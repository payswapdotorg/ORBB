/**
 * `ReminderEngine` — the deterministic B8 notification/reminder engine.
 *
 * COMPUTATION MODEL (recorded design, all decisions PHID-safe):
 *
 * Inputs are EXPLICIT and complete: measurement-task snapshots (the REAL
 * `MeasurementTask`/`MeasurementWindow` types from `@orbb/measurement`
 * — the engine never queries stores itself), a per-person preference
 * profile, and a channel registry. Time comes exclusively from the
 * injected clock. Same inputs (including the clock instant) => a
 * byte-identical schedule, always — across recomputes, fresh engine
 * instances, and serialized re-instantiation, because every identity is
 * content-derived (see `ids.ts`).
 *
 * Per OPEN task the engine computes the CURRENT rung of the gentle
 * escalation ladder — the highest rung whose recorded conditions hold:
 *
 *   REMIND:                    task open AND now >= max(windowStart,
 *                              windowEnd - upcomingLeadMs)
 *   REMIND_WITH_FALLBACK_OFFER: REMIND's conditions AND
 *                              now >= windowEnd + escalationAfterMs AND
 *                              the task records fallback vocabulary
 *                              (methodOrder of length >= 2)
 *
 * A higher rung SUPERSEDES the lower one (at most one rung is current
 * per task window — no double-nudging). A task without fallback
 * vocabulary never escalates: the offer rung requires recorded data, and
 * the engine never invents a provider (journey #7: the fallback offer is
 * DATA — the vocabulary recorded on the task — never a decision).
 *
 * The rung's NOMINAL send instant is `max(windowStart, windowEnd - lead)`
 * for `REMIND` and `windowEnd + escalationAfterMs` for the offer rung.
 * The PLANNED send instant is `deferQuietHours(max(nominal, now))`:
 *   - a future nominal is planned at its (possibly deferred) instant —
 *     visible in the schedule as a pending reminder;
 *   - a passed nominal is planned for "as soon as possible now", so a
 *     person rejoining after a missed window is reminded immediately;
 *   - an instant inside quiet hours defers to the quiet-end edge — the
 *     reminder is never dropped (`deferredFrom` records the deferral).
 *
 * IDENTITY (idempotency): the reminder id is the deterministic function
 * of (task id, window id, rung, channel, UTC day-of-planned-instant) —
 * at most one dispatch per (task, window, rung, channel) per UTC day,
 * and none at all while inputs are unchanged. The send-attempt ledger
 * records what was actually dispatched, exactly once per reminder id.
 *
 * DISPATCH is fail-closed end to end: missing recipient references,
 * undeliverable providers, provider failures, and even contract-
 * violating channels that THROW all become recorded ledger outcomes
 * with typed reasons — never silent drops, never crashes into the
 * engine's typed result.
 */
import { isPersonId, isPlanId, isTaskId, type TaskId } from "@orbb/domain";
import { TASK_STATES, err, ok, type EngineResult, type MeasurementTask } from "@orbb/measurement";
import type { Clock } from "@orbb/testkit";
import {
  validateChannelRegistry,
  isRungCarriedByChannel,
  type ChannelDeliveryOutcome,
  type ChannelFailureReason,
  type ChannelSendRequest,
  type NotificationChannel,
} from "./channels.js";
import { NotificationEngineError } from "./errors.js";
import { deriveReminderIdentity, deriveWindowKey, utcDayOf } from "./ids.js";
import type { DispatchRecord, LedgerWriteOutcome, ReminderDispatchLedger } from "./ledger.js";
import {
  resolveEscalationAfterMs,
  resolveQuietHours,
  resolveUpcomingLeadMs,
  validatePreferenceProfile,
  type PreferenceField,
  type ReminderPreferenceProfile,
} from "./preferences.js";
import { deferForQuietHours } from "./quietHours.js";
import {
  cloneReminderPayload,
  compareReminders,
  type EscalationRung,
  type FallbackMethodOffer,
  type Reminder,
  type ReminderPayload,
  type ReminderReason,
} from "./reminder.js";

// ---------------------------------------------------------------------------
// Inputs and outcomes.
// ---------------------------------------------------------------------------

/**
 * Caller-vetted human-safe labels, keyed by metric/method id. The engine
 * performs structural pass-through only — it never generates free text
 * and never validates label MEANING (that is the authorized caller's
 * responsibility; see README).
 */
