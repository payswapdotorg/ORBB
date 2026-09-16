/**
 * B10 — Adherence enforcement capability seam (Lane C packet M6-B):
 * the typed OS-capability surface a policy decision can drive.
 *
 * Mirrors the M4-C health-seam discipline (healthkit.ts / healthconnect.ts):
 * platform hosts the TypeScript seams over native-module interfaces, plus
 * SYNTHETIC native doubles for tests; real native bindings arrive in the
 * deployment/mobile-integration milestone (handoff recorded).
 *
 * THE INVOCATION CONTRACT: adapters are DUMB capability surfaces. They
 * never decide policy. The ONLY thing that authorizes
 * {@link AdherenceCapabilityAdapter.invokeRestriction} is a
 * {@link RestrictionDecision} — the token minted exclusively by the
 * `@orbb/adherence` enforcement engine. This file is a deliberate
 * STRUCTURAL MIRROR of that token (same field-for-field shape): platform
 * does NOT take a dependency on the policy package, so the mirror keeps
 * the four-changed-path fence (only packages/adherence/**,
 * packages/platform/src/adherence/**, the platform barrel, and the
 * lockfile change). TypeScript's structural typing makes the real token
 * assignable to this mirror, and the vocabulary equality is asserted by
 * the cross-package integration test in @orbb/adherence.
 *
 * FORGERY REFUSAL: {@link isRestrictionDecision} strictly validates the
 * complete shape (including the `kind` discriminant, the canonical id
 * grammar, and `expiresAtMs > decidedAtMs`); adapters REFUSE anything
 * that does not pass — never a throw, always a typed rejection
 * (`decision-invalid`). A hand-forged token cannot act.
 *
 * GRACEFUL DEGRADE: a capability that reports any detection state other
 * than `available` is never invoked; the engine-level decision degrades
 * to observe-only with the accounted reason (the engine probes BEFORE
 * minting; the adapter re-checks as defense in depth).
 */
import { isIdOf } from "@orbb/domain";

// ---------------------------------------------------------------------------
// Capability detection vocabulary (mirror of @orbb/adherence states.ts).
// ---------------------------------------------------------------------------

/**
 * Detection states of an OS capability surface: `available` (invocable),
 * `unavailable` (the OS/device lacks the capability), `needs-permission`
 * (the person has not granted it), `needs-config` (an OS-level setting
 * must be enabled first).
 */
export const CAPABILITY_DETECTION_STATES = [
  "available",
  "unavailable",
  "needs-permission",
  "needs-config",
] as const;

export type CapabilityDetectionState = (typeof CAPABILITY_DETECTION_STATES)[number];

/** One capability's detection report (PHID-safe machine reason codes). */
export interface CapabilityDetection {
  readonly state: CapabilityDetectionState;
  /** PHID-safe machine reason code (never data, never free prose). */
  readonly reason?: string;
}

/**
 * The closed set of OS capability surfaces (mirror of
 * `@orbb/adherence`'s `ADHERENCE_CAPABILITY_IDS`; equality asserted by
 * the cross-package integration test).
 */
export const ADHERENCE_CAPABILITY_IDS = ["ios-focus", "android-usage-access"] as const;

export type AdherenceCapabilityId = (typeof ADHERENCE_CAPABILITY_IDS)[number];

/**
 * The per-task adherence states a decision can carry (mirror of
 * `@orbb/adherence`'s `ADHERENCE_STATES`).
 */
export const ADHERENCE_STATES = ["on-track", "missed", "recovered"] as const;

export type AdherenceState = (typeof ADHERENCE_STATES)[number];

// ---------------------------------------------------------------------------
// The restriction decision token (STRUCTURAL MIRROR — see file header).
// ---------------------------------------------------------------------------

/** Discriminant literal of {@link RestrictionDecision}. */
export const RESTRICTION_DECISION_KIND = "orbb/adherence/restriction-decision/v1" as const;

/**
 * The mirrored restriction token: proof that an explicit, authorized,
 * configured policy decided one bounded restriction. Minted ONLY by the
 * `@orbb/adherence` enforcement engine; verified here by
 * {@link isRestrictionDecision}.
 */
