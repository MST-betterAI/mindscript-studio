// mindscript_change: the MindScript tab — what the engine did in this session, plus
// where its project memory lives. Data comes from the gateway's per-step metadata
// (see session-context-tab.tsx MindScriptSection); nothing here calls the gateway
// directly, so no key ever reaches the browser.
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { authTokenFromCredentials } from "@/utils/server"
import { Button } from "@opencode-ai/ui/button"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { useSessionLayout } from "@/pages/session/session-layout"
import { same } from "@/utils/same"
import { MindScriptSection } from "./session-context-tab"

const emptyMessages: Message[] = []

/** Shape of GET /mindscript/usage (packages/opencode: httpapi/groups/mindscript.ts). */
type AccountUsage = {
  configured: boolean
  reachable: boolean
  baseURL: string
  since?: string
  requests: number
  costUSD: number
  savingsUSD: number
  premiumBaseline?: string
  models: { id: string; requests: number; costUSD: number }[]
  error?: string
}

const SHOW_MODELS_KEY = "mindscript.showModelNames"
function readShowModels() {
  try {
    return localStorage.getItem(SHOW_MODELS_KEY) !== "false"
  } catch {
    return true
  }
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeek() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

/** Account-wide numbers: everything the engine did for this key, not just this session. */
function AccountSection() {
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD", maximumFractionDigits: 2 }))
  const [tick, setTick] = createSignal(0)
  const [showModels, setShowModels] = createSignal(readShowModels())

  const load = async (since?: string): Promise<AccountUsage | undefined> => {
    const http = serverSDK().server.http
    const url = new URL("/mindscript/usage", http.url)
    if (since) url.searchParams.set("since", since)
    const headers: Record<string, string> = {}
    if (http.password) headers.Authorization = `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`
    const doFetch = platform.fetch ?? fetch
    const response = await doFetch(url.toString(), { headers })
    if (!response.ok) return
    return (await response.json()) as AccountUsage
  }

  const [all] = createResource(tick, () => load())
  const [week] = createResource(tick, () => load(startOfWeek()))
  const [today] = createResource(tick, () => load(startOfToday()))

  onMount(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000)
    onCleanup(() => window.clearInterval(timer))
  })

  const state = createMemo(() => {
    const a = all()
    if (a === undefined) return { kind: "loading" as const }
    if (!a.configured) return { kind: "unconfigured" as const, error: a.error }
    if (!a.reachable) return { kind: "unreachable" as const, error: a.error, baseURL: a.baseURL }
    return { kind: "ok" as const, all: a, week: week(), today: today() }
  })

  const Row = (props: { label: string; usage: AccountUsage | undefined }) => (
    <div class="grid grid-cols-4 gap-2 text-12-regular items-baseline">
      <div class="text-text-weak">{props.label}</div>
      <div class="text-text-strong text-right">{props.usage ? props.usage.requests.toLocaleString(language.intl()) : "…"}</div>
      <div class="text-text-strong text-right">{props.usage ? usd().format(props.usage.costUSD) : "…"}</div>
      <div class="text-text-strong text-right">{props.usage ? usd().format(props.usage.savingsUSD) : "…"}</div>
    </div>
  )

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="text-12-regular text-text-weak">Your account (all projects)</div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="small" onClick={() => setTick((n) => n + 1)}>
            Refresh
          </Button>
        </div>
      </div>
      <Show when={state().kind === "loading"}>
        <div class="text-12-regular text-text-weak">Loading…</div>
      </Show>
      <Show when={state().kind === "unconfigured"}>
        <div class="text-12-regular text-text-weak">
          No MindScript key on this machine yet. Put it in <code>~/.config/mindscript/api-key</code> and refresh.
        </div>
      </Show>
      <Show when={state().kind === "unreachable"}>
        <div class="text-12-regular text-text-weak">
          The MindScript engine did not answer{state().kind === "unreachable" && (state() as { baseURL?: string }).baseURL ? ` at ${(state() as { baseURL: string }).baseURL}` : ""}. Is the gateway running?
        </div>
      </Show>
      <Show when={state().kind === "ok" ? (state() as { all: AccountUsage }).all : undefined}>
        {(a) => (
          <div class="border border-border-base rounded-md bg-surface-base px-3 py-2 flex flex-col gap-2">
            <div class="grid grid-cols-4 gap-2 text-12-regular text-text-weak">
              <div />
              <div class="text-right">Requests</div>
              <div class="text-right">Cost</div>
              <div class="text-right">Saved</div>
            </div>
            <Row label="Today" usage={today()} />
            <Row label="Last 7 days" usage={week()} />
            <Row label="All time" usage={a()} />
            <div class="text-12-regular text-text-weak mt-1">
              “Saved” is what always using the premium model would have cost, minus what you paid.
            </div>
            <Show when={a().models.length > 0}>
              <div class="flex items-center justify-between mt-1">
                <div class="text-12-regular text-text-weak">Models used (all time)</div>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    const next = !showModels()
                    setShowModels(next)
                    try {
                      localStorage.setItem(SHOW_MODELS_KEY, String(next))
                    } catch {}
                  }}
                >
                  {showModels() ? "Hide names" : "Show names"}
                </Button>
              </div>
              <Show when={showModels()}>
                <div class="flex flex-col gap-1">
                  <For each={a().models.slice(0, 8)}>
                    {(m) => (
                      <div class="grid grid-cols-4 gap-2 text-12-regular">
                        <div class="col-span-2 text-text-base truncate" title={m.id}>
                          {m.id}
                        </div>
                        <div class="text-text-strong text-right">{m.requests.toLocaleString(language.intl())}</div>
                        <div class="text-text-strong text-right">{usd().format(m.costUSD)}</div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

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

        <AccountSection />

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
