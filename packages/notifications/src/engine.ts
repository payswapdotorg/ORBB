/**
 * B8 — `ReminderEngine`: the deterministic reminder/notification engine.
 *
 * RECORDED DESIGN DECISIONS (the `@orbb/measurement` A30/A31 discipline:
 * injected clock, injected id-factory, injected stores — ZERO db imports,
 * ZERO external runtime deps):
 *
 * SCHEDULE COMPUTATION (`computeSchedule`) is a PURE projection of
 * (measurement-task snapshots, preference profile, channel registry,
 * vocabulary labels, clock-now) onto a reminder schedule:
 *
 *   - Upcoming-due rung `REMIND`: an OPEN task whose window's due instant
 *     (`window.endsAt`, the half-open window's closing edge) is strictly in
 *     the future gets one reminder per eligible channel, nominally sent
 *     `leadMinutes` (default 60) before the due instant. When computation
 *     happens inside the lead window the nominal instant is already past —
 *     the reminder is simply dispatchable now (late, not missed).
 *
 *   - Missed-window detection + gentle escalation ladder
 *     `REMIND → REMIND_WITH_FALLBACK_OFFER`: an OPEN task whose window has
 *     closed (`now >= window.endsAt`) has MISSED it. Rung advancement
 *     happens exactly on the recorded conditions —
 *       (a) the window closed, and
 *       (b) the task is still open —
 *     and the escalation fires `escalationDelayMinutes` (default 30) after
 *     the window edge. When the task's recorded method order contains a
 *     fallback vocabulary (at least two methods) the rung is
 *     `REMIND_WITH_FALLBACK_OFFER` and the payload OFFERS that vocabulary
 *     verbatim (journey #7: data, never a decision — the engine never
 *     ranks, filters, or orders providers on its own, and never applies
 *     restrictions). When there is no fallback vocabulary to offer, the
 *     engine does NOT invent one (and does not skip the person): the
 *     missed-window nudge stays on the `REMIND` rung with reason
 *     `missed-window` (recorded assumption — reminders nudge, they never
 *     punish). Completed tasks produce nothing (no punishment, no
 *     gamification).
 *
 *   - QUIET HOURS (preference-gated, default 22:00–07:00 local-of-record):
 *     a nominal send instant inside quiet hours is DEFERRED to the closing
 *     edge (next 07:00 local) — never dropped (see `quiet-hours.ts`).
 *     Reminder identity is derived from the NOMINAL instant, so deferral
 *     never changes identity.
 *
 *   - IDEMPOTENT IDENTITY: reminder id = deterministic hash of
 *     (task id, window sequence, rung, channel, UTC day of the nominal
 *     send instant) — recomputing over unchanged inputs yields
 *     byte-identical schedules (see `identity.ts`, `canonical.ts`).
 *
 *   - Fan-out is per eligible channel; a channel disabled by preference or
 *     lacking the rung's capability flag is SKIPPED WITH AN ACCOUNTED
 *     REASON in the schedule (fail-closed accounting, never silent).
 *
 * DISPATCH (`dispatchDue`) sends every scheduled reminder whose
 * (deferred) `sendAt <= now`:
 *
 *   - The send-attempt LEDGER is the idempotency boundary: a reminder
 *     recorded as `dispatched` is skipped (`already-dispatched`) — each
 *     dispatch is recorded exactly once, ever. A FAILED attempt is
 *     recorded with its classified reason and remains retryable until
 *     `maxDispatchAttempts` (default 3, recorded assumption), after which
 *     the reminder is skipped with `retries-exhausted`.
 *
 *   - FAIL-CLOSED delivery: channel exceptions and malformed channel
 *     return values are converted into recorded `channel-error` failures;
 *     the engine result stays `ok` — a rogue provider can never crash
 *     dispatch and an undeliverable reminder is never silently dropped.
 *
 *   - Every successful dispatch emits one TASK_DUE event (contracts §11
 *     envelope) through the injected event sink. Ledger/sink port failures
 *     surface as typed rejections (`ledger-failure` / `event-sink-failure`)
 *     — PHID-safe, retryable, with the transactional-outbox coupling
 *     recorded as the db-adapter handoff.
 *
 * All error payloads are PHID-safe (a `kind`, never received ids/values).
 */
