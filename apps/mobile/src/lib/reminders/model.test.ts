import { describe, expect, it } from "vitest";
import {
  assertTodayReminderModelInvariants,
  deferToTodayQuietEdge,
  isTodayQuietInstant,
  isTodayReminderRung,
  listTodayReminders,
  selectTodayReminderRung,
  todayBaseFireInstant,
  todayQuietHours,
  todayReminderId,
  toTodayReminderView,
  TODAY_ESCALATION_GRACE_MS,
  TODAY_LEAD_TIME_MS,
  TODAY_QUIET_HOURS_LABEL,
  TODAY_REMINDER_RUNGS,
  type TodayQuietHoursMirror,
} from "./model";
import {
  initialTodaySession,
  listTodayTasks,
  TODAY_TASK_BP_ID,
  TODAY_TASK_HR_ID,
  TODAY_TASK_SLEEP_ID,
  TODAY_TASK_WEIGHT_ID,
  type TodayTaskRecord,
} from "../today/model";

/**
 * Mobile reminder-model contract tests (M6 EXIT): the web reminder-store
 * assertions mirrored onto the client-local session API — the B8 ladder
 * semantics (rung selection, lead/grace fire instants, quiet-hours
 * deferral), the fallback offer as DATA, the silence-after-completion
 * rule, and the fixture invariants (SYNTH marking, one reminder per
 * task, PHI-free payloads). Zero PHI; deterministic worlds.
 */

/** A deterministic reference noon (local) — the tests' fixed world. */
function referenceNow(): Date {
  return new Date(2026, 8, 15, 12, 0, 0); // 2026-09-15 12:00 local
}

/** A quiet-hours spec with the recorded default shape. */
function defaultQuiet(utcOffsetMinutes: number): TodayQuietHoursMirror {
  return {
    enabled: true,
    startMinuteOfDay: 22 * 60,
    endMinuteOfDay: 7 * 60,
    utcOffsetMinutes,
  };
}

describe("the ladder vocabulary (the B8 REMINDER_RUNGS mirror)", () => {
  it("mirrors the frozen rungs, in escalation order", () => {
    expect(TODAY_REMINDER_RUNGS).toEqual(["REMIND", "REMIND_WITH_FALLBACK_OFFER"]);
    expect(isTodayReminderRung("REMIND")).toBe(true);
    expect(isTodayReminderRung("REMIND_WITH_FALLBACK_OFFER")).toBe(true);
    expect(isTodayReminderRung("ESCALATE")).toBe(false);
    expect(isTodayReminderRung(7)).toBe(false);
  });

  it("mirrors the recorded B8 profile defaults (60 min lead / grace)", () => {
    expect(TODAY_LEAD_TIME_MS).toBe(3_600_000);
    expect(TODAY_ESCALATION_GRACE_MS).toBe(3_600_000);
    expect(TODAY_QUIET_HOURS_LABEL).toBe("22:00–07:00");
    const quiet = todayQuietHours(referenceNow());
    expect(quiet.enabled).toBe(true);
    expect(quiet.startMinuteOfDay).toBe(22 * 60);
    expect(quiet.endMinuteOfDay).toBe(7 * 60);
  });
});

describe("rung selection + fire instants (the B8 engine mirror)", () => {
  const task = (state: "open" | "completed", endsAtIso: string): TodayTaskRecord["task"] =>
    ({
      id: "task_SYNTH-today-tst-000009",
      planId: "plan_SYNTH-today-tst-000009",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-body-weight",
      conceptCode: "SYNTH-29463-7",
      methodOrder: ["SYNTH-method-manual-body-weight"],
      window: {
        sequence: 0,
        startsAt: "2026-09-15T00:00:00.000Z",
        endsAt: endsAtIso,
      },
      state,
      createdAt: "2026-09-14T00:00:00.000Z",
      rollCount: 0,
    }) as TodayTaskRecord["task"];

  it("keeps rung REMIND for open tasks with future windows", () => {
    expect(
      selectTodayReminderRung(task("open", "2026-09-15T23:00:00.000Z"), referenceNow().getTime()),
    ).toBe("REMIND");
  });

  it("escalates to REMIND_WITH_FALLBACK_OFFER once the window elapsed", () => {
    expect(
      selectTodayReminderRung(task("open", "2026-09-14T09:00:00.000Z"), referenceNow().getTime()),
    ).toBe("REMIND_WITH_FALLBACK_OFFER");
  });

  it("silences the ladder for completed tasks (never a punishment)", () => {
    expect(
      selectTodayReminderRung(task("completed", "2026-09-15T23:00:00.000Z"), referenceNow().getTime()),
    ).toBeUndefined();
  });

  it("fires rung 1 lead-time before the close, clamped to the window start", () => {
    const long = task("open", "2026-09-15T23:59:59.999Z");
    // Lead 60 min before the close.
    expect(todayBaseFireInstant(long, "REMIND")).toBe(
      new Date("2026-09-15T23:59:59.999Z").getTime() - 3_600_000,
    );
    const short = {
      ...long,
      window: {
        sequence: 0,
        startsAt: "2026-09-15T23:30:00.000Z",
        endsAt: "2026-09-15T23:59:59.999Z",
      },
    };
    // Lead would fire before the window opens -> clamped to the start.
    expect(todayBaseFireInstant(short, "REMIND")).toBe(
      new Date("2026-09-15T23:30:00.000Z").getTime(),
    );
  });

  it("fires rung 2 grace after the close (gentle, never at the miss)", () => {
    const task2 = task("open", "2026-09-14T09:00:00.000Z");
    expect(todayBaseFireInstant(task2, "REMIND_WITH_FALLBACK_OFFER")).toBe(
      new Date("2026-09-14T09:00:00.000Z").getTime() + 3_600_000,
    );
  });
});

