// The product ships English only, so there is no cross-locale parity left to enforce.
// What survives from the old parity suite is the pluralisation contract for the changed-file
// summary, which is a real English-copy bug if it regresses.
import { describe, expect, test } from "bun:test"

async function dictionary(file: string) {
  const module: unknown = await import(file)
  if (typeof module !== "object" || module === null || !("dict" in module) || !isDictionary(module.dict)) {
    throw new Error(`Invalid translation dictionary: ${file}`)
  }
  return module.dict
}

function isDictionary(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

describe("English copy", () => {
  test("changed-file summary reads as a complete phrase at one and many", async () => {
    const source = await dictionary("../../../ui/src/i18n/en.ts")
    expect(source["ui.sessionTurn.diffs.changed.one"].replace("{{count}}", "1")).toBe("1 Changed file")
    expect(source["ui.sessionTurn.diffs.changed.other"].replace("{{count}}", "2")).toBe("2 Changed files")
    // A non-plural key here would bypass the plural forms above.
    expect(source["ui.sessionTurn.diffs.changed"]).toBeUndefined()
  })

  test("every app and ui value is a string", async () => {
    await dictionary("./en.ts")
    await dictionary("../../../ui/src/i18n/en.ts")
  })
})
