import { describe, expect, it } from "vitest";
import * as notificationsBoundary from "./index.js";

describe("@orbb/notifications boundary package", () => {
  it("loads the engine module with real runtime behavior", () => {
    expect(notificationsBoundary).toBeDefined();
  });

  it("exports the B8 engine surface", () => {
    const surface = notificationsBoundary as Record<string, unknown>;
    for (const name of [
      "ReminderEngine",
      "InMemoryReminderDispatchLedger",
      "InMemoryChannel",
      "WebPushChannel",
      "EmailChannel",
      "SyntheticWebPushProvider",
      "SyntheticEmailProvider",
      "renderWebPushNotification",
      "renderEmailMessage",
      "deriveReminderIdentity",
      "deriveWindowKey",
      "deferForQuietHours",
      "localMinuteOfDay",
      "isInsideQuietHours",
      "validatePreferenceProfile",
      "validateChannelRegistry",
      "compareReminders",
      "cloneReminderPayload",
      "isRungCarriedByChannel",
      "channelRecipient",
      "utcDayOf",
    ]) {
      expect(typeof surface[name]).toBe("function");
    }
    for (const name of [
      "ESCALATION_RUNGS",
      "REMINDER_REASONS",
      "DISPATCH_STATUSES",
      "CHANNEL_FAILURE_REASON_KINDS",
    ]) {
      expect(Array.isArray(surface[name])).toBe(true);
    }
    for (const name of [
      "ALL_CHANNEL_CAPABILITIES",
      "DEFAULT_QUIET_HOURS",
      "DEFAULT_UPCOMING_LEAD_MS",
      "DEFAULT_ESCALATION_AFTER_MS",
    ]) {
      expect(surface[name]).toBeDefined();
    }
  });

  it("does NOT export the local test harness (testsupport stays internal)", () => {
    const surface = notificationsBoundary as Record<string, unknown>;
    expect(surface.buildReminderHarness).toBeUndefined();
    expect(surface.syntheticTask).toBeUndefined();
    expect(surface.syntheticProfile).toBeUndefined();
  });
});
