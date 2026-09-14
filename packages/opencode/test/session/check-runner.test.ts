import { describe, expect, test } from "bun:test"
import { applicableChecks, failureSignature, revisionOf } from "../../src/session/check-runner"

const scripts = { typecheck: "tsgo -b", lint: "eslint .", test: "bun test", build: "vite build" }

describe("applicableChecks", () => {
  test("targeted tier runs typecheck and lint, not the test suite", () => {
    const found = applicableChecks({ scripts, changedFiles: ["src/a.ts"], tier: "targeted" })
    expect(found.map((c) => c.script).sort()).toEqual(["lint", "typecheck"])
  })

  test("the wide tier is where the test suite lives", () => {
    const found = applicableChecks({ scripts, changedFiles: ["src/a.ts"], tier: "wide" })
    expect(found.map((c) => c.script)).toEqual(["test"])
  })

  test("editing docs runs nothing - no check can say anything about a README", () => {
    expect(applicableChecks({ scripts, changedFiles: ["README.md"], tier: "targeted" })).toEqual([])
    expect(applicableChecks({ scripts, changedFiles: ["README.md"], tier: "wide" })).toEqual([])
  })

  test("a script the project does not define is never invented", () => {
    const found = applicableChecks({ scripts: { test: "bun test" }, changedFiles: ["src/a.ts"], tier: "targeted" })
    expect(found).toEqual([])
  })

  test("a css-only change does not trigger a typecheck", () => {
    expect(applicableChecks({ scripts, changedFiles: ["src/a.css"], tier: "targeted" })).toEqual([])
  })

  test("a mixed patch is covered by whatever applies to any of it", () => {
    const found = applicableChecks({ scripts, changedFiles: ["README.md", "src/a.tsx"], tier: "targeted" })
    expect(found.map((c) => c.script).sort()).toEqual(["lint", "typecheck"])
  })
})

describe("failureSignature", () => {
  test("green output has no signature", () => {
    expect(failureSignature("22 successful, 22 total\nDone in 3.1s")).toBeUndefined()
  })

  test("the same failure through two runs digests identically despite timings and paths", () => {
    const a = "src/x.ts(12,3): error TS2322: Type 'string' is not assignable\nRan in 1.79s"
    const b = "src/x.ts(12,3): error TS2322: Type 'string' is not assignable\nRan in 24.10s"
    expect(failureSignature(a)).toBe(failureSignature(b))
    expect(failureSignature(a)).toBeDefined()
  })

  // The rule that lets pre-existing breakage be recognised rather than blamed.
  test("a different error is a different signature", () => {
    const before = "error TS2322: Type 'string' is not assignable"
    const after = "error TS2339: Property 'code' does not exist"
    expect(failureSignature(before)).not.toBe(failureSignature(after))
  })

  test("counts are kept, because 56 failures becoming 57 is news", () => {
    expect(failureSignature("56 fail, 0 error")).not.toBe(failureSignature("57 fail, 0 error"))
  })

  test("order of reported errors does not change the digest", () => {
    const a = "error TS1: one\nerror TS2: two"
    const b = "error TS2: two\nerror TS1: one"
    expect(failureSignature(a)).toBe(failureSignature(b))
  })
})

describe("revisionOf", () => {
  test("same content gives the same revision regardless of listing order", () => {
    const one = revisionOf([
      { path: "b.ts", content: "b" },
      { path: "a.ts", content: "a" },
    ])
    const two = revisionOf([
      { path: "a.ts", content: "a" },
      { path: "b.ts", content: "b" },
    ])
    expect(one).toBe(two)
  })

  test("changing a byte changes the revision", () => {
    const before = revisionOf([{ path: "a.ts", content: "a" }])
    const after = revisionOf([{ path: "a.ts", content: "a " }])
    expect(before).not.toBe(after)
  })

  test("moving content between files changes the revision", () => {
    const before = revisionOf([{ path: "a.ts", content: "x" }])
    const after = revisionOf([{ path: "b.ts", content: "x" }])
    expect(before).not.toBe(after)
  })
})