import { isIdOf, type PersonId, type PlanId, type TaskId } from "@orbb/domain";
import type { EventId } from "@orbb/contracts";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { MeasurementTask } from "@orbb/measurement";
import { err, ok, type EngineResult } from "./result.js";
import { NotificationEngineError } from "./errors.js";
import { deriveReminderId, reminderUtcDay, type ReminderId } from "./identity.js";
import { deferToQuietHoursEdge, MS_PER_MINUTE } from "./quiet-hours.js";
import {
  MAX_TIMING_PREFERENCE_MINUTES,
  MAX_LOCAL_UTC_OFFSET_MINUTES,
  MIN_LOCAL_UTC_OFFSET_MINUTES,
  MINUTES_PER_DAY,
  type ChannelPreference,
  type ReminderPreferences,
} from "./preferences.js";
import {
  isHumanSafeLabel,
  type ReminderPayload,
  type ReminderReason,
  type ReminderRung,
} from "./payloads.js";
import {
  isDeliveryResult,
  sendForRung,
  type ChannelRegistry,
  type ChannelSendRequest,
  type DeliveredResult,
  type DeliveryFailureReason,
  type DeliveryResult,
  type NotificationChannel,
} from "./channels.js";
import type {
  ReminderAttemptRecord,
  ReminderDispatchLedger,
  ReminderDispatchRecord,
} from "./ledger.js";
import { buildTaskDueEvent, type ReminderEventSink } from "./events.js";

// ---------------------------------------------------------------------------
// Inputs and outputs.
// ---------------------------------------------------------------------------

/** Caller-supplied human-safe vocabulary labels (display names only). */
export interface VocabularyLabels {
  /** metricId → human-safe metric label. */
  readonly metrics?: Readonly<Record<string, string>>;
  /** methodId → human-safe method label. */
  readonly methods?: Readonly<Record<string, string>>;
}

/** The schedule/dispatch input: task snapshots + preferences + channels. */
export interface ReminderEngineInput {
  /**
   * Measurement-task snapshots (the REAL `@orbb/measurement` types —
   * completed tasks are silently out of scope for the ladder; open tasks
   * are projected).
   */
  readonly tasks: readonly MeasurementTask[];
  readonly preferences: ReminderPreferences;
  readonly channels: ChannelRegistry;
  /** Optional vocabulary labels carried verbatim (validated human-safe). */
  readonly labels?: VocabularyLabels;
}

/** One scheduled reminder (identity, timing, and PHI-free payload). */
export interface ScheduledReminder {
  readonly id: ReminderId;
  readonly rung: ReminderRung;
  readonly reason: ReminderReason;
  readonly taskId: TaskId;
  readonly planId: PlanId;
  readonly metricId: string;
  readonly windowSequence: number;
  readonly channelId: string;
  /** The window's closing edge (the due instant the ladder is about). */
  readonly dueAt: Date;
  /** The ladder-computed trigger instant, BEFORE quiet-hours deferral. */
  readonly nominalSendAt: Date;
  /** The actual dispatch instant (deferred to the quiet-hours edge). */
  readonly sendAt: Date;
  /** True exactly when quiet hours deferred the send instant. */
  readonly deferredByQuietHours: boolean;
  readonly payload: ReminderPayload;
}

/** A channel target accounted as skipped (never silently dropped). */
export interface SkippedChannelTarget {
  readonly taskId: TaskId;
  readonly windowSequence: number;
  readonly rung: ReminderRung;
  readonly channelId: string;
  readonly reason: "preference-disabled" | "channel-lacks-capability";
  /** Human-safe, PHID-free accounted detail. */
  readonly detail: string;
}

/** The deterministic output of `computeSchedule`. */
export interface ReminderSchedule {
  /** Deterministically ordered (taskId, windowSequence, rung, channelId). */
  readonly reminders: readonly ScheduledReminder[];
  /** Channel targets accounted as skipped, same ordering. */
  readonly skipped: readonly SkippedChannelTarget[];
}

/** Typed schedule/dispatch rejections (PHID-safe, values never echoed). */
export type ReminderError =
  | { readonly kind: "invalid-preferences" }
  | { readonly kind: "invalid-channel" }
  | { readonly kind: "unknown-channel" }
  | { readonly kind: "invalid-label" }
  | { readonly kind: "invalid-task-snapshot" }
  | { readonly kind: "ledger-failure" }
  | { readonly kind: "event-sink-failure" };

