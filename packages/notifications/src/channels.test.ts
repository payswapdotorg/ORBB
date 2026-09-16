import { describe, expect, it } from "vitest";
import type { EngineResult } from "@orbb/measurement";
import type { ChannelDeliveryOutcome, ChannelSendRequest, NotificationChannel } from "./channels.js";
import { isRungCarriedByChannel, validateChannelRegistry } from "./channels.js";
import { InMemoryChannel } from "./inmemory-channel.js";
import type { DispatchRecord } from "./ledger.js";
import {
  EmailChannel,
  SyntheticEmailProvider,
  SyntheticWebPushProvider,
  WebPushChannel,
  renderEmailMessage,
  renderWebPushNotification,
} from "./synth-channels.js";
import {
  SYNTH_LABELS,
  SYNTH_METHOD_ORDER,
  buildReminderHarness,
  syntheticProfile,
  syntheticTask,
} from "./testsupport.js";

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

/** A channel that always returns a fixed outcome (test-defined double). */
function scriptedChannel(
  id: string,
  outcome: ChannelDeliveryOutcome,
): NotificationChannel {
  return {
    id,
    capabilities: { deliversReminders: true, deliversFallbackOffers: true },
    async send() {
      return outcome;
    },
  };
}

/** A channel that always throws (contract-violating double). */
function throwingChannel(id: string): NotificationChannel {
  return {
    id,
    capabilities: { deliversReminders: true, deliversFallbackOffers: true },
    async send() {
      throw new Error("scripted channel crash (SYNTH)");
    },
  };
}

// ---------------------------------------------------------------------------
// InMemoryChannel double.
// ---------------------------------------------------------------------------

