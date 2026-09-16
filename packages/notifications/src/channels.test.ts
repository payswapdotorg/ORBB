import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import {
  HOUR,
  MINUTE,
  buildNotificationHarness,
  synthPreferences,
  synthTask,
  synthTaskId,
} from "./testsupport.js";
import {
  InMemoryChannel,
  type InMemorySentRecord,
} from "./inmemory-channel.js";
import {
  DELIVERY_FAILURE_REASONS,
  InMemoryChannelRegistry,
  isDeliveryFailureReason,
  isDeliveryResult,
  sendForRung,
  type ChannelSendRequest,
  type DeliveryResult,
  type NotificationChannel,
} from "./channels.js";
import { EmailChannel, type EmailAddressProvider } from "./email-channel.js";
import { WebPushChannel, type WebPushSubscriptionProvider } from "./webpush-channel.js";
import { deriveReminderId } from "./identity.js";
import { cloneReminderPayload, type ReminderPayload } from "./payloads.js";
import { NotificationEngineError } from "./errors.js";
import type { QuietHoursSpec } from "./preferences.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

function noQuietHours(): QuietHoursSpec {
  return { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };
}

function endsAtWindow(): Date {
  return new Date(NOON + 2 * HOUR);
}

/** A minimal REMIND payload for direct channel requests. */
function synthRequest(rungPayload: ReminderPayload): ChannelSendRequest {
  return {
    reminderId: deriveReminderId({
      taskId: synthTaskId(1),
      windowSequence: 0,
      rung: "REMIND",
      channelId: "test",
      utcDay: 20_000,
    }),
    personId: synthTask().personId,
    payload: rungPayload,
  };
}

function remindPayload(): ReminderPayload {
  return {
    kind: "REMIND",
    reason: "upcoming-due",
    taskId: synthTaskId(1),
    metricId: "metric-synth-heart-rate",
    windowSequence: 0,
    dueAt: new Date(NOON + 2 * HOUR),
  };
}

describe("B8 InMemoryChannel — the test/impl default double", () => {
  it("delivers with a deterministic SYNTH receipt and records the send", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new InMemoryChannel({ id: "inapp-test", clock: harness.clock });
    const delivery = await channel.sendReminder(synthRequest(remindPayload()));
    expect(delivery.status).toBe("delivered");
    if (delivery.status === "delivered") {
      expect(delivery.providerReceipt).toBe("synth:inapp-test:delivered");
      expect(delivery.deliveredAt.getTime()).toBe(NOON);
    }
    expect(channel.sentCount).toBe(1);
    const sent: InMemorySentRecord = channel.getSent()[0]!;
    expect(sent.rung).toBe("REMIND");
    expect(sent.payload.kind).toBe("REMIND");
    expect(sent.sentAt.getTime()).toBe(NOON);
  });

  it("getSent returns defensive copies (mutating a record cannot corrupt the double)", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new InMemoryChannel({ clock: harness.clock });
    await channel.sendReminder(synthRequest(remindPayload()));
    const record = channel.getSent()[0]!;
    record.payload.dueAt.setTime(0);
    record.sentAt.setTime(0);
    const fresh = channel.getSent()[0]!;
    expect(fresh.payload.dueAt.getTime()).toBe(NOON + 2 * HOUR);
    expect(fresh.sentAt.getTime()).toBe(NOON);
  });

  it("a programmed failure returns a classified undelivered result", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new InMemoryChannel({ clock: harness.clock });
    channel.setFailureMode({ kind: "fail", reason: "rate-limited", detail: "SYNTH-throttled" });
    const delivery = await channel.sendFallbackOffer(synthRequest(remindPayload()));
    expect(delivery).toEqual({
      status: "undelivered",
      reason: "rate-limited",
      detail: "SYNTH-throttled",
    });
    expect(channel.sentCount).toBe(1);
    expect(isDeliveryResult(delivery)).toBe(true);
  });

  it("sendForRung dispatches to the typed operation matching the rung", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new InMemoryChannel({ clock: harness.clock });
    await sendForRung(channel, "REMIND_WITH_FALLBACK_OFFER", synthRequest(remindPayload()));
    expect(channel.getSent()[0]!.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
  });
});

