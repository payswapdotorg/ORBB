/**
 * ORBB edge API — Worker entrypoint (M3-A).
 *
 * The M0 shell grows into the real /v1 router. The wiring seam is
 * explicit: `ApiDependencies` is resolved HERE from the environment.
 * This environment matrix has no persistence/auth bindings yet (the
 * wrangler config intentionally carries none), so the entry wires the
 * UNWIRED shell:
 *
 *   - `rejectingPrincipalVerifier` — no credential can be verified on
 *     this environment, so every principal-scoped /v1 route answers
 *     with an honest 401 envelope (nobody is fake-authorized);
 *   - an unwired Db proxy that fails loudly (500 envelope) if any code
 *     path ever reaches persistence without a wiring — defense in
 *     depth: unreachable behind the 401s;
 *   - the in-memory A24 ledger (ephemeral placeholder until the durable
 *     platform-lane ledger lands — see idempotency.ts).
 *
 * `GET /healthz` (the liveness probe contract) and `GET /v1/openapi.json`
 * (the A26 document) are public and fully functional on this shell.
 *
 * RECORDED HANDOFF: real env bindings (Neon-over-HTTP Db adapter, the
 * packages/auth principal verifier, the durable idempotency ledger, the
 * Upstash rate limiter) arrive with the platform/identity packets; they
 * replace the unwired members below — the router (app.ts) never
 * changes.
 */
import { createOrbbApi } from "./app.js";
import { rejectingPrincipalVerifier } from "./principal.js";
import { InMemoryIdempotencyLedger } from "./idempotency.js";
import { ApiError } from "./errors.js";
import { CryptoIdFactory, CryptoRequestIdFactory, SystemApiClock } from "./ids.js";
import type { ApiDependencies } from "./context.js";
import type { Db } from "@orbb/db";

/**
 * Defense-in-depth persistence seam: any property access on an unwired
 * environment fails with a typed 500 envelope instead of an opaque
 * TypeError. Unreachable while the verifier rejects all principals.
 */
const unwiredDb: Db = new Proxy({} as Db, {
  get(): never {
    throw new ApiError(
      "internal-error",
      "The API Worker is not wired to a persistence binding on this environment.",
    );
  },
});

const dependencies: ApiDependencies = {
  principalVerifier: rejectingPrincipalVerifier,
  db: unwiredDb,
  idempotency: new InMemoryIdempotencyLedger(),
  clock: new SystemApiClock(),
  ids: new CryptoIdFactory(),
  requestIds: new CryptoRequestIdFactory(),
};

const app = createOrbbApi(dependencies);

export default app;
