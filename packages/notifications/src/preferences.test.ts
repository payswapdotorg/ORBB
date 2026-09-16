import { describe, expect, it } from "vitest";
import { parsePersonId, type PersonId } from "@orbb/domain";
import {
  DEFAULT_ESCALATION_AFTER_MS,
  DEFAULT_QUIET_HOURS,
  DEFAULT_UPCOMING_LEAD_MS,
  channelRecipient,
  resolveEscalationAfterMs,
  resolveQuietHours,
  resolveUpcomingLeadMs,
  validatePreferenceProfile,
  type ReminderPreferenceProfile,
} from "./preferences.js";
import { SYNTH_BODY, syntheticProfile } from "./testsupport.js";

function profileWith(patch: (profile: ReminderPreferenceProfile) => Record<string, unknown>): unknown {
  const base = syntheticProfile();
  return { ...base, ...patch(base) };
}

describe("ReminderPreferenceProfile — defaults", () => {
  it("omitted quiet hours resolve to the recorded 22:00–07:00 default", () => {
    expect(resolveQuietHours(syntheticProfile())).toEqual(DEFAULT_QUIET_HOURS);
    expect(DEFAULT_QUIET_HOURS).toEqual({
      enabled: true,
      startMinuteOfDayLocal: 22 * 60,
      endMinuteOfDayLocal: 7 * 60,
    });
  });

  it("omitted timing knobs resolve to the recorded defaults (1h lead, 24h escalation)", () => {
    expect(resolveUpcomingLeadMs(syntheticProfile())).toBe(DEFAULT_UPCOMING_LEAD_MS);
    expect(resolveEscalationAfterMs(syntheticProfile())).toBe(DEFAULT_ESCALATION_AFTER_MS);
  });

  it("explicit values win over defaults", () => {
    const profile = syntheticProfile({
      quietHours: { enabled: true, startMinuteOfDayLocal: 600, endMinuteOfDayLocal: 700 },
      upcomingLeadMs: 120_000,
      escalationAfterMs: 0,
    });
    expect(resolveQuietHours(profile).startMinuteOfDayLocal).toBe(600);
    expect(resolveUpcomingLeadMs(profile)).toBe(120_000);
    expect(resolveEscalationAfterMs(profile)).toBe(0);
  });
});

describe("ReminderPreferenceProfile — structural validation (typed, PHID-safe)", () => {
  it("accepts the synthetic profile", () => {
    expect(validatePreferenceProfile(syntheticProfile())).toBeUndefined();
  });

  it.each([
    {
      name: "person id must be canonical",
      profile: { ...syntheticProfile(), personId: "not-a-person-id" as unknown as PersonId },
      field: "personId",
    },
    {
      name: "master gate must be boolean",
      profile: profileWith(() => ({ remindersEnabled: "yes" })),
      field: "remindersEnabled",
    },
    {
      name: "enabled channels must be an array",
      profile: profileWith(() => ({ enabledChannelIds: "in-memory" })),
      field: "enabledChannelIds",
    },
    {
      name: "enabled channel ids must be non-empty",
      profile: profileWith(() => ({ enabledChannelIds: ["in-memory", ""] })),
      field: "enabledChannelIds",
    },
    {
      name: "enabled channel ids must be unique",
      profile: profileWith(() => ({ enabledChannelIds: ["in-memory", "in-memory"] })),
      field: "enabledChannelIds",
    },
    {
      name: "recipients must be a record",
      profile: profileWith(() => ({ channelRecipients: [] })),
      field: "channelRecipients",
    },
    {
      name: "recipient references must be non-empty strings",
      profile: profileWith(() => ({ channelRecipients: { "in-memory": "" } })),
      field: "channelRecipients",
    },
    {
      name: "UTC offset must be an integer in [-720, 840]",
      profile: profileWith(() => ({ localUtcOffsetMinutes: 841 })),
      field: "localUtcOffsetMinutes",
    },
    {
      name: "UTC offset rejects non-integers",
      profile: profileWith(() => ({ localUtcOffsetMinutes: 5.5 })),
      field: "localUtcOffsetMinutes",
    },
    {
      name: "quiet hours must not be degenerate (start === end)",
      profile: profileWith(() => ({
        quietHours: { enabled: true, startMinuteOfDayLocal: 600, endMinuteOfDayLocal: 600 },
      })),
      field: "quietHours",
    },
    {
      name: "quiet hours minutes must be in [0, 1439]",
      profile: profileWith(() => ({
        quietHours: { enabled: true, startMinuteOfDayLocal: 1440, endMinuteOfDayLocal: 420 },
      })),
      field: "quietHours",
    },
    {
      name: "quiet hours need a boolean gate",
      profile: profileWith(() => ({
        quietHours: { enabled: 1, startMinuteOfDayLocal: 1320, endMinuteOfDayLocal: 420 },
      })),
      field: "quietHours",
    },
    {
      name: "upcoming lead must be a positive integer",
      profile: profileWith(() => ({ upcomingLeadMs: 0 })),
      field: "upcomingLeadMs",
    },
    {
      name: "escalation grace must be a non-negative integer",
      profile: profileWith(() => ({ escalationAfterMs: -1 })),
      field: "escalationAfterMs",
    },
  ])("rejects: $name", ({ profile, field }) => {
    expect(validatePreferenceProfile(profile)).toEqual({
      kind: "invalid-preference",
      field,
    });
  });

  it("rejects a non-object profile without echoing anything", () => {
    expect(validatePreferenceProfile(null)).toEqual({
      kind: "invalid-preference",
      field: "personId",
    });
    expect(validatePreferenceProfile("profile")).toEqual({
      kind: "invalid-preference",
      field: "personId",
    });
  });

  it("channelRecipient brands an opaque reference (routing metadata only)", () => {
    const recipient = channelRecipient("SYNTH-recipient-x");
    expect(recipient).toBe("SYNTH-recipient-x");
    expect(parsePersonId(`prsn_${SYNTH_BODY}`)).toBe(`prsn_${SYNTH_BODY}`);
  });
});
