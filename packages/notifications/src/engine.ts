/**
 * The reminder engine (B8 core) — deterministic schedule computation +
 * idempotent, fail-closed dispatch.
 *
 * TWO OPERATIONS, ONE DETERMINISTIC CORE:
 *   - `computeSchedule({ tasks, profile })` — PURE and SYNCHRONOUS: a
 *     total function of (task snapshots, preference profile, channel
 *     registry metadata, label directory, clock state). Same inputs =>
 *     byte-identical schedule (same reminder ids, same order, same
 *     payloads). No I/O, no ledger access, no randomness — the property
 *     the B8 determinism proofs assert (twice, and across a serialized
 *     re-instantiation).
 *   - `dispatchPending({ tasks, profile })` — recomputes the SAME
 *     schedule from the current clock, filters to reminders whose
 *     effective fire instant is due, suppresses reminders already in the
 *     send-attempt ledger (exactly-once per reminder identity), resolves
 *     recipient pseudonyms, and delivers through the channel registry —
 *     FAIL-CLOSED: every undeliverable path is a RECORDED outcome with a
 *     reason; a throwing channel becomes a recorded
 *     `channel-transport-error`; the engine result shape never changes
 *     because a channel failed.
 *
 * RECORDED SCHEDULE RULES (the complete decision table):
 *   - `remindersEnabled: false` -> empty schedule (the master preference
 *     gate wins; no reminder is ever forced on a muted person).
 *   - COMPLETED task -> no reminders (completing silences the ladder —
 *     reminders nudge, they never punish).
 *   - OPEN task, `window.endsAt > now` -> rung `REMIND`, base fire
 *     instant `window.endsAt - leadTimeMs`, clamped forward to
 *     `window.startsAt` (a nudge never fires before the window opens —
 *     recorded).
 *   - OPEN task, `window.endsAt <= now` -> rung
 *     `REMIND_WITH_FALLBACK_OFFER`, base fire instant `window.endsAt +
 *     escalationGraceMs` (gentle: never at the instant of the miss).
 *   - Exactly ONE rung is active per (task, window) per computation; rung
 *     advancement happens ONLY through the recorded window-state
 *     conditions above.
 *   - Channel fan-out: for each profile channel (in profile order), the
 *     rung's capability requirements are checked; a channel that cannot
 *     satisfy them is skipped WITH AN ACCOUNTED REASON
 *     (`channel-lacks-capability`) — never silently.
 *   - Quiet hours (preference-gated): the base fire instant is deferred
 *     to the quiet-window end edge when it falls inside the quiet
 *     interval — DEFER, NEVER DROP; the deferral is recorded on the
 *     payload (`defer.from`, reason `quiet-hours`).
 *   - Reminder identity: `deriveReminderId(taskId, window, rung,
 *     channel, utcDay)` where the UTC day is that of the EFFECTIVE
 *     (post-deferral) fire instant — see `ids.ts` for the recorded
 *     interpretation.
 *   - Deterministic order: reminders sort by (scheduledAt, taskId, rung
 *     index, channel, id); the input task order does NOT affect the
 *     schedule.
 *
 * The engine reads time EXCLUSIVELY from the injected clock and identity
 * exclusively from the injected id-factory (creation-scoped attempt ids)
 * — the @orbb/measurement discipline. ZERO db imports, ZERO external
 * runtime dependencies.
 */
import { isIdOf, type PersonId, type TaskId } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import type { MeasurementTask, MeasurementWindow } from "@orbb/measurement";
import { err, ok, type NotificationResult } from "./result.js";
import { NotificationEngineError } from "./errors.js";
import { deriveReminderId, utcEpochDay, type ReminderId, type SendAttemptId } from "./ids.js";
import {
  isReminderPreferenceProfile,
  normalizeReminderProfile,
  type NormalizedReminderProfile,
  type ReminderPreferenceProfile,
} from "./preferences.js";
import { deferToQuietEdge } from "./quietHours.js";
import { buildReminderPayload, type ReminderDeferRecord, type ReminderPayload } from "./payload.js";
import type { ReminderLabelDirectory } from "./labels.js";
import type { RecipientDirectory } from "./recipients.js";
import {
  RUNG_CAPABILITY_REQUIREMENTS,
  type ChannelCapabilityName,
  type ChannelRegistry,
  type ChannelSendResult,
  type NotificationChannel,
} from "./channels.js";
import type { SendAttempt, SendAttemptLedger } from "./ledger.js";
import {
  isNotificationChannelId,
  reminderRungIndex,
  type NotificationChannelId,
  type ReminderRung,
} from "./vocabulary.js";

