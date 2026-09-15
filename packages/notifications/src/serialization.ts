/**
 * Reminder serialization + hashing (B8) — the determinism-proof surface.
 *
 * Two surfaces, deliberately separated (see `payload.ts` for the PHI
 * contract):
 *   - `serializeReminderPayload` / `hashReminderPayload` — the AUDITABLE
 *     surface: canonical JSON of a payload. PHID-free by construction
 *     (asserted by the no-PHI tests over every payload variant).
 *   - `serializeReminderSchedule` / `hashReminderSchedule` — the
 *     INTERNAL-ONLY surface: full-fidelity canonical JSON of a schedule
 *     INCLUDING the planned reminders' `personId` addressing field. It
 *     exists for determinism proofs and engine re-instantiation across
 *     serialization boundaries (Dates canonicalize to epoch-ms integers,
 *     so a round-tripped schedule re-serializes byte-identically). It is
 *     NEVER a logging surface — observability goes through the
 *     @orbb/observability redaction pipeline, where `personId` is a
 *     denied field name (recorded).
 *
 * Both surfaces share the canonical serializer of `canonical.ts`, so
 * identical schedules hash identically across processes, replays, and
 * serialized re-instantiations.
 */
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import type { ReminderPayload } from "./payload.js";
import type { ReminderSchedule } from "./engine.js";

/**
 * Canonical JSON of a reminder payload (the auditable, PHI-free surface).
 * Deterministic: structurally equal payloads serialize byte-identically.
 */
export function serializeReminderPayload(payload: ReminderPayload): string {
  return canonicalJsonStringify(payload);
}

/** SHA-256 hex of {@link serializeReminderPayload}. */
export function hashReminderPayload(payload: ReminderPayload): string {
  return sha256Hex(serializeReminderPayload(payload));
}

/**
 * Canonical JSON of a full schedule (INTERNAL-ONLY — includes the
 * `personId` addressing field of every planned reminder; never log this,
 * see the module header). Deterministic across serialization boundaries:
 * Dates become epoch-ms integers, key order is canonical, absent optional
 * keys stay absent.
 */
export function serializeReminderSchedule(schedule: ReminderSchedule): string {
  return canonicalJsonStringify(schedule);
}

/** SHA-256 hex of {@link serializeReminderSchedule}. */
export function hashReminderSchedule(schedule: ReminderSchedule): string {
  return sha256Hex(serializeReminderSchedule(schedule));
}

/**
 * The PHI-free AUDIT projection of a schedule: planned reminders minus
 * the `personId` addressing field. This is the projection safe to hand
 * to explainability/observability consumers.
 */
export interface ScheduledReminderAuditEntry {
  readonly id: string;
  readonly taskId: string;
  readonly channel: string;
  readonly rung: string;
  readonly scheduledAt: Date;
  readonly deferredFrom?: Date;
  readonly payload: ReminderPayload;
}

/** The schedule's audit view: computedAt + PHI-free reminder entries. */
export interface ReminderScheduleAuditView {
  readonly computedAt: Date;
  readonly reminders: readonly ScheduledReminderAuditEntry[];
  readonly skippedChannelCount: number;
}

/** Projects a schedule into its PHI-free audit view. */
export function toScheduleAuditView(schedule: ReminderSchedule): ReminderScheduleAuditView {
  return {
    computedAt: schedule.computedAt,
    reminders: schedule.reminders.map((reminder) => ({
      id: reminder.id,
      taskId: reminder.taskId,
      channel: reminder.channel,
      rung: reminder.rung,
      scheduledAt: reminder.scheduledAt,
      ...(reminder.deferredFrom !== undefined ? { deferredFrom: reminder.deferredFrom } : {}),
      payload: reminder.payload,
    })),
    skippedChannelCount: schedule.skippedChannels.length,
  };
}

/** Canonical JSON of a schedule's audit view (PHID-free by construction). */
export function serializeScheduleAuditView(view: ReminderScheduleAuditView): string {
  return canonicalJsonStringify(view);
}

/** SHA-256 hex of {@link serializeScheduleAuditView}. */
export function hashScheduleAuditView(view: ReminderScheduleAuditView): string {
  return sha256Hex(serializeScheduleAuditView(view));
}
