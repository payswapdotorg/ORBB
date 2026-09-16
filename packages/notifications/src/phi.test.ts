/**
 * B8 — PHI proofs (the `@orbb/observability` not.toContain discipline).
 *
 * Every payload shape the engine can emit — the REMIND payload, the
 * REMIND_WITH_FALLBACK_OFFER payload, the canonical schedule, TASK_DUE
 * event payloads, ledger dispatch records, delivery results, and the full
 * dispatch outcome — is dumped to JSON and proven free of:
 *
 *   - the person id (payloads stay person-free; the ROUTING plane
 *     (`ChannelSendRequest`) and the frozen §11 envelope `subject` are the
 *     only person-carrying planes, checked separately),
 *   - the concept code (denied by the observability default redaction policy),
 *   - an observation VALUE (the marker contains a '.', which cannot occur
 *     inside base64url ids — any leak would be caught),
 *   - evidence content,
 *   - person-identifying free text,
 *   - the delivery addresses/tokens resolved by the provider doubles
 *     (the engine never sees them; providers resolve by person id).
 *
 * The input fixtures deliberately carry the canary markers on every plane
 * where a leak COULD originate (task snapshot: person id + concept code;
 * provider doubles: address tokens). Allowed content — task/metric/window
 * ids and human-safe vocabulary labels — is asserted positively.
 */
import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import { parsePersonId } from "@orbb/domain";
import { serializeReminderPayload, serializeReminderSchedule } from "./canonical.js";
import { MS_PER_HOUR, MS_PER_MINUTE } from "./quiet-hours.js";
import {
  buildNotificationHarness,
  synthPreferences,
  synthTask,
} from "./testsupport.js";
import { EmailChannel } from "./email-channel.js";
import { WebPushChannel } from "./webpush-channel.js";
import type { FallbackOfferReminderPayload, UpcomingDueReminderPayload } from "./payloads.js";
import type { InMemoryReminderEventSink } from "./events.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

/** The person whose data must never surface in payloads. */
const CANARY_PERSON_ID = parsePersonId("prsn_SYNTH-phi-canary-01");

/** Markers that must NEVER appear in any engine payload/output. */
const FORBIDDEN_MARKERS: readonly string[] = [
  CANARY_PERSON_ID,
  "SYNTH-8867-4", // concept code carried by the task snapshot
  "123.456", // an observation value shape ('.' cannot occur in base64url ids)
  "SYNTH-EVIDENCE-BLOB-9f8e2c1a", // evidence content
  "SYNTH-Person-Name", // person-identifying free text
  "synth.patient@example.org", // the email address resolved by the provider double
  "SYNTH-ENDPOINT-TOKEN-9f8e2c1a", // the web-push endpoint token
];

/** One JSON dump of one engine output shape. */
interface OutputDump {
  readonly label: string;
  readonly dump: string;
}

/** The full journey's outputs (both rungs, all three channels). */
interface JourneyOutputs {
  readonly dumps: readonly OutputDump[];
  readonly remindPayloadDump: string;
  readonly offerPayloadDump: string;
  readonly eventPayloadDump: string;
  readonly ledgerDump: string;
  readonly eventSink: InMemoryReminderEventSink;
}

