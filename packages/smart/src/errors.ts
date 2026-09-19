/**
 * Programmer-facing invariant errors for the SMART launch boundary.
 *
 * These describe SHAPE violations of OUR OWN configuration and internal
 * contracts (malformed constructor options, malformed exchange inputs
 * produced by our own parser, structurally invalid doubles) and are never
 * user-facing: every EXTERNAL launch outcome (parsing, validation,
 * exchange, verification) is a typed, deny-by-default result — see
 * `launch-context.ts`, `exchange.ts`, and `evaluation.ts`. Like the
 * @orbb/auth invariant errors, messages describe the expected shape and
 * never echo the offending value (no PHI, no secrets, no launch handles).
 */
export class SmartInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartInvariantError";
  }
}

/** Type guard: is `value` an {@link SmartInvariantError}? */
export function isSmartInvariantError(value: unknown): value is SmartInvariantError {
  return value instanceof SmartInvariantError;
}
