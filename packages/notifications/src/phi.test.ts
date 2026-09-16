/**
 * B8 no-PHI proofs (the observability package's PHI-proof pattern,
 * applied to every payload variant and every seam the engine touches).
 *
 * The reminder discipline under test: payloads reference task/metric/
 * window ids and caller-vetted human-safe labels ONLY — never
 * observation values, never units, never evidence content or evidence
 * ids, never concept codes, never person identifiers, never engine-
 * generated free text.
 *
 * Soundness note: the sentinel strings all contain `/` (or underscore
 * prefixes absent from every fixture string), which can NEVER appear
 * inside the base64url-derived ids or ISO-8601 dates the payloads DO
 * legitimately carry — so `not.toContain` over the serialized payload is
 * a sound absence proof, not a heuristic.
 */
import { describe, expect, it } from "vitest";
import { InMemoryChannel } from "./inmemory-channel.js";
import type { ReminderPayload } from "./reminder.js";
import {
  EmailChannel,
  SyntheticEmailProvider,
  SyntheticWebPushProvider,
  WebPushChannel,
} from "./synth-channels.js";
import {
  SYNTH_LABELS,
  SYNTH_METHOD_ORDER,
  buildReminderHarness,
  syntheticProfile,
  syntheticTask,
} from "./testsupport.js";

const QUIET_OFF = {
  enabled: false,
  startMinuteOfDayLocal: 22 * 60,
  endMinuteOfDayLocal: 7 * 60,
} as const;

/** Observation-content sentinels (never legitimately present anywhere the engine touches). */
const OBSERVATION_CONTENT_SENTINELS = [
  "SYNTH/8867/4", // the task's concept code
  "beats/min", // the observation's unit
  "Jane/Q/Synthetic", // person-identifying free text
  "987654321-value-sentinel", // observation value sentinel (string form)
  "obs_", // observation id prefix
  "evid_", // evidence id prefix
  "prov_", // provenance id prefix
] as const;

/** Payload-level sentinels: person ids additionally never enter PAYLOADS (they are ledger-internal audit scoping only). */
const PAYLOAD_SENTINELS = [...OBSERVATION_CONTENT_SENTINELS, "prsn_"] as const;

/** Every key any payload variant may carry (deny-by-default allowlist). */
const PAYLOAD_KEY_ALLOWLIST = new Set([
  "kind",
  "taskId",
  "planId",
  "metricId",
  "metricLabel",
  "windowSequence",
  "windowOpensAt",
  "windowClosesAt",
  "reason",
  "preferredMethodId",
  "preferredMethodLabel",
  "fallbackMethods",
  "methodId",
  "label",
]);

function expectOk<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Recursive key-allowlist proof (deny-by-default over every nesting level). */
function disallowedKeys(node: unknown, path: string, violations: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => disallowedKeys(child, `${path}[${index}]`, violations));
    return;
  }
  if (typeof node === "object" && node !== null && !(node instanceof Date)) {
    for (const [key, child] of Object.entries(node)) {
      if (!PAYLOAD_KEY_ALLOWLIST.has(key)) {
        violations.push(`${path}.${key}`);
      }
      disallowedKeys(child, `${path}.${key}`, violations);
    }
  }
}

