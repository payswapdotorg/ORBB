/**
 * In-memory reminder store (M6 EXIT, Lane B): the journey-#7 reminder
 * chain's derivation — TYPED SYNTH fixtures computed from the REAL seeded
 * today task records under the MIRRORED B8 schedule semantics.
 *
 * THE MIRROR DISCIPLINE (the lib/ wire-type pattern): `@orbb/notifications`
 * is READ-ONLY and resolves at runtime to an unbuilt `dist/` entry, so the
 * schedule semantics below are mirrored field-for-field from the frozen B8
 * engine decision table (each function cites its source), and the fixture
 * payloads are typed by the REAL `ReminderPayload` type (compile-time pin
 * — see `types.ts`). At worker wiring the derivation swaps for
 * `ReminderEngine.computeSchedule` outputs with no call-site changes.
 *
 * MIRRORED SEMANTICS (B8 `engine.ts`, verbatim decision table):
 *   - COMPLETED task -> no reminder (completing silences the ladder —
 *     reminders nudge, they never punish).
 *   - OPEN task, `window.endsAt > now` -> rung `REMIND`, base fire instant
 *     `endsAt - leadTimeMs`, clamped forward to `window.startsAt`.
 *   - OPEN task, `window.endsAt <= now` -> rung
 *     `REMIND_WITH_FALLBACK_OFFER`, base fire instant
 *     `endsAt + escalationGraceMs` (gentle: never at the instant of the
 *     miss).
 *   - Quiet hours (preference-gated): the base fire instant landing inside
 *     the quiet interval is DEFERRED to the quiet-window end edge — DEFER,
 *     NEVER DROP; the deferral is recorded (`defer.from`, reason
 *     `quiet-hours`).
 *   - The rung-2 fallback offer is the task's recorded `methodOrder` as
 *     DATA (preferred first, fallback order after) with
 *     `enforcementAuthority: "none"` — the engine never orders a provider.
 *
 * DETERMINISM: the derivation is a pure function of (task records, `now`).
 * The seeded task windows are anchored to the local calendar day (the B4
 * fixtures), and quiet hours are anchored to the same session-local clock
 * (see `profile.ts`), so the golden journey's reminder facts — the missed
 * task's delivered rung-2 reminder, the due tasks' quiet-hours-deferred
 * rung-1 reminders — hold at ANY hour of the day and in ANY timezone:
 *   - the whole-day due windows end within the last minute of the local
 *     day, so rung-1 base fire instants (~22:59 local) always land inside
 *     the 22:00–07:00 quiet interval and defer to 07:00 tomorrow
 *     ("deferred to 07:00" — shown honestly);
 *   - the missed weight window (yesterday 07:00–09:00 local) produces a
 *     rung-2 reminder that fired yesterday 10:00 local (delivered).
 */

import type { MeasurementTask } from "@orbb/measurement";
import {
  TODAY_QUIET_HOURS_LABEL,
  todayMetricLabel,
  todayReminderProfile,
} from "./catalog";
import { MS_PER_DAY, MS_PER_MINUTE } from "./profile";
import type {
  TodayFallbackOfferWire,
  TodayQuietHoursMirror,
  TodayReminderWire,
  TodayReminderRung,
} from "./types";
import { isTodayReminderRung } from "./types";
import { listTodayTaskRecords } from "../today/store";
import { TODAY_METHOD_LANDSCAPES } from "../today/catalog";
import type { TodayTaskRecord } from "../today/types";

// ---------------------------------------------------------------------------
// Mirrored B8 pure helpers (each cites its frozen source).
// ---------------------------------------------------------------------------

/**
 * Mirror of B8 `selectRung`: the rung for a task at `nowMs`
 * (`undefined` for completed tasks — silence, never punishment).
 */
export function selectTodayReminderRung(
  task: MeasurementTask,
  nowMs: number,
): TodayReminderRung | undefined {
  if (task.state !== "open") {
    return undefined;
  }
  return task.window.endsAt.getTime() > nowMs
    ? "REMIND"
    : "REMIND_WITH_FALLBACK_OFFER";
}

/**
 * Mirror of B8 `baseFireInstant`: rung 1 fires `leadTimeMs` before the
 * window closes, clamped forward to the window start; rung 2 fires
 * `escalationGraceMs` after the window closes.
 */
export function todayBaseFireInstant(
  task: MeasurementTask,
  rung: TodayReminderRung,
  options: { readonly leadTimeMs: number; readonly escalationGraceMs: number },
): number {
  const endsAtMs = task.window.endsAt.getTime();
  if (rung === "REMIND") {
    const fire = endsAtMs - options.leadTimeMs;
    // A nudge never fires before the window opens (the recorded clamp).
    return Math.max(fire, task.window.startsAt.getTime());
  }
  return endsAtMs + options.escalationGraceMs;
}