describe("quiet-hours math (the B8 mirror)", () => {
  it("detects quiet instants across the wrap-around interval", () => {
    const spec = defaultQuiet(0);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 23, 30), spec)).toBe(true);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 16, 6, 59), spec)).toBe(true);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 12, 0), spec)).toBe(false);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 16, 7, 0), spec)).toBe(false);
  });

  it("defers to the quiet end edge and never drops", () => {
    const spec = defaultQuiet(0);
    const lateEvening = Date.UTC(2026, 8, 15, 23, 30);
    expect(deferToTodayQuietEdge(lateEvening, spec)).toBe(Date.UTC(2026, 8, 16, 7, 0));
    const earlyMorning = Date.UTC(2026, 8, 15, 5, 0);
    expect(deferToTodayQuietEdge(earlyMorning, spec)).toBe(Date.UTC(2026, 8, 15, 7, 0));
    const daytime = Date.UTC(2026, 8, 15, 12, 0);
    expect(deferToTodayQuietEdge(daytime, spec)).toBe(daytime);
  });

  it("honors the preference gate (disabled spec never defers)", () => {
    const spec: TodayQuietHoursMirror = { ...defaultQuiet(0), enabled: false };
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 23, 30), spec)).toBe(false);
  });
});

describe("listTodayReminders (the session derivation)", () => {
  it("derives the missed task's rung-2 reminder as DELIVERED with the offer", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const views = listTodayTasks(session, now);
    const reminders = listTodayReminders(session, views, now);
    const missed = reminders.find((reminder) => reminder.taskId === TODAY_TASK_WEIGHT_ID);
    expect(missed).toBeDefined();
    expect(missed?.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(missed?.deliveryState).toBe("delivered");
    expect(missed?.reminderLabel).toBe("Reminder sent — fallback options offered");
    expect(missed?.detailLabel).toBe(
      "Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00",
    );
    // The offer mirrors the task's methodOrder as DATA, authority none.
    expect(missed?.fallbackOffer?.enforcementAuthority).toBe("none");
    expect(missed?.fallbackOffer?.methods.map((method) => method.methodId)).toEqual([
      "SYNTH-method-manual-body-weight",
    ]);
    expect(missed?.fallbackOffer?.methods[0]?.role).toBe("preferred");
    // The rung-2 fire instant (10:00 local) is not quiet-hours-deferred.
    expect(missed?.defer).toBeUndefined();
  });

  it("derives the due tasks' rung-1 reminders as quiet-hours-DEFERRED", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const views = listTodayTasks(session, now);
    const reminders = listTodayReminders(session, views, now);
    for (const taskId of [TODAY_TASK_BP_ID, TODAY_TASK_HR_ID]) {
      const due = reminders.find((reminder) => reminder.taskId === taskId);
      expect(due).toBeDefined();
      expect(due?.rung).toBe("REMIND");
      expect(due?.deliveryState).toBe("scheduled");
      expect(due?.reminderLabel).toBe("Reminder scheduled");
      expect(due?.defer).toBeDefined();
      expect(due?.defer?.reason).toBe("quiet-hours");
      expect(due?.defer?.label).toBe("deferred to 07:00");
      expect(due?.fallbackOffer).toBeUndefined();
    }
  });

  it("silences the ladder for the completed task (never a punishment)", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const views = listTodayTasks(session, now);
    const reminders = listTodayReminders(session, views, now);
    expect(
      reminders.find((reminder) => reminder.taskId === TODAY_TASK_SLEEP_ID),
    ).toBeUndefined();
  });

  it("derives exactly one reminder per open task, remd_-SYNTH ids", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const views = listTodayTasks(session, now);
    const reminders = listTodayReminders(session, views, now);
    const ids = reminders.map((reminder) => reminder.taskId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      [TODAY_TASK_BP_ID, TODAY_TASK_HR_ID, TODAY_TASK_WEIGHT_ID].sort(),
    );
    for (const reminder of reminders) {
      expect(reminder.reminderId.startsWith("remd_SYNTH-today-")).toBe(true);
    }
    expect(todayReminderId(TODAY_TASK_WEIGHT_ID, "REMIND_WITH_FALLBACK_OFFER")).toBe(
      "remd_SYNTH-today-wt-000003-fallback-offer",
    );
  });

  it("passes the model invariant assertion (fixture loud-failure contract)", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    expect(() =>
      assertTodayReminderModelInvariants(session, listTodayTasks(session, now), now),
    ).not.toThrow();
  });

  it("keeps every derived payload PHI-free (ids + labels only)", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const serialized = JSON.stringify(
      listTodayReminders(session, listTodayTasks(session, now), now),
    );
    expect(serialized).not.toContain("personId");
    expect(serialized).not.toContain("prsn_");
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptCode");
    expect(serialized).not.toContain("evidence");
  });

  it("silences a task's reminder after completion (the pure derivation)", () => {
    const now = referenceNow();
    const session = initialTodaySession(now);
    const views = listTodayTasks(session, now);
    const weight = session.tasks.find(
      (record) => record.task.id === TODAY_TASK_WEIGHT_ID,
    );
    if (weight === undefined) {
      throw new Error("the seeded weight fixture is missing");
    }
    const completed = toTodayReminderView(
      { ...weight, task: { ...weight.task, state: "completed" } },
      views.find((view) => view.taskId === TODAY_TASK_WEIGHT_ID) ?? views[0]!,
      now,
    );
    expect(completed).toBeUndefined();
  });
});