export interface RestrictionDecision {
  readonly kind: typeof RESTRICTION_DECISION_KIND;
  readonly decisionId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly capability: AdherenceCapabilityId;
  readonly authorization: {
    readonly permission: string;
    readonly verifiedAtMs: number;
  };
  readonly evaluation: {
    readonly state: AdherenceState;
    readonly reason: string;
  };
  readonly scope: {
    readonly personId: string;
    readonly planId: string;
    readonly metricId: string;
  };
  readonly detection: {
    readonly state: CapabilityDetectionState;
    readonly reason?: string;
  };
  readonly decidedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * Strict structural guard for {@link RestrictionDecision}: validates the
 * complete shape with an exact field allowlist (unknown keys reject),
 * canonical id grammar for person/plan, the closed capability + state +
 * detection vocabularies, and `expiresAtMs > decidedAtMs`. Never throws.
 */
export function isRestrictionDecision(value: unknown): value is RestrictionDecision {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    "authorization",
    "capability",
    "decidedAtMs",
    "decisionId",
    "detection",
    "evaluation",
    "expiresAtMs",
    "kind",
    "policyId",
    "policyVersion",
    "scope",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return false;
  }
  if (candidate["kind"] !== RESTRICTION_DECISION_KIND) {
    return false;
  }
  if (!isNonEmptyString(candidate["decisionId"])) {
    return false;
  }
  if (!isNonEmptyString(candidate["policyId"])) {
    return false;
  }
  if (!Number.isInteger(candidate["policyVersion"]) || (candidate["policyVersion"] as number) < 1) {
    return false;
  }
  if (!(ADHERENCE_CAPABILITY_IDS as readonly string[]).includes(candidate["capability"] as string)) {
    return false;
  }
  const authorization = candidate["authorization"];
  if (typeof authorization !== "object" || authorization === null) {
    return false;
  }
  const authKeys = Object.keys(authorization).sort();
  if (authKeys.length !== 2 || authKeys[0] !== "permission" || authKeys[1] !== "verifiedAtMs") {
    return false;
  }
  if (!isNonEmptyString((authorization as Record<string, unknown>)["permission"])) {
    return false;
  }
  if (!isNonNegativeNumber((authorization as Record<string, unknown>)["verifiedAtMs"])) {
    return false;
  }
  const evaluation = candidate["evaluation"];
  if (typeof evaluation !== "object" || evaluation === null) {
    return false;
  }
  const evalRecord = evaluation as Record<string, unknown>;
  const evalKeys = Object.keys(evalRecord).sort();
  if (evalKeys.length !== 2 || evalKeys[0] !== "reason" || evalKeys[1] !== "state") {
    return false;
  }
  if (!(ADHERENCE_STATES as readonly string[]).includes(evalRecord["state"] as string)) {
    return false;
  }
  if (!isNonEmptyString(evalRecord["reason"])) {
    return false;
  }
  const scope = candidate["scope"];
  if (typeof scope !== "object" || scope === null) {
    return false;
  }
  const scopeRecord = scope as Record<string, unknown>;
  const scopeKeys = Object.keys(scopeRecord).sort();
  if (
    scopeKeys.length !== 3 ||
    scopeKeys[0] !== "metricId" ||
    scopeKeys[1] !== "personId" ||
    scopeKeys[2] !== "planId"
  ) {
    return false;
  }
  if (!isIdOf("person", scopeRecord["personId"])) {
    return false;
  }
  if (!isIdOf("plan", scopeRecord["planId"])) {
    return false;
  }
  if (!isNonEmptyString(scopeRecord["metricId"])) {
    return false;
  }
  const detection = candidate["detection"];
  if (typeof detection !== "object" || detection === null) {
    return false;
  }
  const detectionRecord = detection as Record<string, unknown>;
  const detectionKeys = Object.keys(detectionRecord).sort();
  const detectionOk =
    (detectionKeys.length === 1 && detectionKeys[0] === "state") ||
    (detectionKeys.length === 2 && detectionKeys[0] === "reason" && detectionKeys[1] === "state");
  if (!detectionOk) {
    return false;
  }
  if (
    !(CAPABILITY_DETECTION_STATES as readonly string[]).includes(
      detectionRecord["state"] as string,
    )
  ) {
    return false;
  }
  if (
    detectionRecord["reason"] !== undefined &&
    !isNonEmptyString(detectionRecord["reason"])
  ) {
    return false;
  }
  const decidedAtMs = candidate["decidedAtMs"];
  const expiresAtMs = candidate["expiresAtMs"];
  if (!isNonNegativeNumber(decidedAtMs) || !isNonNegativeNumber(expiresAtMs)) {
    return false;
  }
  if ((expiresAtMs as number) <= (decidedAtMs as number)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The adapter contract.
// ---------------------------------------------------------------------------

/**
 * Success/failure discriminated union for every capability operation
 * (shape mirror of the health seam's `HealthResult`; helpers are
 * module-internal on purpose — the platform barrel already exports
 * `ok`/`err` from the health seam, and this seam constructs its results
 * internally only).
 */
export type CapabilityResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** What an invocation asks the capability to restrict. */
export interface CapabilityRestrictionRequest {
  /** The engine-minted decision authorizing exactly this restriction. */
  readonly decision: RestrictionDecision;
  /** OS-specific targets (app bundle ids / package names). */
  readonly target: {
    readonly appIds: readonly string[];
  };
}

/** The auditable record of one applied restriction. */
export interface CapabilityInvocationRecord {
  readonly decisionId: string;
  readonly policyId: string;
  readonly capability: AdherenceCapabilityId;
  readonly appIds: readonly string[];
  readonly appliedAtMs: number;
  readonly expiresAtMs: number;
}

/** Reference to the decision whose restriction should be lifted. */
export interface CapabilityReleaseReference {
  readonly decisionId: string;
}

/** The auditable record of one lifted restriction. */
export interface CapabilityReleaseRecord {
  readonly decisionId: string;
  readonly releasedAtMs: number;
}

/** Typed, PHID-safe rejection reasons for capability operations. */
export type CapabilityInvocationError =
  | { readonly kind: "decision-invalid"; readonly detail: string }
  | {
      readonly kind: "capability-mismatch";
      readonly expected: AdherenceCapabilityId;
      readonly received: AdherenceCapabilityId;
    }
  | { readonly kind: "decision-expired" }
  | { readonly kind: "capability-unavailable"; readonly detection: CapabilityDetection }
  | { readonly kind: "invalid-target"; readonly detail: string }
  | { readonly kind: "native-error" };

/**
 * A dumb OS capability surface driven only by policy decisions:
 * detect (what the OS reports), invoke (apply the authorized
 * restriction), release (lift it — recovery direction of journey #7).
 */
export interface AdherenceCapabilityAdapter {
  readonly capability: AdherenceCapabilityId;
  /** Reports the current detection state of the capability. */
  detect(): Promise<CapabilityDetection>;
  /**
   * Applies the restriction authorized by `request.decision`. REFUSES
   * (typed `decision-invalid`) any value that is not a valid
   * {@link RestrictionDecision}; re-checks detection and expiry.
   */
  invokeRestriction(
    request: CapabilityRestrictionRequest,
  ): Promise<CapabilityResult<CapabilityInvocationRecord, CapabilityInvocationError>>;
  /** Lifts the restriction authorized by the referenced decision. */
  releaseRestriction(
    reference: CapabilityReleaseReference,
  ): Promise<CapabilityResult<CapabilityReleaseRecord, CapabilityInvocationError>>;
}

// ---------------------------------------------------------------------------
// Internal helpers (shared by the OS adapters).
// ---------------------------------------------------------------------------

export function capabilityOk<T>(value: T): CapabilityResult<T, never> {
  return { ok: true, value };
}

export function capabilityErr<E>(error: E): CapabilityResult<never, E> {
  return { ok: false, error };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
