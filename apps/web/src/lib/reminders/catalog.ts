/**
 * Seeded reminder catalog (M6 EXIT, Lane B): the SYNTH preference
 * vocabulary the journey-#7 reminder fixtures are derived under —
 * the mirror of the B8 recorded defaults.
 *
 * Pure data — no hooks, no DOM, no fetch — so the API route handler,
 * vitest and the store can all import it (the capture/today catalog
 * discipline).
 *
 * RECORDED ASSUMPTIONS (each mirrors a frozen B8 decision, never a new
 * one):
 *   - QUIET HOURS: the B8 recorded default is 22:00–07:00 local-of-record
 *     (preference-gated, defer-to-edge, never drop). The fixture session's
 *     local-of-record is the SESSION'S LOCAL TIMEZONE: the B4 today
 *     fixtures anchor task windows to the local calendar day, so anchoring
 *     quiet hours to the same local clock keeps the golden journey's
 *     deferral facts ("deferred to 07:00") timezone-independent. The UTC
 *     offset is resolved from the seeding instant (a fixed offset per
 *     session, DST-free like the B8 pure-UTC discipline; DST-transition
 *     sessions are the same recorded handoff B8 makes for IANA zones).
 *   - LEAD TIME / ESCALATION GRACE: the B8 recorded defaults (60 minutes
 *     before the window closes; 60 minutes of grace after it closes — the
 *     ladder escalates gently, never at the instant of the miss).
 *   - REMINDERS ENABLED: the fixture session keeps the master gate ON
 *     (the journey demonstrates the ladder); the B9 consent-settings
 *     surface owns the real preference editing.
 *   - CHANNEL FAN-OUT is NOT mirrored here: the Today surface renders the
 *     per-(task, window) ladder state, which is channel-independent; the
 *     engine's per-channel dispatch (capability-gated skips, exactly-once
 *     ledger) is the worker-wiring handoff recorded in the B8 package.
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI; the label directory reuses the M4-B capture catalog's
 * human-safe labels (the B8 `InMemoryReminderLabelDirectory` seam's data).
 */

import { CAPTURE_SHAPES } from "../capture/catalog";
import {
  TODAY_ESCALATION_GRACE_MS,
  TODAY_LEAD_TIME_MS,
  todayQuietHours,
  todayReminderProfile,
} from "./profile";
import { TODAY_REMINDER_RUNGS } from "./types";

// ---------------------------------------------------------------------------
// Human-safe label directory (the B8 `ReminderLabelDirectory` seam's data).
// ---------------------------------------------------------------------------

/** The registered manual source's label vocabulary (M4-B catalog reuse). */
function fieldLabelFor(metricId: string): string | undefined {
  return CAPTURE_SHAPES.flatMap((shape) => shape.fields).find(
    (field) => field.metric.id === metricId,
  )?.metric.displayName;
}

/**
 * The label directory mirror: metric id -> human-safe display label.
 * Keys/values are SYNTH vocabulary from the M4-B capture catalog —
 * human-safe labels ONLY (the B8 PHI contract: ids + labels, never
 * values, never concept codes, never evidence).
 */
export const TODAY_REMINDER_LABELS: Readonly<Record<string, string>> = {
  "SYNTH-metric-bp-systolic": "Blood Pressure Systolic",
  "SYNTH-metric-heart-rate": "Heart Rate",
  "SYNTH-metric-body-weight": "Body Weight",
  "SYNTH-metric-sleep-minutes": "Sleep Duration",
};

/** The neutral fallback label (B8 `DEFAULT_METRIC_LABEL` mirror). */
export const TODAY_REMINDER_DEFAULT_METRIC_LABEL = "a measurement";

/** Resolves a metric's human-safe label (neutral fallback on miss). */
export function todayMetricLabel(metricId: string): string {
  return (
    TODAY_REMINDER_LABELS[metricId] ??
    fieldLabelFor(metricId) ??
    TODAY_REMINDER_DEFAULT_METRIC_LABEL
  );
}

// ---------------------------------------------------------------------------
// The active preference profile + quiet hours (re-exported for the store).
// ---------------------------------------------------------------------------

export {
  TODAY_ESCALATION_GRACE_MS,
  TODAY_LEAD_TIME_MS,
  todayQuietHours,
  todayReminderProfile,
} from "./profile";

/** The active quiet-hours display label (e.g. "22:00–07:00"). */
export const TODAY_QUIET_HOURS_LABEL = "22:00–07:00";

// ---------------------------------------------------------------------------
// Catalog invariants (pure; a malformed fixture fails loudly).
// ---------------------------------------------------------------------------

/**
 * Catalog invariants (programming errors — the seed is a fixture):
 *   - the rung mirror equals the frozen B8 ladder vocabulary, in order;
 *   - the quiet-hours spec is the recorded default (22:00–07:00, enabled);
 *   - the profile mirrors the recorded B8 defaults (lead/grace 60 min);
 *   - every label-directory key is SYNTH-marked and every label non-empty.
 */
/** A fixed reference instant for invariant checks (deterministic world). */
const INVARIANT_NOW = new Date("2026-09-15T12:00:00.000Z");

export function assertTodayReminderCatalogInvariants(): void {
  expectExactLadder();
  const quiet = todayQuietHours(INVARIANT_NOW);
  if (
    quiet.enabled !== true ||
    quiet.startMinuteOfDay !== 22 * 60 ||
    quiet.endMinuteOfDay !== 7 * 60
  ) {
    throw new Error(
      "Today quiet-hours fixture must mirror the B8 recorded default (22:00–07:00, enabled).",
    );
  }
  const profile = todayReminderProfile(INVARIANT_NOW);
  if (
    profile.remindersEnabled !== true ||
    profile.leadTimeMs !== TODAY_LEAD_TIME_MS ||
    profile.escalationGraceMs !== TODAY_ESCALATION_GRACE_MS ||
    profile.leadTimeMs !== 3_600_000 ||
    profile.escalationGraceMs !== 3_600_000
  ) {
    throw new Error(
      "Today reminder profile must mirror the B8 recorded defaults (60 min lead, 60 min grace).",
    );
  }
  for (const [metricId, label] of Object.entries(TODAY_REMINDER_LABELS)) {
    if (!metricId.startsWith("SYNTH-metric-")) {
      throw new Error(`Reminder label key is not SYNTH-marked: ${metricId}`);
    }
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(`Reminder label must be a non-empty string: ${metricId}`);
    }
  }
}

/** The frozen B8 ladder, pinned literally (the M6-A catalog-mirror pattern). */
function expectExactLadder(): void {
  if (
    TODAY_REMINDER_RUNGS.length !== 2 ||
    TODAY_REMINDER_RUNGS[0] !== "REMIND" ||
    TODAY_REMINDER_RUNGS[1] !== "REMIND_WITH_FALLBACK_OFFER"
  ) {
    throw new Error(
      "Today reminder rung mirror must equal the frozen B8 ladder vocabulary in order.",
    );
  }
}
