import { describe, expect, it } from "vitest";
import { serializeReminderSchedule } from "./canonical.js";
import type { EngineResult } from "./result.js";
import {
  HOUR,
  MINUTE,
  buildNotificationHarness,
  synthPersonId,
  synthPreferences,
  synthTask,
  synthTaskId,
} from "./testsupport.js";
import { InMemoryChannel } from "./inmemory-channel.js";
import {
  InMemoryChannelRegistry,
  type ChannelRegistry,
  type NotificationChannel,
} from "./channels.js";
import { isReminderId } from "./identity.js";
import type { ReminderError, ReminderSchedule } from "./engine.js";
import type { MeasurementTask } from "@orbb/measurement";
import type { QuietHoursSpec } from "./preferences.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

/** Quiet hours disabled (pure window-math tests defer separately). */
function noQuietHours(): QuietHoursSpec {
  return { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };
}

function scheduleOf(result: EngineResult<ReminderSchedule, ReminderError>): ReminderSchedule {
  if (!result.ok) {
    throw new Error("expected schedule computation to succeed");
  }
  return result.value;
}

const endsAt = new Date(NOON + 2 * HOUR);

describe("B8 schedule computation — upcoming-due rung", () => {
  it("schedules one REMIND reminder per eligible channel, lead minutes before the due instant", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const extra = new InMemoryChannel({ id: "inapp-secondary", clock: harness.clock });
    const registry = new InMemoryChannelRegistry([harness.channel, extra]);
    const endsAt = new Date(NOON + 2 * HOUR);
    const task = synthTask({ endsAt });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: registry,
      }),
    );
    expect(schedule.reminders).toHaveLength(2);
    expect(schedule.skipped).toEqual([]);
    for (const reminder of schedule.reminders) {
      expect(isReminderId(reminder.id)).toBe(true);
      expect(reminder.rung).toBe("REMIND");
      expect(reminder.reason).toBe("upcoming-due");
      expect(reminder.taskId).toBe(task.id);
      expect(reminder.metricId).toBe(task.metricId);
      expect(reminder.windowSequence).toBe(0);
      expect(reminder.dueAt.getTime()).toBe(endsAt.getTime());
      expect(reminder.nominalSendAt.getTime()).toBe(endsAt.getTime() - 60 * MINUTE);
      expect(reminder.sendAt.getTime()).toBe(reminder.nominalSendAt.getTime());
      expect(reminder.deferredByQuietHours).toBe(false);
      expect(reminder.payload.kind).toBe("REMIND");
      expect(reminder.payload.reason).toBe("upcoming-due");
      expect(reminder.payload.taskId).toBe(task.id);
      expect(reminder.payload.windowSequence).toBe(0);
      expect(reminder.payload.dueAt.getTime()).toBe(endsAt.getTime());
    }
    const channelIds = schedule.reminders.map((reminder) => reminder.channelId).sort();
    expect(channelIds).toEqual(["inapp-memory", "inapp-secondary"]);
    // Per-channel identity: same (task, window, rung, day), different channel => different ids.
    expect(schedule.reminders[0]!.id).not.toBe(schedule.reminders[1]!.id);
  });

  it("a computation inside the lead window yields an immediately dispatchable (late) reminder", async () => {
    const endsAt = new Date(NOON + 2 * HOUR);
    const harness = buildNotificationHarness({ epochMs: NOON + 90 * MINUTE });
    const task = synthTask({ endsAt });
    const outcome = await harness.engine.dispatchDue({
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(outcome.value.dispatched).toHaveLength(1);
    expect(outcome.value.dispatched[0]!.reminder.rung).toBe("REMIND");
    expect(outcome.value.pending).toEqual([]);
  });

  it("completed tasks produce no reminders and no accounted skips", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 2 * HOUR), state: "completed" });
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

  it("the master preference gate disables every reminder", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 2 * HOUR) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ remindersEnabled: false, quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toEqual([]);
    expect(schedule.skipped).toEqual([]);
  });
});

