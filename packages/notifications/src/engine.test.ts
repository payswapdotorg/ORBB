import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type { MeasurementTask, TaskId } from "@orbb/measurement";
import { canonicalJsonStringify } from "./canonical.js";
import { InMemoryChannel, InMemoryChannelRegistry, type ChannelRegistry } from "./channels.js";
import { ReminderEngine } from "./engine.js";
import { InMemorySendAttemptLedger } from "./ledger.js";
import { InMemoryReminderLabelDirectory } from "./labels.js";
import { InMemoryRecipientDirectory } from "./recipients.js";
import {
  hashReminderSchedule,
  serializeReminderSchedule,
} from "./serialization.js";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  SYNTH_METHOD_IDS,
  SYNTH_PERSON_ID,
  buildNotificationHarness,
  harnessProfile,
  quietHours,
  reviveTasksFromCanonicalJson,
  syntheticTask,
  syntheticTaskId,
} from "./testsupport.js";

/** A window helper: [start, start + duration), sequence 0 by default. */
function window(startMs: number, durationMs: number, sequence = 0) {
  return { sequence, startsAt: new Date(startMs), endsAt: new Date(startMs + durationMs) };
}

describe("B8 reminder engine — schedule computation over real task snapshots", () => {
  it("computes an upcoming-due REMIND reminder at endsAt minus the lead time", () => {
    const harness = buildNotificationHarness();
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const { reminders, skippedChannels, computedAt } = result.value;
    expect(computedAt.getTime()).toBe(0);
    expect(skippedChannels).toEqual([]);
    expect(reminders).toHaveLength(1);
    const reminder = reminders[0];
    if (reminder === undefined) {
      throw new Error("expected one reminder");
    }
    expect(reminder.rung).toBe("REMIND");
    expect(reminder.channel).toBe("inmem");
    expect(reminder.taskId).toBe(syntheticTaskId(1));
    // 1970-01-02T02:00:00Z window end minus the 60-minute default lead.
    expect(reminder.scheduledAt.getTime()).toBe(MS_PER_DAY + MS_PER_HOUR);
    expect(reminder.deferredFrom).toBeUndefined();
    // Rung-1 payload: no fallback-offer key at all, no defer key at all.
    expect("fallbackOffer" in reminder.payload).toBe(false);
    expect("defer" in reminder.payload).toBe(false);
    // Internal addressing field present (never projected into the payload).
    expect(reminder.personId).toBe(SYNTH_PERSON_ID);
    expect("personId" in reminder.payload).toBe(false);
  });

  it("clamps the upcoming nudge forward to the window start when the lead exceeds the window duration", () => {
    const harness = buildNotificationHarness();
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, leadTimeMs: 3 * MS_PER_HOUR }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const reminder = result.value.reminders[0];
    if (reminder === undefined) {
      throw new Error("expected one reminder");
    }
    // 3h lead over a 2h window: fire clamps to the window start (1d).
    expect(reminder.scheduledAt.getTime()).toBe(MS_PER_DAY);
  });

  it("computes a missed-window REMIND_WITH_FALLBACK_OFFER reminder at endsAt plus the grace", () => {
    // Epoch 3h: the [1d, 1d+2h) window has NOT closed yet — use a past window.
    const harness = buildNotificationHarness({ epochMs: 2 * MS_PER_HOUR });
    const task = syntheticTask({ window: window(0, MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const { reminders } = result.value;
    expect(reminders).toHaveLength(1);
    const reminder = reminders[0];
    if (reminder === undefined) {
      throw new Error("expected one reminder");
    }
    expect(reminder.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    // Window closed at 1h; default grace 1h => fires at 2h.
    expect(reminder.scheduledAt.getTime()).toBe(2 * MS_PER_HOUR);
    if (reminder.payload.rung !== "REMIND_WITH_FALLBACK_OFFER") {
      throw new Error("expected fallback-offer payload");
    }
    // Journey #7: the offer carries the task's recorded fallback vocabulary
    // as DATA — preferred first, fallback order after, labeled, no authority.
    expect(reminder.payload.fallbackOffer.enforcementAuthority).toBe("none");
    expect(reminder.payload.fallbackOffer.methods).toEqual([
      {
        methodId: SYNTH_METHOD_IDS.bpCuff,
        methodLabel: "SYNTH-label-bp-cuff",
        role: "preferred",
      },
      {
        methodId: SYNTH_METHOD_IDS.bpManual,
        methodLabel: "SYNTH-label-bp-manual",
        role: "fallback",
      },
    ]);
  });

  it("silences completed tasks — completing a task ends the ladder (no punishment)", () => {
    const harness = buildNotificationHarness({ epochMs: 2 * MS_PER_HOUR });
    const task = syntheticTask({ state: "completed", window: window(0, MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.reminders).toEqual([]);
    expect(result.value.skippedChannels).toEqual([]);
  });

  it("honors the master preference gate — remindersEnabled false yields an empty schedule", () => {
    const harness = buildNotificationHarness();
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ remindersEnabled: false, channels: [] }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.reminders).toEqual([]);
  });

  it("fans out across every enabled profile channel in profile order", () => {
    const harness = buildNotificationHarness();
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["email-synth", "webpush-synth", "inmem"] }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.reminders.map((reminder) => reminder.channel)).toEqual([
      "email-synth",
      "inmem",
      "webpush-synth",
    ]);
    // One distinct deterministic id per channel (identity includes channel).
    const ids = new Set(result.value.reminders.map((reminder) => reminder.id));
    expect(ids.size).toBe(3);
  });
});

describe("B8 reminder engine — due/missed boundary table (UTC day and week edges)", () => {
  // Boundary instants: a UTC-day edge (1970-01-02T00:00Z) and a week edge
  // (2024-01-07T00:00Z, a Sunday). The rung flips exactly at endsAt <= now.
  const cases: readonly {
    readonly name: string;
    readonly nowMs: number;
    readonly endsAtMs: number;
    readonly expectedRung: "REMIND" | "REMIND_WITH_FALLBACK_OFFER" | undefined;
  }[] = [
    {
      name: "endsAt exactly at now on a UTC day edge -> missed (offer rung)",
      nowMs: MS_PER_DAY,
      endsAtMs: MS_PER_DAY,
      expectedRung: "REMIND_WITH_FALLBACK_OFFER",
    },
    {
      name: "endsAt one millisecond after now on a UTC day edge -> upcoming (remind rung)",
      nowMs: MS_PER_DAY,
      endsAtMs: MS_PER_DAY + 1,
      expectedRung: "REMIND",
    },
    {
      name: "endsAt exactly at now on a week edge (Sunday 00:00 UTC) -> missed",
      nowMs: Date.UTC(2024, 0, 7),
      endsAtMs: Date.UTC(2024, 0, 7),
      expectedRung: "REMIND_WITH_FALLBACK_OFFER",
    },
    {
      name: "endsAt one millisecond after now on a week edge (Sunday 00:00 UTC) -> upcoming",
      nowMs: Date.UTC(2024, 0, 7),
      endsAtMs: Date.UTC(2024, 0, 7) + 1,
      expectedRung: "REMIND",
    },
    {
      name: "endsAt one millisecond before a week edge (Saturday 23:59:59.999) -> missed",
      nowMs: Date.UTC(2024, 0, 7),
      endsAtMs: Date.UTC(2024, 0, 7) - 1,
      expectedRung: "REMIND_WITH_FALLBACK_OFFER",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const harness = buildNotificationHarness({ epochMs: testCase.nowMs });
      const task = syntheticTask({
        window: {
          sequence: 0,
          startsAt: new Date(testCase.endsAtMs - MS_PER_HOUR),
          endsAt: new Date(testCase.endsAtMs),
        },
      });
      const result = harness.engine.computeSchedule({
        tasks: [task],
        profile: harnessProfile({ quietHours: null, leadTimeMs: 0, escalationGraceMs: 0 }),
      });
      if (!result.ok) {
        throw new Error("expected scheduling to succeed");
      }
      expect(result.value.reminders.map((reminder) => reminder.rung)).toEqual(
        testCase.expectedRung === undefined ? [] : [testCase.expectedRung],
      );
    });
  }

  it("escalates ONLY on the recorded conditions — one rung per task window per computation", () => {
    const nowMs = 5 * MS_PER_HOUR;
    const harness = buildNotificationHarness({ epochMs: nowMs });
    const tasks: MeasurementTask[] = [
      syntheticTask({ index: 1, window: window(6 * MS_PER_HOUR, MS_PER_HOUR) }), // future window
      syntheticTask({ index: 2, window: window(MS_PER_HOUR, MS_PER_HOUR) }), // missed window
    ];
    const result = harness.engine.computeSchedule({
      tasks,
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const rungsByTask = new Map<string, string[]>();
    for (const reminder of result.value.reminders) {
      const list = rungsByTask.get(reminder.taskId) ?? [];
      list.push(reminder.rung);
      rungsByTask.set(reminder.taskId, list);
    }
    // Future-window task: exactly one REMIND, never the offer rung.
    expect(rungsByTask.get(syntheticTaskId(1))).toEqual(["REMIND"]);
    // Missed-window task: exactly one offer, never the plain remind rung.
    expect(rungsByTask.get(syntheticTaskId(2))).toEqual(["REMIND_WITH_FALLBACK_OFFER"]);
  });
});

describe("B8 reminder engine — determinism (twice, and across serialized re-instantiation)", () => {
  const fixtureTasks = (): MeasurementTask[] => [
    syntheticTask({ index: 1, window: window(MS_PER_DAY, 2 * MS_PER_HOUR) }),
    syntheticTask({ index: 2, metricId: "SYNTH-metric-step-count", window: window(2 * MS_PER_DAY, MS_PER_HOUR) }),
    syntheticTask({ index: 3, state: "completed", window: window(0, MS_PER_HOUR) }),
  ];

  it("computing twice over the same inputs yields byte-identical schedules", () => {
    const harness = buildNotificationHarness();
    const profile = harnessProfile({ quietHours: null });
    const first = harness.engine.computeSchedule({ tasks: fixtureTasks(), profile });
    const second = harness.engine.computeSchedule({ tasks: fixtureTasks(), profile });
    if (!first.ok || !second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(first.value).toEqual(second.value);
    expect(serializeReminderSchedule(first.value)).toBe(serializeReminderSchedule(second.value));
    expect(hashReminderSchedule(first.value)).toBe(hashReminderSchedule(second.value));
  });

  it("is invariant to input task order (canonical schedule ordering)", () => {
    const harness = buildNotificationHarness();
    const profile = harnessProfile({ quietHours: null });
    const forward = harness.engine.computeSchedule({ tasks: fixtureTasks(), profile });
    const reversed = harness.engine.computeSchedule({
      tasks: [...fixtureTasks()].reverse(),
      profile,
    });
    if (!forward.ok || !reversed.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(serializeReminderSchedule(reversed.value)).toBe(serializeReminderSchedule(forward.value));
  });

  it("reproduces the identical schedule across a serialized re-instantiation", () => {
    const harnessA = buildNotificationHarness();
    const profile = harnessProfile({ quietHours: null });
    const first = harnessA.engine.computeSchedule({ tasks: fixtureTasks(), profile });
    if (!first.ok) {
      throw new Error("expected scheduling to succeed");
    }
    // Serialize the inputs (Dates become epoch-ms integers), revive them,
    // rebuild the whole engine over fresh doubles, recompute.
    const revived = reviveTasksFromCanonicalJson(canonicalJsonStringify(fixtureTasks()));
    const harnessB = buildNotificationHarness();
    const second = harnessB.engine.computeSchedule({ tasks: revived, profile });
    if (!second.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(serializeReminderSchedule(second.value)).toBe(serializeReminderSchedule(first.value));
    expect(hashReminderSchedule(second.value)).toBe(hashReminderSchedule(first.value));
    // The canonical serialization round-trips stably on its own, too.
    expect(canonicalJsonStringify(JSON.parse(serializeReminderSchedule(first.value)))).toBe(
      serializeReminderSchedule(first.value),
    );
  });

  it("derives reminder ids that satisfy the lane-local grammar", async () => {
    const { isReminderId } = await import("./ids.js");
    const harness = buildNotificationHarness();
    const result = harness.engine.computeSchedule({
      tasks: [syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) })],
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    for (const reminder of result.value.reminders) {
      expect(isReminderId(reminder.id)).toBe(true);
    }
  });
});

describe("B8 reminder engine — quiet hours: defer to the edge, never drop", () => {
  it("defers an overnight fire instant to the 07:00 edge and records the deferral on the payload", () => {
    const harness = buildNotificationHarness();
    // Window [1d, 1d+2h): fire = 1d+1h = Friday 01:00 local — inside the
    // recorded default quiet hours 22:00–07:00.
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({ tasks: [task], profile: harnessProfile() });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const { reminders } = result.value;
    // DEFER, NOT DROP: the reminder still exists, exactly one.
    expect(reminders).toHaveLength(1);
    const reminder = reminders[0];
    if (reminder === undefined) {
      throw new Error("expected one reminder");
    }
    expect(reminder.scheduledAt.getTime()).toBe(MS_PER_DAY + 7 * MS_PER_HOUR);
    expect(reminder.deferredFrom?.getTime()).toBe(MS_PER_DAY + MS_PER_HOUR);
    expect(reminder.payload.defer).toEqual({
      from: new Date(MS_PER_DAY + MS_PER_HOUR),
      reason: "quiet-hours",
    });
  });

  it("does not dispatch a deferred reminder before the edge, then dispatches at the edge", async () => {
    // Custom non-wrapping quiet hours 02:00–05:00 so a rung-1 reminder can
    // still be inside its window at the deferral edge.
    const harness = buildNotificationHarness({ epochMs: 0 });
    // Window [90m, 330m): fire = 330m - 60m = 270m = 04:30 — quiet.
    const task = syntheticTask({ window: window(90 * 60_000, 240 * 60_000) });
    const profile = harnessProfile({
      quietHours: quietHours({ startMinuteOfDay: 120, endMinuteOfDay: 300 }),
    });
    const before = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!before.ok) {
      throw new Error("expected dispatch to succeed");
    }
    // Deferred to the 05:00 edge: not yet due at epoch 0 — nothing sent,
    // nothing dropped.
    expect(before.value.dispatched).toEqual([]);
    expect(before.value.notYetDue).toHaveLength(1);
    expect(before.value.due).toBe(0);

    harness.clock.advanceTo(300 * 60_000);
    const atEdge = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!atEdge.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(atEdge.value.due).toBe(1);
    expect(atEdge.value.dispatched).toHaveLength(1);
    const attempt = atEdge.value.dispatched[0];
    if (attempt === undefined) {
      throw new Error("expected one attempt");
    }
    expect(attempt.outcome.status).toBe("sent");
    expect(attempt.rung).toBe("REMIND");
  });

  it("an overnight-missed task's fallback-offer reminder defers to the morning edge and fires there", async () => {
    const harness = buildNotificationHarness({ epochMs: 0 });
    // Window [22:30, 23:30) on day 0: missed the same night; offer fires
    // at 23:30 + 1h grace = day-1 00:30 — quiet — deferred to day-1 07:00.
    const task = syntheticTask({
      window: window(22.5 * MS_PER_HOUR, MS_PER_HOUR),
    });
    const profile = harnessProfile();
    harness.clock.advanceTo(MS_PER_DAY + 7 * MS_PER_HOUR);
    const result = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched).toHaveLength(1);
    const attempt = result.value.dispatched[0];
    if (attempt === undefined) {
      throw new Error("expected one attempt");
    }
    expect(attempt.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(attempt.outcome.status).toBe("sent");
  });

  it("a profile that disables quiet hours never defers", () => {
    const harness = buildNotificationHarness();
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = harness.engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    const reminder = result.value.reminders[0];
    if (reminder === undefined) {
      throw new Error("expected one reminder");
    }
    expect(reminder.scheduledAt.getTime()).toBe(MS_PER_DAY + MS_PER_HOUR);
    expect(reminder.deferredFrom).toBeUndefined();
    expect("defer" in reminder.payload).toBe(false);
  });
});

describe("B8 reminder engine — capability-gated channels are skipped with an accounted reason", () => {
  function engineOver(channels: readonly InMemoryChannel[], epochMs = 0) {
    const clock = new DeterministicClock({ epochMs });
    const registry = new InMemoryChannelRegistry(channels);
    const engine = new ReminderEngine({
      clock,
      ids: new DeterministicIdFactory({ seed: "caps" }),
      channels: registry,
      ledger: new InMemorySendAttemptLedger(),
      recipients: new InMemoryRecipientDirectory(),
      labels: new InMemoryReminderLabelDirectory({}),
    });
    return { clock, registry, engine };
  }

  it("skips a rung-2 reminder on a channel without canCarryFallbackOffer, with the accounted reason", () => {
    const basic = new InMemoryChannel({
      id: "basic",
      clock: new DeterministicClock({ epochMs: 2 * MS_PER_HOUR }),
      capabilities: { canRemind: true, canCarryFallbackOffer: false },
    });
    const full = new InMemoryChannel({
      id: "full",
      clock: new DeterministicClock({ epochMs: 2 * MS_PER_HOUR }),
    });
    const { engine } = engineOver([basic, full], 2 * MS_PER_HOUR);
    const task = syntheticTask({ window: window(0, MS_PER_HOUR) }); // missed at epoch 2h
    const result = engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["basic", "full"] }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    // Only the full-capability channel carries the offer.
    expect(result.value.reminders.map((reminder) => reminder.channel)).toEqual(["full"]);
    expect(result.value.skippedChannels).toEqual([
      {
        taskId: syntheticTaskId(1),
        rung: "REMIND_WITH_FALLBACK_OFFER",
        channel: "basic",
        reason: { kind: "channel-lacks-capability", capability: "canCarryFallbackOffer" },
      },
    ]);
  });

  it("still delivers rung-1 reminders on a channel that only lacks the fallback-offer capability", () => {
    const basic = new InMemoryChannel({
      id: "basic",
      clock: new DeterministicClock({ epochMs: 0 }),
      capabilities: { canRemind: true, canCarryFallbackOffer: false },
    });
    const { engine } = engineOver([basic]);
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["basic"] }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.reminders.map((reminder) => reminder.channel)).toEqual(["basic"]);
    expect(result.value.skippedChannels).toEqual([]);
  });

  it("skips both rungs on a channel without canRemind", () => {
    const muted = new InMemoryChannel({
      id: "muted",
      clock: new DeterministicClock({ epochMs: 0 }),
      capabilities: { canRemind: false, canCarryFallbackOffer: true },
    });
    const { engine } = engineOver([muted]);
    const task = syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });
    const result = engine.computeSchedule({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["muted"] }),
    });
    if (!result.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(result.value.reminders).toEqual([]);
    expect(result.value.skippedChannels).toEqual([
      {
        taskId: syntheticTaskId(1),
        rung: "REMIND",
        channel: "muted",
        reason: { kind: "channel-lacks-capability", capability: "canRemind" },
      },
    ]);
  });
});

