// mindscript_change: decide whether a change should be retried harder, from evidence alone.
//
// The whole point is that this never fires on a guess. It escalates only when the checks
// established a genuinely new failure; an inconclusive batch - a pre-existing failure, a
// timeout, a missing checker, no baseline - means we do not know, and not knowing must never
// cost the user a more expensive model.
//
// Division agreed with Bob: Alice-Studio decides "this failed, try harder"; Bob-Engine decides
// which model that means. So a rung here is a request, not a routing decision, and the ladder
// is supplied rather than asserted - whether raising effort before switching model is better
// is a hypothesis to compare, not a rule.

import { establishedFailure, type CheckEvent } from "./check-evidence"

export interface Rung {
  /** For logs and comparison, e.g. "same model, higher effort". */
  label: string
  /** What to ask Bob-Engine for. Absent means "leave the choice alone". */
  model?: string
  effort?: string
  /** Used to refuse an attempt that cannot be afforded, before spending anything. */
  estimatedUsd?: number
}

export interface EscalationPolicy {
  /** Rung 0 is the starting point; later entries are progressively more expensive. */
  ladder: Rung[]
  /** Total attempts including the first, so 3 means one try plus two retries. */
  maxAttempts: number
  /** Ceiling for the whole user request - classifier, solver, tools, retries. */
  budgetUsd?: number
}

export interface AttemptState {
  rungIndex: number
  attempts: number
  spentUsd: number
  /**
   * Failure signatures this attempt was sent to repair. If one is still present afterwards the
   * repair did not work, and that must not be waved through as "pre-existing" just because the
   * previous run is now the baseline - within a retry sequence, unchanged is unresolved.
   */
  resolving?: string[]
}

export type StopReason =
  | "accepted"
  | "no-evidence"
  | "attempts-exhausted"
  | "ladder-exhausted"
  | "budget-exhausted"

export type Decision =
  | { action: "accept"; reason: "verified" | "inconclusive" | "no-evidence" }
  | { action: "retry"; rung: Rung; rungIndex: number; evidence: string }
  | { action: "stop"; reason: StopReason }

/** What actually failed, in the words of the tool that failed it, for the next attempt. */
export function formatEvidence(events: CheckEvent[]): string {
  const failures = events.filter((event) => event.attributable && event.outcome === "fail")
  if (failures.length === 0) return ""
  return failures
    .map((event) => `${event.command} failed (scope: ${event.scope.join(", ") || "unknown"})`)
    .join("\n")
}

/**
 * Is a failure this attempt was sent to repair still present? Baseline comparison alone would
 * call that "pre-existing", because the previous failing run became the baseline - correct for
 * judging independent turns, wrong inside a retry, where unchanged means the repair failed.
 */
export function unresolved(state: AttemptState, events: CheckEvent[]) {
  if (!state.resolving?.length) return false
  const targets = new Set(state.resolving)
  return events.some((event) => event.outcome !== "pass" && event.signature && targets.has(event.signature))
}

/** The signatures a retry should be held to, so the next round can tell whether it worked. */
export function signaturesToResolve(events: CheckEvent[]) {
  return events
    .filter((event) => event.outcome !== "pass" && event.signature)
    .map((event) => event.signature!)
}

export function decide(input: {
  policy: EscalationPolicy
  state: AttemptState
  events: CheckEvent[]
}): Decision {
  const { policy, state, events } = input

  // Nothing ran, or nothing ran that could conclude. Either way this turn is unjudged, and an
  // unjudged turn is not a failed one - architecture questions and doc edits live here.
  if (events.length === 0) return { action: "accept", reason: "no-evidence" }

  if (!establishedFailure(events) && !unresolved(state, events)) {
    const verified = events.some((event) => event.attributable && event.outcome === "pass")
    return { action: "accept", reason: verified ? "verified" : "inconclusive" }
  }

  if (state.attempts >= policy.maxAttempts) return { action: "stop", reason: "attempts-exhausted" }

  const nextIndex = state.rungIndex + 1
  const next = policy.ladder[nextIndex]
  if (!next) return { action: "stop", reason: "ladder-exhausted" }

  if (policy.budgetUsd !== undefined) {
    const projected = state.spentUsd + (next.estimatedUsd ?? 0)
    if (projected > policy.budgetUsd) return { action: "stop", reason: "budget-exhausted" }
  }

  return { action: "retry", rung: next, rungIndex: nextIndex, evidence: formatEvidence(events) }
}
