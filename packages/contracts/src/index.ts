/**
 * @orbb/contracts — cross-service contracts for ORBB.
 *
 * Owns the canonical domain event envelope (architecture §11), the frozen
 * event-type union, and the transactional outbox record interface. This
 * package must stay free of provider SDK types; `@orbb/domain` is its only
 * dependency.
 */
export * from "./eventTypes.js";
export * from "./envelope.js";
export * from "./outbox.js";