export interface ReminderLabelPack {
  readonly metricLabels?: Readonly<Record<string, string>>;
  readonly methodLabels?: Readonly<Record<string, string>>;
}

/** The complete, explicit input of a schedule computation. */
export interface ReminderScheduleInput {
  /** Measurement-task snapshots to compute over (scoping is the caller's query concern). */
  readonly tasks: readonly MeasurementTask[];
  readonly profile: ReminderPreferenceProfile;
  /** The channel registry (the adapters eligible for dispatch). */
  readonly channels: readonly NotificationChannel[];
  readonly labels?: ReminderLabelPack;
}

/** A (task, channel) combination that produced no reminder, with the accounted reason. */
export interface ChannelSkipRecord {
  readonly taskId: TaskId;
  readonly channelId: string;
  readonly rung: EscalationRung;
  readonly reason: { readonly kind: "channel-not-enabled" | "channel-not-capable" };
}

/** A task that produced no reminders at all, with the accounted reason. */
export interface TaskSkipRecord {
  readonly taskId: TaskId;
  readonly reason: "task-not-open";
}

/** The deterministic schedule computation outcome. */
export interface ReminderScheduleOutcome {
  /** Planned reminders in canonical order (pending and due alike). */
  readonly reminders: readonly Reminder[];
  /** Channel-level skips with accounted reasons (preference or capability gates). */
  readonly skippedChannels: readonly ChannelSkipRecord[];
  /** Tasks skipped because they are not open. */
  readonly skippedTasks: readonly TaskSkipRecord[];
  /** Profile-enabled channel ids that are absent from the registry (accounted, not silent). */
  readonly unresolvedChannels: readonly string[];
  /** `true` exactly when the profile's master gate is off (empty schedule, by preference). */
  readonly remindersDisabled: boolean;
  /** Number of reminders deferred by quiet hours (also visible per-reminder via `deferredFrom`). */
  readonly quietHoursDeferrals: number;
}

/** A due reminder the engine did not (re)send, with the accounted reason. */
export interface DispatchSkipRecord {
  readonly reminderId: import("./ids.js").ReminderId;
  readonly reason: { readonly kind: "already-dispatched" };
}

/** The dispatch outcome: the schedule used plus what actually happened. */
export interface ReminderDispatchOutcome {
  readonly schedule: ReminderScheduleOutcome;
  /** Ledger records written by THIS pass (each dispatch recorded exactly once). */
  readonly dispatched: readonly DispatchRecord[];
  /** Due reminders not (re)sent, with accounted reasons. */
  readonly skipped: readonly DispatchSkipRecord[];
  /** Planned reminders whose (possibly deferred) send instant is still in the future. */
  readonly pending: readonly Reminder[];
}

/** Typed schedule rejections (PHID-safe: positions and fields only, values never echoed). */
export type ReminderScheduleError =
  | { readonly kind: "invalid-input" }
  | { readonly kind: "invalid-profile"; readonly field: PreferenceField }
  | { readonly kind: "invalid-channel"; readonly channelIndex: number }
  | { readonly kind: "duplicate-channel-id"; readonly channelIndex: number }
  | { readonly kind: "invalid-label-pack" }
  | { readonly kind: "invalid-task-snapshot"; readonly taskIndex: number }
  | { readonly kind: "task-person-mismatch"; readonly taskIndex: number };

/** Typed dispatch rejections: schedule rejections plus ledger port failures. */
export type ReminderDispatchError =
  | ReminderScheduleError
  | { readonly kind: "ledger-failure" };

/** Constructor deps (all injectable: clock + send-attempt ledger). */
export interface ReminderEngineDeps {
  readonly clock: Clock;
  readonly ledger: ReminderDispatchLedger;
}

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------

/** Computes deterministic reminder schedules and fail-closed dispatches. */
export class ReminderEngine {
  readonly #clock: Clock;
  readonly #ledger: ReminderDispatchLedger;

  constructor(deps: ReminderEngineDeps) {
    if (
      typeof deps !== "object" ||
      deps === null ||
      typeof deps.clock?.now !== "function" ||
      typeof deps.ledger?.record !== "function" ||
      typeof deps.ledger?.find !== "function" ||
      typeof deps.ledger?.list !== "function"
    ) {
      throw new NotificationEngineError(
        "invalid-request",
        "ReminderEngine requires an injectable clock and a send-attempt ledger port.",
      );
    }
    this.#clock = deps.clock;
    this.#ledger = deps.ledger;
  }

