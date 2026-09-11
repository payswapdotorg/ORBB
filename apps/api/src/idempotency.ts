/**
 * ORBB edge API — A24 idempotency middleware.
 *
 * Architecture §3: "Use idempotency keys for every mutating endpoint
 * that can be retried." The HTTP-level contract (recorded):
 *
 *   - The ledger claim is identified by (Idempotency-Key, principal,
 *     route) — the key + principal + route identify the claim.
 *   - A REPLAY (claim completed earlier) returns the ORIGINAL response
 *     verbatim (status, headers, body) so retries converge byte-for-
 *     byte, with `Idempotency-Replayed: true` added and the CURRENT
 *     request's `x-request-id`.
 *   - A CONCURRENT duplicate (claim held, not completed) gets 409
 *     `conflict` — RECORDED CHOICE: 409 rather than waiting. Waiting on
 *     an in-flight claim inside an edge Worker adds unbounded latency
 *     against strict CPU/duration limits; a bounded, explicit 409 lets
 *     well-behaved clients retry after the original completes.
 *   - Responses with status < 500 (including client errors) are stored
 *     as the replayable original — a deterministic 4xx for the same key
 *     and body should replay, not re-validate. Responses >= 500 and
 *     mid-chain failures ABANDON the claim so a later retry re-executes
 *     (a failed mutation must not poison the key).
 *   - A missing Idempotency-Key does NOT reject the request: the
 *     middleware mints a fresh repository key (no cross-request dedupe)
 *     — recorded assumption ("mutating routes ACCEPT the header").
 *     A malformed key (empty or > 256 chars) is a 400.
 *
 * This is the RESPONSE-level ledger, interface-driven against the db
 * idempotency semantics: the mutation itself is additionally keyed at
 * the repository ledger through the derived repo key (see ids.ts), so
 * ledger-miss retries still converge on the same stored record and the
 * same outbox event (belt and braces, exactly like M2-D).
 *
 * The interface is deliberately provider-neutral: the in-memory
 * reference implementation below is per-isolate and ephemeral — the
 * DURABLE ledger (Postgres/Redis-backed, A25/platform lane) implements
 * the same interface. Recorded handoff.
 *
 * Middleware-order contract: mount AFTER `requirePrincipal`
 * (unauthenticated requests must not consume claims). Hono's compose
 * runs post-`next()` middleware code with the error-handler's response
 * in `c.res`, so thrown errors flow through the < 500 / >= 500 store /
 * abandon logic below exactly like returned responses.
 */
import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors.js";
import type { ApiEnv } from "./context.js";
import type { ApiIdFactory } from "./context.js";
import { deriveIdempotencyRepoKey } from "./ids.js";

/** Maximum accepted Idempotency-Key length (matches the db ledger bound). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/** The A24 claim scope: key + principal + route. */
export interface IdempotencyScope {
  readonly key: string;
  readonly principalId: string;
  readonly route: string;
}

/** A stored original response (the replay payload). */
export interface StoredApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Result of claiming an idempotency scope. */
export type IdempotencyClaim =
  | { readonly kind: "granted" }
  | { readonly kind: "replay"; readonly response: StoredApiResponse }
  | { readonly kind: "inflight" };

/**
 * The A24 response-level ledger. Implementations MUST be safe under
 * interleaved async calls on the same scope (single-flight semantics).
 */
export interface IdempotencyLedger {
  /** Claims the scope: first caller wins; later callers replay or 409. */
  claim(scope: IdempotencyScope): Promise<IdempotencyClaim>;
  /** Stores the original response for future replays (idempotent). */
  complete(scope: IdempotencyScope, response: StoredApiResponse): Promise<void>;
  /** Releases an incomplete claim so a later retry can start fresh. */
  abandon(scope: IdempotencyScope): Promise<void>;
}

interface LedgerEntry {
  state: "inflight" | "completed";
  response?: StoredApiResponse;
}

/**
 * In-memory reference ledger (per-isolate Map). Fine for the unwired
 * shell and for tests; the durable implementation arrives with the
 * platform lane (same interface).
 */