describe("B8 reminder engine — idempotent dispatch (recompute adds nothing)", () => {
  function dueRungOneHarness() {
    // Epoch 1d+50m: window [1d, 1d+2h) is open (endsAt 1d+2h > now) and the
    // fire instant 1d+1h is already due.
    return buildNotificationHarness({ epochMs: MS_PER_DAY + 70 * 60_000 });
  }
  const openWindowTask = (): MeasurementTask =>
    syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });

  it("dispatches each due reminder exactly once and suppresses re-dispatch via the ledger", async () => {
    const harness = dueRungOneHarness();
    const task = openWindowTask();
    const profile = harnessProfile({ quietHours: null });
    const first = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!first.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(first.value.due).toBe(1);
    expect(first.value.alreadyDispatched).toEqual([]);
    expect(first.value.dispatched).toHaveLength(1);
    const attempt = first.value.dispatched[0];
    if (attempt === undefined) {
      throw new Error("expected one attempt");
    }
    expect(attempt.outcome.status).toBe("sent");
    expect(attempt.channel).toBe("inmem");
    expect(harness.inmem.recorded).toHaveLength(1);
    const ledgerRows = await harness.ledger.listAll();
    expect(ledgerRows).toHaveLength(1);

    // Recompute + re-dispatch at the SAME clock instant: adds nothing.
    const second = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!second.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(second.value.due).toBe(1);
    expect(second.value.dispatched).toEqual([]);
    expect(second.value.alreadyDispatched).toEqual([attempt.reminderId]);
    expect(await harness.ledger.listAll()).toHaveLength(1);
    expect(harness.inmem.recorded).toHaveLength(1);

    // The schedule itself is duplicate-free across recomputes.
    const scheduleA = harness.engine.computeSchedule({ tasks: [task], profile });
    const scheduleB = harness.engine.computeSchedule({ tasks: [task], profile });
    if (!scheduleA.ok || !scheduleB.ok) {
      throw new Error("expected scheduling to succeed");
    }
    expect(scheduleA.value.reminders.map((reminder) => reminder.id)).toEqual(
      scheduleB.value.reminders.map((reminder) => reminder.id),
    );
  });

  it("fans dispatch out per channel with one ledger row per reminder identity", async () => {
    const harness = dueRungOneHarness();
    const task = openWindowTask();
    const profile = harnessProfile({ quietHours: null, channels: ["webpush-synth", "email-synth"] });
    const result = await harness.engine.dispatchPending({ tasks: [task], profile });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched.map((attempt) => attempt.channel)).toEqual([
      "email-synth",
      "webpush-synth",
    ]);
    const rows = await harness.ledger.listAll();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.reminderId)).size).toBe(2);
  });

  it("records future-scheduled reminders as not yet due (nothing sent, nothing dropped)", async () => {
    const harness = buildNotificationHarness();
    const task = openWindowTask();
    const result = await harness.engine.dispatchPending({
      tasks: [task],
      profile: harnessProfile({ quietHours: null }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.due).toBe(0);
    expect(result.value.dispatched).toEqual([]);
    expect(result.value.notYetDue).toHaveLength(1);
    expect(await harness.ledger.listAll()).toEqual([]);
  });
});

