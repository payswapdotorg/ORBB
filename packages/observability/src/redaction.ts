/**
 * PHI redaction engine (architecture §2 "observability — structured
 * logging, tracing, redaction"; §6 invariant: "Never send full PHI
 * through PostHog, Sentry breadcrumbs, generic logs, queue metadata, or
 * URLs").
 *
 * `redact(record, policy)` is a pure function: it never mutates its
 * input, it has no side effects, and identical inputs produce identical
 * outputs. Redaction is deny-by-default: a field survives only when the
 * policy explicitly allows it (exact name or allow pattern); everything
 * unmatched is replaced with `REDACTED_VALUE`.
 *
 * Precedence for a field name (first match wins):
 *   1. exact deny name      -> redact   (never overridable, not even by an exact allow entry)
 *   2. exact pseudonym name -> hash     (stable, non-reversible, correlatable)
 *   3. exact allow name     -> keep     (overrides deny/allow patterns)
 *   4. deny pattern         -> redact   (overrides allow patterns)
 *   5. allow pattern        -> keep
 *   6. unmatched            -> `unmatchedAction` (default: redact)
 *
 * Kept values are still hardened: strings are truncated to
 * `maxStringLength`, non-finite numbers become `null`, and any runtime
 * value outside `LogValue` (objects, arrays, symbols, functions —
 * smuggled in despite the type contract) is replaced with
 * `REDACTED_VALUE`.
 */
import type { LogValue } from "./record.js";
import { sha256Hex } from "./sha256.js";

/** Marker substituted for every redacted field value. */
export const REDACTED_VALUE = "[REDACTED]";

/** Marker appended (within the cap) to truncated strings. */
const TRUNCATION_SUFFIX = "...";

/** Default pseudonym length in hex characters. */
const DEFAULT_PSEUDONYM_LENGTH = 12;

/** Default string truncation cap applied to kept string values. */
const DEFAULT_MAX_STRING_LENGTH = 256;

/** Action taken for fields that match no policy rule. */
export type RedactionAction = "redact" | "allow";

/** Input accepted by `redact`: a flat bag of log values. */
export type RedactableRecord = Readonly<Record<string, LogValue | undefined>>;

/** Output of `redact`: a flat bag of already-safe values. */
export type RedactedRecord = Readonly<Record<string, LogValue>>;

/**
 * Deny-by-default redaction policy.
 *
 * The three field-name lists are required so that policies are explicit;
 * scalar knobs default as documented. Use a module-level constant policy
 * (compilation is cached per policy object).
 */
export interface RedactionPolicy {
  /** Exact field names that are always redacted (never overridable). */
  readonly denyFieldNames: readonly string[];
  /** Field-name regexes that are redacted unless exactly allowed. */
  readonly denyFieldPatterns: readonly RegExp[];
  /** Exact field names allowed to survive (overrides deny patterns). */
  readonly allowFieldNames: readonly string[];
  /** Field-name regexes allowed to survive (never override a deny rule). */
  readonly allowFieldPatterns: readonly RegExp[];
  /** Exact field names replaced with a stable hash pseudonym. */
  readonly pseudonymFieldNames: readonly string[];
  /** Pseudonym length in hex characters (4-64). Default: 12. */
  readonly pseudonymLength?: number;
  /** Pepper mixed into pseudonym hashes. Default: "" (stable across calls). */
  readonly pseudonymPepper?: string;
  /** Truncation cap for kept string values. Default: 256. */
  readonly maxStringLength?: number;
  /** Action for unmatched fields. Default: "redact" (deny-by-default). */
  readonly unmatchedAction?: RedactionAction;
}

/** Options for the standalone `pseudonymize` helper. */
export interface PseudonymOptions {
  /** Pseudonym length in hex characters (4-64). Default: 12. */
  readonly length?: number;
  /** Pepper mixed into the hash. Default: "". */
  readonly pepper?: string;
}

/**
 * Default policy: deny-by-default. Allowlist covers the log envelope,
 * correlation identifiers, HTTP operational fields, deployment identity,
 * duration/count/boolean-flag patterns, and the synthetic fixture tag.
 * Pseudonyms cover subject/actor/device-style references that must stay
 * correlatable without being identifying.
 */
export const defaultRedactionPolicy: RedactionPolicy = {
  denyFieldNames: [
    "value",
    "conceptCode",
    "observation",
    "evidence",
    "personId",
    "patientId",
    "subject",
    "authorization",
    "accessToken",
    "refreshToken",
    "apiKey",
    "password",
    "cookie",
    "setCookie",
    "ssn",
    "mrn",
    "dob",
    "dateOfBirth",
    "birthDate",
    "firstName",
    "lastName",
    "fullName",
    "givenName",
    "familyName",
    "email",
    "emailAddress",
    "phone",
    "phoneNumber",
    "address",
    "notes",
    "diagnosis",
    "medication",
  ],
  denyFieldPatterns: [
    /phi/i,
    /patient/i,
    /person/i,
    /birth/i,
    /name/i,
    /email/i,
    /phone/i,
    /address/i,
    /authorization/i,
    /bearer/i,
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
    /cookie/i,
    /ssn/i,
    /mrn/i,
    /diagnos/i,
    /medication/i,
    /treatment/i,
  ],
  allowFieldNames: [
    "ts",
    "level",
    "msg",
    "event",
    "durationMs",
    "correlationId",
    "requestId",
    "traceId",
    "spanId",
    "causationId",
    "eventId",
    "routePattern",
    "method",
    "status",
    "statusCode",
    "environment",
    "service",
    "version",
  ],
  allowFieldPatterns: [
    /Ms$/,
    /[Cc]ount$/,
    /^is[A-Z]/,
    /^has[A-Z]/,
    /^synthetic/i,
  ],
  pseudonymFieldNames: ["subjectRef", "personRef", "userId", "actorId", "deviceId", "accountId"],
  unmatchedAction: "redact",
};

