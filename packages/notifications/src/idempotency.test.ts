import { describe, expect, it } from "vitest";
import {
  HOUR,
  MINUTE,
  buildNotificationHarness,
  synthPreferences,
  synthTask,
} from "./testsupport.js";
import { InMemoryChannel } from "./inmemory-channel.js";
import { InMemoryChannelRegistry } from "./channels.js";
import { ReminderEngine } from "./engine.js";
import { deriveReminderId } from "./identity.js";
import type { ReminderDispatchLedger } from "./ledger.js";
import type { QuietHoursSpec } from "./preferences.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

function noQuietHours(): QuietHoursSpec {
  return { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };
}

describe("B8 idempotency — recompute and re-dispatch add nothing", () => {
  it("dispatching twice at the same clock dispatches exactly once and records exactly once", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const input = {
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    };
    const first = await harness.engine.dispatchDue(input);
    if (!first.ok) {
      throw new Error("expected first dispatch to succeed");
    }
    expect(first.value.dispatched).toHaveLength(1);
    expect(harness.channel.sentCount).toBe(1);
    expect(harness.ledger.listAll()).toHaveLength(1);
    expect(harness.eventSink.getEvents()).toHaveLength(1);

    const second = await harness.engine.dispatchDue(input);
    if (!second.ok) {
      throw new Error("expected second dispatch to succeed");
    }
    expect(second.value.dispatched).toEqual([]);
    expect(second.value.failures).toEqual([]);
    expect(second.value.skipped).toHaveLength(1);
    expect(second.value.skipped[0]!.reason).toBe("already-dispatched");
    // The ledger and the channel are untouched by the re-dispatch.
    expect(harness.channel.sentCount).toBe(1);
    expect(harness.ledger.listAll()).toHaveLength(1);
    expect(harness.ledger.listAll()[0]!.attempts).toBe(1);
    expect(harness.eventSink.getEvents()).toHaveLength(1);
  });

  it("the schedule projection is pure: dispatching does not change what computeSchedule yields", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const input = {
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    };
    const before = harness.engine.computeSchedule(input);
    if (!before.ok) {
      throw new Error("expected computation to succeed");
    }
    await harness.engine.dispatchDue(input);
    const after = harness.engine.computeSchedule(input);
    if (!after.ok) {
      throw new Error("expected computation to succeed");
    }
    expect(after.value).toEqual(before.value);
  });
});

describe("B8 idempotency — quiet-hours deferral is defer-not-drop at dispatch time", () => {
  it("a deferred reminder stays pending until the edge, then dispatches exactly once", async () => {
    // Window ends 00:30 next day => nominal 23:30 => deferred to 07:00.
    const harness = buildNotificationHarness({ epochMs: NOON + 12 * HOUR });
    const task = synthTask({ endsAt: new Date(NOON + 12.5 * HOUR) });
    const input = {
      tasks: [task],
      preferences: synthPreferences(),
      channels: harness.registry,
    };

    // At 00:00 (inside quiet hours) the reminder is pending — NOT dropped.
    const early = await harness.engine.dispatchDue(input);
    if (!early.ok) {
      throw new Error("expected early dispatch to succeed");
    }
    expect(early.value.dispatched).toEqual([]);
    expect(early.value.pending).toHaveLength(1);
    expect(early.value.pending[0]!.sendAt.toISOString()).toBe("2026-06-11T07:00:00.000Z");
    expect(early.value.failures).toEqual([]);

    // At the 07:00 edge the deferred reminder dispatches.
    harness.clock.advanceTo(Date.UTC(2026, 5, 11, 7, 0, 0));
    const atEdge = await harness.engine.dispatchDue(input);
    if (!atEdge.ok) {
      throw new Error("expected edge dispatch to succeed");
    }
    expect(atEdge.value.dispatched).toHaveLength(1);
    expect(atEdge.value.dispatched[0]!.reminder.deferredByQuietHours).toBe(true);
    expect(atEdge.value.pending).toEqual([]);

    // And never again.
    harness.clock.advanceTo(Date.UTC(2026, 5, 11, 8, 0, 0));
    const later = await harness.engine.dispatchDue(input);
    if (!later.ok) {
      throw new Error("expected later dispatch to succeed");
    }
    expect(later.value.dispatched).toEqual([]);
    expect(later.value.skipped).toHaveLength(1);
    expect(later.value.skipped[0]!.reason).toBe("already-dispatched");
  });
});

