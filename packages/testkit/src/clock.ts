/**
 * Deterministic clock for tests and local harnesses.
 *
 * ORBB time-dependent logic (consent expiry, observation timestamps,
 * rate-limit windows) must be testable without sleeping or depending on
 * wall-clock time. `Clock` is the injectable seam; `DeterministicClock` is
 * the reference implementation:
 *
 *   - it starts at a fixed epoch (Unix epoch 0 by default),
 *   - it only moves forward through explicit `advance`/`advanceTo` calls,
 *   - `now()` always returns a defensive copy, so consumers cannot corrupt
 *     the clock by mutating a returned Date,
 *   - `reset()` restores the initial epoch, which makes the clock
 *     registrable with {@link import("./reset.js").TestReset} for the
 *     per-suite deterministic reset strategy.
 */
import type { Resettable } from "./reset.js";

/**
 * Injectable time source. Implementations must return a fresh `Date` on
 * every call (defensive copy) and must never be affected by consumer
 * mutation of returned values.
 */
export interface Clock {
  now(): Date;
}

/** Default starting point for `DeterministicClock`: the Unix epoch (0 ms). */
export const DEFAULT_CLOCK_EPOCH_MS = 0;

/** Options for constructing a {@link DeterministicClock}. */
export interface ClockOptions {
  /** Initial epoch in milliseconds (non-negative, finite). Default 0. */
  readonly epochMs?: number | undefined;
}

/**
 * Reference deterministic `Clock`. Deterministic because: same
 * construction options + same advance calls => same `now()` output,
 * always. No wall-clock access, no randomness.
 */
export class DeterministicClock implements Clock, Resettable {
  readonly #initialEpochMs: number;
  #epochMs: number;

  constructor(options?: ClockOptions) {
    const initial = options?.epochMs ?? DEFAULT_CLOCK_EPOCH_MS;
    assertEpochMs(initial, "initial epoch");
    this.#initialEpochMs = initial;
    this.#epochMs = initial;
  }

  /** Current epoch in milliseconds. */
  get epochMs(): number {
    return this.#epochMs;
  }

  now(): Date {
    return new Date(this.#epochMs);
  }

  /**
   * Advances the clock forward by `ms` milliseconds and returns the new
   * time. Zero is allowed (no-op); negative or non-finite deltas throw
   * `RangeError` (time must not run backwards on a deterministic clock —
   * use `reset()` or `advanceTo()` for deliberate repositioning).
   */
  advance(ms: number): Date {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(
        "DeterministicClock.advance requires a finite, non-negative millisecond delta.",
      );
    }
    this.#epochMs += ms;
    return this.now();
  }

  /**
   * Sets the clock to an absolute epoch (non-negative, finite). Unlike
   * `advance`, repositioning (including backwards) is an explicit,
   * absolute operation used by harnesses and resets.
   */
  advanceTo(epochMs: number): void {
    assertEpochMs(epochMs, "target epoch");
    this.#epochMs = epochMs;
  }

  /** Restores the initial epoch (TestReset-compatible). */
  reset(): void {
    this.#epochMs = this.#initialEpochMs;
  }
}

function assertEpochMs(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `DeterministicClock ${label} must be a finite, non-negative epoch millisecond value.`,
    );
  }
}