describe("B8 reminder engine — fail-closed dispatch (recorded outcomes, never crashes)", () => {
  function engineWith(
    channels: readonly InMemoryChannel[],
    options?: { readonly registerRecipient?: boolean },
  ) {
    const clock = new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 });
    const registry = new InMemoryChannelRegistry(channels);
    const recipients = new InMemoryRecipientDirectory();
    if (options?.registerRecipient !== false) {
      recipients.register(SYNTH_PERSON_ID, "SYNTH-recipient-00000001");
    }
    const ledger = new InMemorySendAttemptLedger();
    const engine = new ReminderEngine({
      clock,
      ids: new DeterministicIdFactory({ seed: "failclosed" }),
      channels: registry,
      ledger,
      recipients,
      labels: new InMemoryReminderLabelDirectory({}),
    });
    return { clock, registry, ledger, engine };
  }
  const openWindowTask = (): MeasurementTask =>
    syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });

  it("converts a throwing channel into a recorded channel-transport-error; the engine result stays ok", async () => {
    const throwing = new InMemoryChannel({
      id: "bad",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
      fault: { mode: "throw" },
    });
    const { engine, ledger } = engineWith([throwing]);
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["bad"] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched).toHaveLength(1);
    const attempt = result.value.dispatched[0];
    if (attempt === undefined) {
      throw new Error("expected one attempt");
    }
    expect(attempt.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "channel-transport-error" },
    });
    // The failure is RECORDED (never a silent drop).
    expect(await ledger.listAll()).toHaveLength(1);
  });

  it("records an explicit undeliverable reason from the channel contract", async () => {
    const rejecting = new InMemoryChannel({
      id: "rejecting",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
      fault: { mode: "undeliverable", reason: { kind: "payload-rejected" } },
    });
    const { engine } = engineWith([rejecting]);
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["rejecting"] }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched[0]?.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "payload-rejected" },
    });
  });

  it("records unknown-recipient as an undeliverable outcome when the directory misses", async () => {
    const good = new InMemoryChannel({
      id: "good",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
    });
    const { engine } = engineWith([good], { registerRecipient: false });
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["good"] }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched[0]?.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "unknown-recipient" },
    });
  });

  it("continues past a failing channel — other channels' reminders still dispatch", async () => {
    const bad = new InMemoryChannel({
      id: "bad",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
      fault: { mode: "throw" },
    });
    const good = new InMemoryChannel({
      id: "good",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
    });
    const { engine } = engineWith([bad, good]);
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["bad", "good"] }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched.map((attempt) => attempt.channel)).toEqual(["bad", "good"]);
    expect(result.value.dispatched.map((attempt) => attempt.outcome.status)).toEqual([
      "undeliverable",
      "sent",
    ]);
  });

  it("records channel-disabled when the registry loses a channel between schedule and dispatch", async () => {
    const clock = new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 });
    const channel = new InMemoryChannel({ id: "vanishing", clock });
    // A flippable registry double: deterministic, closure-state controlled.
    const disabled = new Set<string>();
    const flippableRegistry: ChannelRegistry = {
      resolve: (channelId) =>
        disabled.has(channelId) ? undefined : channel.id === channelId ? channel : undefined,
      list: () => (disabled.size > 0 ? [] : [channel]),
    };
    // A ledger double that flips the registry DURING the dispatch loop
    // (the only window where schedule-time validation has already passed
    // but the per-reminder channel resolution has not run yet).
    const midDispatchLedger = {
      record: () => Promise.resolve(),
      findByReminderId: () => {
        disabled.add("vanishing");
        return Promise.resolve(undefined);
      },
      listAll: () => Promise.resolve([]),
    };
    const engine = new ReminderEngine({
      clock,
      ids: new DeterministicIdFactory({ seed: "flip" }),
      channels: flippableRegistry,
      ledger: midDispatchLedger,
      recipients: (() => {
        const recipients = new InMemoryRecipientDirectory();
        recipients.register(SYNTH_PERSON_ID, "SYNTH-recipient-00000001");
        return recipients;
      })(),
      labels: new InMemoryReminderLabelDirectory({}),
    });
    // Schedule-time: the channel is still registered (validation passes).
    const schedule = engine.computeSchedule({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["vanishing"] }),
    });
    expect(schedule.ok).toBe(true);
    // Dispatch-time: the registry lost the channel mid-dispatch — the
    // engine records channel-disabled instead of crashing.
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["vanishing"] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched[0]?.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "channel-disabled" },
    });
  });

  it("surfaces ledger unavailability as a typed rejection, never a crash", async () => {
    const good = new InMemoryChannel({
      id: "good",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
    });
    const failingLedger = {
      record: () => Promise.resolve(),
      findByReminderId: () => Promise.reject(new Error("SYNTH ledger down")),
      listAll: () => Promise.resolve([]),
    };
    const engineWithBadLedger = new ReminderEngine({
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
      ids: new DeterministicIdFactory({ seed: "ledgerdown" }),
      channels: new InMemoryChannelRegistry([good]),
      ledger: failingLedger,
      recipients: new InMemoryRecipientDirectory(),
      labels: new InMemoryReminderLabelDirectory({}),
    });
    const result = await engineWithBadLedger.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["good"] }),
    });
    expect(result).toEqual({ ok: false, error: { kind: "ledger-unavailable" } });
  });

  it("treats a throwing recipient directory as an unknown-recipient outcome (fail-closed)", async () => {
    const good = new InMemoryChannel({
      id: "good",
      clock: new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 }),
    });
    const clock = new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 });
    const engine = new ReminderEngine({
      clock,
      ids: new DeterministicIdFactory({ seed: "dirthrow" }),
      channels: new InMemoryChannelRegistry([good]),
      ledger: new InMemorySendAttemptLedger(),
      recipients: {
        resolve: () => Promise.reject(new Error("SYNTH directory down")),
      },
      labels: new InMemoryReminderLabelDirectory({}),
    });
    const result = await engine.dispatchPending({
      tasks: [openWindowTask()],
      profile: harnessProfile({ quietHours: null, channels: ["good"] }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched[0]?.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "unknown-recipient" },
    });
  });
});