describe("B8 schedule computation — window boundary math (table-driven)", () => {
  const endsAtMs = NOON + 2 * HOUR;

  it.each([
    { label: "one millisecond before the due instant is still upcoming", nowOffsetMs: -1, rung: "REMIND", reason: "upcoming-due" },
    { label: "exactly at the due instant the half-open window is closed (missed)", nowOffsetMs: 0, rung: "REMIND_WITH_FALLBACK_OFFER", reason: "missed-window" },
    { label: "well after the due instant is missed", nowOffsetMs: 45 * MINUTE, rung: "REMIND_WITH_FALLBACK_OFFER", reason: "missed-window" },
  ])("$label", ({ nowOffsetMs, rung, reason }) => {
    const harness = buildNotificationHarness({ epochMs: endsAtMs + nowOffsetMs });
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
    expect(reminder.rung).toBe(rung);
    expect(reminder.reason).toBe(reason);
    if (rung === "REMIND") {
      expect(reminder.nominalSendAt.getTime()).toBe(endsAtMs - 60 * MINUTE);
    } else {
      // Escalation fires escalationDelayMinutes (default 30) after the edge.
      expect(reminder.nominalSendAt.getTime()).toBe(endsAtMs + 30 * MINUTE);
    }
  });

  it("a week of daily windows escalates each missed one at its own edge", () => {
    // Seven daily windows anchored at NOON; compute far after all of them.
    const farNow = NOON + 8 * 24 * HOUR;
    const harness = buildNotificationHarness({ epochMs: farNow });
    const tasks = Array.from({ length: 7 }, (_, index) =>
      synthTask({
        id: synthTaskId(index + 1),
        sequence: index,
        startsAt: new Date(NOON + index * 24 * HOUR),
        endsAt: new Date(NOON + index * 24 * HOUR + 2 * HOUR),
      }),
    );
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks,
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toHaveLength(7);
    // Ordering is by task id (deterministic hash order), so assert per
    // window sequence rather than by list position.
    const bySequence = new Map<number, (typeof schedule.reminders)[number]>();
    for (const reminder of schedule.reminders) {
      bySequence.set(reminder.windowSequence, reminder);
    }
    expect(bySequence.size).toBe(7);
    for (const [sequence, reminder] of bySequence) {
      const expectedEdge = NOON + sequence * 24 * HOUR + 2 * HOUR;
      expect(reminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
      expect(reminder.nominalSendAt.getTime()).toBe(expectedEdge + 30 * MINUTE);
      expect(reminder.payload.kind).toBe("REMIND_WITH_FALLBACK_OFFER");
      expect(reminder.windowSequence).toBe(sequence);
    }
  });
});

describe("B8 schedule computation — quiet hours integration", () => {
  it("defers a nominal send instant inside quiet hours to the closing edge (never drops)", () => {
    // Window ends 00:30 next day => nominal (lead 60) at 23:30 local => deferred to 07:00.
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 12.5 * HOUR) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences(),
        channels: harness.registry,
      }),
    );
    expect(schedule.reminders).toHaveLength(1);
    const reminder = schedule.reminders[0]!;
    expect(reminder.nominalSendAt.toISOString()).toBe("2026-06-10T23:30:00.000Z");
    expect(reminder.sendAt.toISOString()).toBe("2026-06-11T07:00:00.000Z");
    expect(reminder.deferredByQuietHours).toBe(true);
  });

  it("disabled quiet hours leave the nominal instant untouched", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 12.5 * HOUR) });
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [task],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    const reminder = schedule.reminders[0]!;
    expect(reminder.deferredByQuietHours).toBe(false);
    expect(reminder.sendAt.getTime()).toBe(reminder.nominalSendAt.getTime());
  });
});

describe("B8 schedule computation — determinism", () => {
  const endsAt = new Date(NOON + 2 * HOUR);

  function buildInput(registry: ChannelRegistry) {
    return {
      tasks: [synthTask({ id: synthTaskId(1), endsAt }), synthTask({ id: synthTaskId(2), endsAt })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: registry,
    };
  }

  it("computing twice over unchanged inputs yields byte-identical schedules", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const input = buildInput(harness.registry);
    const first = scheduleOf(harness.engine.computeSchedule(input));
    const second = scheduleOf(harness.engine.computeSchedule(input));
    expect(second).toEqual(first);
    expect(serializeReminderSchedule(second)).toBe(serializeReminderSchedule(first));
  });

  it("a serialized re-instantiation (fresh engine, fresh equal inputs) reproduces the schedule byte-for-byte", () => {
    const firstHarness = buildNotificationHarness({ epochMs: NOON, seed: "b8-seed" });
    const first = scheduleOf(firstHarness.engine.computeSchedule(buildInput(firstHarness.registry)));
    const serialized = serializeReminderSchedule(first);

    // The serialized schedule round-trips as JSON with the expected shape.
    const revived = JSON.parse(serialized) as { reminders: unknown[]; skipped: unknown[] };
    expect(revived.reminders).toHaveLength(2);
    expect(revived.skipped).toHaveLength(0);

    // Re-instantiated engine + re-built inputs => identical bytes.
    const secondHarness = buildNotificationHarness({ epochMs: NOON, seed: "b8-seed" });
    const second = scheduleOf(secondHarness.engine.computeSchedule(buildInput(secondHarness.registry)));
    expect(serializeReminderSchedule(second)).toBe(serialized);
  });

  it("reminder ids are stable across engine instances and distinct across channels", () => {
    const firstHarness = buildNotificationHarness({ epochMs: NOON, seed: "a" });
    const secondHarness = buildNotificationHarness({ epochMs: NOON, seed: "b" });
    const first = scheduleOf(firstHarness.engine.computeSchedule(buildInput(firstHarness.registry)));
    const second = scheduleOf(secondHarness.engine.computeSchedule(buildInput(secondHarness.registry)));
    expect(second.reminders.map((reminder) => reminder.id)).toEqual(
      first.reminders.map((reminder) => reminder.id),
    );
    const ids = new Set<string>(first.reminders.map((reminder) => reminder.id));
    expect(ids.size).toBe(first.reminders.length);
  });

  it("schedules are deterministically ordered (taskId, window, rung, channel)", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const extra = new InMemoryChannel({ id: "aa-first", clock: harness.clock });
    const registry = new InMemoryChannelRegistry([extra, harness.channel]);
    const taskA = synthTask({ id: synthTaskId(1), endsAt });
    const taskB = synthTask({ id: synthTaskId(2), endsAt });
    // Feed in reverse order; output order must not depend on input order.
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [taskB, taskA],
        preferences: synthPreferences({ quietHours: noQuietHours() }),
        channels: registry,
      }),
    );
    const expectedTaskOrder = [taskA.id, taskB.id].sort();
    expect(schedule.reminders.map((reminder) => reminder.taskId)).toEqual([
      expectedTaskOrder[0]!,
      expectedTaskOrder[0]!,
      expectedTaskOrder[1]!,
      expectedTaskOrder[1]!,
    ]);
    const firstPair = schedule.reminders.slice(0, 2).map((reminder) => reminder.channelId);
    expect([...firstPair].sort()).toEqual(["aa-first", "inapp-memory"]);
  });
});

