/**
 * @orbb/domain — pure domain contracts for ORBB.
 *
 * Zero runtime dependencies. No provider SDK types are imported or
 * re-exported here; this package is the innermost layer of the frozen
 * architecture and must stay pure.
 */
export * from "./errors.js";
export * from "./ids.js";
export * from "./evidence.js";
export * from "./provenance.js";
export * from "./intent.js";
export * from "./observation.js";
export * from "./plan.js";
export * from "./grant.js";
