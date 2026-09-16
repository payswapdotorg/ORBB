/**
 * B8 — Deterministic reminder identity.
 *
 * RECORDED DESIGN DECISION (the A30 `@orbb/measurement` idempotency
 * pattern): a reminder's identity is a deterministic function of
 *
 *   (task id, window id, rung, channel, UTC day)
 *
 * where "window id" is the window's cadence `sequence` on the task (task
 * ids themselves are domain-separated hashes over plan+metric+window
 * bounds, so (task id, sequence) pins the window exactly), and "UTC day"
 * is the UTC day of the NOMINAL send instant (the ladder-computed trigger
 * instant BEFORE any quiet-hours deferral — so a deferral that crosses a
 * day edge never changes identity). Recomputing the schedule over
 * unchanged inputs yields byte-identical reminders with identical ids —
 * no duplicates — and the send-attempt ledger keys dispatches by these
 * ids so a delivered reminder is dispatched exactly once, ever.
 *
 * Ids are derived with the shared `deriveDeterministicId` helper from
 * `@orbb/measurement` (domain-separated SHA-256 over length-prefixed
 * canonical parts, URL-safe base64) under this package's own domain tag.
 * Lane-local branded id (the `mta_` `@orbb/measurement` attempt-id
 * precedent): the frozen M0 canonical id list in `@orbb/domain` has no
 * reminder kind — handoff recorded; the branded shape mirrors the
 * canonical `<prefix>_<body>` grammar.
 */
import type { TaskId } from "@orbb/domain";
import { deriveDeterministicId } from "@orbb/measurement";
import type { ReminderRung } from "./payloads.js";

declare const reminderIdBrand: unique symbol;

/** Branded canonical reminder id: `rem_<body>`. */
export type ReminderId = string & { readonly [reminderIdBrand]: "ReminderId" };

/** Prefix of every reminder id. */
export const REMINDER_ID_PREFIX = "rem";

/** Domain-separation tag for reminder id derivation. */
const REMINDER_ID_DOMAIN = "orbb/notifications/reminder-id/v1";

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

/** The UTC day (whole days since the Unix epoch) of an instant. */
export function reminderUtcDay(utcMs: number): number {
  return Math.floor(utcMs / 86_400_000);
}

/** Semantic identity parts of a reminder. */
export interface ReminderIdentityParts {
  readonly taskId: TaskId;
  readonly windowSequence: number;
  readonly rung: ReminderRung;
  readonly channelId: string;
  /** UTC day of the NOMINAL (pre-deferral) send instant. */
  readonly utcDay: number;
}

/**
 * Derives the deterministic reminder id from its semantic identity. Same
 * parts => same id, always — across processes, replays, and ledger
 * rebuilds.
 */
export function deriveReminderId(parts: ReminderIdentityParts): ReminderId {
  const id = deriveDeterministicId(REMINDER_ID_PREFIX, REMINDER_ID_DOMAIN, [
    parts.taskId,
    parts.windowSequence,
    parts.rung,
    parts.channelId,
    parts.utcDay,
  ]) as ReminderId;
  if (!isReminderId(id)) {
    // Defensive: sha256 base64url is always a 43-char body.
    throw new RangeError("Deterministic reminder id derivation produced an unexpected digest length.");
  }
  return id;
}
