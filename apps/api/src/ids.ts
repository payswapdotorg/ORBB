/**
 * ORBB edge API — id minting and deterministic id derivation (M3-A).
 *
 * Two id concerns live here:
 *
 *   1. Fresh opaque ids for server-minted resources (`intent_`, `obs_`,
 *      `evt_`, ledger keys). Production uses the WebCrypto UUID
 *      (Workers-compatible); tests inject the deterministic factory.
 *      The canonical `<prefix>_<body>` grammar from @orbb/domain is
 *      asserted on every mint.
 *
 *   2. DETERMINISTIC ids derived from an idempotency key — the crash-
 *      retry convergence trick the M2-D finalize flow established
 *      (`evidenceIngestedEventId`): derive `<prefix>_<sha256hex>` from a
 *      domain separator + the idempotency anchor so a retried request
 *      converges on the same outbox event id and the same synthesized
 *      provenance id even when the response-level ledger misses.
 *      Hashing uses WebCrypto (`crypto.subtle`), which is native to
 *      Cloudflare Workers — no Node built-ins in the bundle.
 */
import { ID_BODY_PATTERN } from "@orbb/domain";
import type { ApiClock, ApiIdFactory, RequestIdFactory } from "./context.js";

/** Wall-clock time source (deterministic clocks are injected in tests). */
export class SystemApiClock implements ApiClock {
  now(): Date {
    return new Date();
  }
}

function isCanonicalBody(body: string): boolean {
  return ID_BODY_PATTERN.test(body);
}

/** Mints `<prefix>_<uuid>` ids using the runtime's WebCrypto UUID. */
export class CryptoIdFactory implements ApiIdFactory {
  next(prefix: string): string {
    const id = `${prefix}_${crypto.randomUUID()}`;
    if (!isCanonicalBody(id.slice(prefix.length + 1))) {
      // uuid bodies are 36 chars of hex + dashes — always canonical.
      throw new Error("The runtime UUID generator produced a non-canonical id body.");
    }
    return id;
  }
}

/** Mints `req_<uuid>` request ids. */
export class CryptoRequestIdFactory implements RequestIdFactory {
  next(): string {
    return `req_${crypto.randomUUID()}`;
  }
}

function toHex(digest: ArrayBuffer): string {
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Derives `<prefix>_<sha256hex>` from a domain separator + seed. The
 * 64-char lowercase hex body satisfies every canonical id grammar, so
 * derived ids pass the @orbb/domain value guards.
 */
export async function deriveDeterministicId(
  domain: string,
  prefix: string,
  seed: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${domain}|${seed}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${prefix}_${toHex(digest)}`;
}

/** Domain separator: repository idempotency-key derivation (A24). */
const REPO_KEY_DOMAIN = "orbb/api/idempotency-repo-key/v1";

/**
 * Derives the REPOSITORY-level idempotency key from the A24 claim scope
 * (route + principal + Idempotency-Key): a 64-char hex digest, safely
 * under the 256-char ledger-key bound, with no separator characters.
 */
export function deriveIdempotencyRepoKey(input: {
  readonly route: string;
  readonly principalId: string;
  readonly idempotencyKey: string;
}): Promise<string> {
  return deriveDeterministicId(
    REPO_KEY_DOMAIN,
    "idem",
    `${input.route}|${input.principalId}|${input.idempotencyKey}`,
  );
}

/** Domain separator: synthesized observation provenance ids. */
const OBSERVATION_PROVENANCE_DOMAIN = "orbb/api/observation-provenance/v1";

/**
 * Deterministic provenance id for a POST /v1/observations mutation
 * (mirrors the M2-D synthesized-upload-provenance precedent): actor and
 * subject are the uploading person; the id is a pure function of the
 * idempotency anchor, so crash retries converge on the same row.
 */
export function deriveObservationProvenanceId(repoKey: string): Promise<string> {
  return deriveDeterministicId(OBSERVATION_PROVENANCE_DOMAIN, "prov", repoKey);
}

/** Domain separator: INTENT_CREATED outbox event ids. */
const INTENT_CREATED_EVENT_DOMAIN = "orbb/api/intent-created-event/v1";

/** Deterministic `evt_` id for the INTENT_CREATED outbox event. */
export function deriveIntentCreatedEventId(repoKey: string): Promise<string> {
  return deriveDeterministicId(INTENT_CREATED_EVENT_DOMAIN, "evt", repoKey);
}

/** Domain separator: OBSERVATION_RECORDED outbox event ids. */
const OBSERVATION_RECORDED_EVENT_DOMAIN = "orbb/api/observation-recorded-event/v1";

/** Deterministic `evt_` id for the OBSERVATION_RECORDED outbox event. */
export function deriveObservationRecordedEventId(repoKey: string): Promise<string> {
  return deriveDeterministicId(OBSERVATION_RECORDED_EVENT_DOMAIN, "evt", repoKey);
}
