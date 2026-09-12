/**
 * Intent journey display formatting (M6-A, Lane B): pure string helpers for
 * the composer and plan review screens — the M4-B `format.ts` discipline
 * (formatting/timezones stay here, never in components).
 */

import type { IntentPackEntryView, IntentSafetyOutcomeView } from "./types";

/**
 * Compact date label for pack coverage windows (e.g. "Aug 12 – Sep 11").
 * Timezones stay local to the viewer; the wire keeps ISO strings.
 */
export function formatWindowLabel(
  windowStart: string,
  windowEnd: string,
): string {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

/** Cadence label (e.g. 2 -> "2×/day", 1/7 -> "1×/week", 0.5 -> "every 2 days"). */
export function formatCadenceLabel(cadencePerDay: number): string {
  if (cadencePerDay === 2) {
    return "2×/day";
  }
  if (cadencePerDay === 1) {
    return "1×/day";
  }
  if (cadencePerDay === 0.5) {
    return "every 2 days";
  }
  if (Math.abs(cadencePerDay - 1 / 7) < 1e-9) {
    return "1×/week";
  }
  return `${cadencePerDay}/day`;
}

/** Burden units label (e.g. 3 -> "3 units/day"). */
export function formatBurdenUnits(unitsPerDay: number): string {
  const rounded = Math.round(unitsPerDay * 100) / 100;
  return `${rounded} units/day`;
}

/** Mean quality percent label (e.g. 0.82 -> "82% mean quality"). */
export function formatMeanQuality(meanQuality: number): string {
  return `${Math.round(meanQuality * 100)}% mean quality`;
}

/** Safety badge text + tone + detail for a safety outcome. */
export function safetyBadge(outcome: IntentSafetyOutcomeView): {
  label: string;
  tone: "success" | "warning" | "danger";
  detail: string;
} {
  if (outcome.kind === "PASS") {
    return {
      label: "PASS",
      tone: "success",
      detail: "No safety rule fired — publishable after your review.",
    };
  }
  if (outcome.kind === "ESCALATE") {
    return {
      label: "ESCALATE",
      tone: "warning",
      detail:
        "Human review required before this plan can publish (reason codes recorded).",
    };
  }
  return {
    label: "REJECT",
    tone: "danger",
    detail: "A safety rule fired with a hard stop — this plan cannot publish.",
  };
}

/** Pack-entry coverage line (the composer's coverage badge text). */
export function packEntryCoverageLine(entry: IntentPackEntryView): string {
  const label =
    entry.qualityMix.byEvidenceLabel.MEASURED > 0 ? "MEASURED" : "ESTIMATED";
  return `${entry.count} obs · ${label}`;
}