export class InMemoryIdempotencyLedger implements IdempotencyLedger {
  readonly #entries = new Map<string, LedgerEntry>();

  static #scopeKey(scope: IdempotencyScope): string {
    return `${scope.route}\u0000${scope.principalId}\u0000${scope.key}`;
  }

  async claim(scope: IdempotencyScope): Promise<IdempotencyClaim> {
    const key = InMemoryIdempotencyLedger.#scopeKey(scope);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      this.#entries.set(key, { state: "inflight" });
      return { kind: "granted" };
    }
    if (entry.state === "completed" && entry.response !== undefined) {
      return { kind: "replay", response: entry.response };
    }
    return { kind: "inflight" };
  }

  async complete(scope: IdempotencyScope, response: StoredApiResponse): Promise<void> {
    this.#entries.set(InMemoryIdempotencyLedger.#scopeKey(scope), {
      state: "completed",
      response,
    });
  }

  async abandon(scope: IdempotencyScope): Promise<void> {
    this.#entries.delete(InMemoryIdempotencyLedger.#scopeKey(scope));
  }
}

/**
 * A24 middleware factory with its dependencies bound. `route` is the
 * stable route template (e.g. `"POST /v1/intents"`) that scopes the
 * claim together with the principal and the header key. The returned
 * middleware sets `idempotencyRepoKey` on the context for the mutation
 * handlers (the repository-ledger claim).
 */
export function withIdempotencyDeps(deps: {
  readonly ids: ApiIdFactory;
  readonly ledger: IdempotencyLedger;
}): (route: string) => MiddlewareHandler<ApiEnv> {
  const { ids, ledger } = deps;
  return (route: string) =>
    async (c, next): Promise<void> => {
      const principal = c.get("principal");
      if (principal === undefined) {
        // Misconfigured route wiring (withIdempotency before requirePrincipal).
        throw new ApiError(
          "internal-error",
          "Idempotency middleware requires a resolved principal (mount it after requirePrincipal).",
        );
      }

      const headerKey = c.req.header("idempotency-key");
      if (
        headerKey !== undefined &&
        (headerKey.length === 0 || headerKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
      ) {
        throw new ApiError(
          "invalid-request",
          `Invalid Idempotency-Key header: expected 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
        );
      }

      // The repository-level key: derived from the claim scope when the
      // header is present; freshly minted (no dedupe) when absent.
      const repoKey =
        headerKey !== undefined
          ? await deriveIdempotencyRepoKey({
              route,
              principalId: principal.personId,
              idempotencyKey: headerKey,
            })
          : ids.next("idem");
      c.set("idempotencyRepoKey", repoKey);

      if (headerKey === undefined) {
        // No claim semantics without a client key — execute directly.
        await next();
        return;
      }

      const scope: IdempotencyScope = {
        key: headerKey,
        principalId: principal.personId,
        route,
      };
      const claim = await ledger.claim(scope);
      if (claim.kind === "replay") {
        const headers = new Headers();
        for (const [name, value] of Object.entries(claim.response.headers)) {
          headers.set(name, value);
        }
        // The replay carries THIS request's request id, never the stored one.
        headers.delete("x-request-id");
        headers.set("idempotency-replayed", "true");
        c.res = new Response(claim.response.body, {
          status: claim.response.status,
          headers,
        });
        return;
      }
      if (claim.kind === "inflight") {
        throw new ApiError(
          "conflict",
          "An idempotent request with this key is still in flight for this route; retry after it completes.",
        );
      }

      // Granted: execute the mutation, then store (or abandon) the response.
      await next();
      const response = c.res;
      if (response.status >= 500) {
        await ledger.abandon(scope);
        return;
      }
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      delete headers["x-request-id"];
      await ledger.complete(scope, { status: response.status, headers, body });
      // Rebuild the response from the stored body (the stream was consumed).
      const rebuiltHeaders = new Headers();
      for (const [name, value] of Object.entries(headers)) {
        rebuiltHeaders.set(name, value);
      }
      c.res = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: rebuiltHeaders,
      });
    };
}
