import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  FULL_CHANNEL_CAPABILITIES,
  InMemoryChannel,
  InMemoryChannelRegistry,
  InMemoryRecipientEndpointDirectory,
  RUNG_CAPABILITY_REQUIREMENTS,
  SyntheticEmailChannel,
  SyntheticWebPushChannel,
  type OutboundDelivery,
} from "./channels.js";
import { ReminderEngine } from "./engine.js";
import { InMemorySendAttemptLedger } from "./ledger.js";
import { InMemoryReminderLabelDirectory } from "./labels.js";
import { InMemoryRecipientDirectory } from "./recipients.js";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  buildNotificationHarness,
  harnessProfile,
  syntheticTask,
} from "./testsupport.js";

/** Computes one real reminder via the default harness and returns its delivery request. */
async function oneDelivery(): Promise<OutboundDelivery> {
  const harness = buildNotificationHarness({ epochMs: MS_PER_DAY + 70 * 60_000 });
  const task = syntheticTask({
    window: {
      sequence: 0,
      startsAt: new Date(MS_PER_DAY),
      endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
    },
  });
  const schedule = harness.engine.computeSchedule({
    tasks: [task],
    profile: harnessProfile({ quietHours: null }),
  });
  if (!schedule.ok) {
    throw new Error("expected scheduling to succeed");
  }
  const reminder = schedule.value.reminders[0];
  if (reminder === undefined) {
    throw new Error("expected one reminder");
  }
  return {
    reminderId: reminder.id,
    recipientRef: "SYNTH-recipient-00000001",
    channel: "inmem",
    payload: reminder.payload,
  };
}

describe("B8 channels — the InMemoryChannel double (test/impl default)", () => {
  it("records every delivery and result in order with a deterministic SYNTH receipt", async () => {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const channel = new InMemoryChannel({ id: "inmem", clock });
    const delivery = await oneDelivery();
    const first = await channel.send(delivery);
    expect(first.status).toBe("sent");
    if (first.status !== "sent") {
      throw new Error("unreachable");
    }
    expect(first.deliveredAt.getTime()).toBe(1_000);
    expect(first.providerReceipt).toBeDefined();
    expect(first.providerReceipt?.startsWith("SYNTH-inmem-provider-v1-")).toBe(true);
    clock.advance(5_000);
    await channel.send(delivery);
    expect(channel.recorded).toHaveLength(2);
    // Deterministic receipt: same delivery => same receipt, always.
    expect(channel.recorded[1]?.result.status).toBe("sent");
    if (channel.recorded[1] && channel.recorded[1].result.status === "sent") {
      expect(channel.recorded[1].result.providerReceipt).toBe(first.providerReceipt);
    }
    // The recorded entries are defensive copies: mutating a returned
    // snapshot cannot corrupt the channel's log.
    const snapshot = [...channel.recorded];
    expect(snapshot).toHaveLength(2);
    snapshot.pop();
    expect(channel.recorded).toHaveLength(2);
  });

  it("surfaces the fault-injection contract: throw mode rejects (the engine converts)", async () => {
    const clock = new DeterministicClock();
    const channel = new InMemoryChannel({ id: "bad", clock, fault: { mode: "throw" } });
    const delivery = await oneDelivery();
    await expect(channel.send(delivery)).rejects.toThrow(
      "SYNTH in-memory channel transport failure (fault injection)",
    );
    expect(channel.recorded).toHaveLength(0);
  });

  it("surfaces the fault-injection contract: undeliverable mode returns the typed reason", async () => {
    const clock = new DeterministicClock();
    const channel = new InMemoryChannel({
      id: "rejecting",
      clock,
      fault: { mode: "undeliverable", reason: { kind: "payload-rejected" } },
    });
    const delivery = await oneDelivery();
    const result = await channel.send(delivery);
    expect(result).toEqual({ status: "undeliverable", reason: { kind: "payload-rejected" } });
    expect(channel.recorded).toHaveLength(1);
  });

  it("honors injected restricted capabilities", () => {
    const clock = new DeterministicClock();
    const channel = new InMemoryChannel({
      id: "basic",
      clock,
      capabilities: { canRemind: true, canCarryFallbackOffer: false },
    });
    expect(channel.capabilities).toEqual({ canRemind: true, canCarryFallbackOffer: false });
    expect(FULL_CHANNEL_CAPABILITIES).toEqual({ canRemind: true, canCarryFallbackOffer: true });
  });
});

describe("B8 channels — the channel registry", () => {
  it("resolves by id, lists in registration order, and rejects duplicate ids", () => {
    const clock = new DeterministicClock();
    const a = new InMemoryChannel({ id: "alpha", clock });
    const b = new InMemoryChannel({ id: "beta", clock });
    const registry = new InMemoryChannelRegistry([a, b]);
    expect(registry.resolve("alpha")).toBe(a);
    expect(registry.resolve("beta")).toBe(b);
    expect(registry.resolve("ghost")).toBeUndefined();
    expect(registry.list()).toEqual([a, b]);
    expect(() => new InMemoryChannelRegistry([a, a])).toThrow(/duplicate channel id/);
  });

  it("freezes the rung capability requirements table", () => {
    expect(RUNG_CAPABILITY_REQUIREMENTS.REMIND).toEqual(["canRemind"]);
    expect(RUNG_CAPABILITY_REQUIREMENTS.REMIND_WITH_FALLBACK_OFFER).toEqual([
      "canRemind",
      "canCarryFallbackOffer",
    ]);
  });
});

