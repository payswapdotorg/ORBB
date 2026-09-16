import { describe, expect, it } from "vitest";
import {
  HOUR,
  MINUTE,
  buildNotificationHarness,
  synthPreferences,
  synthTask,
} from "./testsupport.js";
import type { QuietHoursSpec } from "./preferences.js";
import type { FallbackOfferReminderPayload, UpcomingDueReminderPayload } from "./payloads.js";
import type { ReminderError, ReminderSchedule } from "./engine.js";
import type { EngineResult } from "./result.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

function noQuietHours(): QuietHoursSpec {
  return { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };
}

function scheduleOf(result: EngineResult<ReminderSchedule, ReminderError>): ReminderSchedule {
  if (!result.ok) {
    throw new Error("expected schedule computation to succeed");
  }
  return result.value;
}

describe("B8 escalation ladder — rung advancement only on the recorded conditions", () => {
  it("an upcoming window NEVER yields the fallback-offer rung, even for a capable channel", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 2 * HOUR) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toHaveLength(1);
    expect(schedule.reminders[0]!.rung).toBe("REMIND");
    expect(schedule.reminders[0]!.payload.kind).toBe("REMIND");
  });

  it("a window missed while the task is still open escalates to the fallback-offer rung", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toHaveLength(1);
    const reminder = schedule.reminders[0]!;
    expect(reminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(reminder.reason).toBe("missed-window");
    expect(reminder.nominalSendAt.getTime()).toBe(endsAtMs + 30 * MINUTE);
  });

  it("a window missed AFTER the task completed produces nothing (no punishment)", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs + HOUR });
    const task = synthTask({ endsAt: new Date(endsAtMs), state: "completed" });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toEqual([]);
    expect(schedule.skipped).toEqual([]);
  });

  it("a missed window with NO recorded fallback vocabulary stays on the REMIND rung (gentle nudge)", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const task = synthTask({ endsAt: new Date(endsAtMs), methodOrder: ["method-synth-only"] });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    const reminder = schedule.reminders[0]!;
    expect(reminder.rung).toBe("REMIND");
    expect(reminder.reason).toBe("missed-window");
    expect(reminder.payload.kind).toBe("REMIND");
    expect((reminder.payload as UpcomingDueReminderPayload).reason).toBe("missed-window");
  });

  it("the escalation delay is preference-driven (custom 45-minute delay honored)", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours(), escalationDelayMinutes: 45 }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders[0]!.nominalSendAt.getTime()).toBe(endsAtMs + 45 * MINUTE);
  });
});

describe("B8 escalation ladder — fallback-offer payload carries the recorded vocabulary", () => {
  it("the offer payload reproduces the task's method order verbatim (data, never a decision)", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const methodOrder = ["method-synth-wearable", "method-synth-app", "method-synth-manual"];
    const task = synthTask({ endsAt: new Date(endsAtMs), methodOrder });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    const payload = schedule.reminders[0]!.payload as FallbackOfferReminderPayload;
    expect(payload.preferredMethodId).toBe("method-synth-wearable");
    // The engine NEVER orders or filters providers: the recorded vocabulary,
    // in the recorded order, verbatim.
    expect(payload.fallbackMethods).toEqual([
      { methodId: "method-synth-app" },
      { methodId: "method-synth-manual" },
    ]);
    // The payload carries no engine-authored selection field of any kind.
    expect(Object.keys(payload).sort()).toEqual([
      "dueAt",
      "fallbackMethods",
      "kind",
      "metricId",
      "preferredMethodId",
      "reason",
      "taskId",
      "windowSequence",
    ]);
  });

  it("vocabulary labels ride the payload verbatim under the label contract", () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
        labels: {
          metrics: { "metric-synth-heart-rate": "Heart rate (synth)" },
          methods: { "method-synth-app": "App capture (synth)" },
        },
      }),
    );
    const payload = schedule.reminders[0]!.payload as FallbackOfferReminderPayload;
    expect(payload.metricLabel).toBe("Heart rate (synth)");
    expect(payload.fallbackMethods[0]).toEqual({
      methodId: "method-synth-app",
      label: "App capture (synth)",
    });
    // A method without a label carries no label member at all.
    expect(payload.fallbackMethods[1]).toEqual({ methodId: "method-synth-manual" });
    expect("label" in (payload.fallbackMethods[1] as object)).toBe(false);
  });

  it("quiet hours defer the escalation rung too (defer, never drop)", () => {
    // Window ends 23:45 (already missed at 23:50) => escalation nominal
    // 00:15 next day => deferred to the 07:00 closing edge.
    const harness = buildNotificationHarness({ epochMs: NOON + 11 * HOUR + 50 * MINUTE });
    const task = synthTask({ endsAt: new Date(NOON + 11.75 * HOUR) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences(),
        channels: harness.registry,
      }),
    );
    const reminder = schedule.reminders[0]!;
    expect(reminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(reminder.nominalSendAt.toISOString()).toBe("2026-06-11T00:15:00.000Z");
    expect(reminder.sendAt.toISOString()).toBe("2026-06-11T07:00:00.000Z");
    expect(reminder.deferredByQuietHours).toBe(true);
  });
});

