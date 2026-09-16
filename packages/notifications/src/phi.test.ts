/**
 * B8 PHI-discipline proofs (the observability lane's PHI-proof pattern:
 * plant decoys, then assert `not.toContain` over every payload variant
 * and every record surface that leaves the engine).
 *
 * THE CONTRACT (work order, verbatim): "Reminder payloads reference
 * task/metric/window ids and human-safe labels ONLY — NEVER observation
 * values, never evidence content, never person-identifying free text.
 * Prove it with not.toContain-style tests over every payload shape."
 *
 * Surfaces proven here:
 *   1. rung-1 (upcoming-due) payload — canonical serialization;
 *   2. rung-2 (fallback-offer) payload — canonical serialization;
 *   3. the quiet-hours DEFERRED payload variant — canonical serialization;
 *   4. the channel-visible delivery request (recipientRef + payload);
 *   5. the SYNTH provider receipts;
 *   6. the ledger rows (send attempts of record);
 *   7. the schedule audit view (the observability projection).
 */
import { describe, expect, it } from "vitest";
import {
  hashReminderPayload,
  serializeReminderPayload,
  serializeScheduleAuditView,
  toScheduleAuditView,
} from "./serialization.js";
import type { PlannedReminder, ReminderSchedule } from "./engine.js";
import type { SendAttempt } from "./ledger.js";
import type { OutboundDelivery } from "./channels.js";
import {
  MS_PER_HOUR,
  PHI_DECOYS,
  PHI_DECOY_PERSON_ID,
  SYNTH_LABELS,
  SYNTH_PERSON_ID,
  buildNotificationHarness,
  harnessProfile,
  quietHours,
  syntheticTask,
} from "./testsupport.js";

/** Every PHI decoy literal that must NEVER appear on an outbound surface. */
const DECOYS: readonly string[] = [
  PHI_DECOYS.personId,
  PHI_DECOYS.conceptCode,
  PHI_DECOYS.observationValue,
  PHI_DECOYS.evidenceContent,
  PHI_DECOYS.freeText,
  // The canonical synthetic person id is equally barred from payloads,
  // deliveries, and ledger rows (only its recipient PSEUDONYM may cross).
  SYNTH_PERSON_ID,
];

/** Key names barred from every payload shape (smuggle-proofing). */
const BARRED_KEYS: readonly string[] = [
  "personId",
  "value",
  "conceptCode",
  "observation",
  "evidence",
  "notes",
  "subject",
  "email",
  "phone",
];

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const element of value) {
      collectKeys(element, into);
    }
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

function expectPhiFree(dump: string): void {
  for (const decoy of DECOYS) {
    expect(dump).not.toContain(decoy);
  }
  // No canonical person-id prefix may ever cross the boundary.
  expect(dump).not.toContain("prsn_");
}

function expectKeysClean(payload: unknown): void {
  const keys = collectKeys(payload);
  for (const barred of BARRED_KEYS) {
    expect(keys.has(barred)).toBe(false);
  }
}

/** A window helper over the epoch. */
function window(startMs: number, durationMs: number) {
  return { sequence: 0, startsAt: new Date(startMs), endsAt: new Date(startMs + durationMs) };
}

async function computeVariant(options: {
  readonly epochMs: number;
  readonly taskWindow: { readonly startsAt: number; readonly durationMs: number };
  readonly personId?: typeof SYNTH_PERSON_ID;
  readonly quiet?: boolean;
}): Promise<ReminderSchedule> {
  const harness = buildNotificationHarness({ epochMs: options.epochMs });
  const task = syntheticTask({
    index: 1,
    personId: options.personId ?? SYNTH_PERSON_ID,
    window: window(options.taskWindow.startsAt, options.taskWindow.durationMs),
  });
  const profile = harnessProfile(
    options.quiet === false
      ? { quietHours: null }
      : { quietHours: quietHours({ startMinuteOfDay: 120, endMinuteOfDay: 300 }) },
  );
  const result = harness.engine.computeSchedule({ tasks: [task], profile });
  if (!result.ok) {
    throw new Error("expected scheduling to succeed");
  }
  return result.value;
}