// ---------------------------------------------------------------------------
// Schedule shapes.
// ---------------------------------------------------------------------------

/**
 * A planned reminder: the payload (the auditable PHI-free surface) plus
 * the identity/addressing fields the dispatcher needs. `personId` is an
 * ADDRESSING-ONLY field — it exists solely to resolve the recipient
 * pseudonym at dispatch and is never projected into payloads, deliveries,
 * or ledger records (proven by the no-PHI tests).
 */
export interface PlannedReminder {
  readonly id: ReminderId;
  readonly taskId: TaskId;
  readonly personId: PersonId;
  readonly channel: NotificationChannelId;
  readonly rung: ReminderRung;
  /** The EFFECTIVE fire instant (after quiet-hours deferral). */
  readonly scheduledAt: Date;
  /** The original fire instant — present exactly when quiet-hours-deferred. */
  readonly deferredFrom?: Date;
  readonly payload: ReminderPayload;
}

/** An accounted channel fan-out skip (capability-gated channels). */
export interface SkippedChannelFanout {
  readonly taskId: TaskId;
  readonly rung: ReminderRung;
  readonly channel: NotificationChannelId;
  readonly reason: {
    readonly kind: "channel-lacks-capability";
    readonly capability: ChannelCapabilityName;
  };
}

/** The deterministic schedule computed from one (tasks, profile, now). */
export interface ReminderSchedule {
  /** The computation instant (injected clock — deterministic per clock state). */
  readonly computedAt: Date;
  /** All planned reminders, in the deterministic canonical order. */
  readonly reminders: readonly PlannedReminder[];
  /** Capability-gated channel skips, accounted with reasons (never silent). */
  readonly skippedChannels: readonly SkippedChannelFanout[];
}

/** Input of both engine operations. */
export interface ReminderEngineInput {
  /** REAL measurement-task snapshots (defensive copies are never mutated). */
  readonly tasks: readonly MeasurementTask[];
  readonly profile: ReminderPreferenceProfile;
}

/** Typed schedule rejections (PHID-safe: kinds + structural indexes only). */
export type ReminderScheduleError =
  | { readonly kind: "invalid-task"; readonly taskIndex: number }
  | { readonly kind: "duplicate-task"; readonly taskIndex: number }
  | { readonly kind: "invalid-preference"; readonly field: string }
  | { readonly kind: "unknown-channel"; readonly channelIndex: number };

/** The outcome of one dispatch run. */
export interface DispatchOutcome {
  readonly computedAt: Date;
  /** Reminders whose effective fire instant is due at the dispatch instant. */
  readonly due: number;
  /** Attempts recorded by THIS run (sent AND undeliverable — all recorded). */
  readonly dispatched: readonly SendAttempt[];
  /** Due reminders suppressed by the ledger (already dispatched). */
  readonly alreadyDispatched: readonly ReminderId[];
  /** Reminders whose effective fire instant is still in the future. */
  readonly notYetDue: readonly ReminderId[];
  /** The schedule's accounted channel skips (pass-through, for audit). */
  readonly skippedChannels: readonly SkippedChannelFanout[];
}

/** Typed dispatch rejections (ledger unavailability is infrastructure). */
export type DispatchError = ReminderScheduleError | { readonly kind: "ledger-unavailable" };

// ---------------------------------------------------------------------------
// Engine construction.
// ---------------------------------------------------------------------------

/** Constructor deps (all injectable — the @orbb/measurement discipline). */
export interface ReminderEngineDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly channels: ChannelRegistry;
  readonly ledger: SendAttemptLedger;
  readonly recipients: RecipientDirectory;
  readonly labels: ReminderLabelDirectory;
}

/** The deterministic reminder/notification engine. */
export class ReminderEngine {
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #channels: ChannelRegistry;
  readonly #ledger: SendAttemptLedger;
  readonly #recipients: RecipientDirectory;
  readonly #labels: ReminderLabelDirectory;

  constructor(deps: ReminderEngineDeps) {
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#channels = deps.channels;
    this.#ledger = deps.ledger;
    this.#recipients = deps.recipients;
    this.#labels = deps.labels;
  }