describe("B8 golden journey #7 — miss → reminder → fallback offer (engine head)", () => {
  it("walks the full journey: pre-due REMIND dispatch, miss, deferred offer dispatch, exact-once ledger, TASK_DUE events", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: NOON });
    const preferences = synthPreferences({ quietHours: noQuietHours() });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const input = { tasks: [task], preferences, channels: harness.registry };

    // --- Step 1: the pre-due reminder (inside the lead window, not yet missed).
    harness.clock.advanceTo(endsAtMs - 30 * MINUTE);
    const first = await harness.engine.dispatchDue(input);
    if (!first.ok) {
      throw new Error("expected first dispatch to succeed");
    }
    expect(first.value.dispatched).toHaveLength(1);
    const firstReminder = first.value.dispatched[0]!.reminder;
    expect(firstReminder.rung).toBe("REMIND");
    expect(firstReminder.reason).toBe("upcoming-due");
    expect(first.value.failures).toEqual([]);
    expect(first.value.pending).toEqual([]);

    // --- Step 2: the person misses the window (clock past the edge, task still open).
    harness.clock.advanceTo(endsAtMs + 30 * MINUTE);
    const second = await harness.engine.dispatchDue(input);
    if (!second.ok) {
      throw new Error("expected second dispatch to succeed");
    }
    expect(second.value.dispatched).toHaveLength(1);
    const offerReminder = second.value.dispatched[0]!.reminder;
    expect(offerReminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(offerReminder.id).not.toBe(firstReminder.id);
    const offerPayload = offerReminder.payload as FallbackOfferReminderPayload;
    expect(offerPayload.preferredMethodId).toBe("method-synth-wearable");
    expect(offerPayload.fallbackMethods.map((option) => option.methodId)).toEqual([
      "method-synth-app",
      "method-synth-manual",
    ]);

    // --- Step 3: the ledger recorded each dispatch exactly once, keyed by reminder id.
    expect(harness.ledger.listAll()).toHaveLength(2);
    for (const record of harness.ledger.listAll()) {
      expect(record.status).toBe("dispatched");
      expect(record.attempts).toBe(1);
      expect(record.deliveredAt).toBeDefined();
    }

    // --- Step 4: one TASK_DUE event per dispatched reminder.
    expect(harness.eventSink.getEvents()).toHaveLength(2);
    for (const emission of harness.eventSink.getEvents()) {
      expect(emission.event.type).toBe("TASK_DUE");
      expect(emission.event.causationId).toBeDefined();
    }

    // --- Step 5: re-dispatching at a later clock adds nothing (unchanged inputs).
    // At this clock only the offer rung is still scheduled; it is already dispatched.
    harness.clock.advanceTo(endsAtMs + 3 * HOUR);
    const third = await harness.engine.dispatchDue(input);
    if (!third.ok) {
      throw new Error("expected third dispatch to succeed");
    }
    expect(third.value.dispatched).toEqual([]);
    expect(third.value.failures).toEqual([]);
    expect(third.value.skipped.map((skip) => skip.reason)).toEqual(["already-dispatched"]);
    expect(harness.ledger.listAll()).toHaveLength(2);
    expect(harness.eventSink.getEvents()).toHaveLength(2);

    // The engine never applies restrictions: the outcome carries no
    // enforcement vocabulary of any kind (that is B10's authorized concern).
    const outcomeDump = JSON.stringify(third.value);
    expect(outcomeDump).not.toContain("restrict");
    expect(outcomeDump).not.toContain("enforce");
    expect(outcomeDump).not.toContain("penalt");
  });
});
