import { describe, expect, test } from "bun:test"
import {
  baselineKey,
  collectEvidence,
  conclusiveRun,
  emptyEvidenceState,
  type RunCheck,
} from "../../src/session/check-evidence-collector"
import type { CheckRun } from "../../src/session/check-evidence"

const scripts = { typecheck: "tsgo -b", lint: "eslint .", test: "bun test" }
const changedFiles = ["src/a.ts"]

/** A stub runner so orchestration can be tested without spawning anything. */
const runner =
  (results: Partial<CheckRun>[]): RunCheck =>
  async ({ definition, revision, scope }) => {
    const next = results.shift() ?? {}
    return {
      command: `bun run ${definition.script}`,
      scope,
      revision,
      exitCode: 0,
      elapsedMs: 10,
      ...next,
    }
  }

const collect = (over: Partial<Parameters<typeof collectEvidence>[0]> = {}) =>
  collectEvidence({
    cwd: "/repo",
    changedFiles,
    scripts,
    tier: "targeted",
    revision: "rev2",
    state: emptyEvidenceState(),
    run: runner([]),
    ...over,
  })

describe("collectEvidence", () => {
  test("a patch nothing covers produces no evidence and no state change", async () => {
    const state = emptyEvidenceState()
    const result = await collectEvidence({
      cwd: "/repo",
      changedFiles: ["README.md"],
      scripts,
      tier: "targeted",
      revision: "rev2",
      state,
      run: runner([]),
    })
    expect(result.events).toEqual([])
    expect(result.state).toBe(state)
  })

  test("runs every applicable check at the tier and records each", async () => {
    const result = await collect({ run: runner([{ exitCode: 0 }, { exitCode: 0 }]) })
    expect(result.events).toHaveLength(2)
    expect(result.events.every((e) => e.outcome === "pass")).toBe(true)
    expect(Object.keys(result.state.baselines)).toHaveLength(2)
  })

  test("a green run becomes the baseline for next time", async () => {
    const first = await collect({ run: runner([{ exitCode: 0 }, { exitCode: 0 }]) })
    const second = await collectEvidence({
      cwd: "/repo",
      changedFiles,
      scripts,
      tier: "targeted",
      revision: "rev3",
      state: first.state,
      run: runner([{ exitCode: 1, signature: "new" }, { exitCode: 0 }]),
    })
    const typecheck = second.events.find((e) => e.command.includes("typecheck"))!
    expect(typecheck.outcome).toBe("fail")
    expect(typecheck.attributable).toBe(true)
    expect(typecheck.baselineRevision).toBe("rev2")
  })

  test("the same failure twice is pre-existing the second time", async () => {
    const first = await collect({ run: runner([{ exitCode: 1, signature: "same" }, { exitCode: 0 }]) })
    expect(first.events.find((e) => e.command.includes("typecheck"))!.outcome).toBe("inconclusive")

    const second = await collectEvidence({
      cwd: "/repo",
      changedFiles,
      scripts,
      tier: "targeted",
      revision: "rev3",
      state: first.state,
      run: runner([{ exitCode: 1, signature: "same" }, { exitCode: 0 }]),
    })
    const typecheck = second.events.find((e) => e.command.includes("typecheck"))!
    expect(typecheck.outcome).toBe("inconclusive")
    expect(typecheck.reason).toBe("pre-existing")
    expect(typecheck.attributable).toBe(false)
  })

  // The rule that stops one flaky moment blinding the next real regression.
  test("a timeout never overwrites a good baseline", async () => {
    const green = await collect({ run: runner([{ exitCode: 0 }, { exitCode: 0 }]) })
    const timedOut = await collectEvidence({
      cwd: "/repo",
      changedFiles,
      scripts,
      tier: "targeted",
      revision: "rev3",
      state: green.state,
      run: runner([{ exitCode: null, timedOut: true }, { exitCode: 0 }]),
    })
    expect(timedOut.events.find((e) => e.command.includes("typecheck"))!.reason).toBe("timeout")

    // The green baseline survived, so the next real failure is still recognisable as new.
    const later = await collectEvidence({
      cwd: "/repo",
      changedFiles,
      scripts,
      tier: "targeted",
      revision: "rev4",
      state: timedOut.state,
      run: runner([{ exitCode: 1, signature: "regression" }, { exitCode: 0 }]),
    })
    const typecheck = later.events.find((e) => e.command.includes("typecheck"))!
    expect(typecheck.outcome).toBe("fail")
    expect(typecheck.attributable).toBe(true)
  })

  test("an unavailable checker never becomes the baseline either", async () => {
    const green = await collect({ run: runner([{ exitCode: 0 }, { exitCode: 0 }]) })
    const missing = await collectEvidence({
      cwd: "/repo",
      changedFiles,
      scripts,
      tier: "targeted",
      revision: "rev3",
      state: green.state,
      run: runner([{ exitCode: null, unavailable: true }, { exitCode: 0 }]),
    })
    const key = baselineKey("bun run typecheck", changedFiles)
    expect(missing.state.baselines[key]!.exitCode).toBe(0)
  })

  test("a result for a superseded revision is stale and is not kept", async () => {
    const result = await collect({
      run: runner([{ exitCode: 0 }, { exitCode: 0 }]),
      currentRevision: () => "rev9",
    })
    expect(result.events.every((e) => e.reason === "stale")).toBe(true)
    expect(result.state.baselines).toEqual({})
  })

  test("an already-aborted collection runs nothing", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await collect({ abort: controller.signal, run: runner([{ exitCode: 0 }]) })
    expect(result.events).toEqual([])
  })

  test("the wide tier is the test suite, separately from targeted", async () => {
    const result = await collect({ tier: "wide", run: runner([{ exitCode: 0 }]) })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.command).toContain("test")
  })
})

describe("conclusiveRun", () => {
  const base: CheckRun = { command: "c", scope: [], revision: "r", exitCode: 0, elapsedMs: 1 }
  test("only a completed run establishes anything", () => {
    expect(conclusiveRun(base)).toBe(true)
    expect(conclusiveRun({ ...base, exitCode: 1 })).toBe(true)
    expect(conclusiveRun({ ...base, exitCode: null, timedOut: true })).toBe(false)
    expect(conclusiveRun({ ...base, exitCode: null, unavailable: true })).toBe(false)
  })
})

describe("baselineKey", () => {
  test("same scope in any order is the same check", () => {
    expect(baselineKey("c", ["b.ts", "a.ts"])).toBe(baselineKey("c", ["a.ts", "b.ts"]))
  })
  test("a different scope is a different check", () => {
    expect(baselineKey("c", ["a.ts"])).not.toBe(baselineKey("c", ["b.ts"]))
  })
})
