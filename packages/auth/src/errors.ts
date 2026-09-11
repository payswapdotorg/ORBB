/**
 * Programmer-facing invariant errors for the identity boundary.
 *
 * These describe SHAPE violations (malformed inputs, broken store
 * contracts, impossible states) and are never user-facing: every
 * authentication *outcome* is a typed result (deny-by-default, §3 A22),
 * so these errors only fire on caller bugs. Like the @orbb/domain
 * invariant errors, messages describe the expected shape and never echo
 * the offending value (no PHI, no secrets).
 */
export class AuthInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInvariantError";
  }
}

/** Type guard: is `value` an {@link AuthInvariantError}? */
export function isAuthInvariantError(value: unknown): value is AuthInvariantError {
  return value instanceof AuthInvariantError;
}
