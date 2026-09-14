import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type LatestUser = { id: string; text: string }

// mindscript_change: the engine needs to know which user turn is a REAL question, because a
// compaction continuation is also a user message. The Founder asked a live question in the VS
// Code panel while a compacted turn was mid-flight; the engine saw only the synthetic
// continuation and kept working, so the panel said "Thinking" and the question was ignored.
//
// Real means: typed by a person. Not a compaction's "What did we do so far?", not a subtask
// announcement, not any part the session marked synthetic when it manufactured it.
export function latestRealUser(messages: readonly SessionV1.WithParts[]): LatestUser | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.info.role !== "user") continue
    // A manufactured turn carries a compaction or subtask part; it is never a person speaking.
    if (message.parts.some((part) => part.type === "compaction" || part.type === "subtask")) continue
    const text = message.parts
      .filter((part) => part.type === "text" && !(part as { synthetic?: boolean }).synthetic && !(part as { ignored?: boolean }).ignored)
      .map((part) => (part as { text?: string }).text ?? "")
      .join("\n")
      .trim()
    if (!text) continue
    return { id: message.info.id, text }
  }
  return undefined
}
