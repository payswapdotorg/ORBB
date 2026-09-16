/**
 * Mobile reminder model (M6 EXIT, Lane B) — pure data + pure functions.
 *
 * The MIRROR of the web `apps/web/src/lib/reminders/{types,catalog,profile,store}.ts`
 * (same field-for-field B8 vocabulary, same mirrored schedule semantics),
 * adapted to the mobile discipline: a client-local derivation over the
 * today session's task records — no React Native imports in this module,
 * plain-node unit-testable (the `lib/today/model.ts` discipline).
 *
 * Why a local mirror instead of importing the web libs or
 * `@orbb/notifications`: `apps/mobile` declares only `@orbb/ui` as a
 * workspace dependency (plus the RN/Expo stack); adding anything else
 * would change `pnpm-lock.yaml` beyond workspace-dep additions and add a
 * runtime dependency on an unbuilt `dist/` entry — recorded handoff: at
 * engine wiring the mirrors swap for the real package exports with no
 * call-site changes (the same handoff `lib/today/model.ts` records).
 *
 * MIRRORED B8 SEMANTICS (verbatim decision table, see the web store's
 * header for the citations): completed tasks never remind; open tasks
 * with future windows carry rung `REMIND` (lead 60 min before close,
 * clamped to window start); open tasks with elapsed windows carry rung
 * `REMIND_WITH_FALLBACK_OFFER` (grace 60 min after close); quiet hours
 * 22:00–07:00 local-of-record defer to the edge — defer, never drop.
 *
 * RECORDED ASSUMPTION (the web store's rationale, mirrored): the fixture
 * session's local-of-record is the SESSION'S LOCAL TIMEZONE — the same
 * local clock the B4 mobile today fixtures anchor task windows to — so
 * the journey's reminder facts hold at any hour and in any timezone.
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; zero PHI (ids + human-safe labels only — the B8 payload
 * contract); deterministic derivation (fixed reminder ids per task/rung).
 */

import type {
  TodaySession,
  TodayTaskRecord,
  TodayTaskView,
} from "../today/model";

// ---------------------------------------------------------------------------
// The ladder vocabulary (B8 `REMINDER_RUNGS` mirror).
// ---------------------------------------------------------------------------

/** Mirror of the frozen `REMINDER_RUNGS` vocabulary, in escalation order. */
export const TODAY_REMINDER_RUNGS = ["REMIND", "REMIND_WITH_FALLBACK_OFFER"] as const;

/** One rung of the reminder ladder. */
export type TodayReminderRung = (typeof TODAY_REMINDER_RUNGS)[number];