describe("B8 channels — SYNTH web-push/email provider doubles (seam-only)", () => {
  it("delivers to an active endpoint with a deterministic SYNTH receipt", async () => {
    const clock = new DeterministicClock({ epochMs: 2_000 });
    const endpoints = new InMemoryRecipientEndpointDirectory();
    endpoints.register("SYNTH-recipient-00000001", {
      token: "SYNTH-webpush-endpoint-0001",
      status: "active",
    });
    const channel = new SyntheticWebPushChannel({ clock, endpoints });
    const delivery = await oneDelivery();
    const result = await channel.send(delivery);
    expect(result.status).toBe("sent");
    if (result.status !== "sent") {
      throw new Error("unreachable");
    }
    expect(result.deliveredAt.getTime()).toBe(2_000);
    expect(result.providerReceipt?.startsWith("SYNTH-webpush-provider-v1-")).toBe(true);
    // Deterministic: the same delivery replays the same receipt.
    const again = await channel.send(delivery);
    if (again.status !== "sent") {
      throw new Error("unreachable");
    }
    expect(again.providerReceipt).toBe(result.providerReceipt);
  });

  it("fails closed with unknown-recipient-endpoint when the directory misses", async () => {
    const clock = new DeterministicClock();
    const endpoints = new InMemoryRecipientEndpointDirectory();
    const webpush = new SyntheticWebPushChannel({ clock, endpoints });
    const email = new SyntheticEmailChannel({ clock, endpoints });
    const delivery = await oneDelivery();
    expect(await webpush.send(delivery)).toEqual({
      status: "undeliverable",
      reason: { kind: "unknown-recipient-endpoint" },
    });
    expect(await email.send(delivery)).toEqual({
      status: "undeliverable",
      reason: { kind: "unknown-recipient-endpoint" },
    });
  });

  it("fails closed with recipient-endpoint-expired (the real web-push 410-Gone semantics)", async () => {
    const clock = new DeterministicClock();
    const endpoints = new InMemoryRecipientEndpointDirectory();
    endpoints.register("SYNTH-recipient-00000001", {
      token: "SYNTH-webpush-endpoint-0001",
      status: "expired",
    });
    const webpush = new SyntheticWebPushChannel({ clock, endpoints });
    const email = new SyntheticEmailChannel({ clock, endpoints });
    const delivery = await oneDelivery();
    expect(await webpush.send(delivery)).toEqual({
      status: "undeliverable",
      reason: { kind: "recipient-endpoint-expired" },
    });
    expect(await email.send(delivery)).toEqual({
      status: "undeliverable",
      reason: { kind: "recipient-endpoint-expired" },
    });
  });

  it("issues email receipts through the email provider identity", async () => {
    const clock = new DeterministicClock();
    const endpoints = new InMemoryRecipientEndpointDirectory();
    endpoints.register("SYNTH-recipient-00000001", {
      token: "SYNTH-email-endpoint-0001",
      status: "active",
    });
    const email = new SyntheticEmailChannel({ clock, endpoints });
    const delivery = await oneDelivery();
    const result = await email.send(delivery);
    expect(result.status).toBe("sent");
    if (result.status !== "sent") {
      throw new Error("unreachable");
    }
    expect(result.providerReceipt?.startsWith("SYNTH-email-provider-v1-")).toBe(true);
  });
});

describe("B8 channels — engine wiring over the SYNTH doubles end-to-end", () => {
  it("delivers a due reminder through webpush-synth and email-synth with recorded receipts", async () => {
    const harness = buildNotificationHarness({ epochMs: MS_PER_DAY + 70 * 60_000 });
    const task = syntheticTask({
      window: {
        sequence: 0,
        startsAt: new Date(MS_PER_DAY),
        endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
      },
    });
    const result = await harness.engine.dispatchPending({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["webpush-synth", "email-synth"] }),
    });
    if (!result.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(result.value.dispatched.map((attempt) => attempt.outcome.status)).toEqual([
      "sent",
      "sent",
    ]);
    for (const attempt of result.value.dispatched) {
      if (attempt.outcome.status !== "sent") {
        throw new Error("unreachable");
      }
      expect(attempt.outcome.providerReceipt).toBeDefined();
    }
  });

  it("works over an empty recipient directory fail-closed (the engine records, never crashes)", async () => {
    const clock = new DeterministicClock({ epochMs: MS_PER_DAY + 70 * 60_000 });
    const endpoints = new InMemoryRecipientEndpointDirectory();
    const engine = new ReminderEngine({
      clock,
      ids: new DeterministicIdFactory({ seed: "e2e" }),
      channels: new InMemoryChannelRegistry([
        new SyntheticWebPushChannel({ clock, endpoints }),
      ]),
      ledger: new InMemorySendAttemptLedger(),
      recipients: new InMemoryRecipientDirectory(),
      labels: new InMemoryReminderLabelDirectory({}),
    });
    const task = syntheticTask({
      window: {
        sequence: 0,
        startsAt: new Date(MS_PER_DAY),
        endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
      },
    });
    const result = await engine.dispatchPending({
      tasks: [task],
      profile: harnessProfile({ quietHours: null, channels: ["webpush-synth"] }),
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
