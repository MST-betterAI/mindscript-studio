import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import {
  collectOpenSessionDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
  sameServerOrigin,
  type OpenSessionDeepLink,
} from "./deep-links"

export type DeepLinkRuntime = {
  /** Address of the server this window is talking to, or undefined if unknown. */
  activeServerUrl: () => string | undefined
  /** Open a project without navigating to it. */
  openProject: (directory: string) => void
  /** Confirm a session exists on this server before we navigate to it. */
  sessionExists: (directory: string, sessionID: string) => Promise<boolean>
  navigate: (href: string) => void
  /** Report a problem. The runtime names it; the caller owns the wording, so no user-visible
   *  English lives here (packages/app/AGENTS.md). */
  notify: (problem: { kind: "other-server"; origin: string } | { kind: "not-found"; sessionID: string; directory: string }) => void
}

// mindscript_change: deep links were handled only inside the legacy layout, so under the current
// UI - which mounts a different layout entirely - NOTHING handled them: not the conversation
// links added here, and not upstream's own open-project. The URL arrived in the renderer and sat
// there. Extracted so both layouts share one implementation and neither can silently lose it.
export function createDeepLinkRuntime(runtime: DeepLinkRuntime) {
  // A session id only means something on the server that issued it. A link from a different
  // server is refused rather than resolved against this one, which would open nothing or -
  // worse - an unrelated conversation that happens to share the id.
  const openExistingSession = async (link: OpenSessionDeepLink) => {
    const activeUrl = runtime.activeServerUrl()
    if (activeUrl && !sameServerOrigin(activeUrl, link.origin)) {
      runtime.notify({ kind: "other-server", origin: link.origin })
      return
    }

    // Only the project-scoped form names a directory, and only then can existence be confirmed
    // before navigating. The server-scoped form is handed to the app's own route, which resolves
    // it exactly as pasting the URL would.
    if (link.directory) {
      runtime.openProject(link.directory)
      if (!(await runtime.sessionExists(link.directory, link.sessionID))) {
        runtime.notify({ kind: "not-found", sessionID: link.sessionID, directory: link.directory })
        return
      }
    }
    runtime.navigate(link.path)
  }

  const handle = (urls: string[]) => {
    for (const link of collectOpenSessionDeepLinks(urls)) void openExistingSession(link)
  }

  onMount(() => {
    const listener = (event: Event) => {
      const urls = (event as CustomEvent<{ urls: string[] }>).detail?.urls ?? []
      if (urls.length > 0) handle(urls)
    }
    // Links that arrived before this layout mounted are queued by the desktop shell.
    handle(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, listener as EventListener)
  })

  return { handle, openExistingSession }
}