describe("InMemoryChannel — the test/impl default double", () => {
  it("delivers and records every request verbatim (defensive copies)", async () => {
    const clock = { now: () => new Date(1_000) };
    const channel = new InMemoryChannel({ id: "in-memory", clock });
    const request: ChannelSendRequest = {
      reminderId: "rem_" + "a".repeat(43) as never,
      recipient: "SYNTH-recipient" as never,
      payload: {
        kind: "remind",
        taskId: "task_" + "b".repeat(43) as never,
        planId: "plan_" + "c".repeat(43) as never,
        metricId: "SYNTH-metric",
        windowSequence: 0,
        windowOpensAt: new Date(0),
        windowClosesAt: new Date(3_600_000),
        reason: "upcoming-due",
      },
      sendAt: new Date(500),
    };
    const outcome = await channel.send(request);
    expect(outcome).toEqual({ status: "delivered", deliveredAt: new Date(1_000) });
    expect(channel.sendCount).toBe(1);
    const sent = channel.sent[0];
    expect(sent?.request.reminderId).toBe(request.reminderId);
    // Defensive copy: mutating the recorded request does not corrupt the double.
    sent?.request.payload.windowOpensAt.setTime(99);
    expect((channel.sent[0]?.request.payload.windowOpensAt as Date).getTime()).toBe(0);
  });

  it("scripted failure returns a typed failed outcome", async () => {
    const channel = new InMemoryChannel({
      behavior: "fail",
      failureReason: { kind: "provider-rejected" },
    });
    const outcome = await channel.send({
      reminderId: "rem_" + "a".repeat(43) as never,
      recipient: "SYNTH-recipient" as never,
      payload: {
        kind: "remind",
        taskId: "task_" + "b".repeat(43) as never,
        planId: "plan_" + "c".repeat(43) as never,
        metricId: "SYNTH-metric",
        windowSequence: 0,
        windowOpensAt: new Date(0),
        windowClosesAt: new Date(3_600_000),
        reason: "upcoming-due",
      },
      sendAt: new Date(0),
    });
    expect(outcome).toEqual({ status: "failed", reason: { kind: "provider-rejected" } });
  });

  it("scripted throw is surfaced to the caller (the ENGINE fail-closes)", async () => {
    const channel = new InMemoryChannel({ behavior: "throw" });
    await expect(
      channel.send({
        reminderId: "rem_" + "a".repeat(43) as never,
        recipient: "SYNTH-recipient" as never,
        payload: {
          kind: "remind",
          taskId: "task_" + "b".repeat(43) as never,
          planId: "plan_" + "c".repeat(43) as never,
          metricId: "SYNTH-metric",
          windowSequence: 0,
          windowOpensAt: new Date(0),
          windowClosesAt: new Date(3_600_000),
          reason: "upcoming-due",
        },
        sendAt: new Date(0),
      }),
    ).rejects.toThrow(/scripted throw/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed dispatch proofs.
// ---------------------------------------------------------------------------

describe("B8 dispatch — fail-closed delivery model", () => {
  it("a channel that THROWS becomes a recorded channel-errored failure; the engine result stays ok", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const channels = [throwingChannel("crashy"), new InMemoryChannel({ id: "in-memory" })];
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["crashy", "in-memory"],
        recipients: { crashy: "SYNTH-recipient-crashy", "in-memory": "SYNTH-recipient-ok" },
      }),
      channels,
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched).toHaveLength(2);
    const statuses = outcome.dispatched.map((record) => record.status).sort();
    expect(statuses).toEqual(["delivered", "failed"]);
    const failed = outcome.dispatched.find((record) => record.status === "failed");
    expect(failed?.reason).toEqual({ kind: "channel-errored" });
    expect(failed?.channelId).toBe("crashy");
    // The healthy channel was unaffected by the crashy one.
    const ledgerList = await harness.ledger.list();
    expect(ledgerList).toHaveLength(2);
  });

  it("an undeliverable channel outcome is recorded verbatim with its reason", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        recipients: { expired: "SYNTH-recipient-expired" },
        enabledChannelIds: ["expired"],
      }),
      channels: [
        scriptedChannel("expired", {
          status: "undeliverable",
          reason: { kind: "recipient-expired" },
        }),
      ],
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched).toHaveLength(1);
    expect(outcome.dispatched[0]).toMatchObject({
      status: "undeliverable",
      reason: { kind: "recipient-expired" },
    });
  });

  it("an enabled channel WITHOUT a recipient reference is recorded undeliverable, never silently dropped", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["in-memory"],
        recipients: {},
      }),
      channels: [channel],
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched).toHaveLength(1);
    expect(outcome.dispatched[0]).toMatchObject({
      status: "undeliverable",
      reason: { kind: "no-recipient" },
    });
    expect(channel.sendCount).toBe(0);
  });

  it("a channel returning failed records the provider's typed reason", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["flaky"],
        recipients: { flaky: "SYNTH-recipient-flaky" },
      }),
      channels: [
        scriptedChannel("flaky", { status: "failed", reason: { kind: "provider-error" } }),
      ],
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched[0]).toMatchObject({
      status: "failed",
      reason: { kind: "provider-error" },
    });
    // Failed dispatches are LEDGER-RECORDED — a retry on a later UTC day
    // is a new identity, and this failure stays auditable.
    const ledgerList = await harness.ledger.list();
    expect(ledgerList).toHaveLength(1);
    expect((ledgerList[0] as DispatchRecord).status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Capability gating.
// ---------------------------------------------------------------------------

describe("B8 dispatch — capability-gated channels are skipped with accounted reasons", () => {
  it("a channel that cannot carry fallback offers is skipped for the offer rung only", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 3, 12, 0, 0) }); // post-escalation
    const minimal = new InMemoryChannel({
      id: "minimal",
      capabilities: { deliversReminders: true, deliversFallbackOffers: false },
    });
    const rich = new InMemoryChannel({ id: "rich" });
    const result = await harness.engine.computeSchedule({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["minimal", "rich"],
        recipients: { minimal: "SYNTH-recipient-minimal", rich: "SYNTH-recipient-rich" },
      }),
      channels: [minimal, rich],
    });
    const outcome = expectOk(result);
    expect(outcome.reminders.map((reminder) => reminder.channelId)).toEqual(["rich"]);
    expect(outcome.skippedChannels).toEqual([
      {
        taskId: outcome.reminders[0]?.taskId,
        channelId: "minimal",
        rung: "REMIND_WITH_FALLBACK_OFFER",
        reason: { kind: "channel-not-capable" },
      },
    ]);
  });

  it("a channel that cannot carry reminders at all is skipped for the REMIND rung", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const passive = new InMemoryChannel({
      id: "passive",
      capabilities: { deliversReminders: false, deliversFallbackOffers: false },
    });
    const result = await harness.engine.computeSchedule({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["passive"],
        recipients: { passive: "SYNTH-recipient-passive" },
      }),
      channels: [passive],
    });
    const outcome = expectOk(result);
    expect(outcome.reminders).toHaveLength(0);
    expect(outcome.skippedChannels).toEqual([
      {
        taskId: expect.any(String) as unknown as string,
        channelId: "passive",
        rung: "REMIND",
        reason: { kind: "channel-not-capable" },
      },
    ]);
  });

  it("isRungCarriedByChannel maps rungs to capability flags; registry validation is structural", () => {
    expect(
      isRungCarriedByChannel("REMIND", { deliversReminders: true, deliversFallbackOffers: false }),
    ).toBe(true);
    expect(
      isRungCarriedByChannel("REMIND_WITH_FALLBACK_OFFER", {
        deliversReminders: true,
        deliversFallbackOffers: false,
      }),
    ).toBe(false);
    expect(validateChannelRegistry([])).toBeUndefined();
    expect(
      validateChannelRegistry([
        {
          id: "",
          capabilities: { deliversReminders: true, deliversFallbackOffers: true },
          send: async () => ({ status: "delivered", deliveredAt: new Date(0) }),
        },
      ]),
    ).toEqual({ kind: "invalid-channel", channelIndex: 0 });
    expect(
      validateChannelRegistry([
        new InMemoryChannel({ id: "same" }),
        new InMemoryChannel({ id: "same" }),
      ]),
    ).toEqual({ kind: "duplicate-channel-id", channelIndex: 1 });
  });
});

