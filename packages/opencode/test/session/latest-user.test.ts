import { describe, expect, test } from "bun:test"
import { latestRealUser } from "../../src/session/latest-user"

const user = (id: string, parts: any[]) => ({ info: { id, role: "user" }, parts }) as any
const assistant = (id: string) => ({ info: { id, role: "assistant" }, parts: [{ type: "text", text: "ok" }] }) as any
const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: "text", text: t, ...extra })

describe("latestRealUser", () => {
  test("finds the most recent thing a person actually typed", () => {
    const msgs = [user("m1", [text("first")]), assistant("a1"), user("m2", [text("second")])]
    expect(latestRealUser(msgs)).toEqual({ id: "m2", text: "second" })
  })

  test("looks past a compaction continuation to the real question behind it", () => {
    // This is the reported defect: the live question is older than the synthetic turn.
    const msgs = [
      user("m1", [text("what is the url for looking at your work?")]),
      assistant("a1"),
      user("m2", [{ type: "compaction" }, text("What did we do so far?", { synthetic: true })]),
    ]
    expect(latestRealUser(msgs)).toEqual({ id: "m1", text: "what is the url for looking at your work?" })
  })

  test("ignores a synthetic part even without a compaction marker", () => {
    const msgs = [user("m1", [text("real")]), user("m2", [text("Called the Read tool", { synthetic: true })])]
    expect(latestRealUser(msgs)).toEqual({ id: "m1", text: "real" })
  })

  test("ignores subtask announcements", () => {
    const msgs = [user("m1", [text("real")]), user("m2", [{ type: "subtask" }, text("tool ran", { synthetic: true })])]
    expect(latestRealUser(msgs)).toEqual({ id: "m1", text: "real" })
  })

  test("ignores parts the session marked ignored, and empty turns", () => {
    const msgs = [user("m1", [text("real")]), user("m2", [text("hidden", { ignored: true })]), user("m3", [text("   ")])]
    expect(latestRealUser(msgs)).toEqual({ id: "m1", text: "real" })
  })

  test("joins multiple typed parts of one turn", () => {
    expect(latestRealUser([user("m1", [text("line one"), text("line two")])])).toEqual({
      id: "m1",
      text: "line one\nline two",
    })
  })

  test("says nothing when a person has not spoken", () => {
    expect(latestRealUser([])).toBeUndefined()
    expect(latestRealUser([assistant("a1")])).toBeUndefined()
    expect(latestRealUser([user("m1", [{ type: "compaction" }])])).toBeUndefined()
  })
})
