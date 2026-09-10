/**
 * Canonical domain event types (architecture §11).
 *
 * The vocabulary is frozen: adding, renaming, or removing an event type is
 * a tech-lead decision, not a worker decision.
 */
import { DomainInvariantError } from "@orbb/domain";

export const DOMAIN_EVENT_TYPES = [
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
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isDomainEventType(value: unknown): value is DomainEventType {
  return (
    typeof value === "string" && (DOMAIN_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function parseDomainEventType(value: unknown): DomainEventType {
  if (!isDomainEventType(value)) {
    throw new DomainInvariantError(
      `Invalid domain event type: expected one of ${DOMAIN_EVENT_TYPES.join(" | ")}.`,
    );
  }
  return value;
}
