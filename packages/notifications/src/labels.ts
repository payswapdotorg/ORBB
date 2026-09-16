/**
 * Reminder label directory (B8) — the human-safe label seam.
 *
 * Reminder payloads carry HUMAN-SAFE LABELS next to opaque ids (the B8 PHI
 * rule: "task/metric/window ids and human-safe labels ONLY"). Labels are
 * supplied through an injected directory so the wording surface stays an
 * application/i18n concern (Lane B), never engine logic. The engine NEVER
 * generates free text of its own and NEVER falls back to echoing
 * person-identifying or clinical content — a directory miss yields the
 * fixed NEUTRAL fallback labels below (non-authoritative, non-clinical,
 * non-identifying: reminders nudge, they never assert clinical
 * conclusions).
 *
 * Labels are SUPPOSED to be safe input: the directory is the trust
 * boundary for wording, and its implementations at the app boundary are
 * responsible for sourcing labels from governed catalogs (SYNTH-marked
 * fixtures everywhere in tests — the AGENTS.md test-data rule).
 */

/** A directory of human-safe labels for metric and method ids. */
export interface ReminderLabelDirectory {
  /** Human-safe display label for a metric id, or `undefined` when unknown. */
  metricLabel(metricId: string): string | undefined;
  /** Human-safe display label for a method id, or `undefined` when unknown. */
  methodLabel(methodId: string): string | undefined;
}

/**
 * Neutral fallback metric label — used when the directory misses. Fixed
 * vocabulary: non-identifying, non-clinical, non-alarming.
 */
export const DEFAULT_METRIC_LABEL = "A planned measurement";

/**
 * Neutral fallback method label — used when the directory misses (and in
 * the fallback-offer vocabulary for methods without labels).
 */
export const DEFAULT_METHOD_LABEL = "An alternative capture method";

/**
 * In-memory {@link ReminderLabelDirectory} (the test/impl double). Exact
 * id -> label mapping; a miss falls through to `undefined` so the engine
 * applies the neutral fallbacks (miss behavior is engine-owned and thus
 * testable).
 */
export class InMemoryReminderLabelDirectory implements ReminderLabelDirectory {
  readonly #metricLabels: ReadonlyMap<string, string>;
  readonly #methodLabels: ReadonlyMap<string, string>;

  constructor(entries: {
    readonly metricLabels?: Readonly<Record<string, string>>;
    readonly methodLabels?: Readonly<Record<string, string>>;
  }) {
    this.#metricLabels = new Map(Object.entries(entries.metricLabels ?? {}));
    this.#methodLabels = new Map(Object.entries(entries.methodLabels ?? {}));
  }

  metricLabel(metricId: string): string | undefined {
    return this.#metricLabels.get(metricId);
  }

  methodLabel(methodId: string): string | undefined {
    return this.#methodLabels.get(methodId);
  }
}
