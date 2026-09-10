import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import {
  DOMAIN_EVENT_TYPES,
  isDomainEventType,
  parseDomainEventType,
  type DomainEventType,
} from "./eventTypes.js";

describe("canonical domain event types", () => {
  it("is exactly the §11 vocabulary", () => {
    expect([...DOMAIN_EVENT_TYPES]).toEqual([
      "INTENT_CREATED",
      "PLAN_PUBLISHED",
      "TASK_DUE",
      "OBSERVATION_RECORDED",
      "OBSERVATION_SUPERSEDED",
      "EVIDENCE_INGESTED",
      "ACCESS_GRANTED",
      "ACCESS_REVOKED",
      "ACCESS_EVALUATED",
      "SERVICE_ORDER_CREATED",
      "SERVICE_ORDER_FULFILLED",
      "EXTENSION_INSTALLED",
      "STUDY_ENROLLED",
      "SAFETY_FLAG_RAISED",
    ]);
  });

  it("recognizes every canonical type", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(isDomainEventType(type)).toBe(true);
      expect(parseDomainEventType(type)).toBe(type);
    }
  });

  it("rejects unknown types", () => {
    expect(isDomainEventType("NOT_A_TYPE")).toBe(false);
    expect(isDomainEventType("intent_created")).toBe(false);
    expect(isDomainEventType(1)).toBe(false);
    expect(() => parseDomainEventType("NOT_A_TYPE")).toThrow(DomainInvariantError);
    expect(() => parseDomainEventType(null)).toThrow(DomainInvariantError);
  });

  it("accepts every member at compile time via the union", () => {
    const assignments: DomainEventType[] = [
      "INTENT_CREATED",
      "PLAN_PUBLISHED",
      "TASK_DUE",
      "OBSERVATION_RECORDED",
      "OBSERVATION_SUPERSEDED",
      "EVIDENCE_INGESTED",
      "ACCESS_GRANTED",
      "ACCESS_REVOKED",
      "ACCESS_EVALUATED",
      "SERVICE_ORDER_CREATED",
      "SERVICE_ORDER_FULFILLED",
      "EXTENSION_INSTALLED",
      "STUDY_ENROLLED",
      "SAFETY_FLAG_RAISED",
    ];
    expect(assignments).toHaveLength(14);
  });
});
