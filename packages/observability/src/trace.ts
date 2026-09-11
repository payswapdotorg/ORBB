/**
 * Trace primitives (architecture §2: "observability — tracing"). A
 * `Trace` owns a `traceId` and a list of spans. `startSpan(name,
 * attributes)` records `{spanId, name, startedAt, attributes?}` and
 * `endSpan(spanId)` fills in `durationMs` using the injectable clock.
 * Span attributes pass through the SAME redaction policy as log records
 * BEFORE storage: a `Trace` never retains raw PHI. Pure: no hidden clock
 * or id source — both are injectable; the trace mutates only its own
 * internal span list.
 */
import { redact, type RedactableRecord, type RedactedRecord, type RedactionPolicy, defaultRedactionPolicy } from "./redaction.js";

/** Attributes accepted at span start (same shape as log context fields). */
export type SpanAttributes = RedactableRecord;

/** A recorded span. `durationMs` is present once the span ended. */
export interface Span {
  readonly spanId: string;
  /** Operational span name. Must not contain PHI (calling convention). */
  readonly name: string;
  /** Span start in epoch milliseconds (injectable clock). */
  readonly startedAt: number;
  readonly durationMs?: number;
  /** Redacted attributes (never the raw caller object). */
  readonly attributes?: RedactedRecord;
}

/** Options for `createTrace`. */
export interface TraceOptions {
  /** Correlatable trace identifier. Default: generated. */
  readonly traceId?: string;
  /** Redaction policy applied to span attributes. Default: `defaultRedactionPolicy`. */
  readonly policy?: RedactionPolicy;
  /** Injectable time source (epoch ms). Default: `Date.now`. */
  readonly nowMs?: () => number;
  /** Injectable span-id source. Default: random ids. */
  readonly newSpanId?: () => string;
}

/** A trace: `traceId` plus its spans (live view). */
export interface Trace {
  readonly traceId: string;
  /** Spans in start order. Live view — copy externally for snapshots. */
  readonly spans: readonly Span[];
  /** Starts a span, redacts attributes, returns the new spanId. */
  startSpan(name: string, attributes?: SpanAttributes): string;
  /**
   * Ends the span: records `durationMs = nowMs() - startedAt`. Returns
   * `false` (without throwing) when the spanId is unknown or the span
   * already ended.
   */
  endSpan(spanId: string): boolean;
}

let fallbackIdCounter = 0;

/** Random id with a `crypto.randomUUID` fallback (deterministic environments). */
function randomId(prefix: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID !== undefined) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  fallbackIdCounter += 1;
  return `${prefix}-${fallbackIdCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

class TraceImpl implements Trace {
  readonly traceId: string;
  readonly #spans: Span[] = [];
  readonly #policy: RedactionPolicy;
  readonly #nowMs: () => number;
  readonly #newSpanId: () => string;

  constructor(options: TraceOptions) {
    this.traceId = options.traceId ?? randomId("trace");
    this.#policy = options.policy ?? defaultRedactionPolicy;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#newSpanId = options.newSpanId ?? (() => randomId("span"));
  }

  get spans(): readonly Span[] {
    return this.#spans;
  }

  startSpan(name: string, attributes?: SpanAttributes): string {
    const spanId = this.#newSpanId();
    const span: Span = {
      spanId,
      name,
      startedAt: this.#nowMs(),
      ...(attributes !== undefined ? { attributes: redact(attributes, this.#policy) } : {}),
    };
    this.#spans.push(span);
    return spanId;
  }

  endSpan(spanId: string): boolean {
    const index = this.#spans.findIndex((span) => span.spanId === spanId);
    const span = this.#spans[index];
    if (span === undefined || span.durationMs !== undefined) {
      return false;
    }
    // Not clamped: an injectable clock is expected to be non-decreasing;
    // a regressing clock is surfaced, not hidden.
    this.#spans[index] = { ...span, durationMs: this.#nowMs() - span.startedAt };
    return true;
  }
}

/** Creates a trace. Span attributes are redacted before storage. */
export function createTrace(options?: TraceOptions): Trace {
  return new TraceImpl(options ?? {});
}
