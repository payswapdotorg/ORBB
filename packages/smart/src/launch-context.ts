/**
 * SMART launch-context parsing and validation — the EHR->app launch seam.
 *
 * An external clinical system launches ORBB with launch parameters
 * (SMART on FHIR EHR launch: `iss` = the launching EHR's FHIR base URL,
 * `launch` = the opaque launch handle the EHR issued). This module is
 * the BOUNDARY: it parses those raw parameters totally and fail-closed.
 *
 * Parsing is TOTAL: malformed input produces a typed
 * {@link LaunchValidationFailure} with a distinct reason — NEVER a thrown
 * crash, NEVER a best-effort partial context. Every outcome (allow AND
 * deny) carries an audit-record shape stamped through the injected
 * `Clock` and `IdFactory` seams.
 *
 * Validation rules, each with a DISTINCT typed reason:
 *   - the input container must be a plain object (arrays/null/scalars
 *     are rejected);
 *   - `iss` must be an https URL with a host (http, ftp, protocol-
 *     relative URLs, hostless URLs are rejected; the SYNTH namespace
 *     `synth.test` / `*.synth.test` is allowed for tests and recorded
 *     as `synth: true` on the context);
 *   - `iss` must not embed credentials and must not carry a query or
 *     fragment (fail-closed: credentials leak, and a FHIR base URL
 *     identity never includes a query — architecture §6 never sends PHI
 *     through URLs);
 *   - `aud`, when the EHR supplies an audience hint, must match OUR
 *     registered client id exactly (mismatch = rejection);
 *   - `launch` must be present and a well-formed opaque handle
 *     (non-empty, <= 2048 chars, no control characters, no
 *     whitespace).
 *
 * Unknown parameters are IGNORED but recorded: their NAMES only, never
 * their values (a stray parameter value could carry PHI; the boundary
 * keeps it out of every downstream shape).
 *
 * Recorded assumptions:
 *   - `iss` normalization: scheme + host + port + path, with ONE trailing
 *     "/" stripped from non-root paths; query/fragment are REJECTED, not
 *     stripped (see above). Comparison against registered issuers uses
 *     the normalized form.
 *   - `audience` (OUR client id) is OUR configuration: a malformed one
 *     is a programmer error and throws {@link SmartInvariantError}.
 *     EXTERNAL input, by contrast, always gets typed rejections.
 *   - Validation order is fixed (container -> iss -> aud -> launch) and
 *     first-failure-wins: the first violated rule is the reason
 *     recorded, no cascade.
 */
import type { Clock, IdFactory } from "@orbb/testkit";
import { auditIssHostOf, toSmartLaunchAuditRecord, type SmartLaunchAuditRecord } from "./audit.js";
import { SmartInvariantError } from "./errors.js";
import { SMART_AUDIT_ID_PREFIX, SmartRandomIdFactory, isSynthIssHost, systemClock } from "./ids.js";

/** Parameters this boundary knows. Everything else is "unknown" (recorded by name). */
export const SMART_LAUNCH_KNOWN_PARAMETERS = ["iss", "launch", "aud"] as const;

/** Typed rejection classes for launch-context validation. */
export const LAUNCH_VALIDATION_REASONS = [
  "INPUT_NOT_OBJECT",
  "ISS_MISSING",
  "ISS_MALFORMED",
  "ISS_NOT_HTTPS",
  "ISS_NO_HOST",
  "ISS_CREDENTIALS_EMBEDDED",
  "ISS_QUERY_OR_FRAGMENT",
  "LAUNCH_MISSING",
  "LAUNCH_MALFORMED",
  "AUDIENCE_MALFORMED",
  "AUDIENCE_MISMATCH",
] as const;

/** Typed rejection classes for launch-context validation. */
export type LaunchValidationReason = (typeof LAUNCH_VALIDATION_REASONS)[number];

/** Hard handle-grammar bounds (the SMART handle is opaque; these bound abuse). */
export const SMART_LAUNCH_HANDLE_MAX_LENGTH = 2_048;

/**
 * The parsed launch parameters — NEVER partial. A `SmartLaunchContext`
 * exists only when every rule passed; failures produce typed rejections
 * instead.
 */
export interface SmartLaunchContext {
  /** Launching EHR's FHIR base URL, normalized (scheme+host+port+path). */
  readonly iss: string;
  /** Launching EHR's host (audit-safe identifier — never a full URL). */
  readonly issHost: string;
  /** The EHR-issued opaque launch handle. */
  readonly launch: string;
  /** OUR registered client id (the validated audience expectation). */
  readonly audience: string;
  /** True when `iss` is inside the reserved SYNTH namespace. */
  readonly synth: boolean;
  /** NAMES of parameters this boundary does not know (values never recorded). */
  readonly unknownParameters: readonly string[];
}