describe("B8 fail-closed delivery — a rogue channel can never crash the engine", () => {
  it("a channel that THROWS is converted into a recorded channel-error failure; the engine result stays ok", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON + 90 * MINUTE });
    harness.channel.setFailureMode({ kind: "throw" });
    const outcome = await harness.engine.dispatchDue({
      tasks: [synthTask({ endsAt: endsAtWindow() })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(outcome.value.dispatched).toEqual([]);
    expect(outcome.value.failures).toHaveLength(1);
    expect(outcome.value.failures[0]!.reason).toBe("channel-error");
    expect(outcome.value.failures[0]!.detail).toBe("channel-send-threw");
    const record = harness.ledger.listAll()[0]!;
    expect(record.status).toBe("failed");
    expect(record.lastFailureReason).toBe("channel-error");
    // No event for an undelivered reminder.
    expect(harness.eventSink.getEvents()).toHaveLength(0);
  });

  it("a channel returning a malformed result is converted into a recorded channel-error failure", async () => {
    class RogueResultChannel implements NotificationChannel {
      readonly id = "rogue-result";
      readonly kind = "inapp" as const;
      readonly capabilities = { supportsRemind: true, supportsFallbackOffer: true };
      async sendReminder(): Promise<DeliveryResult> {
        return {} as unknown as DeliveryResult;
      }
      async sendFallbackOffer(): Promise<DeliveryResult> {
        return null as unknown as DeliveryResult;
      }
    }
    const harness = buildNotificationHarness({
      epochMs: NOON + 90 * MINUTE,
      channels: [new RogueResultChannel()],
    });
    const outcome = await harness.engine.dispatchDue({
      tasks: [synthTask({ endsAt: endsAtWindow() })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(outcome.value.failures).toHaveLength(1);
    expect(outcome.value.failures[0]!.reason).toBe("channel-error");
    expect(outcome.value.failures[0]!.detail).toBe("channel-returned-invalid-result");
    expect(harness.ledger.listAll()[0]!.status).toBe("failed");
  });
});

describe("B8 capability gating — accounted skips, never silent", () => {
  it("a channel without the fallback-offer capability is skipped for the offer rung with an accounted reason", async () => {
    const endsAtMs = NOON + 2 * HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs });
    const remindersOnly = new InMemoryChannel({
      id: "reminders-only",
      clock: harness.clock,
      capabilities: { supportsRemind: true, supportsFallbackOffer: false },
    });
    const registry = new InMemoryChannelRegistry([remindersOnly]);
    const schedule = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: registry,
    });
    if (!schedule.ok) {
      throw new Error("expected computation to succeed");
    }
    expect(schedule.value.reminders).toEqual([]);
    expect(schedule.value.skipped).toHaveLength(1);
    const skip = schedule.value.skipped[0]!;
    expect(skip.reason).toBe("channel-lacks-capability");
    expect(skip.detail).toContain("REMIND_WITH_FALLBACK_OFFER");
    expect(skip.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(skip.channelId).toBe("reminders-only");
  });

  it("the same channel still receives the REMIND rung it does support", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const remindersOnly = new InMemoryChannel({
      id: "reminders-only",
      clock: harness.clock,
      capabilities: { supportsRemind: true, supportsFallbackOffer: false },
    });
    const registry = new InMemoryChannelRegistry([remindersOnly]);
    const schedule = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt: endsAtWindow() })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: registry,
    });
    if (!schedule.ok) {
      throw new Error("expected computation to succeed");
    }
    expect(schedule.value.skipped).toEqual([]);
    expect(schedule.value.reminders).toHaveLength(1);
    expect(schedule.value.reminders[0]!.channelId).toBe("reminders-only");
  });

  it("a channel disabled by preference is skipped with an accounted reason while others proceed", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const extra = new InMemoryChannel({ id: "inapp-secondary", clock: harness.clock });
    const registry = new InMemoryChannelRegistry([harness.channel, extra]);
    const schedule = harness.engine.computeSchedule({
      tasks: [synthTask({ endsAt: endsAtWindow() })],
      preferences: synthPreferences({
        quietHours: noQuietHours(),
        channelPreferences: [{ channelId: "inapp-memory", enabled: false }],
      }),
      channels: registry,
    });
    if (!schedule.ok) {
      throw new Error("expected computation to succeed");
    }
    expect(schedule.value.reminders).toHaveLength(1);
    expect(schedule.value.reminders[0]!.channelId).toBe("inapp-secondary");
    expect(schedule.value.skipped).toHaveLength(1);
    expect(schedule.value.skipped[0]!.reason).toBe("preference-disabled");
    expect(schedule.value.skipped[0]!.channelId).toBe("inapp-memory");
  });
});

