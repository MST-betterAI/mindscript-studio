import { useNavigate } from "@solidjs/router"
import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { createDeepLinkRuntime } from "./layout/deep-link-runtime"
import { setV2Toast, showToast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const language = useLanguage()
  const layout = useLayout()
  const server = useServer()
  const serverSync = useServerSync()
  const [state, setState] = createStore({ debugTools: true })

  // mindscript_change: this layout previously handled no deep links at all, so a conversation
  // link reaching the desktop renderer did nothing - silently. Shared with the legacy layout so
  // the two cannot drift apart again.
  createDeepLinkRuntime({
    activeServerUrl: () => {
      const active = server.current
      return active && "http" in active ? active.http.url : undefined
    },
    openProject: (directory) => layout.projects.open(directory),
    sessionExists: async (directory, sessionID) => {
      const sync = serverSync().ensureDirSyncContext(directory)
      if (sync.session.get(sessionID)) return true
      return await sync.session
        .sync(sessionID)
        .then(() => !!sync.session.get(sessionID))
        .catch(() => false)
    },
    navigate: (href) => navigate(href),
    notify: (problem) =>
      showToast({
        variant: "error",
        title:
          problem.kind === "other-server"
            ? language.t("session.link.otherServer.title")
            : language.t("session.link.notFound.title"),
        description:
          problem.kind === "other-server"
            ? language.t("session.link.otherServer.description", { origin: problem.origin })
            : language.t("session.link.notFound.description", {
                sessionID: problem.sessionID,
                directory: problem.directory,
              }),
      }),
  })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
