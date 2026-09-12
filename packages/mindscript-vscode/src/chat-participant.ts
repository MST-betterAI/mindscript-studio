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
const IDLE_TIMEOUT_MS = 90_000
const PARTICIPANT_ID = "mindscript.participant"

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

// --- Session identity: one MindScript session per VS Code chat TAB, not per workspace ---------
// docs/conversation-continuity.md: "do not key conversations solely by workspace directory."
// VS Code's chat participant API has no exposed per-tab id, but a participant's ChatResult can
// carry arbitrary `metadata`, and that metadata comes back on the NEXT turn via
// `context.history` (each ChatResponseTurn keeps the `result` it returned). Stashing our session
// ID there means: a fresh chat tab (empty history) gets a fresh MindScript session; continuing
// an existing tab reuses the same one; VS Code's own "New Chat" / tab-switching becomes the
// new/resume UI for free, and — since VS Code persists chat history across window reloads — the
// mapping survives a reload too, without a separate persisted store of our own.

function sessionIdFromHistory(history: vscode.ChatContext["history"]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]
    if (!(turn instanceof vscode.ChatResponseTurn)) continue
    if (turn.participant !== PARTICIPANT_ID) continue
    const meta = turn.result.metadata as { sessionID?: unknown } | undefined
    if (typeof meta?.sessionID === "string" && meta.sessionID) return meta.sessionID
  }
  return undefined
}

async function createSession(info: ServerInfo): Promise<string> {
  const res = await api(info, "/session", { method: "POST", body: JSON.stringify({ title: "VS Code chat" }) })
  if (!res.ok) throw new Error(`could not start a session (${res.status})`)
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error("session response had no id")
  return data.id
}

// mindscript_change: Stop and the idle timeout must reach the backend, not just abort our
// own HTTP/SSE reader — otherwise a cancelled or stalled turn keeps running (and billing)
// server-side. Bob's native-chat check caught this ("Stop interrupts backend execution",
// "Idle timeout interrupts backend execution" both failed before this). Best-effort: the
// client-side abort already stops us consuming output either way.
async function abortBackend(info: ServerInfo, sessionID: string): Promise<void> {
  try {
    await api(info, `/session/${sessionID}/abort`, { method: "POST" })
  } catch {
    // ignore — nothing more we can do from here
  }
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
  let settled = false
  let sawAnyEvent = false
  // mindscript_change: idle-time watchdog, not a flat deadline (same fix as ai-gateway's
  // run.ts, same reason: a healthy turn that runs past 90s while genuinely working must not be
  // cut off — only real silence should trip this). `lastActivityAt` is bumped by any event that
  // belongs to this session; the timer below checks elapsed-since-THAT, re-arming itself against
  // the remaining idle budget rather than firing on a fixed schedule from call start.
  let lastActivityAt = Date.now()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const emittedLen = new Map<string, number>()
  const seenTools = new Set<string>()

  // mindscript_change: dispose this on the way out (see finally below) — otherwise every
  // turn leaks one subscription for the life of the chat tab (Bob's check: "Completed turn
  // disposes cancellation subscription").
  const cancelSub = token.onCancellationRequested(() => {
    settled = true
    abort.abort()
    void abortBackend(info, sessionID)
  })

  const statusTimer = setInterval(() => {
    if (!settled) out.progress(sawAnyEvent ? "MindScript is working…" : "MindScript is starting…")
  }, STATUS_AFTER_MS)
  let idleTimeoutHandle: ReturnType<typeof setTimeout> | undefined
  const armIdleTimeout = () => {
    const check = () => {
      if (settled) return
      const idleMs = Date.now() - lastActivityAt
      if (idleMs >= IDLE_TIMEOUT_MS) {
        settled = true
        abort.abort()
        void abortBackend(info, sessionID)
        return
      }
      idleTimeoutHandle = setTimeout(check, IDLE_TIMEOUT_MS - idleMs)
    }
    idleTimeoutHandle = setTimeout(check, IDLE_TIMEOUT_MS)
  }
  // mindscript_change: arm BEFORE opening the event stream, so a connection attempt that
  // never resolves (server hung, network stall) is bounded by the same mechanism instead of
  // hanging forever (Bob's check: "Event-stream startup has a finite timeout" — the `fetch`
  // below carries `abort.signal`, so the idle timer firing rejects it same as mid-stream silence).
  armIdleTimeout()

  try {
    const eventsRes = await fetch(`${info.url}/event`, { headers: { authorization: authHeader(info) }, signal: abort.signal })
    if (!eventsRes.ok || !eventsRes.body) throw new Error(`could not open the event stream (${eventsRes.status})`)
    reader = eventsRes.body.getReader()
    const decoder = new TextDecoder()

    const done = (async () => {
      let buf = ""
      while (!settled) {
        const { value, done: streamDone } = await reader!.read()
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
          if (evtSessionID === sessionID) lastActivityAt = Date.now()

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

    const send = await api(info, `/session/${sessionID}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
      signal: abort.signal,
    })
    if (!send.ok) throw new Error(`the request was refused (${send.status})`)
    await done
  } finally {
    settled = true
    clearInterval(statusTimer)
    clearTimeout(idleTimeoutHandle)
    abort.abort()
    reader?.cancel().catch(() => {})
    cancelSub.dispose()
  }

  if (!sawAnyEvent && !token.isCancellationRequested) {
    throw new Error(`no activity for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s — try again`)
  }
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  manager: ServerManager,
  workspaceDirectory: () => string | undefined,
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (request, chatContext, stream, token): Promise<vscode.ChatResult | void> => {
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
      // Reuse this tab's own MindScript session if one already exists (see sessionIdFromHistory);
      // otherwise this is a fresh chat tab, so start a fresh conversation.
      let sessionID = sessionIdFromHistory(chatContext.history)
      try {
        if (!sessionID) sessionID = await createSession(info)
        await streamTurn(info, sessionID, request.prompt, stream, token)
      } catch (e) {
        if (token.isCancellationRequested) return { metadata: { sessionID } }
        stream.markdown(`\n\n⚠️ ${e instanceof Error ? e.message : String(e)}`)
      }
      return { metadata: { sessionID } }
    },
  )
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png")
  return participant
}
