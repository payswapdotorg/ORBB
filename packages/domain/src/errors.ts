/**
 * Domain invariant violations.
 *
 * Every guard in `@orbb/domain` throws this typed error when an illegal
 * state transition or malformed domain value is encountered. Messages
 * describe the expected shape; they never echo received values (ORBB is a
 * health system — identifiers and payloads are treated as PHI-adjacent).
 */
export class DomainInvariantError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainInvariantError";
    // Keeps `instanceof DomainInvariantError` reliable even if a downstream
    // consumer downlevels classes when compiling this package.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
