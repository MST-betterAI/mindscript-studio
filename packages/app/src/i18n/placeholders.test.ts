import { describe, expect, test } from "bun:test"
import { dict } from "./en"

// mindscript_change: a single-brace placeholder is not interpolated — it renders literally, so
// the user reads "The link points at {origin}". That shipped once and was only caught by reading
// a real toast in a running app. Cheap to assert, invisible to typecheck, easy to repeat.
describe("interpolation placeholders", () => {
  const entries = Object.entries(dict as Record<string, string>)

  test("every placeholder uses the {{name}} form", () => {
    const wrong: string[] = []
    for (const [key, value] of entries) {
      if (typeof value !== "string") continue
      // strip the correct form first, then anything left in single braces is a mistake
      const stripped = value.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "")
      if (/\{[a-zA-Z0-9_]+\}/.test(stripped)) wrong.push(`${key}: ${value}`)
    }
    expect(wrong).toEqual([])
  })

})
