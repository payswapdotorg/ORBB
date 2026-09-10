import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import { parseEventId } from "./envelope.js";
import {
  OUTBOX_STATUSES,
  isOutboxStatus,
  parseOutboxStatus,
  type OutboxRecord,
} from "./outbox.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

describe("outbox status", () => {
  it("defines the delivery lifecycle", () => {
    expect([...OUTBOX_STATUSES]).toEqual(["pending", "published", "failed"]);
  });

  it("recognizes legal statuses and rejects unknown ones", () => {
    expect(isOutboxStatus("pending")).toBe(true);
    expect(isOutboxStatus("published")).toBe(true);
    expect(isOutboxStatus("failed")).toBe(true);
    expect(isOutboxStatus("in-flight")).toBe(false);
    expect(isOutboxStatus(2)).toBe(false);
    expect(parseOutboxStatus("failed")).toBe("failed");
    expect(() => parseOutboxStatus("in-flight")).toThrow(DomainInvariantError);
    expect(() => parseOutboxStatus(null)).toThrow(DomainInvariantError);
  });
});

describe("outbox record", () => {
  it("accepts a pending record with optional fields omitted", () => {
    const record: OutboxRecord = {
      eventId: parseEventId(`evt_${BODY}`),
      eventType: "OBSERVATION_RECORDED",
      payload: '{"observationId":"obs_01h45y6e8x2xq4n8v3m2k9abcd"}',
      status: "pending",
      attempts: 0,
      createdAt: new Date("2025-01-15T08:30:00.000Z"),
    };
    expect(record.status).toBe("pending");
    expect(record.publishedAt).toBeUndefined();
    expect(record.lastError).toBeUndefined();
  });

  it("accepts a failed record carrying retry bookkeeping", () => {
    const record: OutboxRecord = {
      eventId: parseEventId(`evt_${BODY}`),
      eventType: "EVIDENCE_INGESTED",
      payload: "{}",
      status: "failed",
      attempts: 3,
      createdAt: new Date("2025-01-15T08:30:00.000Z"),
      lastError: "queue unavailable",
    };
    expect(record.attempts).toBe(3);
    expect(record.lastError).toBe("queue unavailable");
  });
});
