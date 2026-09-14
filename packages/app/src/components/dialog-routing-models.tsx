import type { Component, JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { RoutingPreferences } from "./routing-preferences"

// mindscript_change: the Founder wanted the list of models the engine may route to reachable
// from the composer rather than buried in Settings — "a popup on conductor which has all the
// available models, all checked unless the user wants to uncheck ones". The list, the price
// tags and the engine-backed enable/disable already existed in Settings; this only gives them a
// second door. One source of truth, so a box unticked here is unticked there.
const List: Component<{ children: JSX.Element }> = (props) => <div class="flex flex-col">{props.children}</div>

const Row: Component<{ title: string | JSX.Element; description: string | JSX.Element; children: JSX.Element }> = (
  props,
) => (
  <div class="flex items-center justify-between gap-4 py-1.5">
    <div class="min-w-0">
      <div class="text-12-medium text-text-strong truncate">{props.title}</div>
      <div class="text-11-regular text-text-weak truncate">{props.description}</div>
    </div>
    <div class="shrink-0">{props.children}</div>
  </div>
)

const heading = (title: string): JSX.Element => (
  <div class="text-11-medium text-text-weak uppercase tracking-wide pt-2 pb-1">{title}</div>
)

export const DialogRoutingModels: Component = () => {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-2 p-4 min-w-[320px] max-w-[460px]">
      <div class="text-13-medium text-text-strong">{language.t("dialog.routing.title")}</div>
      <p class="text-11-regular text-text-weak">{language.t("dialog.routing.description")}</p>
      <RoutingPreferences List={List} Row={Row} heading={heading} />
    </div>
  )
}
