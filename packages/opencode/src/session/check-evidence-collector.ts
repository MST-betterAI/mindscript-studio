// mindscript_change: ties a landed patch to the evidence about whether it worked.
//
// Attribution needs memory: to say a failure is new you must know what the same check said
// last time. This owns that memory and the rule that protects it - only a conclusive run may
// become the baseline. A timeout or a missing checker carries no information, and letting one
// overwrite the baseline would make the next genuine regression look like "no baseline", which
// is exactly the blind spot this whole mechanism exists to close.
//
// Collection only. Nothing here changes routing or learning.

import { classify, type CheckEvent, type CheckRun } from "./check-evidence"
import { applicableChecks, runCheck, type CheckDefinition, type CheckTier } from "./check-runner"

/** Last conclusive result per check, which is what a new run is judged against. */
export interface EvidenceState {
  baselines: Record<string, CheckRun>
}

export const emptyEvidenceState = (): EvidenceState => ({ baselines: {} })

/** A check is only comparable with itself, at the same scope. */
export function baselineKey(command: string, scope: string[]) {
  return `${command}::${[...scope].sort().join(",")}`
}

/** A run only earns baseline status if it actually established something. */
export function conclusiveRun(run: CheckRun) {
  return !run.unavailable && !run.timedOut && typeof run.exitCode === "number"
}

export type RunCheck = (input: {
  definition: CheckDefinition
  cwd: string
  revision: string
  scope: string[]
  abort?: AbortSignal
}) => Promise<CheckRun>

export interface CollectInput {
  cwd: string
  /** Files in the coalesced patch - what the checks are being asked about. */
  changedFiles: string[]
  /** The project's own scripts; nothing is ever invented. */
  scripts: Record<string, unknown>
  tier: CheckTier
  /** Identity of the source the patch produced. */
  revision: string
  state: EvidenceState
  /**
   * The revision the workspace is at when judging. If the source moved on while checks ran,
   * their results describe a state nobody is in and must not be read as a verdict.
   */
  currentRevision?: () => string
  abort?: AbortSignal
  run?: RunCheck
}

export interface CollectResult {
  events: CheckEvent[]
  state: EvidenceState
}

/**
 * Run whatever applies to this patch at this tier, judge each result against the last
 * conclusive one, and return the evidence plus the updated memory.
 */
export async function collectEvidence(input: CollectInput): Promise<CollectResult> {
  const checks = applicableChecks({ scripts: input.scripts, changedFiles: input.changedFiles, tier: input.tier })
  if (checks.length === 0) return { events: [], state: input.state }

  const run = input.run ?? runCheck
  const scope = [...input.changedFiles].sort()
  const baselines = { ...input.state.baselines }
  const events: CheckEvent[] = []

  for (const definition of checks) {
    if (input.abort?.aborted) break
    const result = await run({
      definition,
      cwd: input.cwd,
      revision: input.revision,
      scope,
      abort: input.abort,
    })
    const key = baselineKey(result.command, scope)
    const now = input.currentRevision?.() ?? input.revision
    const event = classify(result, baselines[key], now)
    events.push(event)
    // Stale results describe a superseded state, so they must not become the reference either.
    if (conclusiveRun(result) && event.reason !== "stale") baselines[key] = result
  }

  return { events, state: { baselines } }
}