describe("B8 schedule computation — typed rejections (PHID-safe)", () => {
  it.each([
    {
      label: "local-of-record offset out of range",
      mutate: (prefs: ReturnType<typeof synthPreferences>) => ({ ...prefs, localUtcOffsetMinutes: 9999 }),
      kind: "invalid-preferences",
    },
    {
      label: "quiet-hours minutes out of range",
      mutate: (prefs: ReturnType<typeof synthPreferences>) => ({
        ...prefs,
        quietHours: { enabled: true, startLocalMinutes: 2000, endLocalMinutes: 420 },
      }),
      kind: "invalid-preferences",
    },
    {
      label: "negative lead",
      mutate: (prefs: ReturnType<typeof synthPreferences>) => ({ ...prefs, leadMinutes: -5 }),
      kind: "invalid-preferences",
    },
    {
      label: "duplicate channel preferences",
      mutate: (prefs: ReturnType<typeof synthPreferences>) => ({
        ...prefs,
        channelPreferences: [
          { channelId: "inapp-memory", enabled: true },
          { channelId: "inapp-memory", enabled: false },
        ],
      }),
      kind: "invalid-preferences",
    },
  ])("rejects preferences where $label", ({ mutate, kind }) => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const preferences = mutate(synthPreferences({ quietHours: noQuietHours() }));
    const result = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt })],
      preferences,
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind } });
  });

  it("rejects channel preferences that reference an unknown channel", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const result = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt })],
      preferences: synthPreferences({
        quietHours: noQuietHours(),
        channelPreferences: [{ channelId: "ghost-channel", enabled: true }],
      }),
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "unknown-channel" } });
  });

  it("rejects labels that are not human-safe", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const result = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
      labels: { metrics: { "metric-synth-heart-rate": "x".repeat(81) } },
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-label" } });
  });

  it.each([
    {
      label: "window closes before it opens",
      build: (): readonly MeasurementTask[] => [
        synthTask({ startsAt: new Date(NOON + HOUR), endsAt: new Date(NOON) }),
      ],
    },
    {
      label: "non-canonical task id",
      build: (): readonly MeasurementTask[] => [
        synthTask({ id: "not-a-canonical-task-id" as ReturnType<typeof synthTaskId> }),
      ],
    },
    {
      label: "duplicate task ids in the snapshot set",
      build: (): readonly MeasurementTask[] => [
        synthTask({ id: synthTaskId(9) }),
        synthTask({ id: synthTaskId(9) }),
      ],
    },
  ])("rejects task snapshots where $label", ({ build }) => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const result = harness.engine.computeSchedule({
      tasks: build(),
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-task-snapshot" } });
  });

  it("rejects a registry carrying a channel without an id", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const rogue: NotificationChannel = new InMemoryChannel({ id: "", clock: harness.clock });
    const registry: ChannelRegistry = {
      all: () => [rogue],
      get: (channelId) => (channelId === "" ? rogue : undefined),
    };
    const result = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-channel" } });
  });
});

describe("B8 schedule computation — structural PHI minimization", () => {
  it("scheduled reminders never carry a person id (payloads stay person-free)", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const personId = synthPersonId();
    const schedule = scheduleOf(
      harness.engine.computeSchedule({
        tasks: [synthTask({ personId, endsAt })],
        preferences: synthPreferences({ personId, quietHours: noQuietHours() }),
        channels: harness.registry,
      }),
    );
    const dump = serializeReminderSchedule(schedule);
    expect(dump).not.toContain("personId");
    expect(JSON.parse(dump).reminders[0]).not.toHaveProperty("personId");
    // The reminder id is a canonical rem_ id.
    expect(isReminderId(schedule.reminders[0]!.id)).toBe(true);
  });
});
