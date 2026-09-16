/**
 * B10 — Adherence vocabulary (Lane C packet, M6-B).
 *
 * THE BINDING SAFETY RULE (docs/UI_UX_ARCHITECTURE.md §Design system):
 * "Keep clinical states visually conservative. Avoid gamifying risk,
 * abnormality, disease, or adherence." This module is the SINGLE place
 * the adherence vocabulary is defined, and the vocabulary is
 * deliberately non-punitive:
 *
 *   - Per-task adherence states are `on-track | missed | recovered`.
 *     There are NO streaks, NO scores, NO points, NO badges, NO levels,
 *     NO penalties — the type vocabulary cannot express them (proven by
 *     the vocabulary test over {@link ADHERENCE_POLICY_FIELD_NAMES}).
 *   - A policy can trigger enforcement ONLY on `"missed"` (the
 *     `triggerOn` literal type has exactly one legal value) — recovery
 *     and on-track states can NEVER express a restriction.
 *   - Restriction capabilities are a CLOSED, enumerated set of
 *     OS surfaces (`ios-focus`, `android-usage-access`). There is no
 *     "notify-a-third-party" capability, no "escalate" capability, and
 *     no way to add one without editing this file (a reviewed change).
 */

// ---------------------------------------------------------------------------
// Per-task adherence states.
// ---------------------------------------------------------------------------

/**
 * The adherence state of one measurement task:
 *   - `on-track`: nothing has been missed — the window is still open, or
 *     the task was completed inside its window.
 *   - `missed`: the (current) window fully elapsed with the task open.
 *   - `recovered`: a window was missed earlier, and the task was later
 *     completed in an allowed window (rolled forward or late completion).
 */
export const ADHERENCE_STATES = ["on-track", "missed", "recovered"] as const;

export type AdherenceState = (typeof ADHERENCE_STATES)[number];

/** Type guard: is `value` an {@link AdherenceState}? */
export function isAdherenceState(value: unknown): value is AdherenceState {
  return (
    typeof value === "string" && (ADHERENCE_STATES as readonly string[]).includes(value)
  );
}

/**
 * PHID-safe reason codes explaining HOW an {@link AdherenceState} was
 * derived (the audit-trail vocabulary of {@link evaluateAdherenceSnapshot}).
 */
export const ADHERENCE_STATE_REASONS = [
  /** on-track: completed, and the completion instant fell within the window. */
  "completed-in-window",
  /** on-track: the window has not fully elapsed yet (task open). */
  "window-open",
  /** missed: the window fully elapsed with the task open. */
  "window-elapsed",
  /** recovered: completed after at least one roll-forward (missed window). */
  "completed-after-roll-forward",
  /** recovered: completed after the window end without a roll (backfill). */
  "completed-after-window",
] as const;

export type AdherenceStateReason = (typeof ADHERENCE_STATE_REASONS)[number];

/** Type guard: is `value` an {@link AdherenceStateReason}? */
export function isAdherenceStateReason(value: unknown): value is AdherenceStateReason {
  return (
    typeof value === "string" && (ADHERENCE_STATE_REASONS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Restriction capabilities (closed set).
// ---------------------------------------------------------------------------

/**
 * The closed set of OS capability surfaces an {@link AdherencePolicy} may
 * name. Mirrored by `packages/platform/src/adherence/capabilities.ts`
 * (shape mirror — vocabulary equality is asserted by the cross-package
 * integration test in this package).
 */
export const ADHERENCE_CAPABILITY_IDS = ["ios-focus", "android-usage-access"] as const;

export type AdherenceCapabilityId = (typeof ADHERENCE_CAPABILITY_IDS)[number];

/** Type guard: is `value` an {@link AdherenceCapabilityId}? */
export function isAdherenceCapabilityId(value: unknown): value is AdherenceCapabilityId {
  return (
    typeof value === "string" && (ADHERENCE_CAPABILITY_IDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Capability detection states (engine side).
// ---------------------------------------------------------------------------

/**
 * Detection states of an OS capability surface (mirrored by the platform
 * seam): `available` (invocable), `unavailable` (the OS/device lacks the
 * capability), `needs-permission` (the person has not granted it),
 * `needs-config` (an OS-level setting must be enabled first).
 */
export const CAPABILITY_DETECTION_STATES = [
  "available",
  "unavailable",
  "needs-permission",
  "needs-config",
] as const;

export type CapabilityDetectionState = (typeof CAPABILITY_DETECTION_STATES)[number];

/** Type guard: is `value` a {@link CapabilityDetectionState}? */
export function isCapabilityDetectionState(value: unknown): value is CapabilityDetectionState {
  return (
    typeof value === "string" &&
    (CAPABILITY_DETECTION_STATES as readonly string[]).includes(value)
  );
}

/** The engine-side view of one capability's detection report. */
export interface CapabilityDetectionReport {
  readonly state: CapabilityDetectionState;
  /** PHID-safe machine reason code (never data, never free prose). */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Non-punitive vocabulary proof surface.
// ---------------------------------------------------------------------------

/**
 * EVERY field name the {@link AdherencePolicy} schema (below, `policy.ts`)
 * can express, top-level and nested. This const exists so the vocabulary
 * test can scan the complete schema surface for punitive constructs —
 * the schema cannot express what it has no words for, and this list IS
 * the complete set of its words.
 */
export const ADHERENCE_POLICY_FIELD_NAMES = [
  "policyId",
  "version",
  "capability",
  "triggerOn",
  "authorization",
  "permissions",
  "grantId",
  "scope",
  "personIds",
  "planIds",
  "metricIds",
  "restriction",
  "durationMs",
] as const;

export type AdherencePolicyFieldName = (typeof ADHERENCE_POLICY_FIELD_NAMES)[number];
