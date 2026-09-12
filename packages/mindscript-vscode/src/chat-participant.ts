// mindscript_change: an EXPERIMENT, additive only — nothing here touches the existing sidebar
// panel. This registers `@mindscript` as a native participant in VS Code's own built-in Chat
// view (the same UI style GitHub Copilot Chat uses), so asking MindScript a question feels like
// talking to an assistant *in* the editor rather than opening a separate app in a side panel.
// It talks to the same per-workspace `mindscript serve` this extension already manages — same
// engine, same routing, same memory, same cost accounting — just a second, lighter entry point.
//
// v1 scope, deliberately small: one exchange at a time, plain-text streaming + a note when a
// tool runs, no rich diff/permission UI (the sidebar panel is still the place for that). If this
// direction is worth it, permission prompts and diff rendering are the natural next additions.
import * as vscode from "vscode"
import type { ServerManager, ServerInfo } from "./server"

const STATUS_AFTER_MS = 8_000
const HARD_TIMEOUT_MS = 90_000

type SessionEvent = { type: string; properties?: Record<string, unknown> }

function authHeader(info: ServerInfo): string {
  return "Basic " + Buffer.from(`${info.username}:${info.password}`).toString("base64")
}

async function api(info: ServerInfo, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${info.url}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: authHeader(info), "content-type": "application/json" },
  })
}

/** One session per workspace directory, reused across chat turns so context/memory persist —
 * separate from the sidebar panel's own session, so the two entry points never collide. */
const sessionByDirectory = new Map<string, string>()

async function ensureSession(info: ServerInfo, directory: string): Promise<string> {
  const existing = sessionByDirectory.get(directory)
  if (existing) return existing
  const res = await api(info, "/session", { method: "POST", body: JSON.stringify({ title: "VS Code chat" }) })
  if (!res.ok) throw new Error(`could not start a session (${res.status})`)
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error("session response had no id")
  sessionByDirectory.set(directory, data.id)
  return data.id
}

function partText(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined
  const p = part as { type?: unknown; text?: unknown }
  return p.type === "text" && typeof p.text === "string" ? p.text : undefined
}

function partToolName(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined
  const p = part as { type?: unknown; tool?: unknown; state?: { status?: unknown } }
  if (p.type !== "tool" || typeof p.tool !== "string") return undefined
  return p.state?.status === "running" ? p.tool : undefined
}

async function streamTurn(
  info: ServerInfo,
  sessionID: string,
  prompt: string,
  out: { markdown: (s: string) => void; progress: (s: string) => void },
  token: vscode.CancellationToken,
): Promise<void> {
  const abort = new AbortController()
  token.onCancellationRequested(() => abort.abort())

  const eventsRes = await fetch(`${info.url}/event`, { headers: { authorization: authHeader(info) }, signal: abort.signal })
  if (!eventsRes.ok || !eventsRes.body) throw new Error(`could not open the event stream (${eventsRes.status})`)
  const reader = eventsRes.body.getReader()
  const decoder = new TextDecoder()

  let settled = false
  let sawAnyEvent = false
  const emittedLen = new Map<string, number>()
  const seenTools = new Set<string>()

  const statusTimer = setInterval(() => {
    if (!settled && !sawAnyEvent) out.progress("MindScript is starting…")
  }, STATUS_AFTER_MS)
  const hardTimeout = setTimeout(() => {
    if (settled) return
    settled = true
    abort.abort()
  }, HARD_TIMEOUT_MS)

  const done = (async () => {
    let buf = ""
    while (!settled) {
      const { value, done: streamDone } = await reader.read()
      if (streamDone) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const line = chunk.split("\n").find((l) => l.startsWith("data: "))
        if (!line) continue
        let evt: SessionEvent
        try {
          evt = JSON.parse(line.slice("data: ".length))
        } catch {
          continue
        }
        const props = evt.properties ?? {}
        const evtSessionID = (props as { sessionID?: string; info?: { sessionID?: string } }).sessionID
        if (evtSessionID !== undefined && evtSessionID !== sessionID) continue

        if (evt.type === "message.part.updated") {
          sawAnyEvent = true
          const part = (props as { part?: unknown }).part
          const partId = (part as { id?: string } | undefined)?.id
          const text = partText(part)
          if (text !== undefined && partId) {
            const already = emittedLen.get(partId) ?? 0
            if (text.length > already) {
              out.markdown(text.slice(already))
              emittedLen.set(partId, text.length)
            }
          }
          const tool = partToolName(part)
          if (tool && !seenTools.has(String(partId))) {
            seenTools.add(String(partId))
            out.progress(`Using ${tool}…`)
          }
        }
        if (evt.type === "session.error") {
          const err = (props as { error?: { name?: string; data?: { message?: string } } }).error
          const message = err?.data?.message ?? err?.name ?? "unknown error"
          out.markdown(`\n\n⚠️ ${message}`)
        }
        if (evt.type === "session.idle" || (evt.type === "session.status" && (props as { status?: { type?: string } }).status?.type === "idle")) {
          settled = true
          return
        }
      }
    }
  })()

  try {
    const send = await api(info, `/session/${sessionID}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
      signal: abort.signal,
    })
    if (!send.ok) throw new Error(`the request was refused (${send.status})`)
    await done
  } finally {
    clearInterval(statusTimer)
    clearTimeout(hardTimeout)
    abort.abort()
    reader.cancel().catch(() => {})
  }

  if (!sawAnyEvent && !token.isCancellationRequested) {
    throw new Error(`no response after ${Math.round(HARD_TIMEOUT_MS / 1000)}s — try again`)
  }
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  workspaceDirectory: () => string | undefined,
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant("mindscript.participant", async (request, _chatContext, stream, token) => {
    const directory = workspaceDirectory()
    if (!directory) {
      stream.markdown("Open a folder first — MindScript works per project.")
      return
    }
    let info: ServerInfo
    try {
      stream.progress("Connecting to MindScript…")
      info = await manager.ensure(directory)
    } catch (e) {
      stream.markdown(`Could not start the MindScript server: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    try {
      const sessionID = await ensureSession(info, directory)
      await streamTurn(info, sessionID, request.prompt, stream, token)
    } catch (e) {
      if (token.isCancellationRequested) return
      stream.markdown(`\n\n⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png")
  return participant
}