async function runJourney(): Promise<JourneyOutputs> {
  const endsAtMs = NOON + 2 * MS_PER_HOUR;
  const epoch = endsAtMs - 30 * MS_PER_MINUTE;
  const providerClock = new DeterministicClock({ epochMs: epoch });
  const task = synthTask({
    personId: CANARY_PERSON_ID,
    endsAt: new Date(endsAtMs),
    metricId: "metric-synth-canary",
    methodOrder: ["method-synth-canary-preferred", "method-synth-canary-fallback"],
  });
  const email = new EmailChannel({
    addressProvider: {
      resolveAddress: async () => ({ addressToken: "synth.patient@example.org" }),
    },
    clock: providerClock,
  });
  const push = new WebPushChannel({
    subscriptionProvider: {
      resolveSubscription: async () => ({ endpointToken: "SYNTH-ENDPOINT-TOKEN-9f8e2c1a" }),
    },
    clock: providerClock,
  });
  const harness = buildNotificationHarness({ epochMs: epoch, extraChannels: [email, push] });
  const preferences = synthPreferences({
    personId: CANARY_PERSON_ID,
    quietHours: { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 },
  });
  const input = {
    tasks: [task],
    preferences,
    channels: harness.registry,
    labels: {
      metrics: { "metric-synth-canary": "Heart rate (synth)" },
      methods: { "method-synth-canary-fallback": "App capture (synth)" },
    },
  };

  const dumps: OutputDump[] = [];

  const upcoming = harness.engine.computeSchedule(input);
  if (!upcoming.ok) {
    throw new Error("expected upcoming computation to succeed");
  }
  dumps.push({
    label: "schedule (upcoming-due, canonical)",
    dump: serializeReminderSchedule(upcoming.value),
  });
  const remindPayloadDump = serializeReminderPayload(
    upcoming.value.reminders[0]!.payload as UpcomingDueReminderPayload,
  );
  dumps.push({ label: "REMIND payload (canonical)", dump: remindPayloadDump });

  const firstDispatch = await harness.engine.dispatchDue(input);
  if (!firstDispatch.ok) {
    throw new Error("expected first dispatch to succeed");
  }
  dumps.push({ label: "dispatch outcome (upcoming-due)", dump: JSON.stringify(firstDispatch.value) });
  dumps.push({
    label: "TASK_DUE event payloads (after upcoming-due)",
    dump: harness.eventSink.getEvents().map((emission) => emission.payload).join("\n"),
  });

  // Escalate: the window is missed, the fallback offer goes out.
  harness.clock.advanceTo(endsAtMs + 30 * MS_PER_MINUTE);
  providerClock.advanceTo(endsAtMs + 30 * MS_PER_MINUTE);
  const missed = harness.engine.computeSchedule(input);
  if (!missed.ok) {
    throw new Error("expected missed computation to succeed");
  }
  const offerPayloadDump = serializeReminderPayload(
    missed.value.reminders[0]!.payload as FallbackOfferReminderPayload,
  );
  dumps.push({
    label: "REMIND_WITH_FALLBACK_OFFER payload (canonical)",
    dump: offerPayloadDump,
  });
  const offerDispatch = await harness.engine.dispatchDue(input);
  if (!offerDispatch.ok) {
    throw new Error("expected offer dispatch to succeed");
  }
  dumps.push({ label: "dispatch outcome (fallback offer)", dump: JSON.stringify(offerDispatch.value) });
  const eventPayloadDump = harness.eventSink
    .getEvents()
    .map((emission) => emission.payload)
    .join("\n");
  dumps.push({
    label: "TASK_DUE event payloads (after fallback offer)",
    dump: eventPayloadDump,
  });
  const ledgerDump = JSON.stringify(harness.ledger.listAll());
  dumps.push({ label: "ledger records (after fallback offer)", dump: ledgerDump });
  dumps.push({
    label: "delivered results",
    dump: JSON.stringify(offerDispatch.value.dispatched.map((entry) => entry.delivery)),
  });

  return {
    dumps,
    remindPayloadDump,
    offerPayloadDump,
    eventPayloadDump,
    ledgerDump,
    eventSink: harness.eventSink,
  };
}

