import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE } from "./quiet-hours.js";
import { synthTask, synthTaskId } from "./testsupport.js";
import {
  InMemoryReminderDispatchLedger,
  isReminderDispatchStatus,
  type ReminderAttemptRecord,
} from "./ledger.js";
import type { ReminderId } from "./identity.js";

/** Noon UTC on Wednesday 2026-06-10. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

function reminderId(n: number): ReminderId {
  return `rem_SYNTH-ledger-fixture-${String(n).padStart(8, "0")}` as ReminderId;
}

function failedAttempt(at: number): ReminderAttemptRecord {
  return {
    reminderId: reminderId(1),
    taskId: synthTask({ id: synthTaskId(1) }).id,
    channelId: "inapp-memory",
    rung: "REMIND",
    status: "failed",
    attemptedAt: new Date(NOON + at * MS_PER_MINUTE),
    failureReason: "provider-rejected",
    failureDetail: "SYNTH-reject",
  };
}

function deliveredAttempt(at: number): ReminderAttemptRecord {
  return {
    reminderId: reminderId(1),
    taskId: synthTask({ id: synthTaskId(1) }).id,
    channelId: "inapp-memory",
    rung: "REMIND",
    status: "dispatched",
    attemptedAt: new Date(NOON + at * MS_PER_MINUTE),
  };
}

describe("B8 send-attempt ledger — record semantics", () => {
  it("creates the record on the first attempt with full bookkeeping", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    const record = await ledger.recordAttempt(failedAttempt(0));
    expect(record.reminderId).toBe(reminderId(1));
    expect(record.status).toBe("failed");
    expect(record.attempts).toBe(1);
    expect(record.firstAttemptedAt.getTime()).toBe(NOON);
    expect(record.lastAttemptedAt.getTime()).toBe(NOON);
    expect(record.lastFailureReason).toBe("provider-rejected");
    expect(record.lastFailureDetail).toBe("SYNTH-reject");
    expect(record.deliveredAt).toBeUndefined();
    expect(ledger.listAll()).toHaveLength(1);
  });

  it("a later successful attempt flips the record to dispatched and clears failure bookkeeping", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    await ledger.recordAttempt(failedAttempt(0));
    const record = await ledger.recordAttempt(deliveredAttempt(5));
    expect(record.attempts).toBe(2);
    expect(record.status).toBe("dispatched");
    expect(record.deliveredAt?.getTime()).toBe(NOON + 5 * MS_PER_MINUTE);
    expect(record.firstAttemptedAt.getTime()).toBe(NOON);
    expect(record.lastAttemptedAt.getTime()).toBe(NOON + 5 * MS_PER_MINUTE);
    expect("lastFailureReason" in record).toBe(false);
    expect("lastFailureDetail" in record).toBe(false);
  });

  it("a later failed attempt updates the failure bookkeeping in place", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    await ledger.recordAttempt(failedAttempt(0));
    const record = await ledger.recordAttempt({
      ...failedAttempt(5),
      failureReason: "rate-limited",
    });
    expect(record.attempts).toBe(2);
    expect(record.status).toBe("failed");
    expect(record.lastFailureReason).toBe("rate-limited");
    expect(ledger.listAll()).toHaveLength(1);
  });

  it("findById resolves by reminder id and returns undefined for unknown ids", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    await ledger.recordAttempt(failedAttempt(0));
    expect((await ledger.findById(reminderId(1)))?.attempts).toBe(1);
    expect(await ledger.findById(reminderId(2))).toBeUndefined();
  });

  it("records are defensively copied in and out", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    const attempt = failedAttempt(0);
    await ledger.recordAttempt(attempt);
    attempt.attemptedAt.setTime(0);
    const stored = await ledger.findById(reminderId(1));
    if (stored === undefined) {
      throw new Error("expected the record to exist");
    }
    expect(stored.firstAttemptedAt.getTime()).toBe(NOON);
    stored.firstAttemptedAt.setTime(0);
    (stored as { attempts: number }).attempts = 99;
    const fresh = await ledger.findById(reminderId(1));
    if (fresh === undefined) {
      throw new Error("expected the record to exist");
    }
    expect(fresh.firstAttemptedAt.getTime()).toBe(NOON);
    expect(fresh.attempts).toBe(1);
  });

  it("one record per reminder id regardless of attempt count (each dispatch recorded exactly once)", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    await ledger.recordAttempt(failedAttempt(0));
    await ledger.recordAttempt(failedAttempt(1));
    await ledger.recordAttempt(deliveredAttempt(2));
    await ledger.recordAttempt({ ...deliveredAttempt(3), reminderId: reminderId(2) });
    expect(ledger.listAll()).toHaveLength(2);
    expect(ledger.listAll().map((record) => record.reminderId)).toEqual([
      reminderId(1),
      reminderId(2),
    ]);
    expect(ledger.listAll()[0]!.attempts).toBe(3);
    expect(ledger.listAll()[1]!.attempts).toBe(1);
  });
});

describe("B8 send-attempt ledger — vocabulary guard", () => {
  it("classifies dispatch statuses", () => {
    expect(isReminderDispatchStatus("dispatched")).toBe(true);
    expect(isReminderDispatchStatus("failed")).toBe(true);
    expect(isReminderDispatchStatus("queued")).toBe(false);
    expect(isReminderDispatchStatus(undefined)).toBe(false);
  });
});
