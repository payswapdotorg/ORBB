import { describe, expect, it } from "vitest";
import type { ReminderId, SendAttemptId } from "./ids.js";
import { deriveReminderId } from "./ids.js";
import { InMemorySendAttemptLedger, type SendAttempt } from "./ledger.js";
import { syntheticTask, syntheticTaskId } from "./testsupport.js";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

function attempt(reminderKey: string, sequence: number): SendAttempt {
  const task = syntheticTask({
    window: {
      sequence: 0,
      startsAt: new Date(MS_PER_DAY),
      endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
    },
  });
  return {
    id: `snd_SYNTH-attempt-${String(sequence).padStart(8, "0")}` as SendAttemptId,
    reminderId: deriveReminderId({
      taskId: task.id,
      window: task.window,
      rung: "REMIND",
      channel: reminderKey,
      utcDay: 1,
    }),
    channel: reminderKey,
    rung: "REMIND",
    outcome: {
      status: "sent",
      deliveredAt: new Date(sequence),
      providerReceipt: `SYNTH-inmem-provider-v1-${reminderKey}`,
    },
    dispatchedAt: new Date(sequence),
  };
}

describe("B8 send-attempt ledger — the idempotency ledger of record", () => {
  it("records attempts keyed by reminder id: exactly-once rows", async () => {
    const ledger = new InMemorySendAttemptLedger();
    const first = attempt("inmem", 1);
    await ledger.record(first);
    // A second record for the SAME reminder id is a no-op (upsert by key).
    await ledger.record({ ...first, outcome: { status: "undeliverable", reason: { kind: "payload-rejected" } } });
    const rows = await ledger.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome.status).toBe("sent");
  });

  it("finds attempts by reminder id", async () => {
    const ledger = new InMemorySendAttemptLedger();
    const row = attempt("inmem", 1);
    await ledger.record(row);
    expect((await ledger.findByReminderId(row.reminderId))?.id).toBe(row.id);
    expect(await ledger.findByReminderId("remd_nonexistent0000000000" as ReminderId)).toBeUndefined();
  });

  it("lists rows in ledger order across distinct reminder ids", async () => {
    const ledger = new InMemorySendAttemptLedger();
    await ledger.record(attempt("inmem", 1));
    await ledger.record(attempt("webpush-synth", 2));
    await ledger.record(attempt("email-synth", 3));
    const rows = await ledger.listAll();
    expect(rows.map((row) => row.channel)).toEqual(["inmem", "webpush-synth", "email-synth"]);
  });

  it("returns defensive copies — mutating a returned row cannot corrupt the ledger", async () => {
    const ledger = new InMemorySendAttemptLedger();
    const row = attempt("inmem", 1);
    await ledger.record(row);
    const fetched = await ledger.findByReminderId(row.reminderId);
    if (fetched === undefined) {
      throw new Error("expected the row");
    }
    if (fetched.outcome.status === "sent") {
      (fetched.outcome as { deliveredAt: Date }).deliveredAt = new Date(999_999);
    }
    const again = await ledger.findByReminderId(row.reminderId);
    if (again === undefined || again.outcome.status !== "sent") {
      throw new Error("expected the row");
    }
    expect(again.outcome.deliveredAt.getTime()).toBe(1);
  });

  it("keeps undeliverable outcomes in the record (fail-closed: a failed dispatch is still recorded)", async () => {
    const ledger = new InMemorySendAttemptLedger();
    const row: SendAttempt = {
      ...attempt("inmem", 1),
      outcome: { status: "undeliverable", reason: { kind: "channel-transport-error" } },
    };
    await ledger.record(row);
    const rows = await ledger.listAll();
    expect(rows[0]?.outcome).toEqual({
      status: "undeliverable",
      reason: { kind: "channel-transport-error" },
    });
    // The reminder is still considered dispatched (ledger-gated retries).
    expect(await ledger.findByReminderId(row.reminderId)).toBeDefined();
  });

  it("reminder ids derive from the real task identity vocabulary", () => {
    // Cross-check the fixture + derivation wiring used throughout the tests.
    const task = syntheticTask();
    expect(task.id).toBe(syntheticTaskId(1));
    const id = deriveReminderId({
      taskId: task.id,
      window: task.window,
      rung: "REMIND",
      channel: "inmem",
      utcDay: 1,
    });
    expect(id.startsWith("remd_")).toBe(true);
  });
});
