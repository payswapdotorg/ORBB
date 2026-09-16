/**
 * B10 — The authorization gate of adherence enforcement (golden journey
 * #7, Lane C packet M6-B).
 *
 * A restriction may only ever be applied under an authorization that is
 * valid NOW, at decision time. The authorization model is INJECTED as a
 * predicate ({@link AdherenceAuthorizationGate}) shaped on the frozen
 * M1 consent/access-grant domain (`@orbb/domain` `grant.ts` + `access.ts`):
 * grants are subject-scoped permission lists with state + expiry, and
 * validity means `active` AND strictly-before-expiry at the decision
 * instant (the domain rule: a grant is valid strictly before its expiry
 * instant).
 *
 * FAIL-CLOSED: the reference implementation below never throws and never
 * widens — malformed grant entries are filtered by the domain structural
 * guard, and anything short of a fully valid, matching, unexpired,
 * permission-covering grant resolves to NOT authorized. The enforcement
 * engine turns a failed gate into a typed REFUSAL with an audit record —
 * a configured-but-unauthorized restriction is never silently applied
 * and never silently skipped.
 */
import { isAccessGrant, type AccessGrant, type GrantId, type PersonId } from "@orbb/domain";
import type { AdherenceCapabilityId } from "./states.js";

// ---------------------------------------------------------------------------
// The injected gate.
// ---------------------------------------------------------------------------

/** What the engine asks the gate to affirm, at decision time. */
export interface RestrictionAuthorizationRequest {
  /** The person whose device the restriction would touch. */
  readonly personId: PersonId;
  readonly capability: AdherenceCapabilityId;
  /** The permission ids the policy demands (from `AdherencePolicy.authorization`). */
  readonly permissions: readonly string[];
  /** Optional pinned grant id (from the policy, when present). */
  readonly grantId?: GrantId;
}

/**
 * The injected authorization predicate. Implementations must be
 * fail-closed (any doubt => `false`) and must evaluate validity AT CALL
 * TIME, never earlier.
 */
export interface AdherenceAuthorizationGate {
  isRestrictionAuthorized(request: RestrictionAuthorizationRequest): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Reference implementation over the M1 access-grant domain.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link AccessGrantAdherenceGate} (all injectable). */
export interface AccessGrantAdherenceGateDeps {
  /**
   * Snapshot provider for the grants that MIGHT cover the request. May
   * return raw values — the gate filters with the domain structural
   * guard `isAccessGrant` (fail-closed against malformed entries).
   */
  readonly grants: (
    request: RestrictionAuthorizationRequest,
  ) => Promise<readonly unknown[]>;
  /** Injectable clock (epoch ms). Default: `Date.now`. */
  readonly nowMs?: () => number;
}

/**
 * Reference `AdherenceAuthorizationGate` over the frozen M1
 * `AccessGrant` model: a request is authorized iff at least one grant is
 * structurally valid, belongs to the requesting person, (when pinned)
 * carries the requested grant id, is `active`, is NOT expired
 * (`now < expiresAt` — strictly before expiry, the domain rule), and
 * covers at least one of the requested permissions by exact scope-entry
 * match. Deterministic given (snapshot, clock); never throws.
 */
export class AccessGrantAdherenceGate implements AdherenceAuthorizationGate {
  readonly #grants: (request: RestrictionAuthorizationRequest) => Promise<readonly unknown[]>;
  readonly #nowMs: () => number;

  constructor(deps: AccessGrantAdherenceGateDeps) {
    this.#grants = deps.grants;
    this.#nowMs = deps.nowMs ?? Date.now;
  }

  async isRestrictionAuthorized(request: RestrictionAuthorizationRequest): Promise<boolean> {
    let snapshot: readonly unknown[];
    try {
      snapshot = await this.#grants(request);
    } catch {
      // Fail-closed: a broken grant store never authorizes anything.
      return false;
    }
    if (!Array.isArray(snapshot)) {
      return false;
    }
    const nowMs = this.#nowMs();
    for (const candidate of snapshot) {
      if (isRestrictionGrant(candidate, request, nowMs)) {
        return true;
      }
    }
    return false;
  }
}

function isRestrictionGrant(
  candidate: unknown,
  request: RestrictionAuthorizationRequest,
  nowMs: number,
): candidate is AccessGrant {
  if (!isAccessGrant(candidate)) {
    return false;
  }
  if (candidate.subjectId !== request.personId) {
    return false;
  }
  if (request.grantId !== undefined && candidate.id !== request.grantId) {
    return false;
  }
  if (candidate.state !== "active") {
    return false;
  }
  if (candidate.expiresAt.getTime() <= nowMs) {
    // Domain rule: valid strictly BEFORE the expiry instant.
    return false;
  }
  for (const permission of request.permissions) {
    if ((candidate.scope as readonly string[]).includes(permission)) {
      return true;
    }
  }
  return false;
}
