// mindscript_change: measure whether this mechanism is worth switching on at all.
//
// Neither Alice-Studio nor Bob-Engine knows how often a real coding turn concludes anything.
// It matters, because the cascade only pays in a middle band of failure rate: when the cheap
// model always succeeds, escalation is pure overhead; when it usually fails, you pay twice.
// Bob's own two pilots landed on either side of that band. If most real turns turn out
// inconclusive, the loop is worth far less than the arithmetic suggests.
//
// So this counts what actually happens, per Bob's list: conclusive / inconclusive /
// pre-existing / unresolved proportions, plus check duration and coverage - checks cost CPU
// and wall time, and pretending otherwise is how the cascade quietly becomes a tax.
//
// Pure accumulation. Nothing here runs a check, changes routing, or reports anywhere.

import type { CheckEvent, InconclusiveReason } from "./check-evidence"

export interface EvidenceSummary {
  /** Coalesced patches observed, whether or not any check applied. */
  turns: number
  /** Turns where no check covered the change at all - nothing could be judged. */
  turnsUnchecked: number
  /** Turns where at least one check established something. */
  turnsConclusive: number
  /** Turns where checks ran but established nothing. */
  turnsInconclusive: number
  /** Turns whose verdict was a genuinely new failure. */
  turnsFailed: number
  /** Turns where a failure an attempt was sent to repair was still present. */
  turnsUnresolved: number
  events: number
  eventsByOutcome: { pass: number; fail: number; inconclusive: number }
  inconclusiveByReason: Record<InconclusiveReason, number>
  /** Wall time spent running checks. The cost side of the ledger. */
  checkMs: number
  /** Every individual check duration, so a median can be taken rather than just a mean. */
  durations: number[]
  /** Distinct files any check covered, as a crude reach measure. */
  filesCovered: string[]
}

export const emptySummary = (): EvidenceSummary => ({
  turns: 0,
  turnsUnchecked: 0,
  turnsConclusive: 0,
  turnsInconclusive: 0,
  turnsFailed: 0,
  turnsUnresolved: 0,
  events: 0,
  eventsByOutcome: { pass: 0, fail: 0, inconclusive: 0 },
  inconclusiveByReason: {
    "no-baseline": 0,
    "pre-existing": 0,
    timeout: 0,
    unavailable: 0,
    stale: 0,
  },
  checkMs: 0,
  durations: [],
  filesCovered: [],
})

/** Fold one turn's evidence into the running totals. */
export function accumulate(
  summary: EvidenceSummary,
  events: CheckEvent[],
  options?: { unresolved?: boolean },
): EvidenceSummary {
  const next: EvidenceSummary = {
    ...summary,
    eventsByOutcome: { ...summary.eventsByOutcome },
    inconclusiveByReason: { ...summary.inconclusiveByReason },
    durations: [...summary.durations],
    filesCovered: [...summary.filesCovered],
  }

  next.turns += 1
  if (events.length === 0) {
    next.turnsUnchecked += 1
    return next
  }

  const covered = new Set(next.filesCovered)
  let conclusive = false
  let failed = false

  for (const event of events) {
    next.events += 1
    next.eventsByOutcome[event.outcome] += 1
    next.checkMs += event.elapsedMs
    next.durations.push(event.elapsedMs)
    for (const file of event.scope) covered.add(file)
    if (event.outcome === "inconclusive" && event.reason) next.inconclusiveByReason[event.reason] += 1
    if (event.attributable) {
      conclusive = true
      if (event.outcome === "fail") failed = true
    }
  }

  next.filesCovered = [...covered].sort()
  if (conclusive) next.turnsConclusive += 1
  else next.turnsInconclusive += 1
  if (failed) next.turnsFailed += 1
  if (options?.unresolved) next.turnsUnresolved += 1
  return next
}

export function medianDuration(summary: EvidenceSummary) {
  if (summary.durations.length === 0) return 0
  const sorted = [...summary.durations].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!
}

/**
 * The number the decision actually turns on: of the turns where a check could say anything,
 * how many did. A low value means the loop would mostly be guessing.
 */
export function conclusiveRate(summary: EvidenceSummary) {
  const judged = summary.turnsConclusive + summary.turnsInconclusive
  return judged === 0 ? 0 : summary.turnsConclusive / judged
}

/** How often a change was even checkable. */
export function coverageRate(summary: EvidenceSummary) {
  return summary.turns === 0 ? 0 : (summary.turns - summary.turnsUnchecked) / summary.turns
}

export function describe(summary: EvidenceSummary) {
  const pct = (value: number) => `${Math.round(value * 100)}%`
  return [
    `turns=${summary.turns} checkable=${pct(coverageRate(summary))} conclusive=${pct(conclusiveRate(summary))}`,
    `failed=${summary.turnsFailed} unresolved=${summary.turnsUnresolved}`,
    `checks=${summary.events} medianMs=${medianDuration(summary)} totalMs=${summary.checkMs}`,
    `inconclusive: ${Object.entries(summary.inconclusiveByReason)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(" ") || "none"}`,
  ].join(" | ")
}
