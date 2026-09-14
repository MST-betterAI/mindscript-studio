import { createMemo, createSignal, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { DialogRoutingModels } from "@/components/dialog-routing-models"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { mindscriptModelLabel, mindscriptSteps, readShowModels } from "@/utils/mindscript-steps"

// mindscript_change: small text next to the model picker button showing what the engine
// actually used most recently — the picker itself only ever says "MindScript Auto"/"MindScript
// Premium" (the mode you chose), not which underlying model auto is currently routing to. Founder
// asked for this so a model switch mid-conversation is visible without opening the MindScript
// tab. Reuses the exact same step data and show/hide-names preference as that tab (same
// utils/mindscript-steps module) so the two never disagree. Depends on event-reducer.ts no
// longer skipping step-finish parts (see that file's comment) — without that fix this always
// reads empty, which is exactly the bug that took several rounds to track down.
export function CurrentModelIndicator() {
  const params = useParams<{ id?: string }>()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const [showModels] = createSignal(readShowModels())

  const label = createMemo(() => {
    const id = params.id
    if (!id) return undefined
    const messages = (sync().data.message[id] ?? []) as Message[]
    const getParts = (messageID: string) => (sync().data.part[messageID] ?? []) as Part[]
    const steps = mindscriptSteps(messages, getParts)
    const last = steps.at(-1)
    if (!last) return undefined
    return mindscriptModelLabel(last.model, showModels())
  })

  return (
    <Show when={label()}>
      {(text) => (
        // mindscript_change: also the way in to which models the engine may route to. It reads as
        // a label but is now a control, so it takes the brighter text the other controls in this
        // row use - a clickable thing that looks unclickable is worse than no affordance at all.
        <button
          type="button"
          data-action="open-routing-models"
          class="truncate text-[11px] leading-4 text-v2-text-text-base hover:text-v2-text-text-strong transition-colors duration-150 select-none"
          title={language.t("dialog.routing.title")}
          onClick={() => dialog.show(() => <DialogRoutingModels />)}
        >
          {text()}
        </button>
      )}
    </Show>
  )
}
