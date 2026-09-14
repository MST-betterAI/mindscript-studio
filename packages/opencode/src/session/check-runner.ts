// mindscript_change: turns a project's own checks into the evidence that check-evidence.ts judges.
//
// Cadence agreed with Bob: coalesce edits into a coherent patch, run the targeted checks then,
// and leave the wider ones for task completion or a dependency change. Never re-run on every
// file write, and never let a result for a superseded revision be read as a verdict.

import { createHash } from "node:crypto"
import * as Process from "../util/process"
import type { CheckRun } from "./check-evidence"

/** Targeted checks are cheap enough to run after a patch; wide ones are not. */
export type CheckTier = "targeted" | "wide"

export interface CheckDefinition {
  /** The package script to invoke. */
  script: string
  tier: CheckTier
  /** File extensions this check can say anything about. */
  extensions: string[]
}

/**
 * Only scripts a project actually defines are ever run, and only when the change touches
 * something the check covers - editing a README should not run a typecheck.
 */
export const KNOWN_CHECKS: CheckDefinition[] = [
  { script: "typecheck", tier: "targeted", extensions: [".ts", ".tsx"] },
  { script: "check-types", tier: "targeted", extensions: [".ts", ".tsx"] },
  { script: "lint", tier: "targeted", extensions: [".ts", ".tsx", ".js", ".jsx"] },
  { script: "test", tier: "wide", extensions: [".ts", ".tsx", ".js", ".jsx"] },
]

function extensionOf(file: string) {
  const dot = file.lastIndexOf(".")
  return dot === -1 ? "" : file.slice(dot).toLowerCase()
}

/** Which of the project's scripts are worth running for this patch, at this tier. */
export function applicableChecks(input: {
  scripts: Record<string, unknown>
  changedFiles: string[]
  tier: CheckTier
}): CheckDefinition[] {
  const extensions = new Set(input.changedFiles.map(extensionOf))
  return KNOWN_CHECKS.filter(
    (check) =>
      check.tier === input.tier &&
      typeof input.scripts[check.script] === "string" &&
      check.extensions.some((ext) => extensions.has(ext)),
  )
}

const VOLATILE: RegExp[] = [
  /\b\d+(\.\d+)?\s?(ms|s)\b/g, // durations: "1.79s", "204 ms"
  /\[\d+(\.\d+)?(ms|s)\]/g, // bun's "[1.79s]"
  /\/[^\s:]*\//g, // absolute or nested paths, leaving the basename
  /\b0x[0-9a-f]+\b/gi, // addresses
]

/**
 * A stable digest of *how* something failed, so "still broken the same way" can be told from
 * "broken differently now". Deliberately keeps counts - 56 failures becoming 57 is news -
 * while dropping timings and paths, which change run to run without meaning anything.
 */
export function failureSignature(output: string): string | undefined {
  const interesting = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /error|fail|✗|✖|cannot|missing|expected/i.test(line))
  if (interesting.length === 0) return undefined
  const normalised = interesting
    .map((line) => VOLATILE.reduce((acc, pattern) => acc.replace(pattern, ""), line))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
  if (normalised.length === 0) return undefined
  return createHash("sha256").update(normalised.join("\n")).digest("hex").slice(0, 16)
}

/**
 * Identity of the source a check ran against. Content-based rather than git-based, so it is
 * correct with uncommitted work - which is the normal state mid-task.
 */
export function revisionOf(files: { path: string; content: string }[]): string {
  const digest = createHash("sha256")
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    digest.update(file.path)
    digest.update(createHash("sha256").update(file.content).digest("hex"))
  }
  return digest.digest("hex").slice(0, 16)
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Run one check. Never throws for a failing check - a red result is data. It only reports
 * `unavailable` when the checker itself could not run, which must not be read as a failure.
 */
export async function runCheck(input: {
  definition: CheckDefinition
  cwd: string
  revision: string
  scope: string[]
  runner?: string[]
  timeoutMs?: number
  abort?: AbortSignal
}): Promise<CheckRun> {
  const command = [...(input.runner ?? ["bun", "run"]), input.definition.script]
  const started = Date.now()
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = { command: command.join(" "), scope: input.scope, revision: input.revision }
  try {
    // nothrow is essential: Process.run throws on any non-zero exit, and a red check is data,
    // not an exception. Without it every real failure would surface as "checker unavailable".
    const result = await Process.run(command, {
      cwd: input.cwd,
      timeout: timeoutMs,
      abort: input.abort,
      nothrow: true,
    })
    const elapsedMs = Date.now() - started
    const output = `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`

    // A kill leaves no usable code, so fall back to the clock: at or past the limit it timed out.
    if (elapsedMs >= timeoutMs) return { ...base, exitCode: null, elapsedMs, timedOut: true }
    if (typeof result.code !== "number") return { ...base, exitCode: null, elapsedMs, timedOut: true }
    if (result.code !== 0 && looksUnavailable(output)) {
      return { ...base, exitCode: null, elapsedMs, unavailable: true }
    }
    return {
      ...base,
      exitCode: result.code,
      elapsedMs,
      ...(result.code === 0 ? {} : { signature: failureSignature(output) }),
    }
  } catch {
    // Spawning failed outright: the checker is missing or not executable. Says nothing about the change.
    return { ...base, exitCode: null, elapsedMs: Date.now() - started, unavailable: true }
  }
}

/** The checker could not run, as opposed to running and disapproving. */
export function looksUnavailable(output: string) {
  return /ENOENT|command not found|not recognized as an internal|no such file or directory|Script not found|missing script/i.test(
    output,
  )
}
