/**
 * Structured log record shapes.
 *
 * The PHI-safety contract of `@orbb/observability` starts here: log fields
 * are restricted to `LogValue` primitives (architecture §6 — "Never send
 * full PHI through PostHog, Sentry breadcrumbs, generic logs, queue
 * metadata, or URLs"). Objects, arrays, and nested structures are
 * rejected by the type system and replaced with the redaction marker at
 * runtime if they are ever smuggled in. Every string that reaches a sink
 * is additionally subject to the policy truncation cap.
 */

/** Primitive value allowed in log records (never objects or arrays). */
export type LogValue = string | number | boolean | null;

/** Caller-supplied context fields bound to a logger or a single log call. */
export type LogContext = Readonly<Record<string, LogValue>>;

/** Log levels in ascending severity order: debug < info < warn < error. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Fields accepted by a single `logger.debug/info/warn/error` call.
 *
 * `event` and `durationMs` are envelope fields of the emitted record;
 * every other key becomes an inline context field of the record.
 */
export interface LogFields {
  /** Stable operational event name (e.g. `"http.request"`). Never PHI. */
  readonly event?: string;
  /** Measured duration in milliseconds. */
  readonly durationMs?: number;
  readonly [field: string]: LogValue;
}

/**
 * A structured log record: the envelope (`ts`, `level`, `msg`, `event?`,
 * `durationMs?`) plus flattened context fields. Records are built by the
 * logger and are ALWAYS passed through the redaction policy before they
 * reach a sink.
 */
export interface LogRecord {
  /** Emission timestamp in epoch milliseconds (injectable clock). */
  readonly ts: number;
  readonly level: LogLevel;
  /** Operational message. Must not contain PHI (calling convention). */
  readonly msg: string;
  readonly event?: string;
  readonly durationMs?: number;
  readonly [field: string]: LogValue | undefined;
}
