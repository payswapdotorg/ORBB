/**
 * Lane-local identifiers for the intent compiler family (M5-A).
 *
 * RECORDED DECISIONS (architecture §4/§5 constraints):
 *   - The frozen M0 canonical id kinds in `@orbb/domain` (person, intent,
 *     observation, evidence, plan, task, grant, device, source,
 *     provenance) do NOT include an evidence-pack kind, and this packet
 *     must not modify `@orbb/domain`. `EvidencePackId` is therefore a
 *     LANE-LOCAL branded id following the same grammar shape as the domain
 *     canonical ids: `<prefix>_<body>` with prefix `evpack` and a body of
 *     16–128 characters of `[A-Za-z0-9_-]` (URL-safe, admits the testkit
 *     `DeterministicIdFactory` output `evpack_SYNTH-<seed>-<counter>` so
 *     generated pack ids pass the guard — handoff: promoting the kind into
 *     the frozen domain id list is a domain change for tech-lead review).
 *   - Evidence-pack ENTRY ids are content-addressed digests (see
 *     `evidencePack.ts`): prefix `evpe`, 43-character base64url body —
 *     grammar-compatible, deliberately NOT branded (the entry id IS the
 *     content hash; there is no separate identity space to confuse).
 *   - Candidate PLAN ids reuse the frozen domain `plan_` prefix and are
 *     derived from content (see `compiler.ts`), so they satisfy the frozen
 *     domain guards (`isIdOf("plan", ...)`) without new id kinds.
 */
declare const evidencePackIdBrand: unique symbol;

/** Opaque evidence-pack identifier: `evpack_<body>` (lane-local grammar). */
export type EvidencePackId = string & { readonly [evidencePackIdBrand]: "EvidencePackId" };

/** Fixed prefix of {@link EvidencePackId}. */
export const EVIDENCE_PACK_ID_PREFIX = "evpack";

/** Fixed prefix of content-addressed evidence-pack entry ids. */
export const EVIDENCE_PACK_ENTRY_ID_PREFIX = "evpe";

/** Valid body segment of a lane-local id: 16–128 URL-safe characters. */
const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function matchesPrefixedGrammar(prefix: string, value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(prefix.length + 1));
}

/** Type guard: is `value` a canonical lane-local {@link EvidencePackId}? */
export function isEvidencePackId(value: unknown): value is EvidencePackId {
  return matchesPrefixedGrammar(EVIDENCE_PACK_ID_PREFIX, value);
}

/** Type guard: is `value` a well-formed content-addressed entry id (`evpe_...`)? */
export function isEvidencePackEntryId(value: unknown): value is string {
  return matchesPrefixedGrammar(EVIDENCE_PACK_ENTRY_ID_PREFIX, value);
}
