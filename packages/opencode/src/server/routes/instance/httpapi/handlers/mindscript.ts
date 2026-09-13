// mindscript_change: see groups/mindscript.ts. The key and base URL are resolved the
// same way the MindScript plugin resolves them (environment first, then the key file).
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { MindScriptApi } from "../groups/mindscript"

type ModelUsage = { id: string; requests: number; costUSD: number }

type Usage = {
  configured: boolean
  reachable: boolean
  baseURL: string
  since?: string
  requests: number
  costUSD: number
  savingsUSD: number
  premiumBaseline?: string
  models: ModelUsage[]
  error?: string
}

function gatewayBase() {
  const raw = process.env.MINDSCRIPT_BASE_URL?.trim() || "http://127.0.0.1:8787/v1"
  return raw.replace(/\/v1\/?$/, "").replace(/\/$/, "")
}

function apiKey() {
  const fromEnv = process.env.MINDSCRIPT_API_KEY?.trim()
  if (fromEnv) return fromEnv
  for (const file of [join(homedir(), ".config", "mindscript", "api-key"), join(homedir(), ".config", "opencode", "api-key")]) {
    try {
      const key = readFileSync(file, "utf8").trim()
      if (key) return key
    } catch {}
  }
  return ""
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

function modelsOf(byModel: unknown): ModelUsage[] {
  if (!byModel || typeof byModel !== "object") return []
  return Object.entries(byModel as Record<string, unknown>)
    .map(([id, value]) => {
      if (typeof value === "number") return { id, requests: value, costUSD: 0 }
      const v = (value ?? {}) as Record<string, unknown>
      // The engine reports provider cost and the MindScript fee separately per model.
      const cost = v.effectiveCostUSD ?? v.costUSD ?? v.cost ?? num(v.providerCostUSD) + num(v.feeUSD)
      return {
        id,
        requests: num(v.requests ?? v.count ?? v.calls),
        costUSD: num(cost),
      }
    })
    .sort((a, b) => b.requests - a.requests)
}

async function fetchUsage(base: string, key: string, since: string | undefined): Promise<Usage> {
  const empty: Usage = {
    configured: true,
    reachable: false,
    baseURL: base,
    since,
    requests: 0,
    costUSD: 0,
    savingsUSD: 0,
    models: [],
  }
  try {
    const url = new URL(`${base}/v1/usage`)
    if (since) url.searchParams.set("since", since)
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { ...empty, error: `engine answered ${response.status}` }
    const u = (await response.json()) as Record<string, unknown>
    return {
      ...empty,
      reachable: true,
      requests: num(u.requests),
      costUSD: num(u.effectiveCostUSD),
      savingsUSD: num(u.savings_vs_premium_usd),
      premiumBaseline: typeof u.premium_baseline === "string" ? u.premium_baseline : undefined,
      models: modelsOf(u.byModel),
    }
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
}

type Preferences = {
  configured: boolean
  reachable: boolean
  intelligence: number
  speed: number
  cost: number
  disabledModels: string[]
  error?: string
}

// The engine calls the quality axis "quality"; the UI calls it intelligence.
function preferencesFrom(body: Record<string, unknown>, base: Preferences): Preferences {
  const weights = (body.weights ?? {}) as Record<string, unknown>
  const disabled = body.disabledModelIds
  return {
    ...base,
    reachable: true,
    intelligence: num(weights.quality),
    speed: num(weights.speed),
    cost: num(weights.cost),
    disabledModels: Array.isArray(disabled) ? disabled.filter((id): id is string => typeof id === "string") : [],
  }
}

async function callPreferences(
  base: string,
  key: string,
  update?: { intelligence?: number; speed?: number; cost?: number; disabledModels?: readonly string[] },
): Promise<Preferences> {
  const empty: Preferences = {
    configured: true,
    reachable: false,
    intelligence: 0.5,
    speed: 0.2,
    cost: 0.3,
    disabledModels: [],
  }
  try {
    const response = await fetch(`${base}/v1/settings`, {
      method: update ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, ...(update ? { "content-type": "application/json" } : {}) },
      body: update
        ? JSON.stringify({
            quality: update.intelligence,
            speed: update.speed,
            cost: update.cost,
            disabledModelIds: update.disabledModels ? [...update.disabledModels] : undefined,
          })
        : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { ...empty, error: `engine answered ${response.status}` }
    return preferencesFrom((await response.json()) as Record<string, unknown>, empty)
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
}

export const mindscriptHandlers = HttpApiBuilder.group(MindScriptApi, "mindscript", (handlers) =>
  Effect.gen(function* () {
    const usage = Effect.fn("MindScriptHttpApi.usage")(function* (ctx: { query: { since?: string } }) {
      const base = gatewayBase()
      const key = apiKey()
      if (!key) {
        const result: Usage = {
          configured: false,
          reachable: false,
          baseURL: base,
          since: ctx.query.since,
          requests: 0,
          costUSD: 0,
          savingsUSD: 0,
          models: [],
          error: "no MindScript API key (MINDSCRIPT_API_KEY or ~/.config/mindscript/api-key)",
        }
        return result
      }
      return yield* Effect.promise(() => fetchUsage(base, key, ctx.query.since))
    })

    const unconfigured = (): Preferences => ({
      configured: false,
      reachable: false,
      intelligence: 0.5,
      speed: 0.2,
      cost: 0.3,
      disabledModels: [],
      error: "no MindScript API key (MINDSCRIPT_API_KEY or ~/.config/mindscript/api-key)",
    })

    const preferences = Effect.fn("MindScriptHttpApi.preferences")(function* () {
      const key = apiKey()
      if (!key) return unconfigured()
      return yield* Effect.promise(() => callPreferences(gatewayBase(), key))
    })

    const setPreferences = Effect.fn("MindScriptHttpApi.setPreferences")(function* (ctx: {
      payload: { intelligence?: number; speed?: number; cost?: number; disabledModels?: readonly string[] }
    }) {
      const key = apiKey()
      if (!key) return unconfigured()
      return yield* Effect.promise(() => callPreferences(gatewayBase(), key, ctx.payload))
    })

    return handlers.handle("usage", usage).handle("preferences", preferences).handle("setPreferences", setPreferences)
  }),
)