  /**
   * Computes the deterministic reminder schedule for the given task
   * snapshots, preference profile, and channel registry. Pure with
   * respect to its explicit inputs (including the clock): recomputing
   * over unchanged inputs yields byte-identical reminders.
   */
  async computeSchedule(
    input: ReminderScheduleInput,
  ): Promise<EngineResult<ReminderScheduleOutcome, ReminderScheduleError>> {
    if (
      typeof input !== "object" ||
      input === null ||
      !Array.isArray(input.tasks) ||
      !Array.isArray(input.channels)
    ) {
      return err({ kind: "invalid-input" });
    }
    const profileViolation = validatePreferenceProfile(input.profile);
    if (profileViolation !== undefined) {
      return err({ kind: "invalid-profile", field: profileViolation.field });
    }
    const channelViolation = validateChannelRegistry(input.channels);
    if (channelViolation !== undefined) {
      return err(channelViolation);
    }
    const labelViolation = hasLabelPackViolation(input.labels);
    if (labelViolation) {
      return err({ kind: "invalid-label-pack" });
    }
    for (const [index, task] of input.tasks.entries()) {
      const taskViolation = validateTaskSnapshot(task);
      if (taskViolation !== undefined) {
        return err({ kind: taskViolation.kind, taskIndex: index });
      }
      if (task.personId !== input.profile.personId) {
        return err({ kind: "task-person-mismatch", taskIndex: index });
      }
    }

    if (!input.profile.remindersEnabled) {
      return ok({
        reminders: [],
        skippedChannels: [],
        skippedTasks: [],
        unresolvedChannels: [],
        remindersDisabled: true,
        quietHoursDeferrals: 0,
      });
    }

    const nowMs = this.#clock.now().getTime();
    const quiet = resolveQuietHours(input.profile);
    const leadMs = resolveUpcomingLeadMs(input.profile);
    const escalationAfterMs = resolveEscalationAfterMs(input.profile);
    const offsetMinutes = input.profile.localUtcOffsetMinutes;

    const channelsById = new Map(input.channels.map((channel) => [channel.id, channel]));
    const unresolvedChannels: string[] = [];
    for (const channelId of input.profile.enabledChannelIds) {
      if (!channelsById.has(channelId)) {
        unresolvedChannels.push(channelId);
      }
    }

    const reminders: Reminder[] = [];
    const skippedChannels: ChannelSkipRecord[] = [];
    const skippedTasks: TaskSkipRecord[] = [];

    for (const task of input.tasks) {
      if (task.state !== "open") {
        skippedTasks.push({ taskId: task.id, reason: "task-not-open" });
        continue;
      }

      const windowStartMs = task.window.startsAt.getTime();
      const windowEndMs = task.window.endsAt.getTime();
      const reason: ReminderReason = nowMs < windowEndMs ? "upcoming-due" : "missed-window";

      // Current rung: the highest whose recorded conditions hold.
      const nominalRemindMs = Math.max(windowStartMs, windowEndMs - leadMs);
      const escalationInstantMs = windowEndMs + escalationAfterMs;
      const hasFallbackVocabulary = task.methodOrder.length >= 2;
      const escalate = hasFallbackVocabulary && nowMs >= escalationInstantMs;
      const rung: EscalationRung = escalate
        ? "REMIND_WITH_FALLBACK_OFFER"
        : "REMIND";
      const nominalMs = escalate ? escalationInstantMs : nominalRemindMs;

      // Planned send instant: defer-not-drop quiet hours over
      // max(nominal, now).
      const plannedSourceMs = Math.max(nominalMs, nowMs);
      const resolution = deferForQuietHours(plannedSourceMs, quiet, offsetMinutes);
      const sendAtMs = resolution.sendAtMs;
      const utcDay = utcDayOf(sendAtMs);
      const due = sendAtMs <= nowMs;

      const windowKey = deriveWindowKey({
        taskId: task.id,
        sequence: task.window.sequence,
        startsAtMs: windowStartMs,
        endsAtMs: windowEndMs,
      });
      const payload = buildPayload(task, rung, reason, input.labels);

      for (const channel of input.channels) {
        if (!input.profile.enabledChannelIds.includes(channel.id)) {
          skippedChannels.push({
            taskId: task.id,
            channelId: channel.id,
            rung,
            reason: { kind: "channel-not-enabled" },
          });
          continue;
        }
        if (!isRungCarriedByChannel(rung, channel.capabilities)) {
          skippedChannels.push({
            taskId: task.id,
            channelId: channel.id,
            rung,
            reason: { kind: "channel-not-capable" },
          });
          continue;
        }
        const id = deriveReminderIdentity({
          taskId: task.id,
          windowKey,
          rung,
          channelId: channel.id,
          utcDay,
        });
        reminders.push({
          id,
          taskId: task.id,
          planId: task.planId,
          personId: task.personId,
          metricId: task.metricId,
          windowKey,
          window: {
            sequence: task.window.sequence,
            startsAt: new Date(windowStartMs),
            endsAt: new Date(windowEndMs),
          },
          rung,
          channelId: channel.id,
          reason,
          nominalSendAt: new Date(nominalMs),
          sendAt: new Date(sendAtMs),
          ...(resolution.deferred ? { deferredFrom: new Date(plannedSourceMs) } : {}),
          due,
          payload: cloneReminderPayload(payload),
        });
      }
    }

    reminders.sort(compareReminders);
    return ok({
      reminders,
      skippedChannels,
      skippedTasks,
      unresolvedChannels,
      remindersDisabled: false,
      quietHoursDeferrals: reminders.filter((reminder) => reminder.deferredFrom !== undefined)
        .length,
    });
  }