/** Recursive string-class proof: every string must come from the allowed set. */
function disallowedStrings(
  node: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  violations: string[],
): void {
  if (typeof node === "string") {
    if (!allowed.has(node)) {
      // The offending VALUE is intentionally not echoed (PHID-safe failure).
      violations.push(`${path}=<string outside the allowed classes>`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      disallowedStrings(child, allowed, `${path}[${index}]`, violations),
    );
    return;
  }
  if (typeof node === "object" && node !== null) {
    if (node instanceof Date) {
      if (!allowed.has(node.toISOString())) {
        violations.push(`${path}=<date outside the window bounds>`);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      disallowedStrings(child, allowed, `${path}.${key}`, violations);
    }
  }
}

/** Recursive number proof: the only number a payload may carry is the window sequence. */
function disallowedNumbers(
  node: unknown,
  allowedSequence: number,
  path: string,
  violations: string[],
): void {
  if (typeof node === "number") {
    if (node !== allowedSequence) {
      violations.push(`${path}=<non-sequence number>`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      disallowedNumbers(child, allowedSequence, `${path}[${index}]`, violations),
    );
    return;
  }
  if (typeof node === "object" && node !== null && !(node instanceof Date)) {
    for (const [key, child] of Object.entries(node)) {
      disallowedNumbers(child, allowedSequence, `${path}.${key}`, violations);
    }
  }
}

function expectNoSentinels(
  serialized: string,
  label: string,
  sentinels: readonly string[] = PAYLOAD_SENTINELS,
): void {
  for (const sentinel of sentinels) {
    expect(serialized, `${label} must not contain the sentinel "${sentinel}"`).not.toContain(
      sentinel,
    );
  }
}

describe("B8 PHI discipline — no-PHI proofs over every payload variant", () => {
  const WINDOW_START = Date.UTC(2024, 0, 2, 10, 0, 0);
  const WINDOW_END = Date.UTC(2024, 0, 2, 11, 0, 0);

  function buildFixtures(epochMs: number) {
    const harness = buildReminderHarness({ epochMs });
    const channel = new InMemoryChannel({ id: "in-memory" });
    const task = syntheticTask(harness.ids);
    const profile = syntheticProfile({
      quietHours: QUIET_OFF,
      enabledChannelIds: ["in-memory"],
      recipients: { "in-memory": "SYNTH-recipient-in-memory" },
    });
    const labels = {
      metricLabels: { "SYNTH-metric-heart-rate": SYNTH_LABELS.metric },
      methodLabels: {
        "SYNTH-method-wearable": SYNTH_LABELS.methodWearable,
        "SYNTH-method-app": SYNTH_LABELS.methodApp,
        "SYNTH-method-manual": SYNTH_LABELS.methodManual,
      },
    };
    const input = { tasks: [task], profile, channels: [channel] as const, labels };
    return { harness, channel, task, input };
  }

  it.each([
    { name: "upcoming-due REMIND payload", epochMs: WINDOW_START + 1_800_000 },
    { name: "missed-window REMIND payload", epochMs: Date.UTC(2024, 0, 2, 20, 0, 0) },
    {
      name: "REMIND_WITH_FALLBACK_OFFER payload",
      epochMs: Date.UTC(2024, 0, 3, 12, 0, 0),
    },
  ])("proves key/string/number discipline on the $name", async ({ epochMs }) => {
    const { harness, input } = buildFixtures(epochMs);
    const schedule = expectOk(await harness.engine.computeSchedule(input));
    expect(schedule.reminders).toHaveLength(1);
    const payload: ReminderPayload = schedule.reminders[0]?.payload as ReminderPayload;

    // A. Deny-by-default key allowlist over the full nesting.
    const keyViolations: string[] = [];
    disallowedKeys(payload, "payload", keyViolations);
    expect(keyViolations).toEqual([]);

    // B. String classes: ids, labels, vocabulary, window-bound ISO dates ONLY.
    const allowedStrings = new Set<string>([
      "remind",
      "remind-with-fallback-offer",
      "upcoming-due",
      "missed-window",
      SYNTH_LABELS.metric,
      SYNTH_LABELS.methodWearable,
      SYNTH_LABELS.methodApp,
      SYNTH_LABELS.methodManual,
      ...SYNTH_METHOD_ORDER,
      new Date(WINDOW_START).toISOString(),
      new Date(WINDOW_END).toISOString(),
    ]);
    const fixtures = buildFixtures(epochMs);
    allowedStrings.add(fixtures.task.id);
    allowedStrings.add(fixtures.task.planId);
    allowedStrings.add(fixtures.task.metricId);
    const stringViolations: string[] = [];
    disallowedStrings(payload, allowedStrings, "payload", stringViolations);
    expect(stringViolations).toEqual([]);

    // C. Numbers: the window sequence only — no observation values, no
    // quality scores, no units.
    const numberViolations: string[] = [];
    disallowedNumbers(payload, 0, "payload", numberViolations);
    expect(numberViolations).toEqual([]);

    // D. Sentinel absence over the serialized payload (sound: sentinels
    // cannot occur inside base64url ids or ISO dates).
    expectNoSentinels(JSON.stringify(payload), "payload");
  });

  it("proves the discipline end-to-end over channel send requests and the ledger", async () => {
    const { harness, channel, input } = buildFixtures(Date.UTC(2024, 0, 3, 12, 0, 0));
    const outcome = expectOk(await harness.engine.dispatchDue(input));
    expect(outcome.dispatched).toHaveLength(1);

    // The channel saw only allowlisted content.
    expect(channel.sendCount).toBe(1);
    const request = channel.sent[0]?.request;
    expect(request).toBeDefined();
    expectNoSentinels(JSON.stringify(request), "channel request");
    const requestKeys = new Set(Object.keys(request ?? {}));
    for (const key of requestKeys) {
      expect(["reminderId", "recipient", "payload", "sendAt"]).toContain(key);
    }

    // The ledger record carries ids/status/time ONLY — no observation
    // content of any kind. (personId is by-design internal audit scoping,
    // mirroring MeasurementTask.personId — it never enters payloads.)
    const ledgerList = await harness.ledger.list();
    expect(ledgerList).toHaveLength(1);
    const record = ledgerList[0] as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      expect([
        "reminderId",
        "taskId",
        "personId",
        "channelId",
        "rung",
        "status",
        "reason",
        "recordedAt",
      ]).toContain(key);
    }
    expectNoSentinels(JSON.stringify(record), "ledger record", OBSERVATION_CONTENT_SENTINELS);
    // Reason kinds are bare vocabulary, never free text.
    expect(typeof record.reason === "undefined" || typeof record.reason === "object").toBe(true);
  });

  it("proves the discipline over the SYNTH web-push and email renderings", async () => {
    const webPushProvider = new SyntheticWebPushProvider();
    const emailProvider = new SyntheticEmailProvider();
    const channels = [
      new WebPushChannel({ provider: webPushProvider }),
      new EmailChannel({ provider: emailProvider }),
    ];
    const harness = buildReminderHarness({ epochMs: Date.UTC(2024, 0, 3, 12, 0, 0) });
    const task = syntheticTask(harness.ids);
    const outcome = expectOk(
      await harness.engine.dispatchDue({
        tasks: [task],
        profile: syntheticProfile({
          quietHours: QUIET_OFF,
          enabledChannelIds: ["web-push", "email"],
          recipients: {
            "web-push": "SYNTH-subscription-ref",
            email: "SYNTH-address-ref",
          },
        }),
        channels,
        labels: {
          metricLabels: { "SYNTH-metric-heart-rate": SYNTH_LABELS.metric },
          methodLabels: {
            "SYNTH-method-wearable": SYNTH_LABELS.methodWearable,
            "SYNTH-method-app": SYNTH_LABELS.methodApp,
            "SYNTH-method-manual": SYNTH_LABELS.methodManual,
          },
        },
      }),
    );
    expect(outcome.dispatched).toHaveLength(2);

    const push = webPushProvider.deliveries[0]?.notification;
    expect(push).toBeDefined();
    // Fixed non-authoritative templates over ids/labels ONLY.
    expect(push?.title).toBe("Measurement reminder");
    expect(push?.body).toBe(`${SYNTH_LABELS.metric} — alternative capture paths available`);
    expectNoSentinels(JSON.stringify(push), "web-push notification");

    const email = emailProvider.deliveries[0]?.message;
    expect(email).toBeDefined();
    expect(email?.subject).toBe("Measurement reminder");
    expect(email?.bodyText).toBe(
      [
        `Metric: ${SYNTH_LABELS.metric}`,
        `Window: ${new Date(WINDOW_START).toISOString()} - ${new Date(WINDOW_END).toISOString()}`,
        `Preferred capture path: ${SYNTH_LABELS.methodWearable}`,
        `Alternative capture paths offered: ${SYNTH_LABELS.methodApp}, ${SYNTH_LABELS.methodManual}`,
      ].join("\n"),
    );
    expectNoSentinels(JSON.stringify(email), "email message");
  });

  it("payloads carry no person identifier even though reminders are person-scoped records", async () => {
    const { harness, input } = buildFixtures(Date.UTC(2024, 0, 2, 10, 30, 0));
    const schedule = expectOk(await harness.engine.computeSchedule(input));
    const reminder = schedule.reminders[0];
    expect(reminder).toBeDefined();
    // The RECORD is person-scoped (audit); the PAYLOAD is not.
    expect(JSON.stringify(reminder?.payload)).not.toContain(harness.personId);
    expectNoSentinels(JSON.stringify(reminder?.payload), "payload");
  });
});
