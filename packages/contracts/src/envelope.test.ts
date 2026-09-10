import { describe, expect, it } from "vitest";
import { DomainInvariantError, parseDeviceId, parsePersonId } from "@orbb/domain";
import {
  EVENT_ID_PREFIX,
  assertDomainEventEnvelope,
  isDomainEventEnvelope,
  isEventId,
  parseEventId,
  type DomainEventEnvelope,
} from "./envelope.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

function fullEnvelope(): DomainEventEnvelope {
  return {
    eventId: parseEventId(`evt_${BODY}`),
    type: "INTENT_CREATED",
    version: 1,
    occurredAt: new Date("2025-01-15T08:30:00.000Z"),
    actor: parsePersonId(`prsn_${BODY}`),
    subject: parsePersonId(`prsn_${BODY}`),
    correlationId: "corr-7f3a",
    causationId: `evt_${"02h45y6e8x2xq4n8v3m2k9abcd"}`,
    payloadSchemaVersion: "1.0.0",
  };
}

describe("event id", () => {
  it("parses canonical evt_ ids", () => {
    expect(parseEventId(`evt_${BODY}`)).toBe(`evt_${BODY}`);
    expect(isEventId(`evt_${BODY}`)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isEventId(`prsn_${BODY}`)).toBe(false);
    expect(isEventId("evt_short")).toBe(false);
    expect(isEventId(7)).toBe(false);
    expect(() => parseEventId(`prsn_${BODY}`)).toThrow(DomainInvariantError);
    expect(() => parseEventId("evt_short")).toThrow(DomainInvariantError);
    expect(EVENT_ID_PREFIX).toBe("evt");
  });
});

describe("domain event envelope", () => {
  it("accepts a full envelope carrying exactly the §11 fields", () => {
    const envelope = fullEnvelope();
    const candidate: unknown = envelope;
    expect(() => assertDomainEventEnvelope(candidate)).not.toThrow();
    expect(Object.keys(envelope).sort()).toEqual([
      "actor",
      "causationId",
      "correlationId",
      "eventId",
      "occurredAt",
      "payloadSchemaVersion",
      "subject",
      "type",
      "version",
    ]);
  });

  it("accepts a minimal envelope without correlation/causation", () => {
    const envelope: DomainEventEnvelope = {
      eventId: parseEventId(`evt_${BODY}`),
      type: "OBSERVATION_RECORDED",
      version: 1,
      occurredAt: new Date("2025-01-15T08:30:00.000Z"),
      actor: parseDeviceId(`dev_${BODY}`),
      subject: parsePersonId(`prsn_${BODY}`),
      payloadSchemaVersion: "1.0.0",
    };
    const candidate: unknown = envelope;
    assertDomainEventEnvelope(candidate);
    expect(candidate.subject).toBe(`prsn_${BODY}`);
    expect(Object.keys(envelope)).toHaveLength(7);
  });

  it("rejects non-object values", () => {
    for (const candidate of [null, undefined, 42, "evt_01h45y6e8x2xq4n8v3m2k9abcd", true]) {
      expect(isDomainEventEnvelope(candidate)).toBe(false);
      expect(() => assertDomainEventEnvelope(candidate)).toThrow(DomainInvariantError);
    }
  });

  it("rejects an invalid eventId", () => {
    const candidate: unknown = { ...fullEnvelope(), eventId: `prsn_${BODY}` };
    expect(isDomainEventEnvelope(candidate)).toBe(false);
    expect(() => assertDomainEventEnvelope(candidate)).toThrow(DomainInvariantError);
  });

  it("rejects an unknown event type", () => {
    const candidate: unknown = { ...fullEnvelope(), type: "NOT_A_TYPE" };
    expect(isDomainEventEnvelope(candidate)).toBe(false);
    expect(() => assertDomainEventEnvelope(candidate)).toThrow(DomainInvariantError);
  });

  it("rejects a non-positive-integer version", () => {
    const zero: unknown = { ...fullEnvelope(), version: 0 };
    const fractional: unknown = { ...fullEnvelope(), version: 1.5 };
    const stringVersion: unknown = { ...fullEnvelope(), version: "1" };
    expect(isDomainEventEnvelope(zero)).toBe(false);
    expect(isDomainEventEnvelope(fractional)).toBe(false);
    expect(isDomainEventEnvelope(stringVersion)).toBe(false);
    expect(() => assertDomainEventEnvelope(zero)).toThrow(DomainInvariantError);
    expect(() => assertDomainEventEnvelope(fractional)).toThrow(DomainInvariantError);
  });

  it("rejects an invalid occurredAt", () => {
    const asString: unknown = { ...fullEnvelope(), occurredAt: "2025-01-15T08:30:00.000Z" };
    const invalid: unknown = { ...fullEnvelope(), occurredAt: new Date("not-a-date") };
    expect(isDomainEventEnvelope(asString)).toBe(false);
    expect(isDomainEventEnvelope(invalid)).toBe(false);
    expect(() => assertDomainEventEnvelope(asString)).toThrow(DomainInvariantError);
  });

  it("rejects an invalid actor or subject", () => {
    const badActor: unknown = { ...fullEnvelope(), actor: `task_${BODY}` };
    const badSubject: unknown = { ...fullEnvelope(), subject: `dev_${BODY}` };
    expect(isDomainEventEnvelope(badActor)).toBe(false);
    expect(isDomainEventEnvelope(badSubject)).toBe(false);
    expect(() => assertDomainEventEnvelope(badActor)).toThrow(DomainInvariantError);
    expect(() => assertDomainEventEnvelope(badSubject)).toThrow(DomainInvariantError);
  });

  it("rejects present-but-empty correlation/causation and empty payloadSchemaVersion", () => {
    const emptyCorrelation: unknown = { ...fullEnvelope(), correlationId: "" };
    const emptyCausation: unknown = { ...fullEnvelope(), causationId: "" };
    const emptySchemaVersion: unknown = { ...fullEnvelope(), payloadSchemaVersion: "" };
    expect(isDomainEventEnvelope(emptyCorrelation)).toBe(false);
    expect(isDomainEventEnvelope(emptyCausation)).toBe(false);
    expect(isDomainEventEnvelope(emptySchemaVersion)).toBe(false);
    expect(() => assertDomainEventEnvelope(emptyCorrelation)).toThrow(DomainInvariantError);
    expect(() => assertDomainEventEnvelope(emptySchemaVersion)).toThrow(DomainInvariantError);
  });

  it("error messages describe the §11 shape without echoing received values", () => {
    let message = "";
    try {
      assertDomainEventEnvelope({
        eventId: "leaky",
        type: "leaky",
        version: -1,
        occurredAt: "leaky",
        actor: "leaky",
        subject: "leaky",
        payloadSchemaVersion: "",
      });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("eventId");
    expect(message).toContain("payloadSchemaVersion");
    expect(message).not.toContain("leaky");
  });
});