describe("B8 PHI discipline — not.toContain proofs over every payload shape", () => {
  it("no forbidden marker ever appears in any engine payload/output dump", async () => {
    const outputs = await runJourney();
    expect(outputs.dumps.length).toBeGreaterThanOrEqual(7);
    for (const { label, dump } of outputs.dumps) {
      for (const marker of FORBIDDEN_MARKERS) {
        expect(`${label}: ${dump}`).not.toContain(marker);
      }
    }
  });

  it("REMIND payloads carry exactly the allowed key set (structural minimization)", async () => {
    const outputs = await runJourney();
    const parsed = JSON.parse(outputs.remindPayloadDump) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "dueAt",
      "kind",
      "metricId",
      "metricLabel",
      "reason",
      "taskId",
      "windowSequence",
    ]);
    expect(parsed.personId).toBeUndefined();
    expect(parsed.conceptCode).toBeUndefined();
    expect(parsed.value).toBeUndefined();
    expect(parsed.evidence).toBeUndefined();
  });

  it("REMIND_WITH_FALLBACK_OFFER payloads carry exactly the allowed key set", async () => {
    const outputs = await runJourney();
    const parsed = JSON.parse(outputs.offerPayloadDump) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "dueAt",
      "fallbackMethods",
      "kind",
      "metricId",
      "metricLabel",
      "preferredMethodId",
      "reason",
      "taskId",
      "windowSequence",
    ]);
    // The fallback vocabulary is ids + labels only.
    expect(parsed.fallbackMethods).toEqual([
      { methodId: "method-synth-canary-fallback", label: "App capture (synth)" },
    ]);
  });

  it("TASK_DUE event payloads are person-free and concept-free", async () => {
    const outputs = await runJourney();
    const parsed = JSON.parse(
      `[${outputs.eventPayloadDump.split("\n").join(",")}]`,
    ) as Record<string, unknown>[];
    expect(parsed.length).toBeGreaterThan(0);
    for (const payload of parsed) {
      expect(Object.keys(payload).sort()).toEqual(["channelId", "reminder", "reminderId"]);
      expect(payload.personId).toBeUndefined();
      const reminder = payload.reminder as Record<string, unknown>;
      expect(reminder.conceptCode).toBeUndefined();
      expect(reminder.personId).toBeUndefined();
    }
  });

  it("the §11 envelope carries the subject; the event payload does not (plane separation)", async () => {
    const outputs = await runJourney();
    const emissions = outputs.eventSink.getEvents();
    expect(emissions.length).toBeGreaterThan(0);
    for (const emission of emissions) {
      // The frozen envelope field (opaque pseudonymous id, mandated by §11):
      expect(emission.event.subject).toBe(CANARY_PERSON_ID);
      // The payload plane stays person-free:
      expect(emission.payload).not.toContain(CANARY_PERSON_ID);
      expect(emission.payload).not.toContain("SYNTH-8867-4");
    }
  });

  it("ledger dispatch records carry exactly the allowed key set", async () => {
    const outputs = await runJourney();
    const parsed = JSON.parse(outputs.ledgerDump) as Record<string, unknown>[];
    expect(parsed.length).toBeGreaterThan(0);
    for (const record of parsed) {
      expect(Object.keys(record).sort()).toEqual([
        "attempts",
        "channelId",
        "deliveredAt",
        "firstAttemptedAt",
        "lastAttemptedAt",
        "reminderId",
        "rung",
        "status",
        "taskId",
      ]);
    }
  });

  it("allowed content IS present: task/metric ids and human-safe labels pass through", async () => {
    const outputs = await runJourney();
    expect(outputs.remindPayloadDump).toContain("metric-synth-canary");
    expect(outputs.remindPayloadDump).toContain("Heart rate (synth)");
    // The task id is present (referenced by the payload).
    expect(outputs.remindPayloadDump).toMatch(/"taskId":"task_[A-Za-z0-9_-]{43}"/);
  });
});

describe("B8 PHI discipline — the quiet-hours default is a recorded assumption", () => {
  it("the default preference profile is 22:00–07:00 local-of-record at UTC+0", () => {
    const preferences = synthPreferences();
    expect(preferences.quietHours.enabled).toBe(true);
    expect(preferences.quietHours.startLocalMinutes).toBe(22 * 60);
    expect(preferences.quietHours.endLocalMinutes).toBe(7 * 60);
    expect(preferences.localUtcOffsetMinutes).toBe(0);
  });

  it("an offset-based local-of-record shifts the deferral edge, not the discipline", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const task = synthTask({ endsAt: new Date(NOON + 12.5 * MS_PER_HOUR) });
    const schedule = harness.engine.computeSchedule({
      tasks: [task],
      preferences: synthPreferences({ localUtcOffsetMinutes: 120 }),
      channels: harness.registry,
    });
    if (!schedule.ok) {
      throw new Error("expected computation to succeed");
    }
    // Nominal 23:30 UTC == 01:30 local (UTC+2) => deferred to local 07:00 == 05:00 UTC.
    expect(schedule.value.reminders[0]!.sendAt.toISOString()).toBe("2026-06-11T05:00:00.000Z");
    expect(schedule.value.reminders[0]!.deferredByQuietHours).toBe(true);
  });
});
