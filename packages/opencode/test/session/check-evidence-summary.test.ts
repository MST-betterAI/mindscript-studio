import { describe, expect, test } from "bun:test"
import {
  accumulate,
  conclusiveRate,
  coverageRate,
  describe as describeSummary,
  emptySummary,
  medianDuration,
} from "../../src/session/check-evidence-summary"
import type { CheckEvent } from "../../src/session/check-evidence"

const event = (over: Partial<CheckEvent> = {}): CheckEvent => ({
  command: "bun run typecheck",
  scope: ["src/a.ts"],
  revision: "rev",
  outcome: "pass",
  elapsedMs: 100,
  attributable: true,
  ...over,
})

const pass = event()
const fail = event({ outcome: "fail", signature: "s" })
const preExisting = event({ outcome: "inconclusive", reason: "pre-existing", attributable: false })
const timedOut = event({ outcome: "inconclusive", reason: "timeout", attributable: false, elapsedMs: 120_000 })

describe("accumulate", () => {
  test("a turn nothing covered is counted, and marked as unjudgeable", () => {
    const summary = accumulate(emptySummary(), [])
    expect(summary.turns).toBe(1)
    expect(summary.turnsUnchecked).toBe(1)
    expect(summary.turnsConclusive).toBe(0)
    expect(summary.events).toBe(0)
  })

  test("a verified turn is conclusive", () => {
    const summary = accumulate(emptySummary(), [pass])
    expect(summary.turnsConclusive).toBe(1)
    expect(summary.turnsInconclusive).toBe(0)
    expect(summary.eventsByOutcome.pass).toBe(1)
  })

  test("a turn where checks ran but established nothing is inconclusive, not unchecked", () => {
    const summary = accumulate(emptySummary(), [preExisting, timedOut])
    expect(summary.turnsInconclusive).toBe(1)
    expect(summary.turnsUnchecked).toBe(0)
    expect(summary.inconclusiveByReason["pre-existing"]).toBe(1)
    expect(summary.inconclusiveByReason.timeout).toBe(1)
  })

  test("one chargeable result makes the turn conclusive even beside noise", () => {
    const summary = accumulate(emptySummary(), [preExisting, fail])
    expect(summary.turnsConclusive).toBe(1)
    expect(summary.turnsFailed).toBe(1)
  })

  test("unresolved turns are counted separately from failures", () => {
    const summary = accumulate(emptySummary(), [preExisting], { unresolved: true })
    expect(summary.turnsUnresolved).toBe(1)
    expect(summary.turnsFailed).toBe(0)
  })

  test("duration and coverage accumulate, because checks are not free", () => {
    let summary = accumulate(emptySummary(), [pass, event({ scope: ["src/b.ts"], elapsedMs: 300 })])
    summary = accumulate(summary, [event({ scope: ["src/a.ts"], elapsedMs: 200 })])
    expect(summary.checkMs).toBe(600)
    expect(summary.filesCovered).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("accumulating does not mutate the previous summary", () => {
    const first = accumulate(emptySummary(), [pass])
    const second = accumulate(first, [fail])
    expect(first.turns).toBe(1)
    expect(second.turns).toBe(2)
    expect(first.eventsByOutcome.fail).toBe(0)
  })
})

describe("the rates the decision turns on", () => {
  test("conclusive rate ignores turns nothing could check", () => {
    let summary = accumulate(emptySummary(), []) // unchecked
    summary = accumulate(summary, [pass]) // conclusive
    summary = accumulate(summary, [preExisting]) // inconclusive
    expect(conclusiveRate(summary)).toBe(0.5)
    expect(coverageRate(summary)).toBeCloseTo(2 / 3)
  })

  test("both rates are zero rather than NaN with no data", () => {
    expect(conclusiveRate(emptySummary())).toBe(0)
    expect(coverageRate(emptySummary())).toBe(0)
  })

  // The case that would make the loop not worth switching on.
  test("mostly-inconclusive work shows up as a low conclusive rate", () => {
    let summary = emptySummary()
    for (let i = 0; i < 9; i++) summary = accumulate(summary, [preExisting])
    summary = accumulate(summary, [pass])
    expect(conclusiveRate(summary)).toBeCloseTo(0.1)
  })
})

describe("medianDuration", () => {
  test("is zero with nothing recorded", () => {
    expect(medianDuration(emptySummary())).toBe(0)
  })

  test("is a median, so one slow suite does not distort it like a mean would", () => {
    let summary = emptySummary()
    summary = accumulate(summary, [event({ elapsedMs: 100 }), event({ elapsedMs: 200 })])
    summary = accumulate(summary, [event({ elapsedMs: 120_000 })])
    expect(medianDuration(summary)).toBe(200)
  })

  test("averages the middle pair when the count is even", () => {
    const summary = accumulate(emptySummary(), [event({ elapsedMs: 100 }), event({ elapsedMs: 300 })])
    expect(medianDuration(summary)).toBe(200)
  })
})

describe("describe", () => {
  test("renders the numbers a decision would be made on", () => {
    let summary = accumulate(emptySummary(), [pass])
    summary = accumulate(summary, [preExisting])
    const line = describeSummary(summary)
    expect(line).toContain("turns=2")
    expect(line).toContain("conclusive=50%")
    expect(line).toContain("pre-existing=1")
  })

  test("says none rather than an empty list when nothing was inconclusive", () => {
    expect(describeSummary(accumulate(emptySummary(), [pass]))).toContain("inconclusive: none")
  })
})