/** Mirror of B8 `localMinuteOfDay` + `isQuietInstant` (wrap-aware). */
export function isTodayQuietInstant(
  instantMs: number,
  spec: TodayQuietHoursMirror,
): boolean {
  if (!spec.enabled) {
    return false;
  }
  const localMinute = Math.floor(
    ((instantMs + spec.utcOffsetMinutes * MS_PER_MINUTE) % MS_PER_DAY) / MS_PER_MINUTE,
  );
  const { startMinuteOfDay, endMinuteOfDay } = spec;
  if (startMinuteOfDay < endMinuteOfDay) {
    return localMinute >= startMinuteOfDay && localMinute < endMinuteOfDay;
  }
  // Wrap-around interval (22:00–07:00 spans local midnight).
  return localMinute >= startMinuteOfDay || localMinute < endMinuteOfDay;
}

/**
 * Mirror of B8 `deferToQuietEdge`: defer the instant to the quiet-window
 * END edge (the defer edge itself is deliverable by definition).
 */
export function deferToTodayQuietEdge(
  instantMs: number,
  spec: TodayQuietHoursMirror,
): number {
  if (!isTodayQuietInstant(instantMs, spec)) {
    return instantMs;
  }
  const offsetMs = spec.utcOffsetMinutes * MS_PER_MINUTE;
  // The local calendar day that contains the instant.
  const localDay = Math.floor((instantMs + offsetMs) / MS_PER_DAY);
  // Absolute instant of the end edge on that local day.
  const edgeThisLocalDay =
    localDay * MS_PER_DAY + spec.endMinuteOfDay * MS_PER_MINUTE - offsetMs;
  return edgeThisLocalDay >= instantMs ? edgeThisLocalDay : edgeThisLocalDay + MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Local time formatting (deterministic, session-local).
// ---------------------------------------------------------------------------

/** Formats a clock time as HH:MM (24h, session-local — the today mirror). */
function formatTimePart(at: Date): string {
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Local start-of-day of the given instant (the today store's mirror). */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** Formats a past instant relative to `now` (yesterday/day label + time). */
function formatDayTime(at: Date, now: Date): string {
  const DAY_MS = MS_PER_DAY;
  const daysAgo = Math.round(
    (startOfDay(now).getTime() - startOfDay(at).getTime()) / DAY_MS,
  );
  const day =
    daysAgo === 1 ? "yesterday" : daysAgo === 0 ? "today" : `${daysAgo} days ago`;
  return `${day} at ${formatTimePart(at)}`;
}

// ---------------------------------------------------------------------------
// Fixture identity (the B8 `deriveReminderId` grammar mirror).
// ---------------------------------------------------------------------------

/**
 * Derives the deterministic SYNTH reminder id for a (task, rung) pair —
 * the `remd_<body>` grammar mirror (B8 `REMINDER_ID_PREFIX`). RECORDED
 * MIRROR BOUNDARY: the B8 identity is a domain-separated SHA-256 over
 * (task id, window identity, rung, channel, UTC day); this app-side
 * fixture id is the deterministic SYNTH-marked stand-in (the digest
 * kernel is the engine's internal — at wiring the real `ReminderId`
 * flows through this seam unchanged).
 */
export function todayReminderId(taskId: string, rung: TodayReminderRung): string {
  const slug = taskId.replace(/^task_SYNTH-today-/, "").replace(/^task_/, "x");
  const rungSlug = rung === "REMIND" ? "remind" : "fallback-offer";
  return `remd_SYNTH-today-${slug}-${rungSlug}`;
}

// ---------------------------------------------------------------------------
// The derivation (pure, per task record).
// ---------------------------------------------------------------------------

/**
 * Derives one task's reminder wire view at `now` — `undefined` when the
 * ladder is silent (completed task, or reminders disabled by profile).
 */
export function toTodayReminderWire(
  record: TodayTaskRecord,
  now: Date,
): TodayReminderWire | undefined {
  const profile = todayReminderProfile(now);
  if (!profile.remindersEnabled) {
    return undefined;
  }
  const { task } = record;
  const rung = selectTodayReminderRung(task, now.getTime());
  if (rung === undefined || !isTodayReminderRung(rung)) {
    return undefined;
  }
  const baseFireMs = todayBaseFireInstant(task, rung, profile);
  const effectiveFireMs =
    profile.quietHours === null
      ? baseFireMs
      : deferToTodayQuietEdge(baseFireMs, profile.quietHours);
  const deferredFrom = effectiveFireMs === baseFireMs ? undefined : new Date(baseFireMs);
  const scheduledAt = new Date(effectiveFireMs);
  const delivered = effectiveFireMs <= now.getTime();

  const base = {
    reminderId: todayReminderId(task.id, rung),
    rung,
    taskId: task.id,
    planId: task.planId,
    metricId: task.metricId,
    metricLabel: todayMetricLabel(task.metricId),
    window: {
      sequence: task.window.sequence,
      startsAt: task.window.startsAt.toISOString(),
      endsAt: task.window.endsAt.toISOString(),
    },
    scheduledAt: scheduledAt.toISOString(),
    deliveryState: delivered ? ("delivered" as const) : ("scheduled" as const),
    quietHoursLabel: TODAY_QUIET_HOURS_LABEL,
    ...(deferredFrom !== undefined
      ? {
          defer: {
            from: deferredFrom.toISOString(),
            reason: "quiet-hours" as const,
            label: `deferred to ${formatTimePart(scheduledAt)}`,
          },
        }
      : {}),
  };

  if (rung === "REMIND") {
    return {
      ...base,
      reminderLabel: "Reminder scheduled",
      detailLabel: deferredFrom !== undefined
        ? `Rung REMIND · quiet hours ${TODAY_QUIET_HOURS_LABEL} — ${base.defer?.label ?? "deferred"}`
        : `Rung REMIND · fires ${formatDayTime(scheduledAt, now)}`,
    };
  }

  // Rung 2 — the missed-window reminder with the fallback-provider OFFER
  // (the task's recorded method vocabulary as DATA; never an order).
  const offer: TodayFallbackOfferWire = {
    enforcementAuthority: "none",
    methods: task.methodOrder.map((methodId, index) => ({
      methodId,
      methodLabel: todayMethodLabelFor(methodId),
      role: index === 0 ? ("preferred" as const) : ("fallback" as const),
    })),
  };
  return {
    ...base,
    reminderLabel: "Reminder sent — fallback options offered",
    detailLabel: `Rung REMIND_WITH_FALLBACK_OFFER · sent ${formatDayTime(scheduledAt, now)}`,
    fallbackOffer: offer,
  };
}

/** Resolves a method's human-safe label (today method landscape reuse). */
function todayMethodLabelFor(methodId: string): string {
  for (const methods of Object.values(TODAY_METHOD_LANDSCAPES)) {
    const found = methods.find((method) => method.methodId === methodId);
    if (found !== undefined) {
      return found.label;
    }
  }
  return "a measurement method";
}

// ---------------------------------------------------------------------------
// Read models.
// ---------------------------------------------------------------------------

/**
 * Lists the session's reminder wire views, derived from the REAL seeded
 * today task records (deterministic per calendar day; completed tasks
 * never appear — completing silences the ladder).
 */
export function listTodayReminders(now: Date): readonly TodayReminderWire[] {
  return listTodayTaskRecords(now)
    .map((record) => toTodayReminderWire(record, now))
    .filter((reminder): reminder is TodayReminderWire => reminder !== undefined);
}

/** The active quiet-hours label (honest about the deferral policy). */
export function todayQuietHoursLabel(): string {
  return TODAY_QUIET_HOURS_LABEL;
}

/**
 * Store invariants (programming errors — the derivation is a fixture):
 *   - the store derives at most ONE reminder per task (exactly one rung
 *     active per task at any instant — the B8 ladder rule);
 *   - every reminder id is `remd_`-prefixed and SYNTH-marked;
 *   - rung-2 reminders carry the fallback offer with
 *     `enforcementAuthority: "none"` and the task's methodOrder as DATA;
 *   - rung-1 reminders never carry an offer;
 *   - a defer record exists exactly when the fire instant was deferred;
 *   - completed tasks never remind (silence, never punishment).
 */
export function assertTodayReminderStoreInvariants(now: Date): void {
  const seen = new Set<string>();
  const records = listTodayTaskRecords(now);
  for (const record of records) {
    const reminder = toTodayReminderWire(record, now);
    if (record.task.state === "completed") {
      if (reminder !== undefined) {
        throw new Error(
          "Completed tasks never remind (the ladder is silent after completion).",
        );
      }
      continue;
    }
    if (reminder === undefined) {
      continue;
    }
    if (seen.has(reminder.taskId)) {
      throw new Error(`Multiple reminders derived for one task: ${reminder.taskId}`);
    }
    seen.add(reminder.taskId);
    if (
      !reminder.reminderId.startsWith("remd_SYNTH-") ||
      reminder.reminderId.length < "remd_".length + 16
    ) {
      throw new Error(`Reminder id violates the remd_ SYNTH grammar: ${reminder.reminderId}`);
    }
    if (reminder.rung === "REMIND_WITH_FALLBACK_OFFER") {
      if (reminder.fallbackOffer === undefined) {
        throw new Error("Rung-2 reminders must carry the fallback offer.");
      }
      if (reminder.fallbackOffer.enforcementAuthority !== "none") {
        throw new Error("The offer vocabulary carries NO enforcement authority.");
      }
      const expected = record.task.methodOrder;
      if (
        reminder.fallbackOffer.methods.length !== expected.length ||
        reminder.fallbackOffer.methods.some(
          (method, index) => method.methodId !== expected[index],
        )
      ) {
        throw new Error(
          "The offer must mirror the task's recorded methodOrder as DATA (preferred first).",
        );
      }
    } else if (reminder.fallbackOffer !== undefined) {
      throw new Error("Rung-1 reminders never carry a fallback offer.");
    }
    const deferred = reminder.defer !== undefined;
    const baseFireMs = todayBaseFireInstant(
      record.task,
      reminder.rung,
      todayReminderProfile(now),
    );
    const expectedDeferred = baseFireMs !== new Date(reminder.scheduledAt).getTime();
    if (deferred !== expectedDeferred) {
      throw new Error(
        "A defer record must exist exactly when the fire instant was quiet-hours-deferred.",
      );
    }
  }
}