  /**
   * Computes the schedule (same inputs) and dispatches every DUE,
   * not-yet-dispatched reminder through its channel — fail-closed:
   * every attempt (delivered, undeliverable, failed, channel-errored)
   * lands in the ledger exactly once per reminder id.
   */
  async dispatchDue(
    input: ReminderScheduleInput,
  ): Promise<EngineResult<ReminderDispatchOutcome, ReminderDispatchError>> {
    const scheduleResult = await this.computeSchedule(input);
    if (!scheduleResult.ok) {
      return err(scheduleResult.error);
    }
    const schedule = scheduleResult.value;
    const dispatched: DispatchRecord[] = [];
    const skipped: DispatchSkipRecord[] = [];
    const pending: Reminder[] = [];

    if (schedule.remindersDisabled) {
      return ok({ schedule, dispatched, skipped, pending });
    }

    const channelsById = new Map(input.channels.map((channel) => [channel.id, channel]));

    for (const reminder of schedule.reminders) {
      if (!reminder.due) {
        pending.push(reminder);
        continue;
      }

      let existing: DispatchRecord | undefined;
      try {
        existing = await this.#ledger.find(reminder.id);
      } catch {
        return err({ kind: "ledger-failure" });
      }
      if (existing !== undefined) {
        skipped.push({ reminderId: reminder.id, reason: { kind: "already-dispatched" } });
        continue;
      }

      const recipient = input.profile.channelRecipients[reminder.channelId];
      const channel = channelsById.get(reminder.channelId);

      let status: "delivered" | "undeliverable" | "failed";
      let failureReason: ChannelFailureReason | undefined;
      if (recipient === undefined) {
        // Fail-closed: an enabled channel without a recipient reference is
        // a recorded outcome, never a silent drop.
        status = "undeliverable";
        failureReason = { kind: "no-recipient" };
      } else if (channel === undefined) {
        // Defensive: schedules only materialize registered channels.
        status = "undeliverable";
        failureReason = { kind: "not-supported" };
      } else {
        const request: ChannelSendRequest = {
          reminderId: reminder.id,
          recipient,
          payload: cloneReminderPayload(reminder.payload),
          sendAt: new Date(reminder.sendAt.getTime()),
        };
        let outcome: ChannelDeliveryOutcome;
        try {
          outcome = await channel.send(request);
        } catch {
          // Contract-violating channel: fail-closed, recorded, engine
          // result unchanged.
          outcome = { status: "failed", reason: { kind: "channel-errored" } };
        }
        status = outcome.status;
        if (outcome.status !== "delivered") {
          failureReason = { kind: outcome.reason.kind };
        }
      }

      const record: DispatchRecord = {
        reminderId: reminder.id,
        taskId: reminder.taskId,
        personId: reminder.personId,
        channelId: reminder.channelId,
        rung: reminder.rung,
        status,
        ...(failureReason !== undefined ? { reason: failureReason } : {}),
        recordedAt: this.#clock.now(),
      };

      let write: LedgerWriteOutcome;
      try {
        write = await this.#ledger.record(record);
      } catch {
        return err({ kind: "ledger-failure" });
      }
      if (write.status === "recorded") {
        dispatched.push(record);
      } else {
        skipped.push({ reminderId: reminder.id, reason: { kind: "already-dispatched" } });
      }
    }

    return ok({ schedule, dispatched, skipped, pending });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (pure).
// ---------------------------------------------------------------------------

type TaskSnapshotViolation = { readonly kind: "invalid-task-snapshot" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Structural snapshot validation against the REAL measurement task
 * shape. Values are never echoed; violations are positional.
 */
function validateTaskSnapshot(task: unknown): TaskSnapshotViolation | undefined {
  if (!isRecord(task)) {
    return { kind: "invalid-task-snapshot" };
  }
  const window = task.window as unknown;
  if (!isTaskId(task.id) || !isPlanId(task.planId) || !isPersonId(task.personId)) {
    return { kind: "invalid-task-snapshot" };
  }
  if (typeof task.metricId !== "string" || task.metricId.length === 0) {
    return { kind: "invalid-task-snapshot" };
  }
  if (typeof task.conceptCode !== "string" || task.conceptCode.length === 0) {
    return { kind: "invalid-task-snapshot" };
  }
  if (
    !Array.isArray(task.methodOrder) ||
    task.methodOrder.some(
      (methodId) => typeof methodId !== "string" || (methodId as string).length === 0,
    )
  ) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!(TASK_STATES as readonly string[]).includes(task.state as string)) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!isValidTimestamp(task.createdAt)) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!Number.isInteger(task.rollCount) || (task.rollCount as number) < 0) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!isRecord(window)) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!Number.isInteger(window.sequence) || (window.sequence as number) < 0) {
    return { kind: "invalid-task-snapshot" };
  }
  if (!isValidTimestamp(window.startsAt) || !isValidTimestamp(window.endsAt)) {
    return { kind: "invalid-task-snapshot" };
  }
  if ((window.endsAt as Date).getTime() <= (window.startsAt as Date).getTime()) {
    return { kind: "invalid-task-snapshot" };
  }
  return undefined;
}

