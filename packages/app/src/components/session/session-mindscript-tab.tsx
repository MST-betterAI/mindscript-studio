// mindscript_change: the MindScript tab — what the engine did in this session, plus
// where its project memory lives. Data comes from the gateway's per-step metadata
// (see session-context-tab.tsx MindScriptSection); nothing here calls the gateway
// directly, so no key ever reaches the browser.
import { createMemo, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { useSessionLayout } from "@/pages/session/session-layout"
import { same } from "@/utils/same"
import { MindScriptSection } from "./session-context-tab"

const emptyMessages: Message[] = []

export function SessionMindScriptTab() {
  const sync = useSync()
  const sdk = useSDK()
  const { params } = useSessionLayout()
  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )
  const getParts = (id: string) => (sync().data.part[id] ?? []) as Part[]
  const directory = createMemo(() => sdk().directory ?? "")
  const hasSteps = createMemo(() =>
    messages().some((m) => m.role === "assistant" && getParts(m.id).some((p) => p.type === "step-finish" && (p as unknown as { metadata?: unknown }).metadata !== undefined)),
  )

  return (
    <ScrollView class="@container h-full">
      <div class="px-6 pt-4 pb-10 flex flex-col gap-8">
        <div class="flex flex-col gap-1">
          <div class="text-14-medium text-text-strong">MindScript — Smarter Faster Cheaper</div>
          <div class="text-12-regular text-text-weak">
            Every step of this session was routed by the MindScript engine to the best-value model for that step.
            Below: what it chose, what it cost, and what always using the premium model would have cost.
          </div>
        </div>

        <Show
          when={hasSteps()}
          fallback={<div class="text-12-regular text-text-weak">No routed steps yet — send a message and this fills in as the engine works.</div>}
        >
          <MindScriptSection messages={messages()} getParts={getParts} />
        </Show>

        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-text-weak">Project memory</div>
          <div class="border border-border-base rounded-md bg-surface-base px-3 py-2 text-12-regular">
            <div class="text-text-base">
              <code>{directory() ? `${directory()}/.mindscript/memory.md` : ".mindscript/memory.md"}</code>
            </div>
            <div class="text-text-weak mt-1">
              Durable facts, decisions and gotchas the engine writes after each task (once the folder is allowlisted for memory).
              <code>sessions.jsonl</code> next to it is the log of finished tasks. Both are plain files: read them, edit them, commit
              <code> memory.md</code>.
            </div>
          </div>
        </div>
      </div>
    </ScrollView>
  )
}