async function dispatchVariant(options: {
  readonly epochMs: number;
  readonly taskWindow: { readonly startsAt: number; readonly durationMs: number };
  readonly personId?: typeof SYNTH_PERSON_ID;
}): Promise<{ attempts: readonly SendAttempt[]; deliveries: readonly OutboundDelivery[] }> {
  const harness = buildNotificationHarness({ epochMs: options.epochMs });
  const task = syntheticTask({
    index: 1,
    personId: options.personId ?? SYNTH_PERSON_ID,
    window: window(options.taskWindow.startsAt, options.taskWindow.durationMs),
  });
  const profile = harnessProfile({ quietHours: null });
  const result = await harness.engine.dispatchPending({ tasks: [task], profile });
  if (!result.ok) {
    throw new Error("expected dispatch to succeed");
  }
  const deliveries = harness.inmem.recorded.map((entry) => entry.delivery);
  return { attempts: result.value.dispatched, deliveries };
}

describe("B8 PHI discipline — no-PHI proofs over every payload variant", () => {
  it("rung-1 (upcoming-due) payload carries ids and labels only", async () => {
    // Epoch 3h: window [2h, 4h) is open; fire = 3h = now (due).
    const schedule = await computeVariant({
      epochMs: 3 * MS_PER_HOUR,
      taskWindow: { startsAt: 2 * MS_PER_HOUR, durationMs: 2 * MS_PER_HOUR },
      quiet: false,
    });
    const reminder = schedule.reminders[0];
    if (reminder === undefined || reminder.payload.rung !== "REMIND") {
      throw new Error("expected a rung-1 reminder");
    }
    const dump = serializeReminderPayload(reminder.payload);
    expectPhiFree(dump);
    expectKeysClean(reminder.payload);
    // Positive controls: the PHI-free content that SHOULD be there.
    expect(dump).toContain(reminder.payload.taskId);
    expect(dump).toContain(SYNTH_LABELS.bloodPressure);
    expect(dump).not.toContain("fallbackOffer");
    // Byte-stable audit hash (canonical, deterministic).
    expect(hashReminderPayload(reminder.payload)).toBe(hashReminderPayload(reminder.payload));
  });

  it("rung-2 (fallback-offer) payload carries the vocabulary as DATA, PHI-free", async () => {
    // Epoch 2h: window [0, 1h) missed; offer fires at 2h = now (due).
    const schedule = await computeVariant({
      epochMs: 2 * MS_PER_HOUR,
      taskWindow: { startsAt: 0, durationMs: MS_PER_HOUR },
      quiet: false,
    });
    const reminder = schedule.reminders[0];
    if (reminder === undefined || reminder.payload.rung !== "REMIND_WITH_FALLBACK_OFFER") {
      throw new Error("expected a rung-2 reminder");
    }
    const dump = serializeReminderPayload(reminder.payload);
    expectPhiFree(dump);
    expectKeysClean(reminder.payload);
    // Journey #7 positive controls: the offered vocabulary is present as
    // data, labeled, authority-less.
    expect(reminder.payload.fallbackOffer.enforcementAuthority).toBe("none");
    expect(dump).toContain(SYNTH_LABELS.bpCuff);
    expect(dump).toContain(SYNTH_LABELS.bpManual);
    expect(dump).toContain('"role":"preferred"');
    expect(dump).toContain('"role":"fallback"');
  });

  it("the quiet-hours DEFERRED payload variant is PHI-free and proves defer-not-drop", async () => {
    // Quiet 02:00–05:00; window [90m, 330m): fire 270m (04:30) defers to
    // the 05:00 edge — the defer record rides the payload.
    const schedule = await computeVariant({
      epochMs: 0,
      taskWindow: { startsAt: 90 * 60_000, durationMs: 240 * 60_000 },
      quiet: true,
    });
    const reminder = schedule.reminders[0];
    if (reminder === undefined) {
      throw new Error("expected a deferred reminder");
    }
    expect(reminder.payload.defer).toEqual({
      from: new Date(270 * 60_000),
      reason: "quiet-hours",
    });
    const dump = serializeReminderPayload(reminder.payload);
    expectPhiFree(dump);
    expectKeysClean(reminder.payload);
    expect(dump).toContain('"reason":"quiet-hours"');
  });

  it("payloads computed for a PHI-decoy person never leak the person id", async () => {
    const schedule = await computeVariant({
      epochMs: 3 * MS_PER_HOUR,
      taskWindow: { startsAt: 2 * MS_PER_HOUR, durationMs: 2 * MS_PER_HOUR },
      personId: PHI_DECOY_PERSON_ID,
      quiet: false,
    });
    for (const reminder of schedule.reminders) {
      expectPhiFree(serializeReminderPayload(reminder.payload));
      // The addressing field exists INTERNALLY only.
      expect(reminder.personId).toBe(PHI_DECOY_PERSON_ID);
      expect("personId" in reminder.payload).toBe(false);
    }
  });
});

