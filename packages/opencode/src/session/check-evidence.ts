// mindscript_change: evidence that a change actually worked, collected locally.
//
// Studio can run a project's own checks (typecheck, lint, tests) after an edit, which is
// cheap, deterministic and needs no model. What it must never do is treat every red check
// as the model's fault: a suite that was already failing, a missing dependency or a checker
// that timed out say nothing about the answer that was just produced.
//
// So a failure is only chargeable to the change when a baseline proves it is new. Everything
// else is inconclusive, which is a first-class outcome here rather than a kind of failure.
// Collection only - nothing in this module changes routing or learning.

export type CheckOutcome = "pass" | "fail" | "inconclusive"

export type InconclusiveReason =
  /** Nothing to compare against, so a red check might predate the change. */
  | "no-baseline"
  /** It was already failing the same way before the change. */
  | "pre-existing"
  /** The checker did not finish. */
  | "timeout"
  /** The checker could not run at all - not installed, missing dependency, bad invocation. */
  | "unavailable"
  /** The source moved on while this was running, so it describes a state nobody is in. */
  | "stale"

export interface CheckRun {
  /** The command as invoked, for the record. */
  command: string
  /** What this check covers - files, globs or package names. */
  scope: string[]
  /** The source revision it ran against. */
  revision: string
  /** Process exit code; null when it never completed. */
  exitCode: number | null
  /**
   * Stable digest of *how* it failed, so a pre-existing failure can be told apart from a
   * different failure at the same command. Absent for a pass.
   */
  signature?: string
  elapsedMs: number
  /** The checker itself could not run. */
  unavailable?: boolean
  timedOut?: boolean
}

export interface CheckEvent {
  command: string
  scope: string[]
  revision: string
  outcome: CheckOutcome
  reason?: InconclusiveReason
  elapsedMs: number
  /**
   * Whether this outcome may be charged to the change that triggered it. False for every
   * inconclusive result, so pre-existing breakage never looks like a bad answer.
   */
  attributable: boolean
  /** The revision this was judged against, when there was one. */
  baselineRevision?: string
}

function inconclusive(run: CheckRun, reason: InconclusiveReason, baseline?: CheckRun): CheckEvent {
  return {
    command: run.command,
    scope: run.scope,
    revision: run.revision,
    outcome: "inconclusive",
    reason,
    elapsedMs: run.elapsedMs,
    attributable: false,
    ...(baseline ? { baselineRevision: baseline.revision } : {}),
  }
}

/**
 * Judge one check run against the last known result for the same check.
 *
 * `currentRevision` is the revision the workspace is actually at now: a result for anything
 * else is stale, because queued checks can outlive the edit that asked for them.
 */
export function classify(run: CheckRun, baseline: CheckRun | undefined, currentRevision: string): CheckEvent {
  if (run.revision !== currentRevision) return inconclusive(run, "stale", baseline)
  if (run.unavailable) return inconclusive(run, "unavailable", baseline)
  if (run.timedOut) return inconclusive(run, "timeout", baseline)

  if (run.exitCode === 0) {
    return {
      command: run.command,
      scope: run.scope,
      revision: run.revision,
      outcome: "pass",
      elapsedMs: run.elapsedMs,
      attributable: true,
      ...(baseline ? { baselineRevision: baseline.revision } : {}),
    }
  }

  // Red from here on. Only a baseline can say whether that is news.
  if (!baseline || baseline.unavailable || baseline.timedOut || baseline.exitCode === null) {
    return inconclusive(run, "no-baseline", baseline)
  }
  // Failing exactly as it already failed is the repository's problem, not the model's.
  if (baseline.exitCode !== 0 && baseline.signature !== undefined && baseline.signature === run.signature) {
    return inconclusive(run, "pre-existing", baseline)
  }
  // A red check with no signature to compare cannot be told apart from what was already there.
  if (baseline.exitCode !== 0 && (baseline.signature === undefined || run.signature === undefined)) {
    return inconclusive(run, "pre-existing", baseline)
  }

  return {
    command: run.command,
    scope: run.scope,
    revision: run.revision,
    outcome: "fail",
    elapsedMs: run.elapsedMs,
    attributable: true,
    baselineRevision: baseline.revision,
  }
}

/** Only attributable events say anything about the answer; the rest are noise for learning. */
export function attributable(events: CheckEvent[]) {
  return events.filter((event) => event.attributable)
}

/**
 * Did this batch establish that the change is broken? Requires a genuinely new failure -
 * an all-inconclusive batch means we still do not know, which must not trigger escalation.
 */
export function establishedFailure(events: CheckEvent[]) {
  return attributable(events).some((event) => event.outcome === "fail")
}

/** Did the checks actually establish anything at all? */
export function conclusive(events: CheckEvent[]) {
  return attributable(events).length > 0
}
