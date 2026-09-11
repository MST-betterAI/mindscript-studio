// Starts and supervises one `mindscript serve` per VS Code window. The panel is an
// iframe of the server's own web UI, so the server must stay alive as long as the
// window does, restart if it dies, and stop when the window closes.
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

export class ServerManager {
  private child?: ChildProcess
  private info?: ServerInfo
  private starting?: Promise<ServerInfo>
  private stopping = false
  private restarts = 0
  private readonly listeners = new Set<(info: ServerInfo | undefined) => void>()

  constructor(private readonly out: vscode.OutputChannel) {}

  get current(): ServerInfo | undefined {
    return this.info
  }

  onChange(fn: (info: ServerInfo | undefined) => void): vscode.Disposable {
    this.listeners.add(fn)
    return new vscode.Disposable(() => this.listeners.delete(fn))
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.info)
  }

  async ensure(directory: string): Promise<ServerInfo> {
    if (this.info && this.info.directory === directory && this.child && this.child.exitCode === null) return this.info
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

    child.on("exit", (code) => {
      this.out.appendLine(`[server] exited (${code})`)
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
    const auth = "Basic " + Buffer.from(`${info.username}:${info.password}`).toString("base64")
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`${info.url}/global/health`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) })
        if (r.ok) return
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error("server started but never became healthy")
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    this.child = undefined
    this.info = undefined
    this.emit()
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
}
