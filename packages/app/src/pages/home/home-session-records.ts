import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { compareSessionTime, displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export function buildHomeSessionRecords(input: {
  sessions: () => Session[]
  projectDirectories: () => string[] | undefined
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  const selected = input.projectDirectories()
  const directories = selected && new Set(selected.map(pathKey))
  const sessions = directories
    ? input.sessions().filter((session) => directories.has(pathKey(session.directory)))
    : input.sessions()
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .flatMap((session) => {
      const directory = pathKey(session.directory)
      const project =
        input
          .projects()
          .find(
            (item) =>
              pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
          ) ??
        projectForSession(session, input.projects(), input.projectByID()) ??
        // A session on the server need not correspond to a locally opened project. Dropping it
        // here was the second half of the empty-history bug: the directory filter removed most
        // sessions and this removed the rest. Stand in a project derived from the session's own
        // directory so the row still renders with a usable name.
        ({ worktree: session.directory, expanded: false } satisfies LocalProject)
      return { session, project, projectName: displayName(project) }
    })
}

// mindscript_change: which placeholder an empty list should show. Extracted from the view so the
// precedence is testable, because the precedence is the part that was wrong: a failed load and a
// filter that matches nothing were both reported as "Nothing here yet", which is the one message
// that tells a user their data does not exist.
export type HomePlaceholder = "error" | "filtered-empty" | "empty"

export function homePlaceholder(input: { failed: boolean; filtered: boolean }): HomePlaceholder {
  // A failed load says nothing about whether data exists, so it must win over both empties.
  if (input.failed) return "error"
  // An active filter means "none here", never "none at all".
  if (input.filtered) return "filtered-empty"
  return "empty"
}