/** One successfully dispatched reminder. */
export interface DispatchedReminder {
  readonly reminder: ScheduledReminder;
  readonly delivery: DeliveredResult;
  readonly ledgerRecord: ReminderDispatchRecord;
  /** Event id of the emitted TASK_DUE envelope. */
  readonly eventId: EventId;
}

/** One recorded delivery failure (fail-closed: recorded, never thrown). */
export interface FailedDispatch {
  readonly reminder: ScheduledReminder;
  readonly reason: DeliveryFailureReason;
  readonly detail?: string;
  readonly ledgerRecord: ReminderDispatchRecord;
}

/** A due reminder not (re)sent, with the accounted reason. */
export interface SkippedDispatch {
  readonly reminder: ScheduledReminder;
  readonly reason: "already-dispatched" | "retries-exhausted";
}

/** The output of `dispatchDue`. */
export interface DispatchOutcome {
  readonly dispatched: readonly DispatchedReminder[];
  readonly failures: readonly FailedDispatch[];
  readonly skipped: readonly SkippedDispatch[];
  /** Reminders whose (deferred) send instant is still in the future. */
  readonly pending: readonly ScheduledReminder[];
  /** The pure schedule this dispatch was computed from (audit copy). */
  readonly schedule: ReminderSchedule;
}

/** Constructor options. */
export interface ReminderEngineOptions {
  /**
   * Maximum dispatch attempts per reminder before `retries-exhausted`.
   * Default 3 (recorded assumption). Must be an integer in [1, 100].
   */
  readonly maxDispatchAttempts?: number;
}

/** Default retry cap (recorded assumption). */
export const DEFAULT_MAX_DISPATCH_ATTEMPTS = 3;

/** Constructor deps (clock, id-factory, ledger, event sink; all injectable). */
export interface ReminderEngineDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly ledger: ReminderDispatchLedger;
  readonly events: ReminderEventSink;
  readonly options?: ReminderEngineOptions;
}

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------

/** Computes deterministic reminder schedules and idempotent dispatches. */
export class ReminderEngine {
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #ledger: ReminderDispatchLedger;
  readonly #events: ReminderEventSink;
  readonly #maxDispatchAttempts: number;

