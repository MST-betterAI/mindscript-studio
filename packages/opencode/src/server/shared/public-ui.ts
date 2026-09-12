// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head>. These bypass auth so the page can install/render
// the manifest icons even when a server password is configured.
//
// mindscript_change: this used to cover only a few manifest icons, missing the
// SPA's OWN bundle. A page loaded via `?auth_token=` in its URL (the VS Code
// extension's embedding scheme, and in principle any bookmarked/shared link)
// gets that token on the initial document request, but the browser's own
// subsequent <script src>/<link href> requests for /assets/index-*.js and
// -*.css do NOT carry the parent page's query string — those are separate,
// unauthenticated requests. Without this, the auth middleware 401s the app's
// own bundle, so it never executes: #root stays empty forever (the visible
// symptom is a blank page in whatever background color the theme happens to
// be — reported as a blank white screen in the VS Code editor-tab panel).
// Static assets carry no secrets — real protection belongs on the data/API
// routes (session content, event streams), which keep their own auth layer
// untouched by this.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/favicon-96x96-v3.png",
  "/favicon-v3.svg",
  "/favicon-v3.ico",
  "/apple-touch-icon-v3.png",
  "/social-share.png",
])

const PUBLIC_UI_PREFIXES = ["/assets/"]

export function isPublicUIPath(method: string, pathname: string) {
  if (method !== "GET") return false
  if (PUBLIC_UI_PATHS.has(pathname)) return true
  return PUBLIC_UI_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