describe("B8 idempotency — failed attempts are recorded, retryable, and capped", () => {
  it("a failed delivery records the attempt, blocks nothing, and succeeds on retry", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const input = {
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    };

    // First attempt: the provider rejects (classified, recorded, no event).
    harness.channel.setFailureMode({ kind: "fail", reason: "provider-rejected", detail: "SYNTH-reject" });
    const failed = await harness.engine.dispatchDue(input);
    if (!failed.ok) {
      throw new Error("expected failed dispatch to succeed");
    }
    expect(failed.value.dispatched).toEqual([]);
    expect(failed.value.failures).toHaveLength(1);
    expect(failed.value.failures[0]!.reason).toBe("provider-rejected");
    expect(failed.value.failures[0]!.detail).toBe("SYNTH-reject");
    const record = harness.ledger.listAll()[0]!;
    expect(record.status).toBe("failed");
    expect(record.attempts).toBe(1);
    expect(record.lastFailureReason).toBe("provider-rejected");
    expect(record.deliveredAt).toBeUndefined();
    expect(harness.eventSink.getEvents()).toHaveLength(0);

    // Second attempt (channel healthy, clock moved): dispatched, attempts 2.
    harness.channel.setFailureMode({ kind: "none" });
    harness.clock.advance(MINUTE);
    const retried = await harness.engine.dispatchDue(input);
    if (!retried.ok) {
      throw new Error("expected retry dispatch to succeed");
    }
    expect(retried.value.dispatched).toHaveLength(1);
    const recovered = harness.ledger.listAll()[0]!;
    expect(recovered.status).toBe("dispatched");
    expect(recovered.attempts).toBe(2);
    expect(recovered.deliveredAt).toBeDefined();
    expect(recovered.lastFailureReason).toBeUndefined();
    expect("lastFailureReason" in recovered).toBe(false);
    expect(harness.eventSink.getEvents()).toHaveLength(1);

    // Third attempt: already dispatched — nothing new recorded.
    harness.clock.advance(MINUTE);
    const again = await harness.engine.dispatchDue(input);
    if (!again.ok) {
      throw new Error("expected third dispatch to succeed");
    }
    expect(again.value.skipped[0]!.reason).toBe("already-dispatched");
    expect(harness.ledger.listAll()[0]!.attempts).toBe(2);
  });

  it("retries are capped: retries-exhausted skips further attempts (fail-closed, recorded)", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({
      epochMs: endsAtMs - 30 * MINUTE,
      maxDispatchAttempts: 2,
    });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const input = {
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    };

    harness.channel.setFailureMode({ kind: "fail", reason: "no-delivery-address" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await harness.engine.dispatchDue(input);
      if (!failed.ok) {
        throw new Error("expected failed dispatch to succeed");
      }
      expect(failed.value.failures).toHaveLength(1);
      harness.clock.advance(MINUTE);
    }
    expect(harness.ledger.listAll()[0]!.attempts).toBe(2);

    // The cap is reached: the reminder is now skipped with an accounted reason.
    const capped = await harness.engine.dispatchDue(input);
    if (!capped.ok) {
      throw new Error("expected capped dispatch to succeed");
    }
    expect(capped.value.dispatched).toEqual([]);
    expect(capped.value.failures).toEqual([]);
    expect(capped.value.skipped).toHaveLength(1);
    expect(capped.value.skipped[0]!.reason).toBe("retries-exhausted");
    // The ledger is frozen at the cap (no third attempt recorded).
    expect(harness.ledger.listAll()[0]!.attempts).toBe(2);
    expect(harness.ledger.listAll()[0]!.status).toBe("failed");
    expect(harness.eventSink.getEvents()).toHaveLength(0);
  });

  it("two channels produce two independent exactly-once dispatch records", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const extra = new InMemoryChannel({ id: "inapp-secondary", clock: harness.clock });
    const registry = new InMemoryChannelRegistry([harness.channel, extra]);
    const input = {
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: registry,
    };
    const first = await harness.engine.dispatchDue(input);
    if (!first.ok) {
      throw new Error("expected first dispatch to succeed");
    }
    expect(first.value.dispatched).toHaveLength(2);
    expect(harness.channel.sentCount).toBe(1);
    expect(extra.sentCount).toBe(1);

    const second = await harness.engine.dispatchDue(input);
    if (!second.ok) {
      throw new Error("expected second dispatch to succeed");
    }
    expect(second.value.dispatched).toEqual([]);
    expect(second.value.skipped.map((skip) => skip.reason)).toEqual([
      "already-dispatched",
      "already-dispatched",
    ]);
    // One ledger record per (reminder id) — the two channels' reminders are
    // independently recorded exactly once.
    expect(harness.ledger.listAll()).toHaveLength(2);
    const reminderIds = new Set(harness.ledger.listAll().map((record) => record.reminderId));
    expect(reminderIds.size).toBe(2);
    expect(harness.channel.sentCount).toBe(1);
    expect(extra.sentCount).toBe(1);
  });
});