/** Label packs: `true` when the pack is structurally invalid (non-empty, bounded strings required). */
function hasLabelPackViolation(labels: unknown): boolean {
  if (labels === undefined) {
    return false;
  }
  if (!isRecord(labels)) {
    return true;
  }
  for (const pack of [labels.metricLabels, labels.methodLabels]) {
    if (pack === undefined) {
      continue;
    }
    if (!isRecord(pack)) {
      return true;
    }
    for (const value of Object.values(pack)) {
      if (typeof value !== "string" || value.length === 0 || value.length > 200) {
        return true;
      }
    }
  }
  return false;
}

type MeasurementTaskLike = MeasurementTask;

/** Builds the PHID-safe payload for a task's current rung. */
function buildPayload(
  task: MeasurementTaskLike,
  rung: EscalationRung,
  reason: ReminderReason,
  labels: ReminderLabelPack | undefined,
): ReminderPayload {
  const metricLabel = labels?.metricLabels?.[task.metricId];
  const base = {
    taskId: task.id,
    planId: task.planId,
    metricId: task.metricId,
    ...(metricLabel !== undefined ? { metricLabel } : {}),
    windowSequence: task.window.sequence,
    windowOpensAt: new Date(task.window.startsAt.getTime()),
    windowClosesAt: new Date(task.window.endsAt.getTime()),
    reason,
  };
  if (rung === "REMIND") {
    return { kind: "remind", ...base };
  }
  const preferredMethodId = task.methodOrder[0];
  const preferredMethodLabel =
    preferredMethodId !== undefined ? labels?.methodLabels?.[preferredMethodId] : undefined;
  const fallbackMethods: FallbackMethodOffer[] = task.methodOrder
    .slice(1)
    .map((methodId) => {
      const label = labels?.methodLabels?.[methodId];
      return { methodId, ...(label !== undefined ? { label } : {}) };
    });
  return {
    kind: "remind-with-fallback-offer",
    ...base,
    ...(preferredMethodId !== undefined
      ? {
          preferredMethodId,
          ...(preferredMethodLabel !== undefined ? { preferredMethodLabel } : {}),
        }
      : {}),
    fallbackMethods,
  };
}