describe("B8 WebPushChannel — seam-only SYNTH double", () => {
  const subscription: WebPushSubscriptionProvider = {
    resolveSubscription: async () => ({ endpointToken: "SYNTH-ENDPOINT-TOKEN-9f8e2c1a" }),
  };
  const noSubscription: WebPushSubscriptionProvider = {
    resolveSubscription: async () => undefined,
  };

  it("delivers through both typed operations with a deterministic SYNTH receipt", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new WebPushChannel({ subscriptionProvider: subscription, clock: harness.clock });
    for (const delivery of [
      await channel.sendReminder(synthRequest(remindPayload())),
      await channel.sendFallbackOffer(synthRequest(remindPayload())),
    ]) {
      expect(delivery.status).toBe("delivered");
      if (delivery.status === "delivered") {
        expect(delivery.providerReceipt).toBe("synth:webpush:delivered");
      }
    }
    expect(channel.kind).toBe("push");
    expect(channel.capabilities).toEqual({ supportsRemind: true, supportsFallbackOffer: true });
  });

  it("a subscription lookup miss is a typed no-delivery-address failure — never a throw", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new WebPushChannel({ subscriptionProvider: noSubscription, clock: harness.clock });
    const delivery = await channel.sendReminder(synthRequest(remindPayload()));
    expect(delivery).toEqual({
      status: "undelivered",
      reason: "no-delivery-address",
      detail: "synth-webpush-no-subscription",
    });
  });

  it("the endpoint token never leaves the provider plane (engine outputs stay token-free)", async () => {
    const epoch = NOON + 90 * MINUTE;
    const pushClock = new DeterministicClock({ epochMs: epoch });
    const harness = buildNotificationHarness({
      epochMs: epoch,
      channels: [new WebPushChannel({ subscriptionProvider: subscription, clock: pushClock })],
    });
    const outcome = await harness.engine.dispatchDue({
      tasks: [synthTask({ endsAt: endsAtWindow() })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    const dump = JSON.stringify(outcome.value) + JSON.stringify(harness.ledger.listAll());
    expect(dump).not.toContain("SYNTH-ENDPOINT-TOKEN-9f8e2c1a");
    expect(dump).toContain("synth:webpush:delivered");
  });
});

describe("B8 EmailChannel — seam-only SYNTH double", () => {
  const withAddress: EmailAddressProvider = {
    resolveAddress: async () => ({ addressToken: "synth.patient@example.org" }),
  };
  const withoutAddress: EmailAddressProvider = {
    resolveAddress: async () => undefined,
  };

  it("delivers through both typed operations with a deterministic SYNTH receipt", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new EmailChannel({ addressProvider: withAddress, clock: harness.clock });
    for (const delivery of [
      await channel.sendReminder(synthRequest(remindPayload())),
      await channel.sendFallbackOffer(synthRequest(remindPayload())),
    ]) {
      expect(delivery.status).toBe("delivered");
      if (delivery.status === "delivered") {
        expect(delivery.providerReceipt).toBe("synth:email:delivered");
      }
    }
    expect(channel.kind).toBe("email");
  });

  it("an address lookup miss is a typed no-delivery-address failure — never a throw", async () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const channel = new EmailChannel({ addressProvider: withoutAddress, clock: harness.clock });
    const delivery = await channel.sendFallbackOffer(synthRequest(remindPayload()));
    expect(delivery).toEqual({
      status: "undelivered",
      reason: "no-delivery-address",
      detail: "synth-email-no-address",
    });
  });
});

describe("B8 channel registry", () => {
  it("rejects duplicate channel ids and entries without ids", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const first = new InMemoryChannel({ id: "dup", clock: harness.clock });
    const second = new InMemoryChannel({ id: "dup", clock: harness.clock });
    expect(() => new InMemoryChannelRegistry([first, second])).toThrowError(NotificationEngineError);
    const nameless = new InMemoryChannel({ id: "", clock: harness.clock });
    expect(() => new InMemoryChannelRegistry([nameless])).toThrowError(NotificationEngineError);
  });

  it("preserves insertion order and resolves by id", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const first = new InMemoryChannel({ id: "alpha", clock: harness.clock });
    const second = new InMemoryChannel({ id: "beta", clock: harness.clock });
    const registry = new InMemoryChannelRegistry([first, second]);
    expect(registry.all().map((channel) => channel.id)).toEqual(["alpha", "beta"]);
    expect(registry.get("beta")).toBe(second);
    expect(registry.get("ghost")).toBeUndefined();
  });
});

describe("B8 delivery vocabulary guards", () => {
  it("classifies failure reasons and delivery results", () => {
    for (const reason of DELIVERY_FAILURE_REASONS) {
      expect(isDeliveryFailureReason(reason)).toBe(true);
    }
    expect(isDeliveryFailureReason("provider-exploded")).toBe(false);
    expect(isDeliveryFailureReason(undefined)).toBe(false);
    expect(
      isDeliveryResult({ status: "delivered", deliveredAt: new Date(0), providerReceipt: "synth:x" }),
    ).toBe(true);
    expect(isDeliveryResult({ status: "undelivered", reason: "rate-limited" })).toBe(true);
    expect(isDeliveryResult({ status: "undelivered", reason: "made-up" })).toBe(false);
    expect(isDeliveryResult({ status: "teleported" })).toBe(false);
    expect(isDeliveryResult(null)).toBe(false);
  });

  it("payload clones are deep (dates and arrays are fresh copies)", () => {
    const payload = remindPayload();
    const clone = cloneReminderPayload(payload);
    expect(clone).toEqual(payload);
    expect(clone.dueAt).not.toBe(payload.dueAt);
    expect(clone.dueAt.getTime()).toBe(payload.dueAt.getTime());
  });
});
