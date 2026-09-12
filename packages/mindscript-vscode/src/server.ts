// Starts and supervises a `mindscript serve` for the workspace, or ATTACHES to one already
// running for the same project directory (from another VS Code window, a terminal `mindscript
// serve`, or in principle any other client that registers itself the same way). This is the
// first slice of same-computer conversation continuity (docs/conversation-continuity.md): all
// surfaces watching one project should reach the SAME running server and session, not each get
// their own disconnected copy.
//
// mindscript_change: registry-based discovery is new. Everything else (spawn, health-check,
// restart-with-backoff) is the original per-window behavior, still used when nothing exists yet
// to attach to, or when we own the process we spawned.
import * as vscode from "vscode"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"

export interface ServerInfo {
  url: string
  port: number
  username: string
  password: string
  directory: string
  pid: number
}

const USERNAME = "opencode" // the server's default basic-auth user

function config<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("mindscript").get<T>(key) ?? fallback
}

/** A port that is the same for this workspace every time, so the UI keeps its settings. */
function stablePort(directory: string): number {
  const h = createHash("sha256").update(directory).digest()
  return 20000 + (h.readUInt32BE(0) % 20000)
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once("error", () => resolve(false))
    s.once("listening", () => s.close(() => resolve(true)))
    s.listen(port, "127.0.0.1")
  })
}

export function findBinary(): string | undefined {
  const configured = config<string>("cliPath", "").trim()
  if (configured) return configured
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "mindscript")),
    path.join(os.homedir(), ".opencode", "bin", "mindscript"),
    path.join(os.homedir(), ".mindscript", "bin", "mindscript"),
    "/usr/local/bin/mindscript",
    "/opt/homebrew/bin/mindscript",
  ]
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

// --- Shared discovery registry --------------------------------------------------------------
// One small JSON file per project directory, at the same data root the app itself uses
// ($XDG_DATA_HOME/mindscript, default ~/.local/share/mindscript on macOS/Linux) so this is
// genuinely shared infrastructure, not something private to the VS Code extension. Any two
// processes that agree on this path and format can interoperate; this is intentionally simple
// (a file, not a daemon) so a stale entry left by a crashed process is just ignored, never trusted
// without a live health check.

interface RegistryEntry {
  directory: string
  url: string
  port: number
  username: string
  password: string
  pid: number
  startedAt: string
  updatedAt: string
}

function dataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  return xdg ? path.join(xdg, "mindscript") : path.join(os.homedir(), ".local", "share", "mindscript")
}

function registryPath(directory: string): string {
  const key = createHash("sha256").update(directory).digest("hex")
  return path.join(dataRoot(), "servers", `${key}.json`)
}

function readRegistry(directory: string): RegistryEntry | undefined {
  try {
    const raw = fs.readFileSync(registryPath(directory), "utf8")
    const entry = JSON.parse(raw) as RegistryEntry
    if (entry && entry.directory === directory && typeof entry.url === "string") return entry
  } catch {
    /* no entry, or unreadable — treat as none */
  }
  return undefined
}

/** Atomic write (temp file + rename) so a concurrent reader never sees a half-written file. */
function writeRegistry(entry: RegistryEntry): void {
  const target = registryPath(entry.directory)
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2))
    fs.renameSync(tmp, target)
  } catch {
    /* best-effort: a failed write just means the next process won't find this one to attach to */
  }
}

function clearRegistryIfOwned(directory: string, pid: number): void {
  const current = readRegistry(directory)
  if (current?.pid !== pid) return // someone else's entry (e.g. we were only ever attached) — leave it
  try {
    fs.unlinkSync(registryPath(directory))
  } catch {
    /* already gone */
  }
}