describe("B8 reminder engine — typed input validation rejections", () => {
  const validTask = (): MeasurementTask =>
    syntheticTask({ window: window(MS_PER_DAY, 2 * MS_PER_HOUR) });

  it("rejects structurally invalid task snapshots with the task index", () => {
    const harness = buildNotificationHarness();
    const badId = { ...validTask(), id: "task_bad" as TaskId };
    const badWindow = { ...validTask(), window: window(MS_PER_DAY, 0) };
    const first = harness.engine.computeSchedule({
      tasks: [badId, validTask()],
      profile: harnessProfile({ quietHours: null }),
    });
    expect(first).toEqual({ ok: false, error: { kind: "invalid-task", taskIndex: 0 } });
    const second = harness.engine.computeSchedule({
      tasks: [validTask(), badWindow],
      profile: harnessProfile({ quietHours: null }),
    });
    expect(second).toEqual({ ok: false, error: { kind: "invalid-task", taskIndex: 1 } });
  });

  it("rejects duplicate task ids with the second task's index", () => {
    const harness = buildNotificationHarness();
    const result = harness.engine.computeSchedule({
      tasks: [validTask(), validTask()],
      profile: harnessProfile({ quietHours: null }),
    });
    expect(result).toEqual({ ok: false, error: { kind: "duplicate-task", taskIndex: 1 } });
  });

  it("rejects invalid preference profiles with a structural field pointer", () => {
    const harness = buildNotificationHarness();
    const degenerateQuietHours = harnessProfile({
      quietHours: quietHours({ startMinuteOfDay: 22 * 60, endMinuteOfDay: 22 * 60 }),
    });
    expect(
      harness.engine.computeSchedule({ tasks: [validTask()], profile: degenerateQuietHours }),
    ).toEqual({ ok: false, error: { kind: "invalid-preference", field: "quietHours" } });
    expect(
      harness.engine.computeSchedule({
        tasks: [validTask()],
        profile: harnessProfile({ channels: [] }),
      }),
    ).toEqual({ ok: false, error: { kind: "invalid-preference", field: "channels" } });
  });

  it("rejects profiles referencing unregistered channels with the channel index", () => {
    const harness = buildNotificationHarness();
    const result = harness.engine.computeSchedule({
      tasks: [validTask()],
      profile: harnessProfile({ quietHours: null, channels: ["inmem", "ghost"] }),
    });
    expect(result).toEqual({ ok: false, error: { kind: "unknown-channel", channelIndex: 1 } });
  });

  it("never mutates the caller's task snapshots", () => {
    const harness = buildNotificationHarness();
    const task = validTask();
    const snapshot = canonicalJsonStringify(task);
    harness.engine.computeSchedule({ tasks: [task], profile: harnessProfile({ quietHours: null }) });
    expect(canonicalJsonStringify(task)).toBe(snapshot);
  });
});