  constructor(deps: ReminderEngineDeps) {
    const maxAttempts = deps.options?.maxDispatchAttempts ?? DEFAULT_MAX_DISPATCH_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new NotificationEngineError(
        "invalid-request",
        "ReminderEngine maxDispatchAttempts must be an integer in [1, 100].",
      );
    }
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#ledger = deps.ledger;
    this.#events = deps.events;
    this.#maxDispatchAttempts = maxAttempts;
  }

  /**
   * Pure, deterministic schedule computation. Same (tasks, preferences,
   * channels, labels, clock-now) => byte-identical schedule, always.
   */
  computeSchedule(input: ReminderEngineInput): EngineResult<ReminderSchedule, ReminderError> {
    const rejection = this.#validateInput(input);
    if (rejection !== null) {
      return err(rejection);
    }
    if (!input.preferences.remindersEnabled) {
      // Master preference gate: nothing scheduled, nothing to account.
      return ok({ reminders: [], skipped: [] });
    }
    const nowMs = this.#clock.now().getTime();
    const channels = [...input.channels.all()];
    const preferenceByChannel = new Map<string, ChannelPreference>(
      input.preferences.channelPreferences.map((preference) => [preference.channelId, preference]),
    );
    const reminders: ScheduledReminder[] = [];
    const skipped: SkippedChannelTarget[] = [];

    for (const task of input.tasks) {
      if (task.state !== "open") {
        // Completed tasks are out of the ladder's scope (no punishment).
        continue;
      }
      const ladder = this.#ladderFor(task, input.preferences, nowMs);
      const payload = this.#buildPayload(task, ladder.rung, ladder.reason, input.labels);
      for (const channel of channels) {
        const preference = preferenceByChannel.get(channel.id);
        if (preference !== undefined && !preference.enabled) {
          skipped.push({
            taskId: task.id,
            windowSequence: task.window.sequence,
            rung: ladder.rung,
            channelId: channel.id,
            reason: "preference-disabled",
            detail: "channel disabled by reminder preferences",
          });
          continue;
        }
        if (ladder.rung === "REMIND" && channel.capabilities.supportsRemind !== true) {
          skipped.push({
            taskId: task.id,
            windowSequence: task.window.sequence,
            rung: ladder.rung,
            channelId: channel.id,
            reason: "channel-lacks-capability",
            detail: "channel does not support the REMIND rung",
          });
          continue;
        }
        if (
          ladder.rung === "REMIND_WITH_FALLBACK_OFFER" &&
          channel.capabilities.supportsFallbackOffer !== true
        ) {
          skipped.push({
            taskId: task.id,
            windowSequence: task.window.sequence,
            rung: ladder.rung,
            channelId: channel.id,
            reason: "channel-lacks-capability",
            detail: "channel does not support the REMIND_WITH_FALLBACK_OFFER rung",
          });
          continue;
        }
        const sendMs = deferToQuietHoursEdge(
          ladder.nominalMs,
          input.preferences.quietHours,
          input.preferences.localUtcOffsetMinutes,
        );
        reminders.push({
          id: deriveReminderId({
            taskId: task.id,
            windowSequence: task.window.sequence,
            rung: ladder.rung,
            channelId: channel.id,
            utcDay: reminderUtcDay(ladder.nominalMs),
          }),
          rung: ladder.rung,
          reason: ladder.reason,
          taskId: task.id,
          planId: task.planId,
          metricId: task.metricId,
          windowSequence: task.window.sequence,
          channelId: channel.id,
          dueAt: new Date(task.window.endsAt.getTime()),
          nominalSendAt: new Date(ladder.nominalMs),
          sendAt: new Date(sendMs),
          deferredByQuietHours: sendMs !== ladder.nominalMs,
          payload,
        });
      }
    }

    reminders.sort(compareScheduledReminders);
    skipped.sort(compareSkippedTargets);
    return ok({ reminders, skipped });
  }

  /**
   * Dispatches every scheduled reminder whose (deferred) send instant has
   * arrived: sends through the channel (fail-closed), records the attempt
   * in the ledger (idempotent per reminder id), and emits TASK_DUE events
   * for successful deliveries. Reminders already dispatched are skipped
   * with an accounted reason — dispatch is exactly-once per reminder.
   */
  async dispatchDue(
    input: ReminderEngineInput,
  ): Promise<EngineResult<DispatchOutcome, ReminderError>> {
    const scheduleResult = this.computeSchedule(input);
    if (!scheduleResult.ok) {
      return scheduleResult;
    }
    const schedule = scheduleResult.value;
    const nowMs = this.#clock.now().getTime();
    const personByTask = new Map<TaskId, PersonId>(
      input.tasks.map((task) => [task.id, task.personId] as const),
    );

    const dispatched: DispatchedReminder[] = [];
    const failures: FailedDispatch[] = [];
    const skippedDispatch: SkippedDispatch[] = [];
    const pending: ScheduledReminder[] = [];

    for (const reminder of schedule.reminders) {
      if (reminder.sendAt.getTime() > nowMs) {
        pending.push(reminder);
        continue;
      }

      let record: ReminderDispatchRecord | undefined;
      try {
        record = await this.#ledger.findById(reminder.id);
      } catch {
        return err({ kind: "ledger-failure" });
      }
      if (record !== undefined && record.status === "dispatched") {
        skippedDispatch.push({ reminder, reason: "already-dispatched" });
        continue;
      }
      if (record !== undefined && record.attempts >= this.#maxDispatchAttempts) {
        skippedDispatch.push({ reminder, reason: "retries-exhausted" });
        continue;
      }

      const personId = personByTask.get(reminder.taskId);
      if (personId === undefined) {
        throw new NotificationEngineError(
          "invariant-violation",
          "Dispatch could not resolve the person of a scheduled reminder.",
        );
      }
      const channel = input.channels.get(reminder.channelId);
      const request: ChannelSendRequest = {
        reminderId: reminder.id,
        personId,
        payload: reminder.payload,
      };

      let delivery: DeliveryResult;
      if (channel === undefined) {
        // Defensive: the registry mutated mid-dispatch. Fail-closed.
        delivery = { status: "undelivered", reason: "channel-error", detail: "channel-unavailable" };
      } else {
        delivery = await this.#sendSafely(channel, reminder.rung, request);
      }

      const recorded = await this.#recordAttempt(reminder, delivery);
      if (!recorded.ok) {
        return recorded;
      }
      const ledgerRecord = recorded.value;

      if (delivery.status === "delivered") {
        const emission = buildTaskDueEvent({
          ids: this.#ids,
          personId,
          reminderId: reminder.id,
          channelId: reminder.channelId,
          payload: reminder.payload,
          occurredAt: this.#clock.now(),
        });
        try {
          await this.#events.publish(emission.event, emission.payload);
        } catch {
          return err({ kind: "event-sink-failure" });
        }
        dispatched.push({
          reminder,
          delivery,
          ledgerRecord,
          eventId: emission.event.eventId,
        });
      } else {
        failures.push({
          reminder,
          reason: delivery.reason,
          ...(delivery.detail !== undefined ? { detail: delivery.detail } : {}),
          ledgerRecord,
        });
      }
    }

    return ok({ dispatched, failures, skipped: skippedDispatch, pending, schedule });
  }

  // -------------------------------------------------------------------------
  // Ladder + payload construction.
  // -------------------------------------------------------------------------

  /** The ladder position of one open task at `nowMs` (pure). */
  #ladderFor(
    task: MeasurementTask,
    preferences: ReminderPreferences,
    nowMs: number,
  ): { readonly rung: ReminderRung; readonly reason: ReminderReason; readonly nominalMs: number } {
    const endsMs = task.window.endsAt.getTime();
    if (nowMs < endsMs) {
      return {
        rung: "REMIND",
        reason: "upcoming-due",
        nominalMs: endsMs - preferences.leadMinutes * MS_PER_MINUTE,
      };
    }
    // Missed window (the half-open window closed with the task still open).
    const nominalMs = endsMs + preferences.escalationDelayMinutes * MS_PER_MINUTE;
    if (task.methodOrder.length > 1) {
      return { rung: "REMIND_WITH_FALLBACK_OFFER", reason: "missed-window", nominalMs };
    }
    // No fallback vocabulary recorded: gentle missed-window nudge, rung stays REMIND.
    return { rung: "REMIND", reason: "missed-window", nominalMs };
  }

  /** Builds the PHI-free payload for a rung (labels passed verbatim). */
  #buildPayload(
    task: MeasurementTask,
    rung: ReminderRung,
    reason: ReminderReason,
    labels: VocabularyLabels | undefined,
  ): ReminderPayload {
    const metricLabel = labels?.metrics?.[task.metricId];
    if (rung === "REMIND") {
      return {
        kind: "REMIND",
        reason,
        taskId: task.id,
        metricId: task.metricId,
        ...(metricLabel !== undefined ? { metricLabel } : {}),
        windowSequence: task.window.sequence,
        dueAt: new Date(task.window.endsAt.getTime()),
      };
    }
    const preferred = task.methodOrder[0];
    if (preferred === undefined || task.methodOrder.length < 2) {
      throw new NotificationEngineError(
        "invariant-violation",
        "The fallback-offer rung requires a task with a recorded fallback vocabulary.",
      );
    }
    const fallbackMethods = task.methodOrder.slice(1).map((methodId) => {
      const label = labels?.methods?.[methodId];
      return { methodId, ...(label !== undefined ? { label } : {}) };
    });
    return {
      kind: "REMIND_WITH_FALLBACK_OFFER",
      // Invariant: the offer rung exists only on missed windows.
      reason: "missed-window",
      taskId: task.id,
      metricId: task.metricId,
      ...(metricLabel !== undefined ? { metricLabel } : {}),
      windowSequence: task.window.sequence,
      dueAt: new Date(task.window.endsAt.getTime()),
      preferredMethodId: preferred,
      fallbackMethods,
    };
  }

  // -------------------------------------------------------------------------
  // Fail-closed send + ledger recording.
  // -------------------------------------------------------------------------

  /** Sends through a channel, converting throws and garbage into outcomes. */
  async #sendSafely(
    channel: NotificationChannel,
    rung: ReminderRung,
    request: ChannelSendRequest,
  ): Promise<DeliveryResult> {
    let delivery: unknown;
    try {
      delivery = await sendForRung(channel, rung, request);
    } catch {
      // PHID-safe: provider exception text is NEVER surfaced (could carry
      // addresses or payload fragments) — classified reason only.
      return { status: "undelivered", reason: "channel-error", detail: "channel-send-threw" };
    }
    if (!isDeliveryResult(delivery)) {
      return {
        status: "undelivered",
        reason: "channel-error",
        detail: "channel-returned-invalid-result",
      };
    }
    return delivery;
  }

  /** Records one attempt in the ledger (typed rejection on port failure). */
  async #recordAttempt(
    reminder: ScheduledReminder,
    delivery: DeliveryResult,
  ): Promise<EngineResult<ReminderDispatchRecord, ReminderError>> {
    const attempt: ReminderAttemptRecord = {
      reminderId: reminder.id,
      taskId: reminder.taskId,
      channelId: reminder.channelId,
      rung: reminder.rung,
      status: delivery.status === "delivered" ? "dispatched" : "failed",
      attemptedAt: this.#clock.now(),
      ...(delivery.status === "undelivered"
        ? {
            failureReason: delivery.reason,
            ...(delivery.detail !== undefined ? { failureDetail: delivery.detail } : {}),
          }
        : {}),
    };
    try {
      return ok(await this.#ledger.recordAttempt(attempt));
    } catch {
      return err({ kind: "ledger-failure" });
    }
  }

  // -------------------------------------------------------------------------
  // Input validation (deterministic order, PHID-safe rejections).
  // -------------------------------------------------------------------------

  #validateInput(input: ReminderEngineInput): ReminderError | null {
    const preferencesError = this.#validatePreferences(input.preferences);
    if (preferencesError !== null) {
      return preferencesError;
    }
    const channelError = this.#validateChannels(input.channels);
    if (channelError !== null) {
      return channelError;
    }
    const unknownChannelError = this.#validateChannelReferences(input);
    if (unknownChannelError !== null) {
      return unknownChannelError;
    }
    const labelError = this.#validateLabels(input.labels);
    if (labelError !== null) {
      return labelError;
    }
    return this.#validateTasks(input.tasks);
  }

  #validatePreferences(preferences: ReminderPreferences): ReminderError | null {
    if (!isIdOf("person", preferences.personId)) {
      return { kind: "invalid-preferences" };
    }
    if (typeof preferences.remindersEnabled !== "boolean") {
      return { kind: "invalid-preferences" };
    }
    if (
      typeof preferences.quietHours !== "object" ||
      preferences.quietHours === null ||
      typeof preferences.quietHours.enabled !== "boolean" ||
      !Number.isInteger(preferences.quietHours.startLocalMinutes) ||
      preferences.quietHours.startLocalMinutes < 0 ||
      preferences.quietHours.startLocalMinutes >= MINUTES_PER_DAY ||
      !Number.isInteger(preferences.quietHours.endLocalMinutes) ||
      preferences.quietHours.endLocalMinutes < 0 ||
      preferences.quietHours.endLocalMinutes >= MINUTES_PER_DAY
    ) {
      return { kind: "invalid-preferences" };
    }
    if (
      !Number.isInteger(preferences.localUtcOffsetMinutes) ||
      preferences.localUtcOffsetMinutes < MIN_LOCAL_UTC_OFFSET_MINUTES ||
      preferences.localUtcOffsetMinutes > MAX_LOCAL_UTC_OFFSET_MINUTES
    ) {
      return { kind: "invalid-preferences" };
    }
    for (const timing of [preferences.leadMinutes, preferences.escalationDelayMinutes]) {
      if (
        !Number.isInteger(timing) ||
        timing < 0 ||
        timing > MAX_TIMING_PREFERENCE_MINUTES
      ) {
        return { kind: "invalid-preferences" };
      }
    }
    const seen = new Set<string>();
    for (const preference of preferences.channelPreferences) {
      if (
        typeof preference !== "object" ||
        preference === null ||
        typeof preference.channelId !== "string" ||
        preference.channelId.length === 0 ||
        typeof preference.enabled !== "boolean"
      ) {
        return { kind: "invalid-preferences" };
      }
      if (seen.has(preference.channelId)) {
        return { kind: "invalid-preferences" };
      }
      seen.add(preference.channelId);
    }
    return null;
  }

  #validateChannels(channels: ChannelRegistry): ReminderError | null {
    const seen = new Set<string>();
    for (const channel of channels.all()) {
      if (
        typeof channel !== "object" ||
        channel === null ||
        typeof channel.id !== "string" ||
        channel.id.length === 0
      ) {
        return { kind: "invalid-channel" };
      }
      if (seen.has(channel.id)) {
        return { kind: "invalid-channel" };
      }
      seen.add(channel.id);
    }
    return null;
  }

  #validateChannelReferences(input: ReminderEngineInput): ReminderError | null {
    for (const preference of input.preferences.channelPreferences) {
      if (input.channels.get(preference.channelId) === undefined) {
        return { kind: "unknown-channel" };
      }
    }
    return null;
  }

  #validateLabels(labels: VocabularyLabels | undefined): ReminderError | null {
    if (labels === undefined) {
      return null;
    }
    for (const registry of [labels.metrics, labels.methods]) {
      if (registry === undefined) {
        continue;
      }
      if (typeof registry !== "object" || registry === null) {
        return { kind: "invalid-label" };
      }
      for (const label of Object.values(registry)) {
        if (!isHumanSafeLabel(label)) {
          return { kind: "invalid-label" };
        }
      }
    }
    return null;
  }

  #validateTasks(tasks: readonly MeasurementTask[]): ReminderError | null {
    const seen = new Set<string>();
    for (const task of tasks) {
      if (typeof task !== "object" || task === null) {
        return { kind: "invalid-task-snapshot" };
      }
      if (!isIdOf("task", task.id) || !isIdOf("person", task.personId) || !isIdOf("plan", task.planId)) {
        return { kind: "invalid-task-snapshot" };
      }
      if (typeof task.metricId !== "string" || task.metricId.length === 0) {
        return { kind: "invalid-task-snapshot" };
      }
      if (typeof task.conceptCode !== "string" || task.conceptCode.length === 0) {
        return { kind: "invalid-task-snapshot" };
      }
      if (!Array.isArray(task.methodOrder)) {
        return { kind: "invalid-task-snapshot" };
      }
      for (const methodId of task.methodOrder) {
        if (typeof methodId !== "string" || methodId.length === 0) {
          return { kind: "invalid-task-snapshot" };
        }
      }
      if (task.state !== "open" && task.state !== "completed") {
        return { kind: "invalid-task-snapshot" };
      }
      const window = task.window;
      if (
        typeof window !== "object" ||
        window === null ||
        !Number.isInteger(window.sequence) ||
        window.sequence < 0 ||
        !(window.startsAt instanceof Date) ||
        Number.isNaN(window.startsAt.getTime()) ||
        !(window.endsAt instanceof Date) ||
        Number.isNaN(window.endsAt.getTime()) ||
        window.endsAt.getTime() <= window.startsAt.getTime()
      ) {
        return { kind: "invalid-task-snapshot" };
      }
      if (!(task.createdAt instanceof Date) || Number.isNaN(task.createdAt.getTime())) {
        return { kind: "invalid-task-snapshot" };
      }
      if (!Number.isInteger(task.rollCount) || task.rollCount < 0) {
        return { kind: "invalid-task-snapshot" };
      }
      if (seen.has(task.id)) {
        return { kind: "invalid-task-snapshot" };
      }
      seen.add(task.id);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic ordering.
// ---------------------------------------------------------------------------

/** Ladder order: REMIND before REMIND_WITH_FALLBACK_OFFER. */
const RUNG_ORDER: Record<ReminderRung, number> = {
  REMIND: 0,
  REMIND_WITH_FALLBACK_OFFER: 1,
};

/** Deterministic reminder ordering: taskId, window, rung, channel. */
export function compareScheduledReminders(
  a: ScheduledReminder,
  b: ScheduledReminder,
): number {
  if (a.taskId !== b.taskId) {
    return a.taskId < b.taskId ? -1 : 1;
  }
  if (a.windowSequence !== b.windowSequence) {
    return a.windowSequence - b.windowSequence;
  }
  const rung = RUNG_ORDER[a.rung] - RUNG_ORDER[b.rung];
  if (rung !== 0) {
    return rung;
  }
  if (a.channelId !== b.channelId) {
    return a.channelId < b.channelId ? -1 : 1;
  }
  return 0;
}

/** Deterministic skip ordering: taskId, window, rung, channel. */
export function compareSkippedTargets(a: SkippedChannelTarget, b: SkippedChannelTarget): number {
  if (a.taskId !== b.taskId) {
    return a.taskId < b.taskId ? -1 : 1;
  }
  if (a.windowSequence !== b.windowSequence) {
    return a.windowSequence - b.windowSequence;
  }
  const rung = RUNG_ORDER[a.rung] - RUNG_ORDER[b.rung];
  if (rung !== 0) {
    return rung;
  }
  if (a.channelId !== b.channelId) {
    return a.channelId < b.channelId ? -1 : 1;
  }
  return 0;
}
