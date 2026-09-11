/**
 * ORBB edge API — dependency seam and request-context typing (M3-A, A21).
 *
 * Architecture rule being implemented here: the /v1 router consumes
 * repository INTERFACES and an injectable PRINCIPAL verifier — never live
 * Cloudflare bindings. `ApiDependencies` is the constructor-injection
 * surface for the whole router; the Worker entry (`index.ts`) resolves it
 * from the (currently empty) environment, and tests resolve it from
 * in-memory doubles.
 *
 * Recorded decisions:
 *   - `ApiClock` / `ApiIdFactory` / `RequestIdFactory` are structural
 *     twins of the @orbb/testkit `Clock` / `IdFactory` contracts (fresh
 *     `Date` per call; `<prefix>_<body>` ids). Defining them locally keeps
 *     the production API free of a runtime dependency on the test toolkit
 *     while remaining structurally compatible with the deterministic
 *     implementations (tests inject those directly).
 *   - `Db` / `UnitOfWork` / repository interfaces come from @orbb/db as
 *     TYPE-ONLY imports: the persistence provider (Drizzle/postgres.js /
 *     PGlite / in-memory doubles) is injected at the edge and never
 *     bundled into the Worker from this module.
 */
import type { Db } from "@orbb/db";
import type { Hono } from "hono";
import type { Principal, PrincipalVerifier } from "./principal.js";
import type { IdempotencyLedger } from "./idempotency.js";

/** Injectable time source (structural twin of @orbb/testkit `Clock`). */
export interface ApiClock {
  now(): Date;
}

/** Injectable opaque-id source (structural twin of @orbb/testkit `IdFactory`). */
export interface ApiIdFactory {
  next(prefix: string): string;
}

/** Injectable request-id mint (echoed `x-request-id` values bypass this). */
export interface RequestIdFactory {
  next(): string;
}

/** Everything the /v1 router needs, resolved by the entrypoint. */
export interface ApiDependencies {
  /** Auth PRINCIPAL seam (A22/A23 land the real verifier; tests stub it). */
  readonly principalVerifier: PrincipalVerifier;
  /** Persistence facade (repositories + UnitOfWork + transactional outbox). */
  readonly db: Db;
  /** A24 response-level idempotency ledger. */
  readonly idempotency: IdempotencyLedger;
  /** Time source for domain `createdAt` anchors and event payloads. */
  readonly clock: ApiClock;
  /** Opaque id source for server-minted resource ids. */
  readonly ids: ApiIdFactory;
  /** Request-id mint used when no `x-request-id` is echoed. */
  readonly requestIds: RequestIdFactory;
}

/** Per-request variables carried on the Hono context. */
export interface ApiContextVariables {
  /** Echoed or minted request id (also emitted as `x-request-id`). */
  requestId: string;
  /** Resolved principal; set only by {@link ./principal.js~requirePrincipal}. */
  principal: Principal;
  /**
   * Repository-level idempotency key for THIS mutation: derived from
   * (route, principal, Idempotency-Key header) when the header is present,
   * freshly minted when absent. Set only by
   * {@link ./idempotency.js~withIdempotency}.
   */
  idempotencyRepoKey: string;
}

/** Hono environment binding for the typed API context. */
export interface ApiEnv {
  readonly Variables: ApiContextVariables;
}

/** The typed Hono application shape produced by `createOrbbApi`. */
export type ApiApp = Hono<ApiEnv>;
