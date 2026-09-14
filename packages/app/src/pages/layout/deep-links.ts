import { decode64 } from "@/utils/base64"

export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("mindscript://") && !input.startsWith("opencode://")) return // mindscript_change
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

// mindscript_change: open an EXISTING conversation by server + project + session, so the same
// thread can be handed between browser, desktop and the VS Code panel. Deliberately parses the
// ordinary browser URL (`http://host:port/<base64url(directory)>/session/<sessionID>`) rather
// than inventing a second format, so a user can copy the address bar and it just works — and so
// the desktop link and the VS Code extension's `open-session?url=` agree on one shape.
//
// This resolves an existing session only. It never creates a session and never sends a prompt:
// every field is validated and a malformed or foreign link is rejected rather than coerced into
// "open something close enough", which would silently show the wrong conversation.
export type OpenSessionDeepLink = {
  origin: string
  sessionID: string
  /** The in-app route to navigate to — taken from the link, so the app resolves it exactly as if pasted. */
  path: string
  /** Only the legacy project-scoped form carries a directory; the server-scoped form does not. */
  directory?: string
}

// Both shapes are real and a user can copy either from the address bar: the app serves the
// legacy project-scoped URL and then redirects to the server-scoped one, so whichever the user
// happens to copy must work. Verified against a running server in a real browser — the redirect
// is why accepting only one of them looked correct in tests and failed in practice.
export const parseSessionUrl = (input: string): OpenSessionDeepLink | undefined => {
  let target: URL
  try {
    target = new URL(input)
  } catch {
    return
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return
  const segments = target.pathname.split("/").filter(Boolean)

  // Server-scoped (canonical): /server/<base64(serverKey)>/session/<sessionID>
  if (segments.length === 4 && segments[0] === "server" && segments[2] === "session") {
    const sessionID = segments[3]
    if (!sessionID?.startsWith("ses_")) return
    const serverKey = decode64(segments[1])
    // Round-trip like requireServerKey does, so a malformed slug is rejected rather than coerced.
    if (!serverKey || !/^https?:\/\//.test(serverKey)) return
    return { origin: target.origin, sessionID, path: target.pathname }
  }

  // Project-scoped (legacy): /<base64(directory)>/session/<sessionID>
  if (segments.length === 3 && segments[1] === "session") {
    const sessionID = segments[2]
    if (!segments[0] || !sessionID?.startsWith("ses_")) return
    const directory = decode64(segments[0])
    // A project directory is always absolute; anything else means this was not a project slug.
    if (!directory?.startsWith("/")) return
    return { origin: target.origin, sessionID, path: target.pathname, directory }
  }

  return
}

export const parseOpenSessionDeepLink = (input: string): OpenSessionDeepLink | undefined => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-session") return
  const raw = url.searchParams.get("url")
  if (!raw) return
  return parseSessionUrl(raw)
}

// Compare two server addresses by origin, tolerating a trailing slash and an absent default
// port. A session id is only meaningful on the server that issued it, so callers use this to
// refuse a foreign link instead of resolving it against whatever they happen to be connected to.
export const sameServerOrigin = (a: string, b: string) => {
  const origin = (value: string) => {
    try {
      return new URL(value).origin
    } catch {
      return
    }
  }
  const left = origin(a)
  const right = origin(b)
  return !!left && left === right
}

export const collectOpenSessionDeepLinks = (urls: string[]) =>
  urls.map(parseOpenSessionDeepLink).filter((link): link is OpenSessionDeepLink => !!link)

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}
