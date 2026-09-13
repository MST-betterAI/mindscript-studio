import { describe, expect, test } from "bun:test"
import {
  DEFAULT_ROUTING_PRIORITIES,
  parseMaxPricePerQuery,
  ROUTING_PRIORITY_KEYS,
  softMaxPriorities,
} from "./routing-preferences"
import { priceTier, ROUTABLE_MODELS } from "./routing-catalog"

const total = (priorities: Record<string, number>) =>
  Math.round(ROUTING_PRIORITY_KEYS.reduce((sum, key) => sum + priorities[key], 0) * 100) / 100

describe("softMaxPriorities", () => {
  test("keeps the three priorities summing to 1", () => {
    const raised = softMaxPriorities(DEFAULT_ROUTING_PRIORITIES, "intelligence", 0.8)
    expect(raised.intelligence).toBe(0.8)
    expect(total(raised)).toBe(1)
  })

  test("lowers the other two in proportion to each other", () => {
    // speed 0.2 : cost 0.3 stays 2:3 after intelligence takes 0.8 of the budget.
    const raised = softMaxPriorities(DEFAULT_ROUTING_PRIORITIES, "intelligence", 0.8)
    expect(raised.speed).toBe(0.08)
    expect(raised.cost).toBe(0.12)
  })

  test("splits evenly when the other two are both at zero", () => {
    const collapsed = { intelligence: 1, speed: 0, cost: 0 }
    const lowered = softMaxPriorities(collapsed, "intelligence", 0.5)
    expect(lowered).toEqual({ intelligence: 0.5, speed: 0.25, cost: 0.25 })
  })

  test("clamps out-of-range input", () => {
    expect(softMaxPriorities(DEFAULT_ROUTING_PRIORITIES, "cost", 5).cost).toBe(1)
    expect(softMaxPriorities(DEFAULT_ROUTING_PRIORITIES, "cost", -5).cost).toBe(0)
    expect(total(softMaxPriorities(DEFAULT_ROUTING_PRIORITIES, "cost", 5))).toBe(1)
  })
})

describe("parseMaxPricePerQuery", () => {
  test("reads a plain or dollar-prefixed number", () => {
    expect(parseMaxPricePerQuery("0.25")).toBe(0.25)
    expect(parseMaxPricePerQuery("$1.50")).toBe(1.5)
  })

  test("treats empty, zero and junk as no cap", () => {
    expect(parseMaxPricePerQuery("")).toBeNull()
    expect(parseMaxPricePerQuery("   ")).toBeNull()
    expect(parseMaxPricePerQuery("0")).toBeNull()
    expect(parseMaxPricePerQuery("abc")).toBeNull()
  })
})

describe("priceTier", () => {
  test("bands the catalogue from cheapest to flagship", () => {
    const tier = (id: string) => priceTier(ROUTABLE_MODELS.find((model) => model.id === id)!)
    expect(tier("gpt-5.6-luna")).toBe("$")
    expect(tier("claude-sonnet-5")).toBe("$$")
    expect(tier("claude-opus-5")).toBe("$$$")
    expect(tier("claude-fable-5-1")).toBe("$$$$")
  })

  test("reports free models as free", () => {
    expect(priceTier({ input: 0, output: 0 })).toBe("free")
  })
})
