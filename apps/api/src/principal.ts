/**
 * ORBB edge API — the PRINCIPAL seam (M3-A).
 *
 * The real verifier (sessions/passkeys/scoped tokens) lands in the
 * parallel packages/auth packet (A22/A23). Until then the router codes
 * against THIS interface only: tests inject a stub, and the unwired
 * Worker entry injects {@link rejectingPrincipalVerifier} so every
 * principal-scoped route answers with a clean 401 envelope instead of
 * pretending to authorize anyone.
 *
 * Recorded handoff (403 semantics): `requirePrincipal` resolves the
 * principal and answers 401 when NONE could be resolved. Role-based
 * 403 decisions (authorization) belong to the A23 authorization layer,
 * which will consume `roles` and emit `ApiError("forbidden", …)`; the
 * error mapping for 403 already exists in `errors.ts`.
 */
import { isPersonId, type PersonId } from "@orbb/domain";
import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors.js";
import type { ApiEnv } from "./context.js";

/** Roles a principal holds (opaque tokens; owned by the auth/authorization lanes). */
export type PrincipalRole = string;

/** The resolved request principal: a person plus their held roles. */
export interface Principal {
  readonly personId: PersonId;
  readonly roles: readonly PrincipalRole[];
}

/**
 * Resolves a request to a {@link Principal} or `null` when no principal
 * is present. The verifier owns credential extraction and validation
 * (headers, cookies, tokens) — it receives the raw request and must be
 * side-effect free.
 */
export interface PrincipalVerifier {
  verify(request: Request): Promise<Principal | null>;
}

const MAX_ROLES = 64;
const MAX_ROLE_LENGTH = 128;

function isPrincipalRole(value: unknown): value is PrincipalRole {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ROLE_LENGTH;
}

/**
 * Validates the verifier's answer. A structurally malformed principal is
 * a SERVER-side verifier bug — surfaced as 500 (never silently treated
 * as anonymous, which would mask a broken auth deployment as open
 * routes).
 */
function assertWellFormedPrincipal(principal: Principal): void {
  if (!isPersonId(principal.personId)) {
    throw new ApiError(
      "internal-error",
      "The principal verifier returned a principal without a canonical person id.",
    );
  }
  if (
    !Array.isArray(principal.roles) ||
    principal.roles.length > MAX_ROLES ||
    !principal.roles.every(isPrincipalRole)
  ) {
    throw new ApiError(
      "internal-error",
      "The principal verifier returned a malformed principal role set.",
    );
  }
}

/** Principal middleware factory: attaches `{personId, roles}` or 401s. */
export function requirePrincipal(verifier: PrincipalVerifier): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const principal = await verifier.verify(c.req.raw);
    if (principal === null) {
      throw new ApiError(
        "unauthenticated",
        "Authentication is required: no principal could be resolved for this request.",
      );
    }
    assertWellFormedPrincipal(principal);
    c.set("principal", principal);
    await next();
  };
}

/** Unwired-shell verifier: resolves nobody (honest 401s, no fake auth). */
export const rejectingPrincipalVerifier: PrincipalVerifier = {
  async verify(): Promise<null> {
    return null;
  },
};