describe("B8 PHI discipline — no-PHI proofs over delivery, receipt, and ledger surfaces", () => {
  it("channel-visible deliveries carry the recipient pseudonym, never a person id", async () => {
    const { attempts, deliveries } = await dispatchVariant({
      epochMs: 3 * MS_PER_HOUR,
      taskWindow: { startsAt: 2 * MS_PER_HOUR, durationMs: 2 * MS_PER_HOUR },
    });
    expect(deliveries).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    const delivery = deliveries[0];
    const attempt = attempts[0];
    if (delivery === undefined || attempt === undefined) {
      throw new Error("expected one delivery and one attempt");
    }
    expect(delivery.recipientRef).toBe("SYNTH-recipient-00000001");
    const dump = JSON.stringify(delivery);
    expectPhiFree(dump);
    expect(dump).toContain("SYNTH-recipient-00000001");
    // The delivery request shape is structurally incapable of carrying a
    // person id.
    expect("personId" in delivery).toBe(false);
    // The receipt is a deterministic identity hash — PHI-free.
    if (attempt.outcome.status !== "sent") {
      throw new Error("expected a sent outcome");
    }
    expectPhiFree(attempt.outcome.providerReceipt ?? "");
    // The ledger row is the record of dispatch: ids, channel, rung,
    // outcome, timestamp — no payload content, no person id.
    const ledgerDump = JSON.stringify(attempt);
    expectPhiFree(ledgerDump);
    expectKeysClean(attempt);
  });

  it("undeliverable outcomes for an unknown (decoy) recipient are recorded PHI-free", async () => {
    const { attempts, deliveries } = await dispatchVariant({
      epochMs: 3 * MS_PER_HOUR,
      taskWindow: { startsAt: 2 * MS_PER_HOUR, durationMs: 2 * MS_PER_HOUR },
      personId: PHI_DECOY_PERSON_ID,
    });
    // Fail-closed: no delivery happened, but the attempt IS recorded.
    expect(deliveries).toHaveLength(0);
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0];
    if (attempt === undefined) {
      throw new Error("expected one recorded attempt");
    }
    expect(attempt.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "unknown-recipient" },
    });
    expectPhiFree(JSON.stringify(attempt));
  });
});

describe("B8 PHI discipline — the schedule audit view (observability projection)", () => {
  it("projects reminders without the addressing person id and hashes stably", async () => {
    const schedule = await computeVariant({
      epochMs: 2 * MS_PER_HOUR,
      taskWindow: { startsAt: 0, durationMs: MS_PER_HOUR },
      quiet: false,
    });
    const view = toScheduleAuditView(schedule);
    const dump = serializeScheduleAuditView(view);
    expectPhiFree(dump);
    expectKeysClean(view);
    for (const entry of view.reminders) {
      expect("personId" in entry).toBe(false);
    }
    // Deterministic audit hash over the PHI-free projection.
    expect(serializeScheduleAuditView(toScheduleAuditView(schedule))).toBe(dump);
    // The INTERNAL serialization still exists (determinism proofs) but is
    // documented internal-only — the audit view is the outbound surface.
    const internal: PlannedReminder | undefined = schedule.reminders[0];
    if (internal === undefined) {
      throw new Error("expected one reminder");
    }
    expect("personId" in internal).toBe(true);
  });
});
