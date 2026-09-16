import { describe, expect, it } from "vitest";
import { parseTaskId, type TaskId } from "@orbb/domain";
import type { PersonId } from "@orbb/domain";
import { isReminderId, type ReminderId } from "./ids.js";
import { InMemoryReminderDispatchLedger, type DispatchRecord } from "./ledger.js";
import { harnessPersonId, harnessPlanId } from "./testsupport.js";

function record(reminderId: string, recordedAtMs = 0): DispatchRecord {
  return {
    reminderId: reminderId as ReminderId,
    taskId: parseTaskId("task_01h45y6e8x2xq4n8v3m2k9abcd") as TaskId,
    personId: harnessPersonId(),
    channelId: "in-memory",
    rung: "REMIND",
    status: "delivered",
    recordedAt: new Date(recordedAtMs),
  };
}

describe("InMemoryReminderDispatchLedger — exactly-once per reminder id", () => {
  it("records each dispatch exactly once and reports duplicates", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    const first = await ledger.record(record("rem_aaaa000000000000000000000"));
    expect(first).toEqual({ status: "recorded" });
    const second = await ledger.record(record("rem_aaaa000000000000000000000", 5_000));
    expect(second.status).toBe("already-recorded");
    if (second.status === "already-recorded") {
      // The ORIGINAL record wins — the duplicate write is not applied.
      expect(second.existing.recordedAt.getTime()).toBe(0);
    }
    const list = await ledger.list();
    expect(list).toHaveLength(1);
    expect((list[0] as DispatchRecord).recordedAt.getTime()).toBe(0);
  });

  it("keeps distinct reminder ids as distinct records, insertion-ordered", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    const ids = ["rem_aaaa000000000000000000000", "rem_bbbb000000000000000000000"];
    for (const id of ids) {
      await ledger.record(record(id));
    }
    const list = await ledger.list();
    expect(list.map((entry) => entry.reminderId)).toEqual(ids);
  });

  it("find returns undefined for unknown ids and defensive copies otherwise", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    expect(await ledger.find("rem_cccc000000000000000000000" as ReminderId)).toBeUndefined();
    const stored = record("rem_dddd000000000000000000000");
    await ledger.record(stored);
    const found = await ledger.find(stored.reminderId);
    expect(found).toBeDefined();
    if (found !== undefined) {
      found.recordedAt.setTime(99);
      const again = await ledger.find(stored.reminderId);
      expect((again as DispatchRecord).recordedAt.getTime()).toBe(0);
    }
  });

  it("list returns defensive copies (mutating the result never corrupts the store)", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    await ledger.record(record("rem_eeee000000000000000000000"));
    const list = await ledger.list();
    (list[0] as unknown as { status: string }).status = "failed";
    const fresh = await ledger.list();
    expect((fresh[0] as DispatchRecord).status).toBe("delivered");
  });

  it("reminder ids from the engine grammar are guardable", () => {
    const id = "rem_" + "a".repeat(43);
    expect(isReminderId(id)).toBe(true);
    expect(isReminderId("rem_short")).toBe(false);
    expect(isReminderId("bad_" + "a".repeat(43))).toBe(false);
    expect(isReminderId(record("rem_aaaa000000000000000000000").personId)).toBe(false);
  });

  it("records carry the full audit shape (ids, channel, rung, status, reason, time)", async () => {
    const ledger = new InMemoryReminderDispatchLedger();
    const failure: DispatchRecord = {
      reminderId: "rem_ffff000000000000000000000" as ReminderId,
      taskId: parseTaskId("task_01h45y6e8x2xq4n8v3m2k9abcd") as TaskId,
      personId: harnessPersonId() as PersonId,
      channelId: "email",
      rung: "REMIND_WITH_FALLBACK_OFFER",
      status: "failed",
      reason: { kind: "channel-errored" },
      recordedAt: new Date(1_000),
    };
    await ledger.record(failure);
    const [entry] = await ledger.list();
    expect(entry).toEqual(failure);
    expect(harnessPlanId()).toMatch(/^plan_/);
  });
});
