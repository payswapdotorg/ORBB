/**
 * Deterministic identifier factory.
 *
 * Emits `<prefix>_<body>` identifiers whose body is
 * `SYNTH-<seed>-<zero-padded counter>`:
 *
 *   - `SYNTH-` marker: every generated id is obviously synthetic and can
 *     never be confused with a real record identifier (agent-protocol
 *     test-data rule).
 *   - `<seed>`: fixed per factory instance, so two factories built with
 *     the same seed replay identical sequences.
 *   - `<counter>`: globally monotonic across prefixes (a single counter
 *     serves every prefix), so ids are unique and creation-ordered within
 *     a factory instance.
 *
 * Grammar alignment: `@orbb/domain` canonical ids are `<prefix>_<body>`
 * with a 16–128 character body of `[A-Za-z0-9_-]`. With a 1–64 character
 * seed and the counter zero-padded to 8 digits, generated bodies always
 * satisfy that grammar — `next()` asserts it defensively — so factory
 * output passes the domain guards (`isPersonId`, `parseId`, …) and can be
 * safely cast to the branded id types by fixture builders.
 */
import type { Resettable } from "./reset.js";

/** Injectable id source. Implementations must be deterministic per construction options. */
export interface IdFactory {
  next(prefix: string): string;
}

/** Marker included in every generated id body, keeping ids obviously synthetic. */
export const SYNTH_ID_MARKER = "SYNTH";

/** Default seed used when none is provided ("seed-0001"). */
export const DEFAULT_ID_SEED = "seed-0001";

const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PREFIX_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const MIN_BODY_LENGTH = 16;
const MAX_BODY_LENGTH = 128;
const COUNTER_WIDTH = 8;

/** Options for constructing a {@link DeterministicIdFactory}. */
export interface IdFactoryOptions {
  /** Seed embedded in every id body (1–64 chars of `[A-Za-z0-9_-]`). */
  readonly seed?: string | undefined;
}

/**
 * Reference deterministic `IdFactory`. One globally monotonic counter per
 * instance; the sequence restarts on `reset()`.
 */
export class DeterministicIdFactory implements IdFactory, Resettable {
  readonly #seed: string;
  #counter: number;

  constructor(options?: IdFactoryOptions) {
    const seed = options?.seed ?? DEFAULT_ID_SEED;
    if (!SEED_PATTERN.test(seed)) {
      throw new RangeError(
        "DeterministicIdFactory seed must be 1-64 characters of [A-Za-z0-9_-].",
      );
    }
    this.#seed = seed;
    this.#counter = 0;
  }

  /** The seed this factory embeds in every id body. */
  get seed(): string {
    return this.#seed;
  }

  /** Number of ids issued since construction or the last `reset()`. */
  get issued(): number {
    return this.#counter;
  }

  next(prefix: string): string {
    if (!PREFIX_PATTERN.test(prefix)) {
      throw new RangeError(
        "DeterministicIdFactory prefix must be 1-32 characters of [A-Za-z0-9_-].",
      );
    }
    this.#counter += 1;
    const counter = this.#counter.toString().padStart(COUNTER_WIDTH, "0");
    const body = `${SYNTH_ID_MARKER}-${this.#seed}-${counter}`;
    if (body.length < MIN_BODY_LENGTH || body.length > MAX_BODY_LENGTH) {
      throw new RangeError(
        `DeterministicIdFactory produced a body outside the canonical 16-128 character range (seed too long, or more than 10^8 ids issued).`,
      );
    }
    return `${prefix}_${body}`;
  }

  /** Returns the counter to zero (TestReset-compatible). */
  reset(): void {
    this.#counter = 0;
  }
}
