/**
 * Per-suite deterministic reset strategy.
 *
 * ORBB suites never rely on shared state or wall-clock time: every suite
 * builds its fixtures through `@orbb/testkit` primitives, and a
 * {@link TestReset} returns them to a known baseline between suites:
 *
 *   - clocks return to their initial epoch (deterministic time),
 *   - id-factory counters return to zero (deterministic identifiers),
 *   - registered in-memory stores are cleared (deterministic data).
 *
 * The reference {@link InMemoryTestReset} keeps registration order stable,
 * so the returned action report is itself deterministic. Nothing here
 * touches databases or any external system — a real (per-tenant / per-branch
 * Neon preview) reset is owned by the platform lane and is out of scope for
 * unit and contract tests, which must run without credentials.
 */

/** Anything that can restore itself to its construction baseline. */
export interface Resettable {
  reset(): void;
}

/** An in-memory store that can be emptied (`Map`, `Set`, custom stores). */
export interface ClearableStore {
  clear(): void;
  readonly size: number;
}

/** One recorded outcome of a `TestReset.reset()` run. */
export interface ResetAction {
  readonly label: string;
  readonly kind: "reset" | "cleared";
}

/**
 * Human-readable statement of the reset strategy (also surfaced as the
 * `description` of {@link InMemoryTestReset}).
 */
export const TEST_RESET_STRATEGY =
  "Per-suite deterministic reset: clocks return to their initial epoch, id counters return to zero, and registered in-memory stores are cleared. Registration order is preserved so reset reports are deterministic. No external system is touched — unit and contract tests must not require credentials.";

/** Injectable per-suite reset helper. */
export interface TestReset {
  /** Human-readable description of the reset strategy. */
  readonly description: string;
  /** Registers a resettable (clock, id factory, fixture context, …) under a unique label. */
  addResettable(label: string, target: Resettable): void;
  /** Registers an in-memory store (`Map`, `Set`, …) under a unique label. */
  addStore(label: string, store: ClearableStore): void;
  /**
   * Resets everything to baseline: resettables in registration order
   * (clock to epoch, counters to zero), then stores (cleared). Returns the
   * deterministic action report.
   */
  reset(): readonly ResetAction[];
}

/**
 * Reference in-memory `TestReset` implementation. Labels must be unique
 * and non-empty so reports stay unambiguous.
 */
export class InMemoryTestReset implements TestReset {
  readonly description: string;
  readonly #resettables: Array<{ label: string; target: Resettable }> = [];
  readonly #stores: Array<{ label: string; store: ClearableStore }> = [];
  #resetCount = 0;

  constructor(description: string = TEST_RESET_STRATEGY) {
    if (description.length === 0) {
      throw new RangeError("TestReset description must be a non-empty string.");
    }
    this.description = description;
  }

  /** How many times `reset()` has run (useful for suite-order assertions). */
  get resetCount(): number {
    return this.#resetCount;
  }

  addResettable(label: string, target: Resettable): void {
    this.#assertLabel(label);
    this.#resettables.push({ label, target });
  }

  addStore(label: string, store: ClearableStore): void {
    this.#assertLabel(label);
    this.#stores.push({ label, store });
  }

  reset(): readonly ResetAction[] {
    const actions: ResetAction[] = [];
    for (const { label, target } of this.#resettables) {
      target.reset();
      actions.push({ label, kind: "reset" });
    }
    for (const { label, store } of this.#stores) {
      store.clear();
      actions.push({ label, kind: "cleared" });
    }
    this.#resetCount += 1;
    return actions;
  }

  #assertLabel(label: string): void {
    if (label.length === 0) {
      throw new RangeError("TestReset labels must be non-empty.");
    }
    const existing = [...this.#resettables, ...this.#stores].map((entry) => entry.label);
    if (existing.includes(label)) {
      throw new RangeError(`TestReset label "${label}" is already registered.`);
    }
  }
}
