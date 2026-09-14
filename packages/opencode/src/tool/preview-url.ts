// mindscript_change: when the agent starts a dev server, the address it is serving on appears
// once in that command's output and is then lost. The Founder asked the running agent "what is
// the URL for looking at your work?" and it could not answer, because nothing in the session
// retained the answer. Surfacing detected addresses into the tool's own metadata puts them in
// the conversation, where both the model and the reader can see them.

// Terminal output is full of escape codes; dev servers colour the very line we care about
// (Local: <esc>[36mhttp://localhost:5173/<esc>[39m), so strip them before matching.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g

const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])(?::\d{1,5})?(?:\/[^\s"'`<>)\]]*)?/gi

/** Addresses that are the tooling talking to itself, not something a person should open. */
const NOT_A_PREVIEW = /\/(?:__|\.well-known|healthz?|metrics|favicon\.ico)\b/i

export function detectPreviewUrls(text: string, limit = 3): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const found: string[] = []
  for (const raw of text.replace(ANSI, "").match(LOCAL_URL) ?? []) {
    // Trailing punctuation belongs to the sentence, not the URL: "running at http://x:3000."
    const trimmed = raw.replace(/[.,;:!?]+$/, "")
    if (NOT_A_PREVIEW.test(trimmed)) continue
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      continue
    }
    // 0.0.0.0 means "every interface" and is not reliably browsable; :: is its IPv6 equivalent.
    // Rewrite to the loopback address a person can actually open.
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1"
    // A bare host with no port is almost never a dev server someone means to open.
    if (!url.port) continue
    const normalized = url.toString()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    found.push(normalized)
    if (found.length >= limit) break
  }
  return found
}

/** The line handed to the model and shown to the reader, or undefined when there is nothing. */
export function describePreviewUrls(urls: string[]): string | undefined {
  if (urls.length === 0) return undefined
  if (urls.length === 1) return `Serving at ${urls[0]} - open this to see the running app.`
  return `Serving at ${urls.join(" and ")} - open these to see the running app.`
}