/** The typed rejection for a malformed launch. Never thrown, never partial. */
export interface LaunchValidationFailure {
  readonly ok: false;
  readonly reason: LaunchValidationReason;
  /** Shape description of the violated rule — never echoes raw input. */
  readonly message: string;
  readonly audit: SmartLaunchAuditRecord;
}

/** Result of {@link parseSmartLaunchContext}. */
export type SmartLaunchParseResult =
  | { readonly ok: true; readonly context: SmartLaunchContext; readonly audit: SmartLaunchAuditRecord }
  | LaunchValidationFailure;

/** Options for {@link parseSmartLaunchContext}. */
export interface SmartLaunchParseOptions {
  /** OUR registered OAuth client id — the required audience for every launch. */
  readonly audience: string;
  /** Injectable time source (audit timestamps). Default: wall clock. */
  readonly clock?: Clock;
  /** Injectable audit-record-id source. Default: {@link SmartRandomIdFactory}. */
  readonly idFactory?: IdFactory;
}

/** Control characters, DEL, and whitespace: forbidden in handles and audiences. */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function launchFailure(
  reason: LaunchValidationReason,
  message: string,
  issHost: string | null,
  at: Date,
  id: string,
): LaunchValidationFailure {
  return {
    ok: false,
    reason,
    message,
    audit: toSmartLaunchAuditRecord({
      id,
      stage: "launch-validation",
      decision: "DENY",
      reason,
      issHost,
      at,
    }),
  };
}

/** Best-effort host extraction FOR THE AUDIT RECORD only (never a context). */
function hostForAudit(iss: unknown): string | null {
  return typeof iss === "string" ? auditIssHostOf(iss) : null;
}

/** Normalizes a validated `iss` URL to scheme+host+port+path (trailing "/" stripped). */
function normalizeIss(url: URL): string {
  const path =
    url.pathname === "/"
      ? "" // root: iss is the origin, with no trailing slash
      : url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;
  return `${url.origin}${path}`;
}

/**
 * Normalizes an OUR-side issuer string (a double's registration) into
 * the same canonical form {@link parseSmartLaunchContext} produces, so
 * issuer comparisons always happen in one space. Programmer error when
 * the registration issuer is not a parseable https URL.
 */
export function normalizeSmartIssuer(issuer: string): string {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new SmartInvariantError(
      "SmartTokenExchange registration issuers must be parseable absolute https URLs.",
    );
  }
  if (url.protocol !== "https:") {
    throw new SmartInvariantError(
      "SmartTokenExchange registration issuers must use https.",
    );
  }
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new SmartInvariantError(
      "SmartTokenExchange registration issuers must be bare base URLs (no credentials, query, or fragment).",
    );
  }
  return normalizeIss(url);
}

/**
 * Validates OUR side of the seam: the audience expectation. Programmer
 * error (throws) when malformed — this is configuration we authored.
 */
function requireAudience(audience: string): string {
  if (
    typeof audience !== "string" ||
    audience.length === 0 ||
    audience.length > SMART_LAUNCH_HANDLE_MAX_LENGTH ||
    hasControlOrSpace(audience)
  ) {
    throw new SmartInvariantError(
      "SmartLaunchParseOptions.audience must be a non-empty string of at most 2048 characters without whitespace.",
    );
  }
  return audience;
}

/**
 * Parses and validates raw SMART launch parameters (total, fail-closed).
 *
 * `input` is the decoded launch parameter map exactly as the EHR passed
 * it (e.g. `{ iss, launch, aud? }`); unknown keys are ignored but their
 * NAMES are recorded on the context.
 */
