/**
 * Deterministic reminder identities (B8 idempotency requirement).
 *
 * RECORDED CHOICE (the A30 `@orbb/measurement` precedent, `ids.ts`):
 * reminder identities are derived by domain-separated SHA-256 hashing
 * over the semantic identity of the reminder — NOT by a counter id
 * factory. Reason: recomputing the schedule over unchanged inputs (same
 * tasks, same profile, same channel registry, same clock instant) must
 * yield BYTE-IDENTICAL reminders with no duplicates, and identity must
 * survive process restarts, replays, and fresh engine/store instances.
 * Content-derived ids make identity a pure function of meaning. The
 * testkit `IdFactory` seam stays the source for creation-scoped fixture
 * identities in the local test harness (`testsupport.ts`).
 *
 * Reminder identity is EXACTLY the packet-recorded tuple:
 *
 *   (task id, window id, rung, channel, UTC day)
 *
 *   - `task id`  — the canonical domain `TaskId` of the measurement task.
 *   - `window id`— the measurement model has no standalone window id
 *     (`MeasurementWindow` is `{sequence, startsAt, endsAt}`), so this
 *     package derives a lane-local `WindowKey` from
 *     (task id, sequence, window bounds). Recorded assumption: window
 *     identity is task-scoped, which also makes roll-forward re-anchoring
 *     produce a NEW window key (new bounds => new identity) while the
 *     ledger keeps the audit trail of the old window's dispatches.
 *   - `rung`     — the escalation rung (`REMIND` |
 *     `REMIND_WITH_FALLBACK_OFFER`).
 *   - `channel`  — the destination channel's registry id.
 *   - `UTC day`  — the UTC day bucket of the reminder's EFFECTIVE
 *     (post-quiet-hours-deferral) send instant. Recorded assumption:
 *     bucketing by the effective send day gives exactly the packet's
 *     "no duplicates" semantics — at most one dispatch per (task,
 *     window, rung, channel) per UTC day — while later days legitimately
 *     materialize a fresh identity for the daily gentle recap of a
 *     still-open task.
 *
 * Digests reuse `deriveDeterministicId` from `@orbb/measurement`
 * (length-prefixed, domain-separated, URL-safe base64) so derived ids
 * always satisfy the canonical 16–128 character body grammar and pass
 * lane-local guards.
 */
import type { TaskId } from "@orbb/domain";
import { deriveDeterministicId } from "@orbb/measurement";
import { MS_PER_DAY } from "./preferences.js";
import type { EscalationRung } from "./reminder.js";

// ---------------------------------------------------------------------------
// Lane-local branded identifiers (contracts-style; the canonical domain id
// kinds are frozen in @orbb/domain — handoff recorded, mirrors the
// `AttemptId` precedent in @orbb/measurement).
// ---------------------------------------------------------------------------

declare const reminderIdBrand: unique symbol;

/** Branded canonical reminder id: `rem_<body>`. */
export type ReminderId = string & { readonly [reminderIdBrand]: "ReminderId" };

/** Prefix of every reminder id. */
export const REMINDER_ID_PREFIX = "rem";

declare const windowKeyBrand: unique symbol;

/** Branded lane-local measurement-window key: `win_<body>`. */
export type WindowKey = string & { readonly [windowKeyBrand]: "WindowKey" };

/** Prefix of every window key. */
export const WINDOW_KEY_PREFIX = "win";

const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a canonical reminder id? */
export function isReminderId(value: unknown): value is ReminderId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${REMINDER_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(REMINDER_ID_PREFIX.length + 1));
}

/** Type guard: is `value` a lane-local window key? */
export function isWindowKey(value: unknown): value is WindowKey {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${WINDOW_KEY_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(WINDOW_KEY_PREFIX.length + 1));
}

// ---------------------------------------------------------------------------
// Derivation.
// ---------------------------------------------------------------------------

/** Domain-separation tag for window-key derivation. */
const WINDOW_KEY_DOMAIN = "orbb/notifications/window-key/v1";

/** Domain-separation tag for reminder-id derivation. */
const REMINDER_ID_DOMAIN = "orbb/notifications/reminder-id/v1";

/** Semantic input of a window-key derivation. */
export interface WindowKeyInput {
  readonly taskId: TaskId;
  readonly sequence: number;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

/**
 * Derives the task-scoped window key: a pure function of the window's
 * semantic identity. Same window => same key, always.
 */
export function deriveWindowKey(input: WindowKeyInput): WindowKey {
  return deriveDeterministicId(WINDOW_KEY_PREFIX, WINDOW_KEY_DOMAIN, [
    input.taskId,
    input.sequence,
    input.startsAtMs,
    input.endsAtMs,
  ]) as WindowKey;
}

/** Semantic input of a reminder identity. */
export interface ReminderIdentityInput {
  readonly taskId: TaskId;
  readonly windowKey: WindowKey;
  readonly rung: EscalationRung;
  readonly channelId: string;
  /** UTC day bucket of the effective send instant: `floor(ms / 86_400_000)`. */
  readonly utcDay: number;
}

/**
 * Derives the reminder id — the deterministic identity function of
 * (task id, window id, rung, channel, UTC day).
 */
export function deriveReminderIdentity(input: ReminderIdentityInput): ReminderId {
  return deriveDeterministicId(REMINDER_ID_PREFIX, REMINDER_ID_DOMAIN, [
    input.taskId,
    input.windowKey,
    input.rung,
    input.channelId,
    input.utcDay,
  ]) as ReminderId;
}

/** The UTC day bucket of an instant: `floor(instantMs / 86_400_000)`. */
export function utcDayOf(instantMs: number): number {
  return Math.floor(instantMs / MS_PER_DAY);
}