// ---------------------------------------------------------------------------
// Seam-only SYNTH provider doubles (web push, email).
// ---------------------------------------------------------------------------

describe("WebPushChannel — seam double over the provider port", () => {
  function harnessAt(epochMs: number) {
    const harness = buildReminderHarness({ epochMs });
    const provider = new SyntheticWebPushProvider();
    const channel = new WebPushChannel({ provider });
    return { harness, provider, channel };
  }

  it("delivers through the provider port and records the notification shape", async () => {
    const { harness, provider, channel } = harnessAt(Date.UTC(2024, 0, 2, 10, 30, 0));
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["web-push"],
        recipients: { "web-push": "SYNTH-subscription-ref" },
      }),
      channels: [channel],
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched[0]?.status).toBe("delivered");
    expect(provider.deliveryCount).toBe(1);
    const delivery = provider.deliveries[0];
    expect(delivery?.subscriptionRef).toBe("SYNTH-subscription-ref");
    expect(delivery?.notification.title).toBe("Measurement reminder");
    expect(delivery?.notification.tag).toBe(outcome.dispatched[0]?.reminderId);
    expect(delivery?.notification.data.kind).toBe("remind");
  });

  it("renders deterministic PHID-safe notifications (same request => same output)", () => {
    const request: ChannelSendRequest = {
      reminderId: "rem_" + "a".repeat(43) as never,
      recipient: "SYNTH-subscription-ref" as never,
      payload: {
        kind: "remind",
        taskId: "task_" + "b".repeat(43) as never,
        planId: "plan_" + "c".repeat(43) as never,
        metricId: "SYNTH-metric-heart-rate",
        windowSequence: 3,
        windowOpensAt: new Date(0),
        windowClosesAt: new Date(3_600_000),
        reason: "missed-window",
      },
      sendAt: new Date(0),
    };
    expect(renderWebPushNotification(request)).toEqual(renderWebPushNotification(request));
  });

  it("a failing provider surfaces a typed failed outcome; a throwing provider is fail-closed by the engine", async () => {
    const failing = new WebPushChannel({
      provider: new SyntheticWebPushProvider({ behavior: "fail", failureReason: { kind: "provider-error" } }),
    });
    const throwing = new WebPushChannel({
      provider: new SyntheticWebPushProvider({ behavior: "throw" }),
    });
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["web-push"],
        recipients: { "web-push": "SYNTH-subscription-ref" },
      }),
      channels: [failing],
    });
    expect(expectOk(result).dispatched[0]).toMatchObject({
      status: "failed",
      reason: { kind: "provider-error" },
    });

    const harnessTwo = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const resultTwo = await harnessTwo.engine.dispatchDue({
      tasks: [syntheticTask(harnessTwo.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["web-push"],
        recipients: { "web-push": "SYNTH-subscription-ref" },
      }),
      channels: [throwing],
    });
    expect(expectOk(resultTwo).dispatched[0]).toMatchObject({
      status: "failed",
      reason: { kind: "channel-errored" },
    });
  });
});

