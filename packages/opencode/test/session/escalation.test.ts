import { describe, expect, test } from "bun:test"
import { decide, formatEvidence, signaturesToResolve, type EscalationPolicy } from "../../src/session/escalation"
import type { CheckEvent } from "../../src/session/check-evidence"

const event = (over: Partial<CheckEvent> = {}): CheckEvent => ({
  command: "bun run typecheck",
  scope: ["src/a.ts"],
  revision: "rev2",
  outcome: "pass",
  elapsedMs: 100,
  attributable: true,
  ...over,
})

const pass = event()
const realFailure = event({ outcome: "fail" })
const preExisting = event({ outcome: "inconclusive", reason: "pre-existing", attributable: false })
const timedOut = event({ outcome: "inconclusive", reason: "timeout", attributable: false })
const noBaseline = event({ outcome: "inconclusive", reason: "no-baseline", attributable: false })

const policy: EscalationPolicy = {
  ladder: [
    { label: "cheap", estimatedUsd: 0.01 },
    { label: "same model, higher effort", effort: "high", estimatedUsd: 0.05 },
    { label: "stronger model", model: "strong", estimatedUsd: 0.4 },
  ],
  maxAttempts: 3,
}
const start = { rungIndex: 0, attempts: 1, spentUsd: 0.01 }

describe("accepting", () => {
  test("a verified change is accepted", () => {
    expect(decide({ policy, state: start, events: [pass] })).toEqual({ action: "accept", reason: "verified" })
  })

  test("a turn with nothing to check is accepted, not treated as failure", () => {
    expect(decide({ policy, state: start, events: [] })).toEqual({ action: "accept", reason: "no-evidence" })
  })
})

// The rules that stop this costing money on noise. Each of these would otherwise look like
// failure and escalate to a more expensive model for nothing.
describe("never escalating on what we do not know", () => {
  test("pre-existing breakage does not escalate", () => {
    expect(decide({ policy, state: start, events: [preExisting] }).action).toBe("accept")
  })

  test("a timeout does not escalate", () => {
    expect(decide({ policy, state: start, events: [timedOut] }).action).toBe("accept")
  })

  test("a red check with no baseline does not escalate", () => {
    expect(decide({ policy, state: start, events: [noBaseline] }).action).toBe("accept")
  })

  test("an all-inconclusive batch is reported as inconclusive, not verified", () => {
    const decision = decide({ policy, state: start, events: [preExisting, timedOut] })
    expect(decision).toEqual({ action: "accept", reason: "inconclusive" })
  })

  test("a real failure alongside noise still escalates", () => {
    expect(decide({ policy, state: start, events: [preExisting, realFailure] }).action).toBe("retry")
  })
})

describe("escalating", () => {
  test("a genuine regression retries at the next rung, carrying what failed", () => {
    const decision = decide({ policy, state: start, events: [realFailure] })
    expect(decision).toMatchObject({ action: "retry", rungIndex: 1 })
    if (decision.action !== "retry") throw new Error("expected retry")
    expect(decision.rung.label).toBe("same model, higher effort")
    expect(decision.evidence).toContain("bun run typecheck failed")
  })

  test("it climbs one rung at a time", () => {
    const decision = decide({ policy, state: { rungIndex: 1, attempts: 2, spentUsd: 0.06 }, events: [realFailure] })
    if (decision.action !== "retry") throw new Error("expected retry")
    expect(decision.rung.label).toBe("stronger model")
  })

  test("it stops at the top of the ladder rather than looping", () => {
    // attempts deliberately below the cap, so this isolates ladder exhaustion.
    const decision = decide({ policy, state: { rungIndex: 2, attempts: 2, spentUsd: 0.5 }, events: [realFailure] })
    expect(decision).toEqual({ action: "stop", reason: "ladder-exhausted" })
  })

  test("when both limits are reached, attempts is reported first", () => {
    const decision = decide({ policy, state: { rungIndex: 2, attempts: 3, spentUsd: 0.5 }, events: [realFailure] })
    expect(decision).toEqual({ action: "stop", reason: "attempts-exhausted" })
  })

  test("attempts are capped even with ladder left", () => {
    const decision = decide({ policy, state: { rungIndex: 0, attempts: 3, spentUsd: 0.01 }, events: [realFailure] })
    expect(decision).toEqual({ action: "stop", reason: "attempts-exhausted" })
  })
})

