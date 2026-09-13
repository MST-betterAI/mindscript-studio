import { createResource, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import {
  DEFAULT_ROUTING_PRIORITIES,
  formatMaxPricePerQuery,
  parseMaxPricePerQuery,
  softMaxPriorities,
  type RoutingPriorities,
  type RoutingPriorityKey,
} from "@/utils/routing-preferences"
import { isAutoBalance, loadPreferences, savePreferences } from "@/utils/routing-preferences-client"
import { priceTier, ROUTABLE_MODELS } from "@/utils/routing-catalog"
import "./routing-preferences.css"

type RowComponent = Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}>

type ListComponent = Component<{ children: JSX.Element }>

const PRIORITY_ROWS: { key: RoutingPriorityKey; title: string; description: string }[] = [
  {
    key: "intelligence",
    title: "settings.routing.row.intelligence.title",
    description: "settings.routing.row.intelligence.description",
  },
  { key: "speed", title: "settings.routing.row.speed.title", description: "settings.routing.row.speed.description" },
  { key: "cost", title: "settings.routing.row.cost.title", description: "settings.routing.row.cost.description" },
]

const PreferenceSlider: Component<{
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}> = (props) => (
  <div class="routing-preferences-slider">
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      onInput={(event) => props.onChange(Number(event.currentTarget.value))}
    />
    <span class="routing-preferences-value">{Math.round(props.value * 100)}%</span>
  </div>
)

export const RoutingPreferences: Component<{
  List: ListComponent
  Row: RowComponent
  heading: (title: string) => JSX.Element
}> = (props) => {
  const language = useLanguage()
  const settings = useSettings()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const routing = settings.routing

  // The balance and the model list live on the engine, per account, so every surface
  // sees the same settings. Verbosity and the price cap stay local until the engine
  // can act on them.
  const http = () => serverSDK().server.http
  const doFetch = () => platform.fetch ?? fetch
  const [remote, { mutate: setRemote }] = createResource(() => loadPreferences(http(), doFetch()))
  const [pendingError, setPendingError] = createSignal<string | undefined>()

  const priorities = (): RoutingPriorities => {
    const r = remote()
    if (!r?.reachable) return routing.priorities()
    return { intelligence: r.intelligence, speed: r.speed, cost: r.cost }
  }
  const auto = () => isAutoBalance(priorities())
  const connected = () => remote()?.reachable === true
  const disabledModels = () => remote()?.disabledModels ?? []

  const push = async (update: Partial<RoutingPriorities> & { disabledModels?: string[] }) => {
    const saved = await savePreferences(http(), doFetch(), update).catch(() => undefined)
    if (!saved) {
      setPendingError(language.t("settings.routing.saveFailed"))
      return
    }
    setPendingError(undefined)
    setRemote(saved)
  }

  const setPriority = (key: RoutingPriorityKey, value: number) => {
    const next = softMaxPriorities(priorities(), key, value)
    // Optimistic: the slider must track the thumb, not the round trip.
    setRemote((prev) => (prev ? { ...prev, ...next } : prev))
    routing.setPriority(key, value)
    void push(next)
  }

  const toggleAuto = () => {
    if (auto()) return
    setRemote((prev) => (prev ? { ...prev, ...DEFAULT_ROUTING_PRIORITIES } : prev))
    void push(DEFAULT_ROUTING_PRIORITIES)
  }

  const setModelEnabled = (id: string, enabled: boolean) => {
    const next = enabled ? disabledModels().filter((item) => item !== id) : [...disabledModels(), id]
    setRemote((prev) => (prev ? { ...prev, disabledModels: next } : prev))
    void push({ disabledModels: next })
  }

  return (
    <>
      <div class="flex flex-col gap-1">
        {props.heading(language.t("settings.routing.section.title"))}
        <props.List>
          <props.Row
            title={language.t("settings.routing.row.auto.title")}
            description={language.t("settings.routing.row.auto.description")}
          >
            <div class="routing-preferences-auto" data-action="settings-routing-auto">
              <button
                type="button"
                class="routing-preferences-auto-button"
                aria-pressed={auto()}
                data-active={auto() ? "true" : "false"}
                onClick={toggleAuto}
              >
                {language.t("settings.routing.row.auto.button")}
              </button>
            </div>
          </props.Row>

          <For each={PRIORITY_ROWS}>
            {(row) => (
              <props.Row title={language.t(row.title)} description={language.t(row.description)}>
                <div data-action={`settings-routing-${row.key}`}>
                  <PreferenceSlider
                    label={language.t(row.title)}
                    value={priorities()[row.key]}
                    onChange={(value) => setPriority(row.key, value)}
                  />
                </div>
              </props.Row>
            )}
          </For>

          <props.Row
            title={language.t("settings.routing.row.verbosity.title")}
            description={language.t("settings.routing.row.verbosity.description")}
          >
            <div data-action="settings-routing-verbosity">
              <PreferenceSlider
                label={language.t("settings.routing.row.verbosity.title")}
                value={routing.verbosity()}
                onChange={(value) => routing.setVerbosity(value)}
              />
            </div>
          </props.Row>

          <props.Row
            title={language.t("settings.routing.row.maxPrice.title")}
            description={language.t("settings.routing.row.maxPrice.description")}
          >
            <div class="routing-preferences-price" data-action="settings-routing-max-price">
              <span aria-hidden="true">$</span>
              <input
                type="text"
                inputmode="decimal"
                value={formatMaxPricePerQuery(routing.maxPricePerQuery())}
                placeholder={language.t("settings.routing.row.maxPrice.placeholder")}
                aria-label={language.t("settings.routing.row.maxPrice.title")}
                spellcheck={false}
                autocomplete="off"
                onChange={(event) => routing.setMaxPricePerQuery(parseMaxPricePerQuery(event.currentTarget.value))}
              />
            </div>
          </props.Row>
        </props.List>
        <p class="routing-preferences-hint">{language.t("settings.routing.priorities.hint")}</p>
        <Show when={pendingError()}>{(message) => <p class="routing-preferences-hint">{message()}</p>}</Show>
        <Show when={remote() && !connected()}>
          <p class="routing-preferences-hint">{language.t("settings.routing.offline")}</p>
        </Show>
        <p class="routing-preferences-hint">{language.t("settings.routing.localOnly")}</p>
      </div>

      <div class="flex flex-col gap-1">
        {props.heading(language.t("settings.routing.section.models"))}
        <props.List>
          <For each={ROUTABLE_MODELS}>
            {(model) => (
              <props.Row
                title={model.label}
                description={language.t("settings.routing.models.description", { provider: model.provider })}
              >
                <div class="routing-preferences-model">
                  <span class="routing-preferences-price-tag" title={language.t("settings.routing.models.price")}>
                    <Show when={priceTier(model) !== "free"} fallback={language.t("settings.routing.models.free")}>
                      {priceTier(model)}
                    </Show>
                  </span>
                  <input
                    type="checkbox"
                    checked={!disabledModels().includes(model.id)}
                    disabled={!connected()}
                    aria-label={model.label}
                    onChange={(event) => setModelEnabled(model.id, event.currentTarget.checked)}
                  />
                </div>
              </props.Row>
            )}
          </For>
        </props.List>
        <p class="routing-preferences-hint">{language.t("settings.routing.notConnected")}</p>
      </div>
    </>
  )
}
