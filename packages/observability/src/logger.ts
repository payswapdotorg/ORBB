/**
 * Structured logger (architecture §2: "observability — structured
 * logging"). `createLogger(context)` returns a logger whose
 * debug/info/warn/error methods emit flat structured records
 * `{ts, level, msg, event?, ...context, durationMs?}` through an
 * injectable `Sink`. The redaction policy ALWAYS runs between record
 * construction and the sink, so sinks only ever receive
 * policy-approved records (architecture §6: never send PHI through
 * generic logs).
 *
 * The logger never throws: sink failures are swallowed (observability
 * must not crash the host application). Determinism: the clock is
 * injectable (`nowMs`), defaulting to `Date.now`.
 */
import type { LogContext, LogFields, LogLevel, LogRecord, LogValue } from "./record.js";
import {
  defaultRedactionPolicy,
  redact,
  type RedactedRecord,
  type RedactionPolicy,
} from "./redaction.js";

/** Severity weights used for `minLevel` filtering. */
const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Destination for already-redacted records. */
export interface Sink {
  write(record: RedactedRecord): void;
}

/** Options for `createLogger`. */
export interface LoggerOptions {
  /** Destination sink. Default: `ConsoleSink` (one JSON line per record). */
  readonly sink?: Sink;
  /** Redaction policy applied before the sink. Default: `defaultRedactionPolicy`. */
  readonly policy?: RedactionPolicy;
  /** Injectable time source (epoch ms). Default: `Date.now`. */
  readonly nowMs?: () => number;
  /** Minimum emitted level. Default: "debug" (emit everything). */
  readonly minLevel?: LogLevel;
}

/** Structured logger with bound context and derived child loggers. */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Derives a logger with `context` merged over this logger's context. */
  child(context: LogContext): Logger;
}

/** Options for `ConsoleSink`. */
export interface ConsoleSinkOptions {
  /**
   * Line writer (receives the serialized line and the record level).
   * Default: `console.log/info/warn/error` via `globalThis` — never
   * throws when no console exists.
   */
  readonly writeLine?: (line: string, level: LogLevel) => void;
  /** Serializer. Default: single-line `JSON.stringify`. */
  readonly serialize?: (record: RedactedRecord) => string;
}

function readLevel(record: RedactedRecord): LogLevel {
  const level = record["level"];
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}

const defaultWriteLine = (line: string, level: LogLevel): void => {
  const consoleApi = (globalThis as {
    console?: Partial<Record<"log" | LogLevel, (message: string) => void>>;
  }).console;
  const write = consoleApi?.[level] ?? consoleApi?.log;
  write?.call(consoleApi, line);
};

const defaultSerialize = (record: RedactedRecord): string => JSON.stringify(record);

/**
 * Console sink: one serialized line per record, routed by level. The
 * default serialization is `JSON.stringify`, which also escapes control
 * characters (log-injection safe).
 */
export class ConsoleSink implements Sink {
  readonly #writeLine: (line: string, level: LogLevel) => void;
  readonly #serialize: (record: RedactedRecord) => string;

  constructor(options?: ConsoleSinkOptions) {
    this.#writeLine = options?.writeLine ?? defaultWriteLine;
    this.#serialize = options?.serialize ?? defaultSerialize;
  }

  write(record: RedactedRecord): void {
    this.#writeLine(this.#serialize(record), readLevel(record));
  }
}

/**
 * In-memory sink for tests and short-lived diagnostics. Stores the
 * exact redacted record objects emitted by a logger.
 */
export class InMemorySink implements Sink {
  readonly #records: RedactedRecord[] = [];

  write(record: RedactedRecord): void {
    this.#records.push(record);
  }

  /** Emitted records in order (live view). */
  get records(): readonly RedactedRecord[] {
    return this.#records;
  }

  /** Clears stored records (test-reset convenience). */
  clear(): void {
    this.#records.length = 0;
  }
}

class LoggerImpl implements Logger {
  readonly #bound: Record<string, LogValue>;
  readonly #sink: Sink;
  readonly #policy: RedactionPolicy;
  readonly #nowMs: () => number;
  readonly #minLevel: LogLevel;

  constructor(bound: Record<string, LogValue>, options: LoggerOptions) {
    this.#bound = bound;
    this.#sink = options.sink ?? new ConsoleSink();
    this.#policy = options.policy ?? defaultRedactionPolicy;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#minLevel = options.minLevel ?? "debug";
  }

  child(context: LogContext): Logger {
    return new LoggerImpl(
      { ...this.#bound, ...context },
      {
        sink: this.#sink,
        policy: this.#policy,
        nowMs: this.#nowMs,
        minLevel: this.#minLevel,
      },
    );
  }

  debug(msg: string, fields?: LogFields): void {
    this.#emit("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.#emit("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.#emit("warn", msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.#emit("error", msg, fields);
  }

  #emit(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.#minLevel]) {
      return;
    }
    const { event, durationMs, ...rest } = fields ?? {};
    // Envelope fields are written last, so they win collisions with
    // context keys of the same name.
    const record: LogRecord = {
      ...this.#bound,
      ...rest,
      ts: this.#nowMs(),
      level,
      msg,
      ...(event !== undefined ? { event } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    const safe = redact(record, this.#policy);
    try {
      this.#sink.write(safe);
    } catch {
      // Observability must never crash the host application.
    }
  }
}

/**
 * Creates a logger with bound context. The redaction policy always runs
 * between record construction and the sink: raw PHI field values can
 * never reach a sink.
 */
export function createLogger(context?: LogContext, options?: LoggerOptions): Logger {
  return new LoggerImpl({ ...context }, options ?? {});
}