  // -------------------------------------------------------------------------
  // computeSchedule — pure, synchronous, deterministic.
  // -------------------------------------------------------------------------

  computeSchedule(
    input: ReminderEngineInput,
  ): NotificationResult<ReminderSchedule, ReminderScheduleError> {
    const validated = this.#validateInput(input);
    if (!validated.ok) {
      return err(validated.error);
    }
    const { tasks, profile } = validated.value;
    const computedAt = this.#clock.now();
    const reminders: PlannedReminder[] = [];
    const skippedChannels: SkippedChannelFanout[] = [];

    if (!profile.remindersEnabled) {
      // Master preference gate: an empty schedule is the person's choice.
      return ok({ computedAt, reminders, skippedChannels });
    }

    for (const task of [...tasks].sort(compareReminderTasks)) {
      const rung = selectRung(task, computedAt.getTime());
      if (rung === undefined) {
        continue; // COMPLETED tasks never remind (the ladder is gentle).
      }
      const baseFireMs = baseFireInstant(task, rung, profile);
      const effectiveFireMs =
        profile.quietHours === null
          ? baseFireMs
          : deferToQuietEdge(baseFireMs, profile.quietHours);
      const deferredFrom = effectiveFireMs === baseFireMs ? undefined : new Date(baseFireMs);
      const defer: ReminderDeferRecord | undefined =
        deferredFrom === undefined ? undefined : { from: deferredFrom, reason: "quiet-hours" };
      const payload = buildReminderPayload({
        task,
        rung,
        labels: this.#labels,
        ...(defer !== undefined ? { defer } : {}),
      });

      for (const channel of profile.channels) {
        const skip = this.#capabilitySkip(task.id, rung, channel);
        if (skip !== undefined) {
          skippedChannels.push(skip);
          continue;
        }
        const utcDay = utcEpochDay(effectiveFireMs);
        const id = deriveReminderId({
          taskId: task.id,
          window: task.window,
          rung,
          channel,
          utcDay,
        });
        reminders.push({
          id,
          taskId: task.id,
          personId: task.personId,
          channel,
          rung,
          scheduledAt: new Date(effectiveFireMs),
          ...(deferredFrom !== undefined ? { deferredFrom } : {}),
          payload,
        });
      }
    }

    reminders.sort(comparePlannedReminders);
    assertUniqueReminderIds(reminders);
    return ok({ computedAt, reminders, skippedChannels });
  }

  // -------------------------------------------------------------------------
  // dispatchPending — idempotent, fail-closed.
  // -------------------------------------------------------------------------

  async dispatchPending(
    input: ReminderEngineInput,
  ): Promise<NotificationResult<DispatchOutcome, DispatchError>> {
    const schedule = this.computeSchedule(input);
    if (!schedule.ok) {
      return err(schedule.error);
    }
    const { computedAt, reminders, skippedChannels } = schedule.value;
    const nowMs = computedAt.getTime();
    const dispatched: SendAttempt[] = [];
    const alreadyDispatched: ReminderId[] = [];
    const notYetDue: ReminderId[] = [];
    let due = 0;

    for (const reminder of reminders) {
      if (reminder.scheduledAt.getTime() > nowMs) {
        notYetDue.push(reminder.id);
        continue;
      }
      due += 1;
      let prior: SendAttempt | undefined;
      try {
        prior = await this.#ledger.findByReminderId(reminder.id);
      } catch {
        // Infrastructure failure: typed rejection, never a silent drop.
        return err({ kind: "ledger-unavailable" });
      }
      if (prior !== undefined) {
        alreadyDispatched.push(reminder.id);
        continue;
      }
      const attempt = await this.#dispatchOne(reminder);
      if (attempt === undefined) {
        // The ledger refused the record — without a ledger row the
        // exactly-once proof is broken; surface the typed failure.
        return err({ kind: "ledger-unavailable" });
      }
      dispatched.push(attempt);
    }

    return ok({ computedAt, due, dispatched, alreadyDispatched, notYetDue, skippedChannels });
  }

  // -------------------------------------------------------------------------
  // Dispatch internals (fail-closed at every step).
  // -------------------------------------------------------------------------

