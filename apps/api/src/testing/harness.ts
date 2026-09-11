/**
 * ORBB edge API — deterministic test harness (M3-A test infrastructure).
 *
 * Wires `createOrbbApi` with:
 *   - the {@link InMemoryDb} double (no live bindings);
 *   - a stub principal verifier keyed by `Authorization: Bearer <token>`
 *     (the real verifier lands with packages/auth);
 *   - deterministic clock / id factory / request-id factory (structural
 *     @orbb/testkit twins — the very same instances drive the double).
 *
 * Seeding helpers produce SYNTH-marked synthetic data only (agent
 * protocol: never real medical data): persons, and the
 * provenance+evidence(+EVIDENCE_INGESTED outbox event) rows a finalized
 * upload would leave behind.
 *
 * Runtime notes: the harness runs under Node (vitest) but sticks to
 * WebWorker-safe APIs (WebCrypto, TextEncoder) so the file typechecks
 * under the app's `lib: [ES2022, WebWorker]` with no Node typings.
 */
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import type { EvidenceObjectRecord, PersonRecord } from "@orbb/db";
import type { EventId } from "@orbb/contracts";
import type { PersonId, ProvenanceId } from "@orbb/domain";
import { createOrbbApi } from "../app.js";
import { InMemoryIdempotencyLedger } from "../idempotency.js";
import { InMemoryDb } from "./inmemory-db.js";
import type { Principal, PrincipalVerifier } from "../principal.js";
import type { ApiApp } from "../context.js";

/** Stub verifier: `Authorization: Bearer <token>` → registered principal. */
export class StubPrincipalVerifier implements PrincipalVerifier {
  readonly #principals = new Map<string, Principal>();

  register(token: string, principal: Principal): void {
    this.#principals.set(token, principal);
  }

  async verify(request: Request): Promise<Principal | null> {
    const header = request.headers.get("authorization");
    if (header === null || !header.startsWith("Bearer ")) {
      return null;
    }
    return this.#principals.get(header.slice("Bearer ".length)) ?? null;
  }
}

/** Deterministic request-id factory: req_SYNTH-<seed>-<counter>. */
export class DeterministicRequestIdFactory {
  readonly #ids: DeterministicIdFactory;

  constructor(seed: string) {
    this.#ids = new DeterministicIdFactory({ seed: `${seed}-req` });
  }

  next(): string {
    return this.#ids.next("req");
  }
}

/** Everything a test needs to drive the API. */
export interface TestApi {
  readonly app: ApiApp;
  readonly db: InMemoryDb;
  readonly verifier: StubPrincipalVerifier;
  readonly ledger: InMemoryIdempotencyLedger;
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  /** Registers a person row + a principal token; returns the person. */
  seedPerson(token: string, displayName?: string): Promise<PersonRecord>;
  /** Seeds one evidence object (with provenance + EVIDENCE_INGESTED event). */
  seedEvidence(personId: PersonId): Promise<EvidenceObjectRecord>;
}

const SYNTH_EVIDENCE_BYTES = "SYNTH-api-harness-evidence-v1";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function createTestApi(seed: string): TestApi {
  const clock = new DeterministicClock();
  const ids = new DeterministicIdFactory({ seed });
  const db = new InMemoryDb(clock);
  const verifier = new StubPrincipalVerifier();
  const ledger = new InMemoryIdempotencyLedger();
  const app: ApiApp = createOrbbApi({
    principalVerifier: verifier,
    db,
    idempotency: ledger,
    clock,
    ids,
    requestIds: new DeterministicRequestIdFactory(seed),
  });

  const seedPerson = async (token: string, displayName?: string): Promise<PersonRecord> => {
    const person: PersonRecord = {
      id: ids.next("prsn") as PersonId,
      displayName: displayName ?? `SYNTH-Person-${ids.issued}`,
    };
    await db.transaction((uow) =>
      uow.persons.insert(person, { idempotencyKey: `seed:${person.id}` }),
    );
    verifier.register(token, { personId: person.id, roles: ["self"] });
    return person;
  };

  const seedEvidence = async (personId: PersonId): Promise<EvidenceObjectRecord> => {
    const evidenceId = ids.next("evid") as EvidenceObjectRecord["id"];
    const provenanceId = ids.next("prov") as ProvenanceId;
    const sha256 = await sha256Hex(`${SYNTH_EVIDENCE_BYTES}:${evidenceId}`);
    const createdAt = clock.now();
    const evidence: EvidenceObjectRecord = {
      id: evidenceId,
      personId,
      objectKey: `evidence/v1/${evidenceId}/${sha256}`,
      mediaType: "application/octet-stream",
      sha256,
      sizeBytes: new TextEncoder().encode(SYNTH_EVIDENCE_BYTES).length,
      capturedAt: createdAt,
      sourceType: "SYNTH-device",
      provenanceId,
      retentionClass: "original",
      state: "active",
      createdAt,
    };
    await db.transaction(async (uow) => {
      await uow.provenances.insert(
        {
          provenanceId,
          actor: personId,
          subject: personId,
          occurredAt: createdAt,
        },
        { idempotencyKey: `seed:${provenanceId}` },
      );
      await uow.evidence.insert(evidence, { idempotencyKey: `seed:${evidenceId}` });
      await uow.appendEvent({
        eventId: ids.next("evt") as EventId,
        eventType: "EVIDENCE_INGESTED",
        payload: JSON.stringify({
          type: "EVIDENCE_INGESTED",
          evidenceId,
          personId,
          synthetic: true,
        }),
      });
    });
    return evidence;
  };

  return { app, db, verifier, ledger, clock, ids, seedPerson, seedEvidence };
}

/** Issues a request against the app with JSON body + bearer token. */
export async function requestJson(
  app: ApiApp,
  path: string,
  init: {
    readonly method?: string;
    readonly token?: string;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
    readonly rawBody?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token !== undefined) {
    headers.authorization = `Bearer ${init.token}`;
  }
  let body: string | undefined;
  if (init.rawBody !== undefined) {
    headers["content-type"] = "application/json";
    body = init.rawBody;
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return app.request(path, {
    method: init.method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

/** Reads a JSON response body (typed for assertions). */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
