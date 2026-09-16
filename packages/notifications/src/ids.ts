/**
 * @orbb/notifications identifiers (B8).
 *
 * RECORDED IDENTITY RULE (the B8 idempotency requirement, verbatim): a
 * reminder's identity is a deterministic function of
 * `(task id, window id, rung, channel, UTC day)` — implemented as a
 * domain-separated SHA-256 over exactly those parts, mirroring the
 * measurement lane's A30 recorded rationale for content-derived ids:
 * the schedule must be IDEMPOTENT over unchanged inputs (same tasks, same
 * preferences, same clock instant => byte-identical reminders, same ids),
 * so identity can never depend on a counter or call sequence. The testkit
 * `IdFactory` seam stays the source for CREATION-SCOPED identities — send
 * attempts (`snd_<body>`) — where sequence-dependence is the desired
 * semantics (mirrors `@orbb/measurement` attempts vs tasks).
 *
 * RECORDED INTERPRETATION of the UTC-day component: the UTC day of the
 * reminder's EFFECTIVE (post-quiet-hours-deferral) fire instant. This
 * makes identity invariant across computation instants (computing a
 * future reminder at 23:50 or at 00:10 yields the SAME id — no midnight
 * double-dispatch), and makes "at most one reminder per
 * (task, window, rung, channel) per UTC day" explicit and testable.
 * Re-nudging a still-missed task across DAYS is deliberately NOT invented
 * here (no requirement specifies recurrence): duplicate suppression is
 * owned by the ledger (dispatch exactly once per reminder id) plus the
 * measurement scheduler's window roll-forward (a rolled task has a NEW
 * window identity => new reminders). See README.md.
 *
 * `MeasurementWindow` has no standalone id in the frozen domain; its
 * identity within a task is (sequence, startsAt, endsAt) — exactly the
 * parts the A30 scheduler hashes into task ids — so the window part of
 * reminder identity is that triple.
 *
 * Hash construction (collision-safe, ambiguity-free — length-prefixed):
 *   sha256( "orbb/notifications/reminder-id/v1"
 *           || len(taskId):taskId
 *           || len(sequence):sequence
 *           || len(startsAtMs):startsAtMs
 *           || len(endsAtMs):endsAtMs
 *           || len(rung):rung
 *           || len(channelId):channelId
 *           || len(utcDay):utcDay )
 * encoded as URL-safe base64 (43 chars) under the `remd_` prefix — always
 * within the lane-local 16–128 character body grammar.
 */
import type { TaskId } from "@orbb/domain";
import type { MeasurementWindow } from "@orbb/measurement";
import { sha256Base64Url } from "./canonical.js";
import type { NotificationChannelId, ReminderRung } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// ReminderId (remd_<body>) — content-derived, idempotency-critical.
// ---------------------------------------------------------------------------

declare const reminderIdBrand: unique symbol;

/** Opaque reminder identifier: `remd_<body>` (lane-local grammar). */
export type ReminderId = string & { readonly [reminderIdBrand]: "ReminderId" };

/** Fixed prefix of {@link ReminderId}. */
export const REMINDER_ID_PREFIX = "remd";

/** Valid body segment of the lane-local reminder id grammar. */
const REMINDER_ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a well-formed lane-local {@link ReminderId}? */
export function isReminderId(value: unknown): value is ReminderId {
  return (
    typeof value === "string" &&
    value.startsWith(`${REMINDER_ID_PREFIX}_`) &&
    REMINDER_ID_BODY_PATTERN.test(value.slice(REMINDER_ID_PREFIX.length + 1))
  );
}

/** Domain-separation tag for reminder id derivation. */
const REMINDER_ID_DOMAIN = "orbb/notifications/reminder-id/v1";

/** Canonical serialization separator between length-prefixed parts. */
const PART_SEPARATOR = "|";

/** Length of the URL-safe base64 SHA-256 digest (no padding). */
const SHA256_BASE64URL_LENGTH = 43;

/**
 * The identity components the B8 packet fixes: task id, window identity,
 * ladder rung, delivery channel, and the UTC day of the effective fire
 * instant. Same parts => same {@link ReminderId}, always.
 */
export interface ReminderIdentityParts {
  readonly taskId: TaskId;
  readonly window: MeasurementWindow;
  readonly rung: ReminderRung;
  readonly channel: NotificationChannelId;
  /** UTC epoch-day (floor(ms / 86_400_000)) of the effective fire instant. */
  readonly utcDay: number;
}

/**
 * Derives the deterministic reminder id `remd_<sha256-base64url>` from the
 * identity parts above. Pure: identical parts always yield the identical
 * id; any single changed part yields a different id (asserted by tests).
 */
export function deriveReminderId(parts: ReminderIdentityParts): ReminderId {
  const canonical = [
    REMINDER_ID_DOMAIN,
    parts.taskId,
    String(parts.window.sequence),
    String(parts.window.startsAt.getTime()),
    String(parts.window.endsAt.getTime()),
    parts.rung,
    parts.channel,
    String(parts.utcDay),
  ]
    .map((part) => `${part.length}:${part}`)
    .join(PART_SEPARATOR);
  const digest = sha256Base64Url(canonical);
  if (digest.length !== SHA256_BASE64URL_LENGTH) {
    // Defensive: sha256 base64url is always 43 unpadded chars.
    throw new RangeError("Reminder id derivation produced an unexpected digest length.");
  }
  return `${REMINDER_ID_PREFIX}_${digest}` as ReminderId;
}

/** UTC epoch-day of an instant (floor division — pure UTC, DST-free). */
export function utcEpochDay(instantMs: number): number {
  return Math.floor(instantMs / 86_400_000);
}

// ---------------------------------------------------------------------------
// SendAttemptId (snd_<body>) — creation-scoped (IdFactory source).
// ---------------------------------------------------------------------------

declare const sendAttemptIdBrand: unique symbol;

/** Opaque send-attempt identifier: `snd_<body>` (lane-local grammar). */
export type SendAttemptId = string & { readonly [sendAttemptIdBrand]: "SendAttemptId" };

/** Fixed prefix of {@link SendAttemptId}. */
export const SEND_ATTEMPT_ID_PREFIX = "snd";

/** Valid body segment of the lane-local send-attempt id grammar. */
const SEND_ATTEMPT_ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a well-formed lane-local {@link SendAttemptId}? */
export function isSendAttemptId(value: unknown): value is SendAttemptId {
  return (
    typeof value === "string" &&
    value.startsWith(`${SEND_ATTEMPT_ID_PREFIX}_`) &&
    SEND_ATTEMPT_ID_BODY_PATTERN.test(value.slice(SEND_ATTEMPT_ID_PREFIX.length + 1))
  );
}