export function parseSmartLaunchContext(
  input: unknown,
  options: SmartLaunchParseOptions,
): SmartLaunchParseResult {
  const audience = requireAudience(options.audience);
  const clock = options.clock ?? systemClock;
  const ids = options.idFactory ?? new SmartRandomIdFactory();
  const at = clock.now();
  const auditId = ids.next(SMART_AUDIT_ID_PREFIX);

  if (!isPlainObject(input)) {
    return launchFailure(
      "INPUT_NOT_OBJECT",
      "launch parameters must arrive as a plain object of parameter names to values",
      null,
      at,
      auditId,
    );
  }

  // --- iss: https URL with a host, no credentials, no query/fragment. ---
  const rawIss = input.iss;
  if (typeof rawIss !== "string" || rawIss.length === 0) {
    return launchFailure("ISS_MISSING", "launch parameter iss is required", null, at, auditId);
  }
  let issUrl: URL;
  try {
    issUrl = new URL(rawIss);
  } catch {
    return launchFailure(
      "ISS_MALFORMED",
      "launch parameter iss must be a parseable absolute URL",
      hostForAudit(rawIss),
      at,
      auditId,
    );
  }
  if (issUrl.protocol !== "https:") {
    return launchFailure(
      "ISS_NOT_HTTPS",
      "launch parameter iss must use https",
      issUrl.host.length > 0 ? issUrl.host : null,
      at,
      auditId,
    );
  }
  if (issUrl.host.length === 0) {
    return launchFailure("ISS_NO_HOST", "launch parameter iss must carry a host", null, at, auditId);
  }
  if (issUrl.username.length > 0 || issUrl.password.length > 0) {
    return launchFailure(
      "ISS_CREDENTIALS_EMBEDDED",
      "launch parameter iss must not embed credentials",
      issUrl.host,
      at,
      auditId,
    );
  }
  if (issUrl.search.length > 0 || issUrl.hash.length > 0) {
    return launchFailure(
      "ISS_QUERY_OR_FRAGMENT",
      "launch parameter iss is a FHIR base URL and must not carry a query or fragment",
      issUrl.host,
      at,
      auditId,
    );
  }

  // --- aud (optional EHR-supplied audience hint): must match ours exactly. ---
  if (input.aud !== undefined) {
    if (typeof input.aud !== "string" || input.aud.length === 0) {
      return launchFailure(
        "AUDIENCE_MALFORMED",
        "launch parameter aud, when present, must be a non-empty string",
        issUrl.host,
        at,
        auditId,
      );
    }
    if (input.aud !== audience) {
      return launchFailure(
        "AUDIENCE_MISMATCH",
        "launch parameter aud does not match the registered audience for this boundary",
        issUrl.host,
        at,
        auditId,
      );
    }
  }

  // --- launch: present, opaque, well-formed handle. ---
  const rawLaunch = input.launch;
  if (typeof rawLaunch !== "string" || rawLaunch.length === 0) {
    return launchFailure(
      "LAUNCH_MISSING",
      "launch parameter launch is required",
      issUrl.host,
      at,
      auditId,
    );
  }
  if (
    rawLaunch.length > SMART_LAUNCH_HANDLE_MAX_LENGTH ||
    hasControlOrSpace(rawLaunch)
  ) {
    return launchFailure(
      "LAUNCH_MALFORMED",
      `launch parameter launch must be an opaque handle of at most ${SMART_LAUNCH_HANDLE_MAX_LENGTH} characters without whitespace or control characters`,
      issUrl.host,
      at,
      auditId,
    );
  }

  // --- unknown parameters: names only, values never recorded. ---
  const unknownParameters = Object.keys(input).filter(
    (key) => !(SMART_LAUNCH_KNOWN_PARAMETERS as readonly string[]).includes(key),
  );

  const context: SmartLaunchContext = {
    iss: normalizeIss(issUrl),
    issHost: issUrl.host,
    launch: rawLaunch,
    audience,
    synth: isSynthIssHost(issUrl.host),
    unknownParameters,
  };

  return {
    ok: true,
    context,
    audit: toSmartLaunchAuditRecord({
      id: auditId,
      stage: "launch-validation",
      decision: "ALLOW",
      reason: "OK",
      issHost: issUrl.host,
      at,
    }),
  };
}

/** Type guard: is `value` a well-formed {@link SmartLaunchContext}? */
export function isSmartLaunchContext(value: unknown): value is SmartLaunchContext {
  if (!isPlainObject(value)) {
    return false;
  }
  const candidate = value as Partial<Record<keyof SmartLaunchContext, unknown>>;
  return (
    typeof candidate.iss === "string" &&
    candidate.iss.length > 0 &&
    typeof candidate.issHost === "string" &&
    candidate.issHost.length > 0 &&
    typeof candidate.launch === "string" &&
    candidate.launch.length > 0 &&
    typeof candidate.audience === "string" &&
    candidate.audience.length > 0 &&
    typeof candidate.synth === "boolean" &&
    Array.isArray(candidate.unknownParameters) &&
    candidate.unknownParameters.every((name) => typeof name === "string" && name.length > 0)
  );
}
