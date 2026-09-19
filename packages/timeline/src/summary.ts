/**
 * timelineSummary (A49, part 4) — HONEST counts as a pure derivation.
 *
 * Counts entries by kind over the entries the caller supplies (the
 * entries in a window, a page, or an accumulated walk). There is NO
 * aggregation beyond what the entries themselves state: no inference, no
 * trend claims, no baseline/episode/interpretation of any kind — M12
 * (doctor-grade intelligence) owns interpretation, and this package
 * deliberately does not reach into it.
 */
import type { TimelineEntry, TimelineEntryKind } from "./entries.js";

/** Honest counts of timeline entries by kind — and nothing else. */
export interface TimelineSummary {
  /** Total number of entries summarized. */
  readonly total: number;
  /** Count per entry kind (every frozen kind is always present). */
  readonly byKind: Readonly<Record<TimelineEntryKind, number>>;
}

/**
 * Derives the honest summary of `entries`: counts by kind. Pure — the
 * input is never mutated; deterministic — same entries (in any order)
 * → same summary. No inference, no trend claims.
 */
export function timelineSummary(entries: readonly TimelineEntry[]): TimelineSummary {
  const byKind: Record<TimelineEntryKind, number> = {
    observation: 0,
    task: 0,
    intent: 0,
  };
  for (const entry of entries) {
    byKind[entry.kind] += 1;
  }
  return { total: entries.length, byKind };
}
