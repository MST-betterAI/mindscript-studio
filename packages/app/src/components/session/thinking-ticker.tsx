import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { quoteFor } from "./thinking-quotes"
import "./thinking-ticker.css"

// mindscript_change: the Founder's report was that nothing shows MindScript is thinking. A
// spinner says "busy"; this says "busy, and here is something worth reading meanwhile". The
// quote scrolls left to right and changes as the wait goes on, so a long turn does not look
// frozen. No model is called - see thinking-quotes.ts for why.
const ROTATE_MS = 12_000

export function ThinkingTicker(props: { active: boolean; sessionID: string }) {
  const [index, setIndex] = createSignal(0)

  createEffect(() => {
    if (!props.active) {
      setIndex(0)
      return
    }
    const timer = setInterval(() => setIndex((value) => value + 1), ROTATE_MS)
    onCleanup(() => clearInterval(timer))
  })

  const quote = () => quoteFor(props.sessionID, index())

  return (
    <Show when={props.active}>
      <div
        data-component="thinking-ticker"
        class="pointer-events-none w-full overflow-hidden select-none"
        aria-live="off"
      >
        <div class="thinking-ticker-track whitespace-nowrap text-[11px] leading-4 text-v2-text-text-faint">
          <span>{quote().text}</span>
          <span class="opacity-70"> — {quote().who}</span>
        </div>
      </div>
    </Show>
  )
}