describe("EmailChannel — seam double over the provider port", () => {
  it("delivers a deterministic message over ids/labels; provider failures are typed", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 3, 12, 0, 0) });
    const provider = new SyntheticEmailProvider();
    const channel = new EmailChannel({ provider });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["email"],
        recipients: { email: "SYNTH-address-ref" },
      }),
      channels: [channel],
      labels: {
        metricLabels: { "SYNTH-metric-heart-rate": SYNTH_LABELS.metric },
        methodLabels: {
          "SYNTH-method-wearable": SYNTH_LABELS.methodWearable,
          "SYNTH-method-app": SYNTH_LABELS.methodApp,
          "SYNTH-method-manual": SYNTH_LABELS.methodManual,
        },
      },
    });
    const outcome = expectOk(result);
    expect(outcome.dispatched[0]?.status).toBe("delivered");
    const message = provider.deliveries[0]?.message;
    expect(message?.subject).toBe("Measurement reminder");
    expect(message?.bodyText).toContain(`Metric: ${SYNTH_LABELS.metric}`);
    expect(message?.bodyText).toContain(
      `Preferred capture path: ${SYNTH_LABELS.methodWearable}`,
    );
    expect(message?.bodyText).toContain(
      `Alternative capture paths offered: ${SYNTH_LABELS.methodApp}, ${SYNTH_LABELS.methodManual}`,
    );
    expect(message?.data.kind).toBe("remind-with-fallback-offer");
    expect(provider.deliveries[0]?.addressRef).toBe("SYNTH-address-ref");

    // Deterministic rendering.
    const request: ChannelSendRequest = {
      reminderId: "rem_" + "a".repeat(43) as never,
      recipient: "SYNTH-address-ref" as never,
      payload: {
        kind: "remind",
        taskId: "task_" + "b".repeat(43) as never,
        planId: "plan_" + "c".repeat(43) as never,
        metricId: "SYNTH-metric-heart-rate",
        windowSequence: 0,
        windowOpensAt: new Date(0),
        windowClosesAt: new Date(3_600_000),
        reason: "upcoming-due",
      },
      sendAt: new Date(0),
    };
    expect(renderEmailMessage(request)).toEqual(renderEmailMessage(request));
    expect(renderEmailMessage(request).bodyText).not.toContain(SYNTH_METHOD_ORDER[1]);
  });

  it("an undeliverable email provider report is recorded verbatim", async () => {
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 2, 10, 30, 0) });
    const channel = new EmailChannel({
      provider: new SyntheticEmailProvider({
        behavior: "fail",
        failureReason: { kind: "provider-rejected" },
      }),
    });
    const result = await harness.engine.dispatchDue({
      tasks: [syntheticTask(harness.ids)],
      profile: syntheticProfile({
        quietHours: QUIET_OFF,
        enabledChannelIds: ["email"],
        recipients: { email: "SYNTH-address-ref" },
      }),
      channels: [channel],
    });
    expect(expectOk(result).dispatched[0]).toMatchObject({
      status: "failed",
      reason: { kind: "provider-rejected" },
    });
  });
});