describe("B8 idempotency — deterministic reminder identity", () => {
  it("identity is a pure function of (task, window, rung, channel, UTC day)", () => {
    const first = deriveReminderId({
      taskId: synthTask().id,
      windowSequence: 0,
      rung: "REMIND",
      channelId: "inapp-memory",
      utcDay: 20_000,
    });
    const second = deriveReminderId({
      taskId: synthTask().id,
      windowSequence: 0,
      rung: "REMIND",
      channelId: "inapp-memory",
      utcDay: 20_000,
    });
    expect(second).toBe(first);
    // Each identity component changes the id.
    expect(
      deriveReminderId({ taskId: synthTask().id, windowSequence: 1, rung: "REMIND", channelId: "inapp-memory", utcDay: 20_000 }),
    ).not.toBe(first);
    expect(
      deriveReminderId({ taskId: synthTask().id, windowSequence: 0, rung: "REMIND_WITH_FALLBACK_OFFER", channelId: "inapp-memory", utcDay: 20_000 }),
    ).not.toBe(first);
    expect(
      deriveReminderId({ taskId: synthTask().id, windowSequence: 0, rung: "REMIND", channelId: "email", utcDay: 20_000 }),
    ).not.toBe(first);
    expect(
      deriveReminderId({ taskId: synthTask().id, windowSequence: 0, rung: "REMIND", channelId: "inapp-memory", utcDay: 20_001 }),
    ).not.toBe(first);
  });
});

describe("B8 idempotency — ledger port failures surface as typed rejections", () => {
  it("a throwing findById rejects with ledger-failure (PHID-safe, retryable)", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const failingLedger: ReminderDispatchLedger = {
      findById: async () => {
        throw new Error("SYNTH ledger down");
      },
      recordAttempt: async () => {
        throw new Error("SYNTH ledger down");
      },
    };
    const engine = new ReminderEngine({
      clock: harness.clock,
      ids: harness.ids,
      ledger: failingLedger,
      events: harness.eventSink,
    });
    const result = await engine.dispatchDue({
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "ledger-failure" } });
  });

  it("a throwing recordAttempt rejects with ledger-failure after a channel delivery", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MINUTE });
    const failingLedger: ReminderDispatchLedger = {
      findById: async () => undefined,
      recordAttempt: async () => {
        throw new Error("SYNTH ledger write failure");
      },
    };
    const engine = new ReminderEngine({
      clock: harness.clock,
      ids: harness.ids,
      ledger: failingLedger,
      events: harness.eventSink,
    });
    const result = await engine.dispatchDue({
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "ledger-failure" } });
    // The channel DID send (the send happened before the ledger write) —
    // the typed rejection makes the at-least-once retry safe via the real
    // ledger's idempotency (documented handoff: transactional outbox).
    expect(harness.channel.sentCount).toBe(1);
    expect(harness.eventSink.getEvents()).toHaveLength(0);
  });
});