async function checkHealth(url: string, username: string, password: string): Promise<boolean> {
  try {
    const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
    const r = await fetch(`${url}/global/health`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

export class ServerManager {
  private child?: ChildProcess // set only when WE spawned the current server (we own its lifecycle)
  private info?: ServerInfo
  private starting?: Promise<ServerInfo>
  private stopping = false
  private restarts = 0
  private leaseTimer?: ReturnType<typeof setInterval>
  private readonly listeners = new Set<(info: ServerInfo | undefined) => void>()

  constructor(private readonly out: vscode.OutputChannel) {}

  get current(): ServerInfo | undefined {
    return this.info
  }

  /** Whether the currently-attached server is one we spawned (vs. one we found already running). */
  get owns(): boolean {
    return this.child !== undefined
  }

  onChange(fn: (info: ServerInfo | undefined) => void): vscode.Disposable {
    this.listeners.add(fn)
    return new vscode.Disposable(() => this.listeners.delete(fn))
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.info)
  }

  async ensure(directory: string): Promise<ServerInfo> {
    if (this.info && this.info.directory === directory) {
      // Either we own a live child, or we're attached to someone else's — either way, confirm
      // it still answers before reusing it; a dead attachment must not look like a working one.
      if (this.child && this.child.exitCode === null) return this.info
      if (!this.child && (await checkHealth(this.info.url, this.info.username, this.info.password))) return this.info
    }
    if (this.starting) return this.starting
    this.starting = this.start(directory).finally(() => (this.starting = undefined))
    return this.starting
  }

  private async pickPort(directory: string): Promise<number> {
    const fixed = config<number>("port", 0)
    if (fixed > 0) return fixed
    const base = stablePort(directory)
    for (let i = 0; i < 20; i++) if (await portFree(base + i)) return base + i
    return 0
  }

  private async start(directory: string): Promise<ServerInfo> {
    await this.stop()

    // Attach first: if another process already registered a healthy server for this exact
    // directory, use it instead of spawning a redundant one (same-computer continuity's
    // precondition — two surfaces on one server means one session, one live event stream).
    const existing = readRegistry(directory)
    if (existing && (await checkHealth(existing.url, existing.username, existing.password))) {
      this.out.appendLine(`[server] attaching to existing server for ${directory} (pid ${existing.pid}, ${existing.url})`)
      const info: ServerInfo = {
        url: existing.url,
        port: existing.port,
        username: existing.username,
        password: existing.password,
        directory,
        pid: existing.pid,
      }
      this.info = info
      this.restarts = 0
      this.emit()
      return info
    }

    const bin = findBinary()
    if (!bin) {
      throw new Error("The `mindscript` binary was not found. Set mindscript.cliPath in Settings, or install MindScript Studio.")
    }
    const password = randomBytes(24).toString("hex")
    const port = await this.pickPort(directory)
    const baseUrl = config<string>("baseUrl", "").trim()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCODE_SERVER_PASSWORD: password,
      MINDSCRIPT_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: USERNAME,
      OPENCODE_CLIENT: "vscode",
      MINDSCRIPT_CLIENT: "vscode",
      ...(baseUrl ? { MINDSCRIPT_BASE_URL: baseUrl } : {}),
    }
    this.out.appendLine(`[server] starting ${bin} serve --port ${port} in ${directory}`)
    const child = spawn(bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: directory,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.child = child
    this.stopping = false

    const url = await new Promise<string>((resolve, reject) => {
      let buf = ""
      const timer = setTimeout(() => reject(new Error(`server did not report a port within 60 s\n${buf.slice(-600)}`)), 60_000)
      const onData = (d: Buffer) => {
        const text = String(d)
        buf += text
        for (const line of text.split(/\r?\n/)) if (line.trim()) this.out.appendLine(`[server] ${line}`)
        const m = buf.match(/listening on (http:\/\/[^\s]+)/)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      }
      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)
      child.once("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`server exited with code ${code}\n${buf.slice(-600)}`))
      })
    })

    const actualPort = Number(new URL(url).port)
    const info: ServerInfo = { url, port: actualPort, username: USERNAME, password, directory, pid: child.pid ?? -1 }
    await this.waitHealthy(info)
    this.info = info
    this.restarts = 0
    this.emit()

    const now = new Date().toISOString()
    writeRegistry({ directory, url, port: actualPort, username: USERNAME, password, pid: info.pid, startedAt: now, updatedAt: now })
    // Refresh the registry's updatedAt periodically: a future cleanup pass (not built yet) can
    // use staleness to decide an entry is abandoned, without needing this process to still exist.
    this.leaseTimer = setInterval(() => {
      writeRegistry({ directory, url, port: actualPort, username: USERNAME, password, pid: info.pid, startedAt: now, updatedAt: new Date().toISOString() })
    }, 20_000)

    child.on("exit", (code) => {
      this.out.appendLine(`[server] exited (${code})`)
      clearInterval(this.leaseTimer)
      clearRegistryIfOwned(directory, info.pid)
      if (this.child === child) {
        this.child = undefined
        this.info = undefined
        this.emit()
      }
      if (this.stopping) return
      if (this.restarts >= 3) {
        void vscode.window.showErrorMessage("MindScript Studio's server keeps exiting. See the MindScript output channel.")
        return
      }
      const delay = 1000 * 2 ** this.restarts++
      this.out.appendLine(`[server] restarting in ${delay} ms`)
      setTimeout(() => void this.ensure(directory).catch((e) => this.out.appendLine(`[server] restart failed: ${e}`)), delay)
    })
    return info
  }

  private async waitHealthy(info: ServerInfo): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (await checkHealth(info.url, info.username, info.password)) return
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error("server started but never became healthy")
  }

  /**
   * Detach this manager from its current server. If we own the process (we spawned it), this
   * still stops it — used by the explicit "Restart Server" command, where killing and respawning
   * is exactly what was asked for. If we're merely attached to someone else's server, this never
   * touches that process — closing one view must not kill work another view may be watching
   * (docs/conversation-continuity.md, C5). Call sites: `stopOwned()` on deactivate (never kills a
   * shared server); `stop()` (this method) for an explicit user-requested restart.
   */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.info = undefined
      this.emit()
      return
    }
    this.stopping = true
    this.child = undefined
    this.info = undefined
    this.emit()
    clearInterval(this.leaseTimer)
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM")
      else child.kill("SIGTERM")
    } catch {
      /* already gone */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL")
          else child.kill("SIGKILL")
        } catch {
          /* gone */
        }
        resolve()
      }, 5000)
      child.once("exit", () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  /**
   * Called when this VS Code window closes. Detaches without killing anything: if we own the
   * server, it keeps running in the background (any other attached view, or a future attacher,
   * keeps working) rather than dying with this window — the whole point of a shared service.
   * Known, deliberate gap in this first slice: nothing here shuts an ABANDONED server down when
   * truly nobody is left watching it; that needs a real reference count or idle-timeout, tracked
   * as the next increment, not solved by this file.
   */
  async detach(): Promise<void> {
    clearInterval(this.leaseTimer)
    if (this.child) this.child.unref() // let the extension host exit without waiting on it
    this.child = undefined
    this.info = undefined
    this.emit()
  }
}