  async #dispatchOne(reminder: PlannedReminder): Promise<SendAttempt | undefined> {
    const recipientRef = await this.#resolveRecipient(reminder.personId);
    const outcome = await this.#deliverFailClosed(reminder, recipientRef);
    const attempt: SendAttempt = {
      id: this.#ids.next("snd") as SendAttemptId,
      reminderId: reminder.id,
      channel: reminder.channel,
      rung: reminder.rung,
      outcome,
      dispatchedAt: this.#clock.now(),
    };
    try {
      await this.#ledger.record(attempt);
    } catch {
      return undefined;
    }
    return attempt;
  }

  /**
   * Delivers one reminder fail-closed: recipient miss, channel-miss
   * (registry change), and a THROWING channel are all recorded outcomes —
   * never a crash into the engine, never a silent drop.
   */
  async #deliverFailClosed(
    reminder: PlannedReminder,
    recipientRef: string | undefined,
  ): Promise<ChannelSendResult> {
    if (recipientRef === undefined) {
      return { status: "undeliverable", reason: { kind: "unknown-recipient" } };
    }
    const channel: NotificationChannel | undefined = this.#channels.resolve(reminder.channel);
    if (channel === undefined) {
      return { status: "undeliverable", reason: { kind: "channel-disabled" } };
    }
    const delivery = {
      reminderId: reminder.id,
      recipientRef,
      channel: reminder.channel,
      payload: reminder.payload,
    };
    try {
      return await channel.send(delivery);
    } catch {
      // The channel contract is fail-closed; a thrown error is still
      // converted here so the engine itself can never crash on a channel.
      return { status: "undeliverable", reason: { kind: "channel-transport-error" } };
    }
  }

  /** Resolves the recipient pseudonym; a throwing directory is a miss (fail-closed). */
  async #resolveRecipient(personId: PersonId): Promise<string | undefined> {
    try {
      return await this.#recipients.resolve(personId);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Input validation + schedule internals.
  // -------------------------------------------------------------------------

  #validateInput(
    input: ReminderEngineInput,
  ): NotificationResult<
    { tasks: readonly MeasurementTask[]; profile: NormalizedReminderProfile },
    ReminderScheduleError
  > {
    if (!isReminderPreferenceProfile(input.profile)) {
      return err({ kind: "invalid-preference", field: preferenceErrorField(input.profile) });
    }
    const seenTaskIds = new Set<string>();
    for (const [index, task] of input.tasks.entries()) {
      if (!isTaskSnapshotValid(task)) {
        return err({ kind: "invalid-task", taskIndex: index });
      }
      if (seenTaskIds.has(task.id)) {
        return err({ kind: "duplicate-task", taskIndex: index });
      }
      seenTaskIds.add(task.id);
    }
    for (const [index, channelId] of input.profile.channels.entries()) {
      if (this.#channels.resolve(channelId) === undefined) {
        return err({ kind: "unknown-channel", channelIndex: index });
      }
    }
    return ok({ tasks: input.tasks, profile: normalizeReminderProfile(input.profile) });
  }

  #capabilitySkip(
    taskId: TaskId,
    rung: ReminderRung,
    channel: NotificationChannelId,
  ): SkippedChannelFanout | undefined {
    const resolved = this.#channels.resolve(channel);
    if (resolved === undefined) {
      // Unreachable: #validateInput proved registry membership and
      // computeSchedule is synchronous (no concurrent mutation window).
      // A defensive invariant error is the lane-consistent response to a
      // bypassed validation path — NOT a channel failure.
      throw new NotificationEngineError(
        "invariant-violation",
        "Channel registry lost a validated channel during schedule computation.",
      );
    }
    for (const capability of RUNG_CAPABILITY_REQUIREMENTS[rung]) {
      if (!resolved.capabilities[capability]) {
        return { taskId, rung, channel, reason: { kind: "channel-lacks-capability", capability } };
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pure schedule helpers (exported for table-driven tests).
// ---------------------------------------------------------------------------

/**
 * The recorded rung-selection table: `REMIND` for open tasks with a
 * future window end; `REMIND_WITH_FALLBACK_OFFER` for open tasks with a
 * closed window (missed); `undefined` for completed tasks.
 */
export function selectRung(task: MeasurementTask, nowMs: number): ReminderRung | undefined {
  if (task.state !== "open") {
    return undefined;
  }
  return task.window.endsAt.getTime() > nowMs ? "REMIND" : "REMIND_WITH_FALLBACK_OFFER";
}

/**
 * The base (pre-deferral) fire instant of a rung: rung 1 fires
 * `leadTimeMs` before the window closes, clamped forward to the window
 * start; rung 2 fires `escalationGraceMs` after the window closes.
 */
export function baseFireInstant(
  task: MeasurementTask,
  rung: ReminderRung,
  profile: NormalizedReminderProfile,
): number {
  const endsAtMs = task.window.endsAt.getTime();
  if (rung === "REMIND") {
    const fire = endsAtMs - profile.leadTimeMs;
    // A nudge never fires before the window opens (recorded clamp).
    return Math.max(fire, task.window.startsAt.getTime());
  }
  return endsAtMs + profile.escalationGraceMs;
}

/** Deterministic task ordering: metricId, then window start, then id. */
export function compareReminderTasks(a: MeasurementTask, b: MeasurementTask): number {
  if (a.metricId !== b.metricId) {
    return a.metricId < b.metricId ? -1 : 1;
  }
  const byStart = a.window.startsAt.getTime() - b.window.startsAt.getTime();
  if (byStart !== 0) {
    return byStart;
  }
  return a.id < b.id ? -1 : 1;
}

/** Deterministic reminder ordering: scheduledAt, task, rung, channel, id. */
export function comparePlannedReminders(a: PlannedReminder, b: PlannedReminder): number {
  const byTime = a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  if (a.taskId !== b.taskId) {
    return a.taskId < b.taskId ? -1 : 1;
  }
  const byRung = reminderRungIndex(a.rung) - reminderRungIndex(b.rung);
  if (byRung !== 0) {
    return byRung;
  }
  if (a.channel !== b.channel) {
    return a.channel < b.channel ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/** Defensive uniqueness guard over derived reminder identities. */
function assertUniqueReminderIds(reminders: readonly PlannedReminder[]): void {
  const seen = new Set<string>();
  for (const reminder of reminders) {
    if (seen.has(reminder.id)) {
      throw new NotificationEngineError(
        "invariant-violation",
        "Reminder id derivation collided (two identical reminder identities in one schedule).",
      );
    }
    seen.add(reminder.id);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

/**
 * Structural validation of a task snapshot's CONSUMED fields (identity,
 * person/plan scope, metric, method order, window, state). Unconsumed
 * fields (`conceptCode`, `createdAt`, `rollCount`) are neither echoed nor
 * validated — fail-closed on consumed shape only.
 */
export function isTaskSnapshotValid(task: MeasurementTask): boolean {
  if (typeof task !== "object" || task === null) {
    return false;
  }
  if (!isIdOf("task", task.id) || !isIdOf("person", task.personId) || !isIdOf("plan", task.planId)) {
    return false;
  }
  if (typeof task.metricId !== "string" || task.metricId.length === 0) {
    return false;
  }
  if (!Array.isArray(task.methodOrder) || task.methodOrder.some((m) => typeof m !== "string")) {
    return false;
  }
  if (task.state !== "open" && task.state !== "completed") {
    return false;
  }
  return isWindowValid(task.window);
}

function isWindowValid(window: MeasurementWindow): boolean {
  if (typeof window !== "object" || window === null) {
    return false;
  }
  if (!Number.isInteger(window.sequence) || window.sequence < 0) {
    return false;
  }
  const startsAt = window.startsAt instanceof Date ? window.startsAt.getTime() : Number.NaN;
  const endsAt = window.endsAt instanceof Date ? window.endsAt.getTime() : Number.NaN;
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt;
}

function preferenceErrorField(profile: unknown): string {
  if (typeof profile !== "object" || profile === null) {
    return "remindersEnabled";
  }
  const candidate = profile as Record<string, unknown>;
  if (typeof candidate.remindersEnabled !== "boolean") {
    return "remindersEnabled";
  }
  if (!Array.isArray(candidate.channels)) {
    return "channels";
  }
  if (candidate.remindersEnabled === true && candidate.channels.length === 0) {
    return "channels";
  }
  if (
    candidate.channels.some(
      (channel) => typeof channel !== "string" || !isNotificationChannelId(channel),
    )
  ) {
    return "channels";
  }
  const quietHours: unknown = candidate.quietHours;
  if (quietHours !== undefined && quietHours !== null && typeof quietHours === "object") {
    return "quietHours";
  }
  return "escalationGraceMs";
}
