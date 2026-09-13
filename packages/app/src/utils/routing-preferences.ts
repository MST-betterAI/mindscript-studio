export type RoutingPriorityKey = "intelligence" | "speed" | "cost"

export type RoutingPriorities = Record<RoutingPriorityKey, number>

export const ROUTING_PRIORITY_KEYS: RoutingPriorityKey[] = ["intelligence", "speed", "cost"]

// Mirrors the gateway's current default routing weights (quality/speed/cost).
export const DEFAULT_ROUTING_PRIORITIES: RoutingPriorities = { intelligence: 0.5, speed: 0.2, cost: 0.3 }
export const DEFAULT_VERBOSITY = 0.5

export function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Intelligence, speed and cost are a soft maximum: they always total 1, so raising one
 * lowers the other two in proportion rather than letting every dial sit at full.
 */
export function softMaxPriorities(
  current: RoutingPriorities,
  key: RoutingPriorityKey,
  next: number,
): RoutingPriorities {
  const value = round(clamp01(next))
  const remaining = round(1 - value)
  const [first, second] = ROUTING_PRIORITY_KEYS.filter((candidate) => candidate !== key)
  const total = clamp01(current[first]) + clamp01(current[second])
  const share = total > 0 ? clamp01(current[first]) / total : 0.5
  const firstValue = round(remaining * share)
  return {
    [key]: value,
    [first]: firstValue,
    [second]: round(remaining - firstValue),
  } as RoutingPriorities
}

export const MAX_PRICE_PER_QUERY_MAX = 100

/** The max-price field is free text; empty or unparseable means "no cap". */
export function parseMaxPricePerQuery(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, "")
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(Math.round(parsed * 10000) / 10000, MAX_PRICE_PER_QUERY_MAX)
}

export function formatMaxPricePerQuery(value: number | null) {
  if (value === null) return ""
  return String(value)
}
