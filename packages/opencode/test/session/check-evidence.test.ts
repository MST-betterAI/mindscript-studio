import { describe, expect, test } from "bun:test"
import {
  attributable,
  classify,
  conclusive,
  establishedFailure,
  type CheckRun,
} from "../../src/session/check-evidence"

const run = (over: Partial<CheckRun> = {}): CheckRun => ({
  command: "bun run typecheck",
  scope: ["packages/app"],
  revision: "rev2",
  exitCode: 0,
  elapsedMs: 1200,
  ...over,
})

describe("classify", () => {
  test("a green check is chargeable to the change", () => {
    const event = classify(run(), run({ revision: "rev1" }), "rev2")
    expect(event.outcome).toBe("pass")
    expect(event.attributable).toBe(true)
    expect(event.baselineRevision).toBe("rev1")
  })

  test("a new failure against a green baseline is a real regression", () => {
    const event = classify(
      run({ exitCode: 1, signature: "TS2322 x1" }),
      run({ revision: "rev1", exitCode: 0 }),
      "rev2",
    )
    expect(event.outcome).toBe("fail")
    expect(event.attributable).toBe(true)
  })

  // The case from this repository: 56 failures before anyone touched it. Charging those to
  // the model would mark every single turn as a bad answer.
  test("a suite that was already failing the same way is pre-existing, not the model's fault", () => {
    const event = classify(
      run({ exitCode: 1, signature: "56 fail" }),
      run({ revision: "rev1", exitCode: 1, signature: "56 fail" }),
      "rev2",
    )
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("pre-existing")
    expect(event.attributable).toBe(false)
  })

  test("failing differently than before is news, and is chargeable", () => {
    const event = classify(
      run({ exitCode: 1, signature: "57 fail" }),
      run({ revision: "rev1", exitCode: 1, signature: "56 fail" }),
      "rev2",
    )
    expect(event.outcome).toBe("fail")
    expect(event.attributable).toBe(true)
  })

  test("red with nothing to compare against cannot be charged to anyone", () => {
    const event = classify(run({ exitCode: 1, signature: "TS2322" }), undefined, "rev2")
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("no-baseline")
    expect(event.attributable).toBe(false)
  })

  test("a checker that could not run says nothing about the answer", () => {
    const event = classify(run({ exitCode: null, unavailable: true }), run({ revision: "rev1" }), "rev2")
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("unavailable")
    expect(event.attributable).toBe(false)
  })

  test("a timeout is not a failure", () => {
    const event = classify(run({ exitCode: null, timedOut: true }), run({ revision: "rev1" }), "rev2")
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("timeout")
    expect(event.attributable).toBe(false)
  })

  test("a result for a revision nobody is on any more is stale", () => {
    const event = classify(run({ revision: "rev2", exitCode: 1, signature: "x" }), undefined, "rev3")
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("stale")
    expect(event.attributable).toBe(false)
  })

  test("staleness is checked before anything else, including a pass", () => {
    const event = classify(run({ revision: "rev1" }), undefined, "rev3")
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("stale")
  })

  test("an unusable baseline is treated as no baseline", () => {
    const event = classify(
      run({ exitCode: 1, signature: "TS2322" }),
      run({ revision: "rev1", exitCode: null, timedOut: true }),
      "rev2",
    )
    expect(event.reason).toBe("no-baseline")
  })

  test("a red check with no signature cannot be distinguished from what was already there", () => {
    const event = classify(
      run({ exitCode: 1 }),
      run({ revision: "rev1", exitCode: 1, signature: "56 fail" }),
      "rev2",
    )
    expect(event.outcome).toBe("inconclusive")
    expect(event.reason).toBe("pre-existing")
  })
})

describe("reading a batch", () => {
  const green = classify(run(), run({ revision: "rev1" }), "rev2")
  const regression = classify(
    run({ command: "bun test", exitCode: 1, signature: "a" }),
    run({ command: "bun test", revision: "rev1", exitCode: 0 }),
    "rev2",
  )
  const preExisting = classify(
    run({ command: "bun lint", exitCode: 1, signature: "b" }),
    run({ command: "bun lint", revision: "rev1", exitCode: 1, signature: "b" }),
    "rev2",
  )

  test("inconclusive results are excluded from anything that learns", () => {
    expect(attributable([green, regression, preExisting])).toHaveLength(2)
  })

  test("a real regression counts as established failure", () => {
    expect(establishedFailure([green, regression, preExisting])).toBe(true)
  })

  // The rule that stops a cascade escalating on noise.
  test("pre-existing breakage alone never establishes failure", () => {
    expect(establishedFailure([preExisting])).toBe(false)
    expect(conclusive([preExisting])).toBe(false)
  })

  test("an all-inconclusive batch establishes nothing", () => {
    const unknown = classify(run({ exitCode: 1, signature: "z" }), undefined, "rev2")
    expect(establishedFailure([unknown])).toBe(false)
    expect(conclusive([unknown])).toBe(false)
  })
})