describe("budget", () => {
  test("an unaffordable attempt is refused before anything is spent", () => {
    const decision = decide({
      policy: { ...policy, budgetUsd: 0.03 },
      state: start,
      events: [realFailure],
    })
    expect(decision).toEqual({ action: "stop", reason: "budget-exhausted" })
  })

  test("an affordable attempt proceeds", () => {
    const decision = decide({ policy: { ...policy, budgetUsd: 1 }, state: start, events: [realFailure] })
    expect(decision.action).toBe("retry")
  })

  // The ceiling covers the whole request, as Bob ruled - not each provider call.
  test("spend already made counts against the ceiling", () => {
    const decision = decide({
      policy: { ...policy, budgetUsd: 0.05 },
      state: { rungIndex: 0, attempts: 1, spentUsd: 0.04 },
      events: [realFailure],
    })
    expect(decision).toEqual({ action: "stop", reason: "budget-exhausted" })
  })
})

// The gap the live run exposed: baseline comparison alone calls a failure the retry did not
// fix "pre-existing", because the previous failing run became the baseline. Inside a retry
// sequence, unchanged means the repair failed.
describe("a retry that did not fix what it was sent to fix", () => {
  const stillBroken = event({
    outcome: "inconclusive",
    reason: "pre-existing",
    attributable: false,
    signature: "sig-A",
  })

  test("is not accepted just because it now looks pre-existing", () => {
    const decision = decide({
      policy,
      state: { rungIndex: 1, attempts: 2, spentUsd: 0.06, resolving: ["sig-A"] },
      events: [stillBroken],
    })
    expect(decision.action).toBe("retry")
    if (decision.action !== "retry") throw new Error("expected retry")
    expect(decision.rung.label).toBe("stronger model")
  })

  test("but the same shape with nothing being repaired is still just pre-existing", () => {
    const decision = decide({
      policy,
      state: { rungIndex: 1, attempts: 2, spentUsd: 0.06 },
      events: [stillBroken],
    })
    expect(decision).toEqual({ action: "accept", reason: "inconclusive" })
  })

  test("an unrelated pre-existing failure does not count as unresolved", () => {
    const decision = decide({
      policy,
      state: { rungIndex: 1, attempts: 2, spentUsd: 0.06, resolving: ["sig-A"] },
      events: [event({ outcome: "inconclusive", reason: "pre-existing", attributable: false, signature: "sig-Z" })],
    })
    expect(decision.action).toBe("accept")
  })

  test("a repair that worked is accepted", () => {
    const decision = decide({
      policy,
      state: { rungIndex: 1, attempts: 2, spentUsd: 0.06, resolving: ["sig-A"] },
      events: [pass],
    })
    expect(decision).toEqual({ action: "accept", reason: "verified" })
  })

  test("unresolved still respects the limits rather than looping forever", () => {
    const decision = decide({
      policy,
      state: { rungIndex: 2, attempts: 2, spentUsd: 0.5, resolving: ["sig-A"] },
      events: [stillBroken],
    })
    expect(decision).toEqual({ action: "stop", reason: "ladder-exhausted" })
  })
})

describe("signaturesToResolve", () => {
  test("collects what the next attempt must clear, ignoring passes", () => {
    expect(
      signaturesToResolve([pass, event({ outcome: "fail", signature: "s1" }), event({ outcome: "fail", signature: "s2" })]),
    ).toEqual(["s1", "s2"])
  })
})

describe("formatEvidence", () => {
  test("only chargeable failures are handed to the next attempt", () => {
    const text = formatEvidence([realFailure, preExisting, pass])
    expect(text).toContain("bun run typecheck failed")
    expect(text.split("\n")).toHaveLength(1)
  })

  test("nothing to say when nothing genuinely failed", () => {
    expect(formatEvidence([pass, preExisting])).toBe("")
  })
})
