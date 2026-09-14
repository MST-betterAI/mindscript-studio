import { describe, expect, test } from "bun:test"
import { quoteFor, THINKING_QUOTES } from "./thinking-quotes"

describe("thinking quotes", () => {
  test("every quote has text and an attribution", () => {
    for (const q of THINKING_QUOTES) {
      expect(q.text.trim().length).toBeGreaterThan(0)
      expect(q.who.trim().length).toBeGreaterThan(0)
    }
  })

  test("no duplicates, so a rotation does not repeat itself early", () => {
    const texts = THINKING_QUOTES.map((q) => q.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  // The point of seeding: one turn keeps one quote instead of flickering on every re-render.
  test("the same session and index always give the same quote", () => {
    expect(quoteFor("ses_abc", 3)).toEqual(quoteFor("ses_abc", 3))
  })

  test("advancing the index moves to a different quote", () => {
    expect(quoteFor("ses_abc", 0)).not.toEqual(quoteFor("ses_abc", 1))
  })

  test("two sessions working at once do not show the same line", () => {
    const a = quoteFor("ses_aaa", 0)
    const b = quoteFor("ses_bbb", 0)
    expect(a).not.toEqual(b)
  })

  test("it never runs off the end of the list", () => {
    for (let i = 0; i < THINKING_QUOTES.length * 3; i++) {
      expect(quoteFor("ses_abc", i)).toBeDefined()
    }
    expect(quoteFor("", 0)).toBeDefined()
  })
})