/** Type guard: is `value` a ladder rung? */
export function isTodayReminderRung(value: unknown): value is TodayReminderRung {
  return (
    typeof value === "string" &&
    (TODAY_REMINDER_RUNGS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The preference profile mirror (the B8 recorded defaults).
// ---------------------------------------------------------------------------

/** One millisecond per minute (the B8 `MS_PER_MINUTE` mirror). */
export const MS_PER_MINUTE = 60_000;

/** One millisecond per day (the B8 `MS_PER_DAY` mirror). */
export const MS_PER_DAY = 86_400_000;

/** The B8 recorded default upcoming-due lead time: 60 minutes. */
export const TODAY_LEAD_TIME_MS = 3_600_000;

/** The B8 recorded default missed-window escalation grace: 60 minutes. */
export const TODAY_ESCALATION_GRACE_MS = 3_600_000;

/** The active quiet-hours display label (the recorded default). */
export const TODAY_QUIET_HOURS_LABEL = "22:00–07:00";

/** Mirror of the B8 `QuietHoursSpec` (half-open, wrap-aware, fixed offset). */
export interface TodayQuietHoursMirror {
  readonly enabled: boolean;
  readonly startMinuteOfDay: number;
  readonly endMinuteOfDay: number;
  readonly utcOffsetMinutes: number;
}

/**
 * The session's local-of-record UTC offset in minutes (east-positive).
 * Resolved from the reference instant; fixed for the session (DST-free,
 * the B8 pure-UTC discipline).
 */
export function localOffsetMinutes(at: Date): number {
  return -at.getTimezoneOffset();
}

/** The active quiet-hours spec: the B8 recorded default, session-local. */
export function todayQuietHours(at: Date): TodayQuietHoursMirror {
  return {
    enabled: true,
    startMinuteOfDay: 22 * 60,
    endMinuteOfDay: 7 * 60,
    utcOffsetMinutes: localOffsetMinutes(at),
  };
}

// ---------------------------------------------------------------------------
// The reminder view (the wire-shaped projection the screen renders).
// ---------------------------------------------------------------------------

/** The quiet-hours defer record (defer, never drop). */
export interface TodayReminderDeferView {
  readonly from: string;
  readonly reason: "quiet-hours";
  readonly label: string;
}

/** The fallback-provider offer — DATA, never an order. */
export interface TodayFallbackOfferView {
  readonly enforcementAuthority: "none";
  readonly methods: readonly {
    readonly methodId: string;
    readonly methodLabel: string;
    readonly role: "preferred" | "fallback";
  }[];
}

/** One task's reminder state, shaped for the Today screen. */
export interface TodayReminderView {
  readonly reminderId: string;
  readonly rung: TodayReminderRung;
  readonly taskId: string;
  readonly metricLabel: string;
  /** The EFFECTIVE fire instant after quiet-hours deferral (ISO-8601). */
  readonly scheduledAt: string;
  readonly deliveryState: "scheduled" | "delivered";
  readonly reminderLabel: string;
  readonly detailLabel: string;
  readonly defer?: TodayReminderDeferView;
  readonly fallbackOffer?: TodayFallbackOfferView;
  readonly quietHoursLabel: string;
}

// ---------------------------------------------------------------------------
// Mirrored B8 pure helpers (each cites its frozen source).
// ---------------------------------------------------------------------------

/** Mirror of B8 `selectRung` (completed tasks never remind). */
export function selectTodayReminderRung(
  task: TodayTaskRecord["task"],
  nowMs: number,
): TodayReminderRung | undefined {
  if (task.state !== "open") {
    return undefined;
  }
  return new Date(task.window.endsAt).getTime() > nowMs
    ? "REMIND"
    : "REMIND_WITH_FALLBACK_OFFER";
}

/** Mirror of B8 `baseFireInstant` (lead clamp; grace after close). */
export function todayBaseFireInstant(
  task: TodayTaskRecord["task"],
  rung: TodayReminderRung,
): number {
  const endsAtMs = new Date(task.window.endsAt).getTime();
  if (rung === "REMIND") {
    const fire = endsAtMs - TODAY_LEAD_TIME_MS;
    return Math.max(fire, new Date(task.window.startsAt).getTime());
  }
  return endsAtMs + TODAY_ESCALATION_GRACE_MS;
}

/** Mirror of B8 `isQuietInstant` (wrap-aware local minutes of day). */
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
  return localMinute >= startMinuteOfDay || localMinute < endMinuteOfDay;
}

/** Mirror of B8 `deferToQuietEdge` (defer to the end edge, never drop). */
export function deferToTodayQuietEdge(
  instantMs: number,
  spec: TodayQuietHoursMirror,
): number {
  if (!isTodayQuietInstant(instantMs, spec)) {
    return instantMs;
  }
  const offsetMs = spec.utcOffsetMinutes * MS_PER_MINUTE;
  const localDay = Math.floor((instantMs + offsetMs) / MS_PER_DAY);
  const edgeThisLocalDay =
    localDay * MS_PER_DAY + spec.endMinuteOfDay * MS_PER_MINUTE - offsetMs;
  return edgeThisLocalDay >= instantMs ? edgeThisLocalDay : edgeThisLocalDay + MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Formatting + fixture identity (deterministic, session-local).
// ---------------------------------------------------------------------------

/** Formats a clock time as HH:MM (24h, session-local). */
function formatTimePart(at: Date): string {
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Local start-of-day of the given instant. */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
}

/** Formats a past instant relative to `now` (yesterday/day label + time). */
function formatDayTime(at: Date, now: Date): string {
  const daysAgo = Math.round(
    (startOfDay(now).getTime() - startOfDay(at).getTime()) / MS_PER_DAY,
  );
  const day =
    daysAgo === 1 ? "yesterday" : daysAgo === 0 ? "today" : `${daysAgo} days ago`;
  return `${day} at ${formatTimePart(at)}`;
}

/**
 * Derives the deterministic SYNTH reminder id (`remd_` grammar, the B8
 * mirror stand-in — see the web store's recorded mirror boundary).
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
 * Derives one task's reminder view at `now` — `undefined` when the ladder
 * is silent (completed task). The labels reuse the task view's own metric
 * label (human-safe, already projected by the today model).
 */
export function toTodayReminderView(
  record: TodayTaskRecord,
  taskView: TodayTaskView,
  now: Date,
): TodayReminderView | undefined {
  const rung = selectTodayReminderRung(record.task, now.getTime());
  if (rung === undefined) {
    return undefined;
  }
  const quiet = todayQuietHours(now);
  const baseFireMs = todayBaseFireInstant(record.task, rung);
  const effectiveFireMs = deferToTodayQuietEdge(baseFireMs, quiet);
  const deferredFrom = effectiveFireMs === baseFireMs ? undefined : new Date(baseFireMs);
  const scheduledAt = new Date(effectiveFireMs);
  const delivered = effectiveFireMs <= now.getTime();

  const base = {
    reminderId: todayReminderId(record.task.id, rung),
    rung,
    taskId: record.task.id,
    metricLabel: taskView.metricLabel,
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
      detailLabel:
        deferredFrom !== undefined
          ? `Rung REMIND · quiet hours ${TODAY_QUIET_HOURS_LABEL} — ${base.defer?.label ?? "deferred"}`
          : `Rung REMIND · fires ${formatDayTime(scheduledAt, now)}`,
    };
  }

  // Rung 2 — the missed-window reminder with the fallback-provider OFFER:
  // the task's recorded methodOrder as DATA (preferred first), labeled
  // through the task view's own method labels. Never an order.
  return {
    ...base,
    reminderLabel: "Reminder sent — fallback options offered",
    detailLabel: `Rung REMIND_WITH_FALLBACK_OFFER · sent ${formatDayTime(scheduledAt, now)}`,
    fallbackOffer: {
      enforcementAuthority: "none",
      methods: record.task.methodOrder.map((methodId, index) => {
        const label =
          taskView.methods.find((method) => method.methodId === methodId)?.label ??
          "a measurement method";
        return {
          methodId,
          methodLabel: label,
          role: index === 0 ? ("preferred" as const) : ("fallback" as const),
        };
      }),
    },
  };
}

/**
 * Lists the session's reminder views, derived from the today session's
 * task records (deterministic; completed tasks never appear). The task
 * views are read through the SAME session the screen renders.
 */
export function listTodayReminders(
  session: TodaySession,
  taskViews: readonly TodayTaskView[],
  now: Date,
): readonly TodayReminderView[] {
  const views = new Map(taskViews.map((view) => [view.taskId, view]));
  return session.tasks
    .map((record) => {
      const view = views.get(record.task.id);
      return view === undefined ? undefined : toTodayReminderView(record, view, now);
    })
    .filter((reminder): reminder is TodayReminderView => reminder !== undefined);
}

// ---------------------------------------------------------------------------
// Model invariants (programming errors — the derivation is a fixture).
// ---------------------------------------------------------------------------

/**
 * Model invariants: at most ONE reminder per task; `remd_` SYNTH ids;
 * rung-2 carries the offer with `enforcementAuthority: "none"` mirroring
 * the task's methodOrder; rung-1 never carries an offer; a defer record
 * exists exactly when the fire instant was deferred; completed tasks
 * never remind.
 */
export function assertTodayReminderModelInvariants(
  session: TodaySession,
  taskViews: readonly TodayTaskView[],
  now: Date,
): void {
  const seen = new Set<string>();
  for (const record of session.tasks) {
    const view = taskViews.find((entry) => entry.taskId === record.task.id);
    const reminder =
      view === undefined ? undefined : toTodayReminderView(record, view, now);
    if (record.task.state === "completed") {
      if (reminder !== undefined) {
        throw new Error("Completed tasks never remind.");
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
    if (!reminder.reminderId.startsWith("remd_SYNTH-")) {
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
        throw new Error("The offer must mirror the task's methodOrder as DATA.");
      }
    } else if (reminder.fallbackOffer !== undefined) {
      throw new Error("Rung-1 reminders never carry a fallback offer.");
    }
    const baseFireMs = todayBaseFireInstant(record.task, reminder.rung);
    const deferred = reminder.defer !== undefined;
    const expectedDeferred = baseFireMs !== new Date(reminder.scheduledAt).getTime();
    if (deferred !== expectedDeferred) {
      throw new Error("A defer record must exist exactly when deferral happened.");
    }
  }
}