type FieldDecision = "keep" | "redact" | "pseudonymize";

interface CompiledPolicy {
  readonly denyNames: ReadonlySet<string>;
  readonly denyPatterns: readonly RegExp[];
  readonly allowNames: ReadonlySet<string>;
  readonly allowPatterns: readonly RegExp[];
  readonly pseudonymNames: ReadonlySet<string>;
  readonly pseudonymLength: number;
  readonly pepper: string;
  readonly maxStringLength: number;
  readonly unmatchedAction: RedactionAction;
}

const compiledPolicies = new WeakMap<RedactionPolicy, CompiledPolicy>();

/**
 * Copies a caller regex without `g`/`y` flags so `test()` stays stateless
 * (keeps `redact` pure even if a policy regex was authored with `/g`).
 */
function detached(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
}

function validatedPseudonymLength(length: number): number {
  if (!Number.isInteger(length) || length < 4 || length > 64) {
    throw new RangeError("RedactionPolicy.pseudonymLength must be an integer between 4 and 64.");
  }
  return length;
}

function validatedMaxStringLength(cap: number): number {
  if (!Number.isInteger(cap) || cap < 4) {
    throw new RangeError("RedactionPolicy.maxStringLength must be an integer >= 4.");
  }
  return cap;
}

function compilePolicy(policy: RedactionPolicy): CompiledPolicy {
  const cached = compiledPolicies.get(policy);
  if (cached !== undefined) {
    return cached;
  }
  const compiled: CompiledPolicy = {
    denyNames: new Set(policy.denyFieldNames),
    denyPatterns: policy.denyFieldPatterns.map(detached),
    allowNames: new Set(policy.allowFieldNames),
    allowPatterns: policy.allowFieldPatterns.map(detached),
    pseudonymNames: new Set(policy.pseudonymFieldNames),
    pseudonymLength: validatedPseudonymLength(policy.pseudonymLength ?? DEFAULT_PSEUDONYM_LENGTH),
    pepper: policy.pseudonymPepper ?? "",
    maxStringLength: validatedMaxStringLength(policy.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH),
    unmatchedAction: policy.unmatchedAction ?? "redact",
  };
  compiledPolicies.set(policy, compiled);
  return compiled;
}

function decideField(name: string, compiled: CompiledPolicy): FieldDecision {
  if (compiled.denyNames.has(name)) {
    return "redact";
  }
  if (compiled.pseudonymNames.has(name)) {
    return "pseudonymize";
  }
  if (compiled.allowNames.has(name)) {
    return "keep";
  }
  if (compiled.denyPatterns.some((pattern) => pattern.test(name))) {
    return "redact";
  }
  if (compiled.allowPatterns.some((pattern) => pattern.test(name))) {
    return "keep";
  }
  return compiled.unmatchedAction === "allow" ? "keep" : "redact";
}

function truncateString(value: string, cap: number): string {
  if (value.length <= cap) {
    return value;
  }
  if (cap <= TRUNCATION_SUFFIX.length) {
    return value.slice(0, cap);
  }
  return value.slice(0, cap - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function sanitizeKeptValue(value: LogValue, compiled: CompiledPolicy): LogValue {
  if (typeof value === "string") {
    return truncateString(value, compiled.maxStringLength);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  // Runtime defense: anything outside LogValue (objects, arrays, symbols,
  // functions — smuggled past the type contract) is redacted.
  return REDACTED_VALUE;
}

function pseudonymizeValue(value: LogValue, compiled: CompiledPolicy): LogValue {
  if (value === null) {
    return null;
  }
  return `hash:${sha256Hex(compiled.pepper + String(value)).slice(0, compiled.pseudonymLength)}`;
}

/**
 * Stable, non-reversible pseudonym for a single value: the first
 * `length` hex characters of `SHA-256(pepper + value)`, prefixed with
 * `"hash:"`. Same input -> same pseudonym; distinct inputs -> distinct
 * pseudonyms (up to hash truncation).
 */
export function pseudonymize(value: string, options?: PseudonymOptions): string {
  const length = validatedPseudonymLength(options?.length ?? DEFAULT_PSEUDONYM_LENGTH);
  return `hash:${sha256Hex((options?.pepper ?? "") + value).slice(0, length)}`;
}

/**
 * Redact a flat record according to the policy. Pure: the input is never
 * mutated and the output only contains policy-approved `LogValue`s.
 * Keys with `undefined` values are dropped; "__proto__" keys are stored
 * as own properties (no prototype pollution).
 */
export function redact(record: RedactableRecord, policy: RedactionPolicy): RedactedRecord {
  const compiled = compilePolicy(policy);
  const output: Record<string, LogValue> = {};
  for (const [name, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }
    const decision = decideField(name, compiled);
    const safe: LogValue =
      decision === "redact"
        ? REDACTED_VALUE
        : decision === "pseudonymize"
          ? pseudonymizeValue(value, compiled)
          : sanitizeKeptValue(value, compiled);
    Object.defineProperty(output, name, {
      value: safe,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}
