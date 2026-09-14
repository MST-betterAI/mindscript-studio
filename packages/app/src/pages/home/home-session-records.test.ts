import { describe, expect, test } from "bun:test"
import { buildHomeSessionRecords, homePlaceholder } from "./home-session-records"

const session = (id: string, directory: string, updated = 1) =>
  ({
    id,
    directory,
    projectID: "",
    title: id,
    version: "1",
    time: { created: updated, updated },
  }) as any

const project = (worktree: string) => ({ worktree, expanded: false })

const build = (input: {
  sessions: any[]
  projectDirectories: string[] | undefined
  projects: { worktree: string; expanded: boolean }[]
}) =>
  buildHomeSessionRecords({
    sessions: () => input.sessions,
    projectDirectories: () => input.projectDirectories,
    projects: () => input.projects as any,
    projectByID: () => new Map(),
  })

describe("home session records", () => {
  // The exact shape of the reported bug: real sessions on the server, nothing opened locally,
  // and the user was shown a new-user empty state.
  test("with no project selected and nothing opened locally, every session still shows", () => {
    const records = build({
      sessions: [session("ses_a", "/repo/one"), session("ses_b", "/repo/two")],
      projectDirectories: undefined,
      projects: [],
    })
    expect(records.map((r: { session: { id: string } }) => r.session.id)).toEqual(["ses_a", "ses_b"])
  })

  test("a session with no local project gets a name derived from its own directory", () => {
    const records = build({
      sessions: [session("ses_a", "/repo/brightside")],
      projectDirectories: undefined,
      projects: [],
    })
    expect(records[0]?.projectName).toBe("brightside")
    expect(records[0]?.project.worktree).toBe("/repo/brightside")
  })

  test("an explicit project selection still filters", () => {
    const records = build({
      sessions: [session("ses_a", "/repo/one"), session("ses_b", "/repo/two")],
      projectDirectories: ["/repo/one"],
      projects: [project("/repo/one")],
    })
    expect(records.map((r: { session: { id: string } }) => r.session.id)).toEqual(["ses_a"])
  })

  // An empty array is a real filter (a selected project with no sessions); undefined is not.
  test("an empty selection array filters everything, unlike no selection", () => {
    const sessions = [session("ses_a", "/repo/one")]
    expect(build({ sessions, projectDirectories: [], projects: [] })).toHaveLength(0)
    expect(build({ sessions, projectDirectories: undefined, projects: [] })).toHaveLength(1)
  })

  test("known local projects are still preferred for the name", () => {
    const records = build({
      sessions: [session("ses_a", "/repo/one")],
      projectDirectories: undefined,
      projects: [project("/repo/one")],
    })
    expect(records[0]?.project.worktree).toBe("/repo/one")
  })

  test("duplicates are collapsed and order is newest first", () => {
    const records = build({
      sessions: [session("ses_a", "/repo/one", 10), session("ses_a", "/repo/one", 10), session("ses_b", "/repo/two", 50)],
      projectDirectories: undefined,
      projects: [],
    })
    expect(records.map((r: { session: { id: string } }) => r.session.id)).toEqual(["ses_b", "ses_a"])
  })
})

describe("homePlaceholder", () => {
  test("a failed load is never reported as emptiness", () => {
    expect(homePlaceholder({ failed: true, filtered: false })).toBe("error")
    // even while a filter is active - the filter cannot be blamed for data we failed to fetch
    expect(homePlaceholder({ failed: true, filtered: true })).toBe("error")
  })

  test("an active filter means none here, not none at all", () => {
    expect(homePlaceholder({ failed: false, filtered: true })).toBe("filtered-empty")
  })

  test("only a clean, unfiltered, empty load is the new-user state", () => {
    expect(homePlaceholder({ failed: false, filtered: false })).toBe("empty")
  })
})
