// Real-process concurrency check for server.ts's spawn-vs-attach race (Bob's review: "start()
// reads the registry, awaits spawning/health, then writes it without an interprocess claim").
// Runs N *actual* ServerManagers, racing ensure() for the SAME project directory at once, against
// the REAL mindscript binary (no mocked transport) — a sequential test cannot exercise this path.
// Only the `vscode` import is stubbed (this file has no VS Code host); everything else — fs, the
// real registry file, the real lock file, the real spawn — is the genuine module under test.
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as net from "node:net"
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"

const sourcePath = fileURLToPath(new URL("../src/server.ts", import.meta.url))
const source = readFileSync(sourcePath, "utf8")
const body = source.slice(source.indexOf("export interface ServerInfo")).replace(/^export /gm, "")
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(body) + "\nreturn { ServerManager }"

class Disposable {
  constructor(private fn?: () => void) {}
  dispose() {
    this.fn?.()
  }
}
const vscode = {
  workspace: { getConfiguration: () => ({ get: (_key: string) => undefined }) },
  window: { showErrorMessage: (msg: string) => console.error("[showErrorMessage]", msg) },
  Disposable,
}

const env = { vscode, fs, os, path, net, spawn, createHash, randomBytes }
const { ServerManager } = new Function(...Object.keys(env), js)(...Object.values(env))

const dir = mkdtempSync(join(tmpdir(), "mindscript-race-"))
const N = 5
const out = { appendLine: () => {} }
const managers = Array.from({ length: N }, () => new ServerManager(out))

console.log(`racing ${N} ServerManager.ensure() calls for ${dir} ...`)
const infos = await Promise.all(managers.map((m: any) => m.ensure(dir)))
const pids = new Set(infos.map((i: any) => i.pid))
const urls = new Set(infos.map((i: any) => i.url))
const result = {
  dir,
  pidsSeen: [...pids],
  urlsSeen: [...urls],
  onePidOnly: pids.size === 1,
  oneUrlOnly: urls.size === 1,
}
console.log(JSON.stringify(result, null, 2))

for (const m of managers) await m.detach()
try {
  process.kill(-(infos[0] as any).pid, "SIGTERM")
} catch {
  /* already gone */
}
rmSync(dir, { recursive: true, force: true })

if (!result.onePidOnly || !result.oneUrlOnly) {
  console.error("FAIL: more than one server was spawned for the same directory")
  process.exit(1)
}
console.log("PASS: exactly one server was spawned across", N, "concurrent ensure() calls")
