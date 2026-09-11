/**
 * @orbb/observability — structured logging, tracing, PHI redaction.
 *
 * Pure TypeScript: zero runtime dependencies, no provider SDK imports
 * (Sentry/PostHog adapters arrive in a later milestone behind the
 * @orbb/platform interface pattern). Implements the architecture §6
 * invariant: never send full PHI through generic logs or URLs. Every
 * record, span attribute, and request envelope passes the deny-by-default
 * redaction policy before it is stored or emitted.
 */
export * from "./record.js";
export * from "./sha256.js";
export * from "./redaction.js";
export * from "./logger.js";
export * from "./trace.js";
export * from "./envelope.js";
