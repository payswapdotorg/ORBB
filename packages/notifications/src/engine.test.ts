import { describe, expect, it } from "vitest";
import type { EngineResult } from "@orbb/measurement";
import { InMemoryChannel } from "./inmemory-channel.js";
import { ReminderEngine } from "./engine.js";
import { deriveReminderIdentity, deriveWindowKey, isReminderId, utcDayOf } from "./ids.js";
import { InMemoryReminderDispatchLedger } from "./ledger.js";
import { MS_PER_DAY } from "./preferences.js";
import type { Reminder } from "./reminder.js";
import {
  SYNTH_LABELS,
  SYNTH_METHOD_ORDER,
  buildReminderHarness,
  harnessPersonId,
  syntheticProfile,
  syntheticTask,
  type ReminderHarness,
} from "./testsupport.js";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function expectOk<T, E>(result: EngineResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const QUIET_OFF = {
  enabled: false,
  startMinuteOfDayLocal: 22 * 60,
  endMinuteOfDayLocal: 7 * 60,
} as const;

/** Default synthetic window: [2024-01-02T10:00Z, 2024-01-02T11:00Z). */
const WINDOW_START = Date.UTC(2024, 0, 2, 10, 0, 0);
const WINDOW_END = Date.UTC(2024, 0, 2, 11, 0, 0);

interface RunOptions {
  readonly epochMs: number;
  readonly taskOverrides?: Parameters<typeof syntheticTask>[1];
  readonly profileOverrides?: Parameters<typeof syntheticProfile>[0];
  readonly channels?: readonly InMemoryChannel[];
  readonly labels?: Parameters<ReminderEngine["computeSchedule"]>[0]["labels"];
}

interface RunResult {
  readonly harness: ReminderHarness;
  readonly channel: InMemoryChannel;
  readonly schedule: Awaited<ReturnType<ReminderEngine["computeSchedule"]>>;
}

/**
 * Runs one schedule computation at the given epoch with one default
 * in-memory channel (unless overridden). The profile defaults to quiet
 * hours DISABLED so window math is observed raw.
 */
async function runSchedule(options: RunOptions): Promise<RunResult> {
  const harness = buildReminderHarness({ epochMs: options.epochMs });
  const channel = options.channels?.[0] ?? new InMemoryChannel({ id: "in-memory" });
  const channels = options.channels ?? [channel];
  const schedule = await harness.engine.computeSchedule({
    tasks: [syntheticTask(harness.ids, options.taskOverrides)],
    profile: syntheticProfile({ quietHours: QUIET_OFF, ...options.profileOverrides }),
    channels,
    ...(options.labels !== undefined ? { labels: options.labels } : {}),
  });
  return { harness, channel, schedule };
}

function firstReminder(schedule: RunResult["schedule"]): Reminder {
  const value = expectOk(schedule);
  const reminder = value.reminders[0];
  if (reminder === undefined) {
    throw new Error("expected at least one reminder");
  }
  return reminder;
}

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("B8 engine — determinism (the core contract)", () => {
  it("recomputing over unchanged inputs yields byte-identical reminders", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const input = {
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile(),
      channels: [channel] as const,
    };
    const first = expectOk(await harness.engine.computeSchedule(input));
    const second = expectOk(await harness.engine.computeSchedule(input));
    expect(second.reminders).toEqual(first.reminders);
    expect(JSON.stringify(second.reminders)).toBe(JSON.stringify(first.reminders));
    expect(second.skippedChannels).toEqual(first.skippedChannels);
    expect(second.reminders).toHaveLength(first.reminders.length);
  });

  it("produces the identical serialized schedule across a fresh engine re-instantiation", async () => {
    const epoch = Date.UTC(2024, 0, 3, 12, 0, 0); // post-escalation: both rungs exercised
    const runA = await runSchedule({ epochMs: epoch });
    const runB = await runSchedule({ epochMs: epoch });
    const serializedA = JSON.stringify(expectOk(runA.schedule));
    const serializedB = JSON.stringify(expectOk(runB.schedule));
    expect(serializedB).toBe(serializedA);
    // Literal serialized round-trip: parse(serialize(x)) deep-equals across instances.
    expect(JSON.parse(serializedB)).toEqual(JSON.parse(serializedA));
    expect(JSON.parse(serializedA).reminders).toHaveLength(1);
    expect(JSON.parse(serializedA).reminders[0].rung).toBe("REMIND_WITH_FALLBACK_OFFER");
  });

  it("multi-channel schedules are deterministic and channel-identity-stable", async () => {
    const epoch = WINDOW_START + 1_800_000;
    const channels = [
      new InMemoryChannel({ id: "alpha" }),
      new InMemoryChannel({ id: "beta" }),
    ];
    const a = await runSchedule({
      epochMs: epoch,
      channels,
      profileOverrides: {
        enabledChannelIds: ["alpha", "beta"],
        recipients: { alpha: "SYNTH-recipient-alpha", beta: "SYNTH-recipient-beta" },
      },
    });
    const b = await runSchedule({
      epochMs: epoch,
      channels,
      profileOverrides: {
        enabledChannelIds: ["alpha", "beta"],
        recipients: { alpha: "SYNTH-recipient-alpha", beta: "SYNTH-recipient-beta" },
      },
    });
    const scheduleA = expectOk(a.schedule);
    const scheduleB = expectOk(b.schedule);
    expect(scheduleB.reminders).toEqual(scheduleA.reminders);
    expect(scheduleA.reminders).toHaveLength(2);
    expect(new Set(scheduleA.reminders.map((reminder) => reminder.id)).size).toBe(2);
    expect(scheduleA.reminders.map((reminder) => reminder.channelId)).toEqual(["alpha", "beta"]);
    for (const reminder of scheduleA.reminders) {
      expect(isReminderId(reminder.id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Window mathematics (table-driven: due / missed / boundaries).
// ---------------------------------------------------------------------------

describe("B8 engine — window mathematics (table-driven)", () => {
  it.each([
    {
      name: "before the upcoming lead: planned, not yet due",
      now: "2024-01-02T08:59:59.999Z",
      rung: "REMIND",
      reason: "upcoming-due",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-02T10:00:00.000Z",
      due: false,
    },
    {
      name: "exactly at the nominal instant: due",
      now: "2024-01-02T10:00:00.000Z",
      rung: "REMIND",
      reason: "upcoming-due",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-02T10:00:00.000Z",
      due: true,
    },
    {
      name: "mid-window: planned as soon as possible now",
      now: "2024-01-02T10:30:00.000Z",
      rung: "REMIND",
      reason: "upcoming-due",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-02T10:30:00.000Z",
      due: true,
    },
    {
      name: "one millisecond before close: still upcoming",
      now: "2024-01-02T10:59:59.999Z",
      rung: "REMIND",
      reason: "upcoming-due",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-02T10:59:59.999Z",
      due: true,
    },
    {
      name: "exactly at window close: missed (boundary flip)",
      now: "2024-01-02T11:00:00.000Z",
      rung: "REMIND",
      reason: "missed-window",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-02T11:00:00.000Z",
      due: true,
    },
    {
      name: "one millisecond before escalation grace ends: still REMIND",
      now: "2024-01-03T10:59:59.999Z",
      rung: "REMIND",
      reason: "missed-window",
      nominal: "2024-01-02T10:00:00.000Z",
      sendAt: "2024-01-03T10:59:59.999Z",
      due: true,
    },
    {
      name: "exactly at the escalation instant: the offer rung is current",
      now: "2024-01-03T11:00:00.000Z",
      rung: "REMIND_WITH_FALLBACK_OFFER",
      reason: "missed-window",
      nominal: "2024-01-03T11:00:00.000Z",
      sendAt: "2024-01-03T11:00:00.000Z",
      due: true,
    },
  ])("$name", async ({ now, rung, reason, nominal, sendAt, due }) => {
    const result = await runSchedule({ epochMs: Date.parse(now) });
    const outcome = expectOk(result.schedule);
    expect(outcome.reminders).toHaveLength(1);
    const reminder = firstReminder(result.schedule);
    expect(reminder.rung).toBe(rung);
    expect(reminder.reason).toBe(reason);
    expect(reminder.nominalSendAt.toISOString()).toBe(nominal);
    expect(reminder.sendAt.toISOString()).toBe(sendAt);
    expect(reminder.due).toBe(due);
    expect(reminder.deferredFrom).toBeUndefined();
    expect(outcome.quietHoursDeferrals).toBe(0);
  });

  it("clamps the nominal instant to the window start when the lead exceeds the window duration", async () => {
    const result = await runSchedule({
      epochMs: Date.parse("2024-01-02T09:59:59.999Z"),
      profileOverrides: { upcomingLeadMs: 2 * 3_600_000 },
    });
    const reminder = firstReminder(result.schedule);
    expect(reminder.nominalSendAt.toISOString()).toBe("2024-01-02T10:00:00.000Z");
    expect(reminder.sendAt.toISOString()).toBe("2024-01-02T10:00:00.000Z");
    expect(reminder.due).toBe(false);
    const dueNow = await runSchedule({
      epochMs: Date.parse("2024-01-02T10:00:00.000Z"),
      profileOverrides: { upcomingLeadMs: 2 * 3_600_000 },
    });
    expect(firstReminder(dueNow.schedule).due).toBe(true);
  });

  it("crosses UTC day edges with pure UTC arithmetic (distinct per-day identities)", async () => {
    // Window ends exactly at the UTC day edge; 1ms lead puts the nominal
    // instant one millisecond INSIDE the previous day.
    const windowEnd = Date.UTC(2024, 0, 3, 0, 0, 0);
    const harness = buildReminderHarness({ epochMs: windowEnd - 1 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids, {
      window: {
        startsAt: new Date(windowEnd - 3_600_000),
        endsAt: new Date(windowEnd),
      },
    });
    const profile = syntheticProfile({
      quietHours: QUIET_OFF,
      upcomingLeadMs: 1,
    });
    const input = { tasks: [task], profile, channels: [channel] as const };

    // Day 1: dispatch at the nominal instant (inside the earlier UTC day).
    harness.clock.advanceTo(windowEnd - 1);
    const dayOne = expectOk(await harness.engine.dispatchDue(input));
    expect(dayOne.dispatched).toHaveLength(1);
    const dayOneId = (dayOne.dispatched[0] as { reminderId: string }).reminderId;
    // Re-dispatching within the same UTC day adds nothing.
    const dayOneAgain = expectOk(await harness.engine.dispatchDue(input));
    expect(dayOneAgain.dispatched).toHaveLength(0);
    expect(dayOneAgain.skipped).toHaveLength(1);

    // Day 2: one tick into the next UTC day => a fresh identity (daily
    // gentle recap of the still-open task), dispatched exactly once more.
    harness.clock.advanceTo(windowEnd + 100);
    const dayTwo = expectOk(await harness.engine.dispatchDue(input));
    expect(dayTwo.dispatched).toHaveLength(1);
    const dayTwoId = (dayTwo.dispatched[0] as { reminderId: string }).reminderId;
    expect(dayTwoId).not.toBe(dayOneId);
    const ledgerList = await harness.ledger.list();
    expect(ledgerList).toHaveLength(2);
  });

  it("crosses week boundaries (Saturday -> Sunday window) with no calendar logic", async () => {
    const saturdayNight = Date.UTC(2024, 0, 6, 23, 0, 0); // 2024-01-06 Sat 23:00Z
    const upcoming = await runSchedule({
      epochMs: Date.parse("2024-01-07T00:05:00.000Z"),
      taskOverrides: {
        window: {
          startsAt: new Date(saturdayNight),
          endsAt: new Date(saturdayNight + 2 * 3_600_000),
        },
      },
    });
    const reminder = firstReminder(upcoming.schedule);
    expect(reminder.rung).toBe("REMIND");
    expect(reminder.reason).toBe("upcoming-due");
    expect(reminder.sendAt.toISOString()).toBe("2024-01-07T00:05:00.000Z");

    const missed = await runSchedule({
      epochMs: Date.parse("2024-01-07T01:30:00.000Z"),
      taskOverrides: {
        window: {
          startsAt: new Date(saturdayNight),
          endsAt: new Date(saturdayNight + 2 * 3_600_000),
        },
      },
    });
    expect(firstReminder(missed.schedule).reason).toBe("missed-window");
  });

  it("tracks the task's CURRENT window after a roll-forward (no stale-window reminders)", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const profile = syntheticProfile({ quietHours: QUIET_OFF });
    const original = syntheticTask(harness.ids, {
      window: { startsAt: new Date(WINDOW_START), endsAt: new Date(WINDOW_END) },
    });
    const firstPass = expectOk(
      await harness.engine.dispatchDue({ tasks: [original], profile, channels: [channel] }),
    );
    expect(firstPass.dispatched).toHaveLength(1);

    // The scheduler rolled the task forward: same id, new window.
    const rolled = {
      ...original,
      window: {
        sequence: 1,
        startsAt: new Date(WINDOW_START + MS_PER_DAY),
        endsAt: new Date(WINDOW_END + MS_PER_DAY),
      },
      rollCount: 1,
    };
    harness.clock.advanceTo(WINDOW_START + MS_PER_DAY + 1_800_000);
    const secondPass = expectOk(
      await harness.engine.dispatchDue({ tasks: [rolled], profile, channels: [channel] }),
    );
    expect(secondPass.dispatched).toHaveLength(1);
    const schedule = secondPass.schedule;
    expect(schedule.reminders).toHaveLength(1);
    const reminder = schedule.reminders[0] as Reminder;
    expect(reminder.window.sequence).toBe(1);
    expect(reminder.windowKey).toBe(
      deriveWindowKey({
        taskId: rolled.id,
        sequence: 1,
        startsAtMs: WINDOW_START + MS_PER_DAY,
        endsAtMs: WINDOW_END + MS_PER_DAY,
      }),
    );
    // Both windows' dispatches are distinct ledger entries.
    const ledgerList = await harness.ledger.list();
    expect(ledgerList).toHaveLength(2);
    expect(new Set(ledgerList.map((entry) => entry.reminderId)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Escalation ladder.
// ---------------------------------------------------------------------------

describe("B8 engine — gentle escalation ladder", () => {
  const ESCALATION_EPOCH = Date.UTC(2024, 0, 3, 12, 0, 0); // past window end + 24h grace

  it("advances to the offer rung only when the recorded conditions hold", async () => {
    const result = await runSchedule({ epochMs: ESCALATION_EPOCH });
    const reminder = firstReminder(result.schedule);
    expect(reminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(reminder.reason).toBe("missed-window");
  });

  it("supersedes: exactly ONE rung is current per (task, window, channel)", async () => {
    const result = await runSchedule({ epochMs: ESCALATION_EPOCH });
    const outcome = expectOk(result.schedule);
    expect(outcome.reminders).toHaveLength(1);
    expect(outcome.reminders.filter((reminder) => reminder.rung === "REMIND")).toHaveLength(0);
  });

  it("never escalates without recorded fallback vocabulary (single-method task)", async () => {
    const result = await runSchedule({
      epochMs: Date.UTC(2024, 0, 10, 12, 0, 0),
      taskOverrides: { methodOrder: ["SYNTH-method-wearable"] },
    });
    const reminder = firstReminder(result.schedule);
    expect(reminder.rung).toBe("REMIND");
    expect(reminder.payload.kind).toBe("remind");
  });

  it("the offer payload carries the task's fallback vocabulary as DATA (journey #7)", async () => {
    const result = await runSchedule({
      epochMs: ESCALATION_EPOCH,
      labels: {
        metricLabels: { "SYNTH-metric-heart-rate": SYNTH_LABELS.metric },
        methodLabels: {
          "SYNTH-method-wearable": SYNTH_LABELS.methodWearable,
          "SYNTH-method-app": SYNTH_LABELS.methodApp,
          "SYNTH-method-manual": SYNTH_LABELS.methodManual,
        },
      },
    });
    const reminder = firstReminder(result.schedule);
    expect(reminder.payload.kind).toBe("remind-with-fallback-offer");
    if (reminder.payload.kind !== "remind-with-fallback-offer") {
      throw new Error("unreachable");
    }
    // Preferred = methodOrder[0]; fallbacks = the RECORDED remainder, in
    // the recorded order, with caller-vetted labels. The engine orders
    // nothing and decides nothing.
    expect(reminder.payload.preferredMethodId).toBe(SYNTH_METHOD_ORDER[0]);
    expect(reminder.payload.preferredMethodLabel).toBe(SYNTH_LABELS.methodWearable);
    expect(reminder.payload.fallbackMethods).toEqual([
      { methodId: "SYNTH-method-app", label: SYNTH_LABELS.methodApp },
      { methodId: "SYNTH-method-manual", label: SYNTH_LABELS.methodManual },
    ]);
    expect(reminder.payload.metricLabel).toBe(SYNTH_LABELS.metric);
  });

  it("escalation grace zero advances immediately at window close", async () => {
    const result = await runSchedule({
      epochMs: WINDOW_END,
      profileOverrides: { escalationAfterMs: 0 },
    });
    expect(firstReminder(result.schedule).rung).toBe("REMIND_WITH_FALLBACK_OFFER");
  });

  it("completed tasks produce no reminders and are accounted, never silently skipped", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids, { state: "completed" });
    const result = await harness.engine.computeSchedule({
      tasks: [task],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel],
    });
    const outcome = expectOk(result);
    expect(outcome.reminders).toHaveLength(0);
    expect(outcome.skippedTasks).toEqual([{ taskId: task.id, reason: "task-not-open" }]);
  });

  it("reminders disabled by preference: empty schedule, explicitly flagged", async () => {
    const result = await runSchedule({
      epochMs: WINDOW_START + 1_800_000,
      profileOverrides: { remindersEnabled: false },
    });
    const outcome = expectOk(result.schedule);
    expect(outcome.remindersDisabled).toBe(true);
    expect(outcome.reminders).toHaveLength(0);
    expect(outcome.skippedChannels).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Quiet hours integration (defer, never drop).
// ---------------------------------------------------------------------------

describe("B8 engine — quiet hours defer-not-drop", () => {
  it("a reminder due inside quiet hours is deferred to the edge and stays in the schedule", async () => {
    // Nominal 22:30 local (UTC+0) is inside the default 22:00–07:00 window.
    const result = await runSchedule({
      epochMs: Date.UTC(2024, 0, 2, 22, 30, 0),
      taskOverrides: {
        window: {
          startsAt: new Date(Date.UTC(2024, 0, 2, 22, 30, 0)),
          endsAt: new Date(Date.UTC(2024, 0, 2, 23, 30, 0)),
        },
      },
      profileOverrides: {
        quietHours: { enabled: true, startMinuteOfDayLocal: 22 * 60, endMinuteOfDayLocal: 7 * 60 },
      },
    });
    const outcome = expectOk(result.schedule);
    expect(outcome.reminders).toHaveLength(1);
    const reminder = firstReminder(result.schedule);
    expect(reminder.deferredFrom).toBeDefined();
    expect(reminder.deferredFrom?.toISOString()).toBe("2024-01-02T22:30:00.000Z");
    expect(reminder.sendAt.toISOString()).toBe("2024-01-03T07:00:00.000Z");
    expect(reminder.due).toBe(false);
    expect(outcome.quietHoursDeferrals).toBe(1);
  });

  it("the deferred reminder dispatches at the edge with the SAME identity (stable overnight)", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 22, 30, 0) });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids, {
      window: {
        startsAt: new Date(Date.UTC(2024, 0, 2, 22, 30, 0)),
        endsAt: new Date(Date.UTC(2024, 0, 2, 23, 30, 0)),
      },
    });
    const input = { tasks: [task], profile: syntheticProfile(), channels: [channel] as const };

    const night = expectOk(await harness.engine.computeSchedule(input));
    const nightReminder = night.reminders[0] as Reminder;

    const earlyDispatch = expectOk(await harness.engine.dispatchDue(input));
    expect(earlyDispatch.dispatched).toHaveLength(0);
    expect(earlyDispatch.pending).toHaveLength(1);
    expect(channel.sendCount).toBe(0);

    harness.clock.advanceTo(Date.UTC(2024, 0, 3, 7, 0, 0));
    const morning = expectOk(await harness.engine.computeSchedule(input));
    const morningReminder = morning.reminders[0] as Reminder;
    // Same identity: the overnight deferral never duplicates the reminder.
    expect(morningReminder.id).toBe(nightReminder.id);
    expect(morningReminder.due).toBe(true);
    expect(morningReminder.sendAt.toISOString()).toBe("2024-01-03T07:00:00.000Z");

    const dispatched = expectOk(await harness.engine.dispatchDue(input));
    expect(dispatched.dispatched).toHaveLength(1);
    expect(channel.sendCount).toBe(1);
    expect((await harness.ledger.list())).toHaveLength(1);
  });

  it("disabled quiet hours send at the planned instant with no deferral", async () => {
    const result = await runSchedule({
      epochMs: Date.UTC(2024, 0, 2, 22, 30, 0),
      taskOverrides: {
        window: {
          startsAt: new Date(Date.UTC(2024, 0, 2, 22, 30, 0)),
          endsAt: new Date(Date.UTC(2024, 0, 2, 23, 30, 0)),
        },
      },
      profileOverrides: { quietHours: QUIET_OFF },
    });
    const reminder = firstReminder(result.schedule);
    expect(reminder.deferredFrom).toBeUndefined();
    expect(reminder.sendAt.toISOString()).toBe("2024-01-02T22:30:00.000Z");
    expect(reminder.due).toBe(true);
    expect(expectOk(result.schedule).quietHoursDeferrals).toBe(0);
  });

  it("task completion between deferral and edge cancels the send (accounted, not stale)", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 22, 30, 0) });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids, {
      window: {
        startsAt: new Date(Date.UTC(2024, 0, 2, 22, 30, 0)),
        endsAt: new Date(Date.UTC(2024, 0, 2, 23, 30, 0)),
      },
    });
    const input = { tasks: [task], profile: syntheticProfile(), channels: [channel] as const };
    expectOk(await harness.engine.dispatchDue(input));
    expect(channel.sendCount).toBe(0);

    harness.clock.advanceTo(Date.UTC(2024, 0, 3, 7, 0, 0));
    const completed = { ...task, state: "completed" as const };
    const outcome = expectOk(
      await harness.engine.dispatchDue({ ...input, tasks: [completed] }),
    );
    expect(outcome.dispatched).toHaveLength(0);
    expect(channel.sendCount).toBe(0);
    expect(outcome.schedule.skippedTasks).toEqual([
      { taskId: task.id, reason: "task-not-open" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Idempotency (recompute adds nothing; ledger records each dispatch once).
// ---------------------------------------------------------------------------

describe("B8 engine — idempotency and the send-attempt ledger", () => {
  async function dispatchTwiceAtSameInstant() {
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const input = {
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel] as const,
    };
    const first = expectOk(await harness.engine.dispatchDue(input));
    const second = expectOk(await harness.engine.dispatchDue(input));
    return { harness, channel, first, second, input };
  }

  it("re-dispatching at the same clock instant records nothing new", async () => {
    const { channel, first, second } = await dispatchTwiceAtSameInstant();
    expect(first.dispatched).toHaveLength(1);
    expect(second.dispatched).toHaveLength(0);
    expect(second.skipped).toEqual([
      { reminderId: (first.dispatched[0] as { reminderId: string }).reminderId, reason: { kind: "already-dispatched" } },
    ]);
    expect(channel.sendCount).toBe(1);
  });

  it("the ledger records each dispatch exactly once per reminder id", async () => {
    const { harness, first } = await dispatchTwiceAtSameInstant();
    const list = await harness.ledger.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.reminderId).toBe((first.dispatched[0] as { reminderId: string }).reminderId);
    expect(list[0]?.status).toBe("delivered");
  });

  it("a rehydrated ledger (serialized re-instantiation) still blocks re-dispatch", async () => {
    const original = await dispatchTwiceAtSameInstant();
    const records = await original.harness.ledger.list();

    // Fresh engine + ledger; replay the serialized records.
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    for (const entry of records) {
      const write = await harness.ledger.record(entry);
      expect(write.status).toBe("recorded");
    }
    const channel = new InMemoryChannel({ id: "in-memory" });
    const replay = expectOk(
      await harness.engine.dispatchDue({
        tasks: [syntheticTask(harness.ids)],
        profile: syntheticProfile({ quietHours: QUIET_OFF }),
        channels: [channel],
      }),
    );
    expect(replay.dispatched).toHaveLength(0);
    expect(replay.skipped).toHaveLength(1);
    expect(channel.sendCount).toBe(0);
    expect(await harness.ledger.list()).toHaveLength(1);
  });

  it("recomputation adds nothing to the schedule (no duplicate identities)", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START + 1_800_000 });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const input = {
      tasks: [syntheticTask(harness.ids), syntheticTask(harness.ids, { metricId: "SYNTH-metric-other" })],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel] as const,
    };
    const first = expectOk(await harness.engine.computeSchedule(input));
    const second = expectOk(await harness.engine.computeSchedule(input));
    expect(second.reminders).toHaveLength(first.reminders.length);
    const ids = first.reminders.map((reminder) => reminder.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.reminders.map((reminder) => reminder.id)).toEqual(ids);
  });

  it("reminder ids are exactly the recorded identity function outputs", async () => {
    const result = await runSchedule({ epochMs: WINDOW_START + 1_800_000 });
    const reminder = firstReminder(result.schedule);
    const expected = deriveReminderIdentity({
      taskId: reminder.taskId,
      windowKey: reminder.windowKey,
      rung: reminder.rung,
      channelId: reminder.channelId,
      utcDay: utcDayOf(reminder.sendAt.getTime()),
    });
    expect(reminder.id).toBe(expected);
    expect(reminder.windowKey).toBe(
      deriveWindowKey({
        taskId: reminder.taskId,
        sequence: reminder.window.sequence,
        startsAtMs: reminder.window.startsAt.getTime(),
        endsAtMs: reminder.window.endsAt.getTime(),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Typed rejections and accounted skips.
// ---------------------------------------------------------------------------

describe("B8 engine — typed rejections (PHID-safe) and accounted skips", () => {
  it("rejects a task belonging to a different person (deny-by-default, loud)", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const foreign = syntheticTask(harness.ids, {
      personId: `prsn_${"other".repeat(6)}000000` as never,
    });
    const result = await harness.engine.computeSchedule({
      tasks: [foreign],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel],
    });
    expect(result).toEqual({ ok: false, error: { kind: "task-person-mismatch", taskIndex: 0 } });
  });

  it("rejects structurally invalid task snapshots positionally", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const good = syntheticTask(harness.ids);
    const bad = { ...syntheticTask(harness.ids), id: "not-a-task-id" } as never;
    const result = await harness.engine.computeSchedule({
      tasks: [good, bad],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel],
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-task-snapshot", taskIndex: 1 } });
  });

  it("rejects invalid profiles, channels, labels, and inputs with typed errors", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids);
    const base = { tasks: [task], channels: [channel] as const };

    const badProfile = await harness.engine.computeSchedule({
      ...base,
      profile: syntheticProfile({ localUtcOffsetMinutes: 9999 }),
    });
    expect(badProfile).toEqual({
      ok: false,
      error: { kind: "invalid-profile", field: "localUtcOffsetMinutes" },
    });

    const duplicateChannels = await harness.engine.computeSchedule({
      ...base,
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel, new InMemoryChannel({ id: "in-memory" })],
    });
    expect(duplicateChannels).toEqual({
      ok: false,
      error: { kind: "duplicate-channel-id", channelIndex: 1 },
    });

    const badLabels = await harness.engine.computeSchedule({
      ...base,
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      labels: { metricLabels: { "SYNTH-metric-heart-rate": "" } },
    });
    expect(badLabels).toEqual({ ok: false, error: { kind: "invalid-label-pack" } });

    const badInput = await harness.engine.computeSchedule({
      tasks: "not-an-array" as never,
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [channel],
    });
    expect(badInput).toEqual({ ok: false, error: { kind: "invalid-input" } });
  });

  it("accounts channels that are registered but not enabled by preference", async () => {
    const channels = [
      new InMemoryChannel({ id: "in-memory" }),
      new InMemoryChannel({ id: "email" }),
    ];
    const result = await runSchedule({
      epochMs: WINDOW_START + 1_800_000,
      channels,
      profileOverrides: {
        quietHours: QUIET_OFF,
        enabledChannelIds: ["in-memory"],
        recipients: { "in-memory": "SYNTH-recipient-in-memory" },
      },
    });
    const outcome = expectOk(result.schedule);
    expect(outcome.reminders.map((reminder) => reminder.channelId)).toEqual(["in-memory"]);
    expect(outcome.skippedChannels).toEqual([
      {
        taskId: (outcome.reminders[0] as Reminder).taskId,
        channelId: "email",
        rung: "REMIND",
        reason: { kind: "channel-not-enabled" },
      },
    ]);
  });

  it("accounts profile-enabled channels missing from the registry", async () => {
    const result = await runSchedule({
      epochMs: WINDOW_START + 1_800_000,
      profileOverrides: {
        quietHours: QUIET_OFF,
        enabledChannelIds: ["in-memory", "ghost"],
        recipients: { "in-memory": "SYNTH-recipient-in-memory" },
      },
    });
    const outcome = expectOk(result.schedule);
    expect(outcome.unresolvedChannels).toEqual(["ghost"]);
    expect(outcome.reminders).toHaveLength(1);
  });

  it("constructor rejects missing injected ports (programming error, not a typed rejection)", () => {
    expect(() => new ReminderEngine({} as never)).toThrow(/injectable clock/);
    expect(
      () =>
        new ReminderEngine({
          clock: { now: () => new Date(0) },
          ledger: new InMemoryReminderDispatchLedger(),
        }),
    ).not.toThrow();
  });

  it("multi-person batches are rejected loudly rather than routed across profiles", async () => {
    const harness = buildReminderHarness({ epochMs: WINDOW_START });
    const mine = syntheticTask(harness.ids);
    const theirs = syntheticTask(harness.ids, {
      personId: `prsn_${"zzzz".repeat(6)}0000zz` as never,
    });
    const result = await harness.engine.computeSchedule({
      tasks: [mine, theirs],
      profile: syntheticProfile({ quietHours: QUIET_OFF }),
      channels: [new InMemoryChannel({ id: "in-memory" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("task-person-mismatch");
    }
    expect(harnessPersonId()).toMatch(/^prsn_/);
  });
});
