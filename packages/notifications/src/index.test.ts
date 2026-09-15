import { describe, expect, it } from "vitest";
import * as notifications from "./index.js";

/**
 * Public-surface assertion (the lane discipline of
 * `@orbb/measurement/src/index.test.ts`): the package exports exactly the
 * B8 contract surface — engine, vocabulary, ids, quiet hours, preferences,
 * labels, recipients, payload builder, channels, ledger, serialization —
 * and the test-support module is NOT part of the public surface.
 */
describe("@orbb/notifications public surface", () => {
  it("exports the engine and its doubles", () => {
    expect(typeof notifications.ReminderEngine).toBe("function");
    expect(typeof notifications.InMemoryChannel).toBe("function");
    expect(typeof notifications.InMemoryChannelRegistry).toBe("function");
    expect(typeof notifications.InMemorySendAttemptLedger).toBe("function");
    expect(typeof notifications.InMemoryRecipientDirectory).toBe("function");
    expect(typeof notifications.InMemoryRecipientEndpointDirectory).toBe("function");
    expect(typeof notifications.InMemoryReminderLabelDirectory).toBe("function");
    expect(typeof notifications.SyntheticWebPushChannel).toBe("function");
    expect(typeof notifications.SyntheticEmailChannel).toBe("function");
  });

  it("exports the vocabulary, ids, and pure helpers", () => {
    expect(notifications.REMINDER_RUNGS).toEqual(["REMIND", "REMIND_WITH_FALLBACK_OFFER"]);
    expect(notifications.REMINDER_ID_PREFIX).toBe("remd");
    expect(notifications.SEND_ATTEMPT_ID_PREFIX).toBe("snd");
    expect(typeof notifications.deriveReminderId).toBe("function");
    expect(typeof notifications.isReminderId).toBe("function");
    expect(typeof notifications.isReminderRung).toBe("function");
    expect(typeof notifications.buildReminderPayload).toBe("function");
    expect(typeof notifications.selectRung).toBe("function");
    expect(typeof notifications.baseFireInstant).toBe("function");
    expect(typeof notifications.comparePlannedReminders).toBe("function");
    expect(typeof notifications.isTaskSnapshotValid).toBe("function");
    expect(typeof notifications.deferToQuietEdge).toBe("function");
    expect(typeof notifications.isQuietInstant).toBe("function");
    expect(typeof notifications.localMinuteOfDay).toBe("function");
    expect(typeof notifications.normalizeReminderProfile).toBe("function");
    expect(typeof notifications.isReminderPreferenceProfile).toBe("function");
    expect(typeof notifications.serializeReminderSchedule).toBe("function");
    expect(typeof notifications.hashReminderSchedule).toBe("function");
    expect(typeof notifications.toScheduleAuditView).toBe("function");
    expect(typeof notifications.canonicalJsonStringify).toBe("function");
    expect(typeof notifications.ok).toBe("function");
    expect(typeof notifications.err).toBe("function");
  });

  it("exports the recorded defaults and the frozen capability requirements", () => {
    expect(notifications.DEFAULT_QUIET_HOURS).toEqual({
      enabled: true,
      startMinuteOfDay: 22 * 60,
      endMinuteOfDay: 7 * 60,
      utcOffsetMinutes: 0,
    });
    expect(notifications.DEFAULT_LEAD_TIME_MS).toBe(3_600_000);
    expect(notifications.DEFAULT_ESCALATION_GRACE_MS).toBe(3_600_000);
    expect(notifications.DEFAULT_REMINDER_PROFILE.remindersEnabled).toBe(true);
    expect(notifications.DEFAULT_METRIC_LABEL).toBe("A planned measurement");
    expect(notifications.DEFAULT_METHOD_LABEL).toBe("An alternative capture method");
    expect(notifications.RUNG_CAPABILITY_REQUIREMENTS.REMIND).toEqual(["canRemind"]);
    expect(notifications.RUNG_CAPABILITY_REQUIREMENTS.REMIND_WITH_FALLBACK_OFFER).toEqual([
      "canRemind",
      "canCarryFallbackOffer",
    ]);
    expect(notifications.FULL_CHANNEL_CAPABILITIES).toEqual({
      canRemind: true,
      canCarryFallbackOffer: true,
    });
  });

  it("exports the error taxonomy class", () => {
    const error = new notifications.NotificationEngineError(
      "invariant-violation",
      "SYNTH surface test",
    );
    expect(error.name).toBe("NotificationEngineError");
    expect(error.code).toBe("invariant-violation");
  });

  it("does NOT export the local test-support module", () => {
    expect("buildNotificationHarness" in (notifications as Record<string, unknown>)).toBe(false);
    expect("syntheticTask" in (notifications as Record<string, unknown>)).toBe(false);
  });
});
