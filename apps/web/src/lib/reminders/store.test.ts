// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  listTodayTaskRecords,
  resetTodayStore,
  TODAY_TASK_BP_ID,
  TODAY_TASK_HR_ID,
  TODAY_TASK_SLEEP_ID,
  TODAY_TASK_WEIGHT_ID,
} from "../today/store";
import {
  assertTodayReminderCatalogInvariants,
  TODAY_QUIET_HOURS_LABEL,
} from "./catalog";
import {
  assertTodayReminderStoreInvariants,
  deferToTodayQuietEdge,
  isTodayQuietInstant,
  listTodayReminders,
  selectTodayReminderRung,
  todayBaseFireInstant,
  todayReminderId,
  toTodayReminderWire,
} from "./store";
import type { MeasurementTask } from "@orbb/measurement";
import type { TodayTaskRecord } from "../today/types";
import type { TodayQuietHoursMirror } from "./types";

/**
 * Reminder-store derivation tests (M6 EXIT): the journey-#7 reminder
 * chain derived from the REAL seeded today task records under the
 * mirrored B8 schedule semantics — the ladder rules, the fire-instant
 * math (lead/grace + clamps), the quiet-hours deferral (defer, never
 * drop), the fallback offer as DATA, and the silence-after-completion
 * rule. All fixtures are SYNTH; zero PHI.
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

beforeEach(() => {
  resetTodayStore();
});

describe("catalog invariants", () => {
  it("passes the fixture loud-failure contract (B8 defaults mirrored)", () => {
    expect(() => assertTodayReminderCatalogInvariants()).not.toThrow();
    expect(TODAY_QUIET_HOURS_LABEL).toBe("22:00–07:00");
  });
});

describe("selectTodayReminderRung (the B8 selectRung mirror)", () => {
  const task = (state: "open" | "completed", endsAtMs: number): MeasurementTask =>
    ({
      id: "task_SYNTH-today-tst-000009",
      planId: "plan_SYNTH-today-tst-000009",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-body-weight",
      conceptCode: "SYNTH-29463-7",
      methodOrder: ["SYNTH-method-manual-body-weight"],
      window: { sequence: 0, startsAt: new Date(endsAtMs - 7_200_000), endsAt: new Date(endsAtMs) },
      state,
      createdAt: new Date(endsAtMs - 86_400_000),
      rollCount: 0,
    }) as unknown as MeasurementTask;

  it("keeps rung REMIND for open tasks with future windows", () => {
    expect(selectTodayReminderRung(task("open", 2_000), 1_000)).toBe("REMIND");
  });

  it("escalates to REMIND_WITH_FALLBACK_OFFER once the window elapsed", () => {
    expect(selectTodayReminderRung(task("open", 1_000), 1_000)).toBe(
      "REMIND_WITH_FALLBACK_OFFER",
    );
  });

  it("silences the ladder for completed tasks (never a punishment)", () => {
    expect(selectTodayReminderRung(task("completed", 1_000), 2_000)).toBeUndefined();
  });
});

describe("todayBaseFireInstant (the B8 base-fire mirror)", () => {
  const task = (startsAtMs: number, endsAtMs: number): MeasurementTask =>
    ({
      id: "task_SYNTH-today-tst-000010",
      planId: "plan_SYNTH-today-tst-000010",
      personId: "prsn_SYNTH-person-0001",
      metricId: "SYNTH-metric-body-weight",
      conceptCode: "SYNTH-29463-7",
      methodOrder: [],
      window: { sequence: 0, startsAt: new Date(startsAtMs), endsAt: new Date(endsAtMs) },
      state: "open",
      createdAt: new Date(startsAtMs - 86_400_000),
      rollCount: 0,
    }) as unknown as MeasurementTask;

  it("fires rung 1 lead-time before the close, clamped to the window start", () => {
    const start = 1_000_000;
    const end = start + 10 * 3_600_000;
    // Lead 1h: fires 1h before the end.
    expect(todayBaseFireInstant(task(start, end), "REMIND", { leadTimeMs: 3_600_000, escalationGraceMs: 0 })).toBe(end - 3_600_000);
    // Lead 100h: clamped forward to the window start (never before open).
    expect(todayBaseFireInstant(task(start, end), "REMIND", { leadTimeMs: 100 * 3_600_000, escalationGraceMs: 0 })).toBe(start);
  });

  it("fires rung 2 grace after the close (gentle, never at the miss)", () => {
    const start = 1_000_000;
    const end = start + 3_600_000;
    expect(
      todayBaseFireInstant(task(start, end), "REMIND_WITH_FALLBACK_OFFER", {
        leadTimeMs: 0,
        escalationGraceMs: 3_600_000,
      }),
    ).toBe(end + 3_600_000);
  });
});

describe("quiet-hours math (the B8 isQuietInstant/deferToQuietEdge mirror)", () => {
  it("detects quiet instants across the wrap-around interval", () => {
    const spec = defaultQuiet(0);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 23, 30), spec)).toBe(true);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 22, 0), spec)).toBe(true);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 16, 6, 59), spec)).toBe(true);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 12, 0), spec)).toBe(false);
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 16, 7, 0), spec)).toBe(false);
  });

  it("respects the fixed UTC offset (local-of-record)", () => {
    const spec = defaultQuiet(120); // UTC+02:00 local-of-record
    // 23:30 UTC == 01:30 local (next day) — inside quiet hours.
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 23, 30), spec)).toBe(true);
    // 04:00 UTC == 06:00 local — inside quiet hours.
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 4, 0), spec)).toBe(true);
    // 12:00 UTC == 14:00 local — outside.
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 12, 0), spec)).toBe(false);
  });

  it("honors the preference gate (disabled spec never defers)", () => {
    const spec: TodayQuietHoursMirror = { ...defaultQuiet(0), enabled: false };
    expect(isTodayQuietInstant(Date.UTC(2026, 8, 15, 23, 30), spec)).toBe(false);
  });

  it("defers to the quiet end edge and never drops", () => {
    const spec = defaultQuiet(0);
    const lateEvening = Date.UTC(2026, 8, 15, 23, 30);
    // Deferred to 07:00 the NEXT day (the edge already passed today).
    expect(deferToTodayQuietEdge(lateEvening, spec)).toBe(Date.UTC(2026, 8, 16, 7, 0));
    // An instant already at/after the edge is untouched.
    expect(deferToTodayQuietEdge(Date.UTC(2026, 8, 15, 12, 0), spec)).toBe(
      Date.UTC(2026, 8, 15, 12, 0),
    );
    // Early-morning quiet instant defers to the SAME day's edge.
    expect(deferToTodayQuietEdge(Date.UTC(2026, 8, 15, 5, 0), spec)).toBe(
      Date.UTC(2026, 8, 15, 7, 0),
    );
  });
});

describe("listTodayReminders (the deterministic fixture derivation)", () => {
  it("passes the store invariant assertion (fixture loud-failure contract)", () => {
    expect(() => assertTodayReminderStoreInvariants(referenceNow())).not.toThrow();
  });

  it("derives the missed task's rung-2 reminder as DELIVERED with the offer", () => {
    const reminders = listTodayReminders(referenceNow());
    const missed = reminders.find((reminder) => reminder.taskId === TODAY_TASK_WEIGHT_ID);
    expect(missed).toBeDefined();
    expect(missed?.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(missed?.deliveryState).toBe("delivered");
    expect(missed?.reminderLabel).toBe("Reminder sent — fallback options offered");
    expect(missed?.detailLabel).toBe(
      "Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00",
    );
    // The offer is the task's recorded methodOrder as DATA.
    expect(missed?.fallbackOffer).toEqual({
      enforcementAuthority: "none",
      methods: [
        {
          methodId: "SYNTH-method-manual-body-weight",
          methodLabel: "Manual entry — scale reading",
          role: "preferred",
        },
      ],
    });
    // The rung-2 fire instant is not quiet-hours-deferred (10:00 local).
    expect(missed?.defer).toBeUndefined();
  });

  it("derives the due tasks' rung-1 reminders as quiet-hours-DEFERRED", () => {
    const reminders = listTodayReminders(referenceNow());
    for (const taskId of [TODAY_TASK_BP_ID, TODAY_TASK_HR_ID]) {
      const due = reminders.find((reminder) => reminder.taskId === taskId);
      expect(due).toBeDefined();
      expect(due?.rung).toBe("REMIND");
      expect(due?.deliveryState).toBe("scheduled");
      expect(due?.reminderLabel).toBe("Reminder scheduled");
      // The whole-day window's ~22:59 lead fire lands inside quiet hours,
      // so the reminder defers to the 07:00 edge — shown honestly.
      expect(due?.defer).toBeDefined();
      expect(due?.defer?.reason).toBe("quiet-hours");
      expect(due?.defer?.label).toBe("deferred to 07:00");
      expect(due?.fallbackOffer).toBeUndefined();
      // Rung-1 reminders never carry an offer.
      expect(due?.detailLabel).toContain("Rung REMIND ·");
    }
  });

  it("silences the ladder for the completed task (never a punishment)", () => {
    const reminders = listTodayReminders(referenceNow());
    expect(
      reminders.find((reminder) => reminder.taskId === TODAY_TASK_SLEEP_ID),
    ).toBeUndefined();
  });

  it("derives exactly one reminder per open task (the ladder rule)", () => {
    const reminders = listTodayReminders(referenceNow());
    const ids = reminders.map((reminder) => reminder.taskId);
    expect(new Set(ids).size).toBe(ids.length);
    // Three open tasks (bp, hr, weight); the completed sleep task is silent.
    expect(ids.sort()).toEqual(
      [TODAY_TASK_BP_ID, TODAY_TASK_HR_ID, TODAY_TASK_WEIGHT_ID].sort(),
    );
  });

  it("derives remd_-prefixed SYNTH reminder ids (the B8 grammar mirror)", () => {
    const reminders = listTodayReminders(referenceNow());
    for (const reminder of reminders) {
      expect(reminder.reminderId.startsWith("remd_SYNTH-today-")).toBe(true);
      expect(reminder.reminderId.length).toBeGreaterThanOrEqual("remd_".length + 16);
    }
    expect(todayReminderId(TODAY_TASK_WEIGHT_ID, "REMIND_WITH_FALLBACK_OFFER")).toBe(
      "remd_SYNTH-today-wt-000003-fallback-offer",
    );
  });

  it("keeps every derived payload PHI-free (ids + labels only)", () => {
    const serialized = JSON.stringify(listTodayReminders(referenceNow()));
    expect(serialized).not.toContain("personId");
    expect(serialized).not.toContain("prsn_");
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptCode");
    expect(serialized).not.toContain("evidence");
  });

  it("silences a task's reminder after completion (the honest re-read)", () => {
    const now = referenceNow();
    const before = listTodayReminders(now).find(
      (reminder) => reminder.taskId === TODAY_TASK_WEIGHT_ID,
    );
    expect(before).toBeDefined();
    // The derivation is pure over records: a COMPLETED weight task derives
    // NO reminder (the mirror of the engine's completed-task skip).
    const records = listTodayTaskRecords(now);
    const weight = records.find((record) => record.task.id === TODAY_TASK_WEIGHT_ID);
    if (weight === undefined) {
      throw new Error("the seeded weight fixture is missing");
    }
    const completedWeight: TodayTaskRecord = {
      task: { ...weight.task, state: "completed" },
      completion: {
        captureId: "SYNTH-CAP-TEST-COMPLETE",
        observationIds: ["obs_SYNTH-obs-test-complete-0001"],
        completedAt: now.toISOString(),
      },
    };
    expect(toTodayReminderWire(completedWeight, now)).toBeUndefined();
  });
});
