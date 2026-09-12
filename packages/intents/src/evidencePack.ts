/**
 * A36 — EvidencePack schema: the typed, PHI-free summary structure the
 * intent compiler compiles against (architecture §4 intent family).
 *
 * WHAT A PACK IS: an append-only, versioned SUMMARY of a person's
 * evidence/observation capabilities. Every entry summarizes ONE
 * capability (one metric measured by one method): metric id + method id +
 * window coverage + observation count + quality mix + provenance actor
 * class. NO raw values, NO observation ids, NO actor ids — only counts,
 * windows, and classes (the pack aggregates the SUMMARIES that M4-C's
 * platform health seam and M4-A's reconciliation produce as canonical
 * observation views; raw PHI stays behind that seam).
 *
 * RECORDED DECISIONS (all architecture-consistent; none invented into
 * frozen vocabulary):
 *   - `version` is validated by the FROZEN domain guard
 *     `isEvidencePackVersion` (the kernel owns the evidence-pack version
 *     grammar — positive integer >= 1).
 *   - Versioning is immutable + append-only: a new version is a NEW record
 *     referencing its predecessor (`supersedesVersion` is present exactly
 *     on versions >= 2 and equals `version - 1` — a linear chain, like the
 *     domain supersession grammar). Version CONTENT is never mutated in
 *     place; only lifecycle state transitions (see `registry.ts`).
 *   - Entries are CONTENT-ADDRESSED: `entryId` =
 *     `evpe_<base64url(sha256(canonical JSON of the entry content))>`.
 *     Identical content always yields the identical id (order-independent:
 *     object key order is canonicalized away); a forged or mismatched
 *     entry id is a typed validation rejection.
 *   - `QualityMix` summarizes quality with counts per the FROZEN domain
 *     evidence-label vocabulary (MEASURED | ESTIMATED | IMPORTED |
 *     DERIVED — every observation carries exactly one label, so the label
 *     counts must sum to the entry `count`) plus an optional `meanQuality`
 *     (domain `QualityScore` in [0,1], absent when no summarized
 *     observation carried a quality score). No quality bands or
 *     thresholds are invented (clinical-adjacent vocabulary is a tech-lead
 *     decision).
 *   - `provenanceActorClass` is the CLASS of actor that produced the
 *     summarized evidence — one of person | device | source, the three
 *     kinds of the frozen domain `ProvenanceActor` union. Actor ids are
 *     deliberately NOT echoed (PHID-safe summaries).
 *   - A pack MAY carry zero entries: a person with no summarized evidence
 *     yet is a valid state (the compiler simply emits no candidates for
 *     uncovered goal metrics — the registry, not the schema, decides when
 *     a new version is registered).
 *   - Entry `count` is a positive integer (>= 1): entries summarize
 *     OBSERVED evidence; absence of evidence is represented by omitting
 *     the entry, not by a zero-count entry.
 *   - The canonical serialization (`serializeEvidencePack`) sorts entries
 *     by `entryId` (ascending) so the serialized form — and therefore the
 *     content hash — is INDEPENDENT of the order entries were supplied
 *     in; validation returns the same normalized order.
 */
import {
  EVIDENCE_LABELS,
  isEvidencePackVersion,
  isIdOf,
  isQualityScore,
  type EvidenceLabel,
  type PersonId,
  type QualityScore,
} from "@orbb/domain";
import {
  canonicalJsonStringify,
  hashWithDomainBase64Url,
  sha256Hex,
} from "./canonical.js";
import {
  EVIDENCE_PACK_ENTRY_ID_PREFIX,
  isEvidencePackEntryId,
  isEvidencePackId,
  type EvidencePackId,
} from "./ids.js";
import { err, ok, type IntentResult } from "./result.js";

// ---------------------------------------------------------------------------
// Vocabulary: provenance actor classes (frozen domain ProvenanceActor kinds).
// ---------------------------------------------------------------------------

/**
 * The class of actor that produced the summarized evidence — exactly the
 * three kinds of the frozen domain `ProvenanceActor` union
 * (PersonId | DeviceId | SourceId), expressed as a class label so pack
 * entries never echo actor ids.
 */
export const PROVENANCE_ACTOR_CLASSES = ["person", "device", "source"] as const;

export type ProvenanceActorClass = (typeof PROVENANCE_ACTOR_CLASSES)[number];

export function isProvenanceActorClass(value: unknown): value is ProvenanceActorClass {
  return (
    typeof value === "string" &&
    (PROVENANCE_ACTOR_CLASSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Schema types.
// ---------------------------------------------------------------------------

/** Half-open coverage window `[startsAt, endsAt)` a pack entry summarizes. */
export interface CoverageWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Counts per frozen evidence label (all four labels required, zero default). */
export type EvidenceLabelCounts = Readonly<Record<EvidenceLabel, number>>;

/**
 * Quality summary of an entry: label counts (frozen 4-label vocabulary)
 * plus an optional mean quality score in [0, 1] (absent when no summarized
 * observation carried a quality score).
 */
export interface QualityMix {
  readonly byEvidenceLabel: EvidenceLabelCounts;
  readonly meanQuality?: QualityScore;
}

/**
 * The CONTENT of one evidence/observation capability summary (the entry
 * without its derived id — the registry derives the id, so callers cannot
 * forge it).
 */
export interface EvidencePackEntryContent {
  /** Opaque metric concept-code id (measurement lane owns the vocabulary). */
  readonly metricId: string;
  /** Opaque method code the summarized observations were acquired with. */
  readonly methodId: string;
  readonly window: CoverageWindow;
  /** Number of summarized observations (positive integer). */
  readonly count: number;
  readonly qualityMix: QualityMix;
  readonly provenanceActorClass: ProvenanceActorClass;
}

/** One content-addressed entry: the content plus its derived `entryId`. */
export interface EvidencePackEntry extends EvidencePackEntryContent {
  /** Content-addressed id: `evpe_<base64url sha256 of the canonical content>`. */
  readonly entryId: string;
}

/** Domain-separation tag for evidence-pack entry id derivation. */
const ENTRY_ID_DOMAIN = "orbb/intents/evidence-pack-entry-id/v1";

/**
 * The EvidencePack value object: one version of one person's evidence
 * summary. Version lifecycle (active/superseded), provenance
 * (assembled-by / assembled-at / source-entry references) and content
 * hash live on the REGISTRY record (`registry.ts`); this is the pure
 * content the hash commits to.
 */
export interface EvidencePack {
  readonly packId: EvidencePackId;
  /** Person scope: every version of one pack belongs to exactly one person. */
  readonly personId: PersonId;
  /** Positive-integer version (frozen domain guard `isEvidencePackVersion`). */
  readonly version: number;
  readonly entries: readonly EvidencePackEntry[];
  /**
   * Predecessor version this version supersedes. Present exactly on
   * versions >= 2 and equal to `version - 1` (linear append-only chain).
   */
  readonly supersedesVersion?: number;
}

// ---------------------------------------------------------------------------
// Typed validation errors (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reason an entry content (or entry) failed validation. */
export type EvidencePackEntryError =
  | { readonly kind: "not-an-object" }
  | { readonly kind: "invalid-metric-id" }
  | { readonly kind: "invalid-method-id" }
  | { readonly kind: "invalid-window" }
  | { readonly kind: "invalid-count" }
  | { readonly kind: "invalid-quality-mix" }
  | { readonly kind: "quality-mix-count-mismatch" }
  | { readonly kind: "invalid-actor-class" }
  | { readonly kind: "invalid-entry-id" };

/** Typed reason a full pack failed validation. */
export type EvidencePackValidationError =
  | { readonly kind: "not-an-object" }
  | { readonly kind: "invalid-pack-id" }
  | { readonly kind: "invalid-person-id" }
  | { readonly kind: "invalid-version" }
  | { readonly kind: "invalid-supersedes" }
  | { readonly kind: "invalid-entries" }
  | { readonly kind: "invalid-entry"; readonly entryIndex: number; readonly reason: EvidencePackEntryError }
  | { readonly kind: "duplicate-entry"; readonly entryIndex: number };

// ---------------------------------------------------------------------------
// Validation (typed results, never throws for expected rejections).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Validates one entry CONTENT object (no `entryId` — the registry derives
 * it). Returns the rebuilt, defensively-copied content so downstream
 * consumers never alias caller-mutable objects.
 */
export function validateEvidencePackEntryContent(
  candidate: unknown,
): IntentResult<EvidencePackEntryContent, EvidencePackEntryError> {
  if (!isPlainObject(candidate)) {
    return err({ kind: "not-an-object" });
  }
  if (!isNonEmptyString(candidate.metricId)) {
    return err({ kind: "invalid-metric-id" });
  }
  if (!isNonEmptyString(candidate.methodId)) {
    return err({ kind: "invalid-method-id" });
  }
  const window = validateCoverageWindow(candidate.window);
  if (window === undefined) {
    return err({ kind: "invalid-window" });
  }
  if (typeof candidate.count !== "number" || !Number.isInteger(candidate.count) || candidate.count < 1) {
    return err({ kind: "invalid-count" });
  }
  const qualityMix = validateQualityMix(candidate.qualityMix);
  if (qualityMix === undefined) {
    return err({ kind: "invalid-quality-mix" });
  }
  const labelTotal = EVIDENCE_LABELS.reduce(
    (sum, label) => sum + qualityMix.byEvidenceLabel[label],
    0,
  );
  if (labelTotal !== candidate.count) {
    return err({ kind: "quality-mix-count-mismatch" });
  }
  if (!isProvenanceActorClass(candidate.provenanceActorClass)) {
    return err({ kind: "invalid-actor-class" });
  }
  return ok({
    metricId: candidate.metricId,
    methodId: candidate.methodId,
    window,
    count: candidate.count,
    qualityMix,
    provenanceActorClass: candidate.provenanceActorClass,
  });
}

function validateCoverageWindow(candidate: unknown): CoverageWindow | undefined {
  if (!isPlainObject(candidate)) {
    return undefined;
  }
  if (!isValidDate(candidate.startsAt) || !isValidDate(candidate.endsAt)) {
    return undefined;
  }
  const startsAt = new Date(candidate.startsAt.getTime());
  const endsAt = new Date(candidate.endsAt.getTime());
  // Half-open [startsAt, endsAt): a degenerate (empty or inverted) window
  // summarizes nothing and is rejected.
  if (!(startsAt.getTime() < endsAt.getTime())) {
    return undefined;
  }
  return { startsAt, endsAt };
}

function validateQualityMix(candidate: unknown): QualityMix | undefined {
  if (!isPlainObject(candidate)) {
    return undefined;
  }
  const byLabel = candidate.byEvidenceLabel;
  if (!isPlainObject(byLabel)) {
    return undefined;
  }
  const counts: Partial<Record<EvidenceLabel, number>> = {};
  for (const label of EVIDENCE_LABELS) {
    const count = byLabel[label];
    if (!isNonNegativeInteger(count)) {
      return undefined;
    }
    counts[label] = count;
  }
  if (Object.keys(byLabel).length !== EVIDENCE_LABELS.length) {
    // Exactly the four frozen labels — no extras.
    return undefined;
  }
  let meanQuality: QualityScore | undefined;
  if (candidate.meanQuality !== undefined) {
    if (!isQualityScore(candidate.meanQuality)) {
      return undefined;
    }
    meanQuality = candidate.meanQuality;
  }
  return {
    byEvidenceLabel: counts as EvidenceLabelCounts,
    ...(meanQuality !== undefined ? { meanQuality } : {}),
  };
}

// ---------------------------------------------------------------------------
// Content addressing.
// ---------------------------------------------------------------------------

/** Domain-separated digest of the (canonical) entry content. */
function entryContentDigest(content: EvidencePackEntryContent): string {
  return hashWithDomainBase64Url(ENTRY_ID_DOMAIN, {
    metricId: content.metricId,
    methodId: content.methodId,
    window: content.window,
    count: content.count,
    qualityMix: content.qualityMix,
    provenanceActorClass: content.provenanceActorClass,
  });
}

/**
 * Derives the content-addressed entry id for validated entry content:
 * `evpe_<43-char base64url sha256>`. Pure: identical content (in any key
 * order) always yields the identical id.
 */
export function deriveEvidencePackEntryId(content: EvidencePackEntryContent): string {
  return `${EVIDENCE_PACK_ENTRY_ID_PREFIX}_${entryContentDigest(content)}`;
}

/**
 * Assembles a content-addressed entry from validated content (derives the
 * entry id). For raw/unvalidated input, run
 * {@link validateEvidencePackEntryContent} first — derivation over garbage
 * input is a caller bug, not a typed rejection.
 */
export function assembleEvidencePackEntry(content: EvidencePackEntryContent): EvidencePackEntry {
  return { ...content, entryId: deriveEvidencePackEntryId(content) };
}

/**
 * Validates one full entry (content + `entryId`): every field is checked
 * and the entry id is re-derived and compared, so a forged or stale id is
 * a typed rejection. Returns the rebuilt entry.
 */
export function validateEvidencePackEntry(
  candidate: unknown,
): IntentResult<EvidencePackEntry, EvidencePackEntryError> {
  if (!isPlainObject(candidate)) {
    return err({ kind: "not-an-object" });
  }
  if (!isEvidencePackEntryId(candidate.entryId)) {
    return err({ kind: "invalid-entry-id" });
  }
  const content = validateEvidencePackEntryContent(candidate);
  if (!content.ok) {
    return content;
  }
  if (deriveEvidencePackEntryId(content.value) !== candidate.entryId) {
    return err({ kind: "invalid-entry-id" });
  }
  return ok(assembleEvidencePackEntry(content.value));
}

// ---------------------------------------------------------------------------
// Pack validation.
// ---------------------------------------------------------------------------

/**
 * Validates a full EvidencePack candidate (typed errors, never throws for
 * expected rejections). Returns the NORMALIZED pack: entries rebuilt and
 * sorted by `entryId` ascending — the same order the canonical
 * serialization and content hash use, so equal content is order-stable.
 */
export function validateEvidencePack(
  candidate: unknown,
): IntentResult<EvidencePack, EvidencePackValidationError> {
  if (!isPlainObject(candidate)) {
    return err({ kind: "not-an-object" });
  }
  if (!isEvidencePackId(candidate.packId)) {
    return err({ kind: "invalid-pack-id" });
  }
  if (!isIdOf("person", candidate.personId)) {
    return err({ kind: "invalid-person-id" });
  }
  // The kernel owns the evidence-pack version grammar (frozen domain guard).
  if (!isEvidencePackVersion(candidate.version)) {
    return err({ kind: "invalid-version" });
  }
  const hasSupersedes = candidate.supersedesVersion !== undefined;
  if (candidate.version === 1 && hasSupersedes) {
    return err({ kind: "invalid-supersedes" });
  }
  if (candidate.version > 1) {
    if (!hasSupersedes || candidate.supersedesVersion !== candidate.version - 1) {
      return err({ kind: "invalid-supersedes" });
    }
  }
  if (!Array.isArray(candidate.entries)) {
    return err({ kind: "invalid-entries" });
  }
  const entries: EvidencePackEntry[] = [];
  const seenEntryIds = new Set<string>();
  for (const [entryIndex, entryCandidate] of candidate.entries.entries()) {
    const entry = validateEvidencePackEntry(entryCandidate);
    if (!entry.ok) {
      return err({ kind: "invalid-entry", entryIndex, reason: entry.error });
    }
    if (seenEntryIds.has(entry.value.entryId)) {
      // Identical content twice — content addressing makes duplicates
      // detectable by id.
      return err({ kind: "duplicate-entry", entryIndex });
    }
    seenEntryIds.add(entry.value.entryId);
    entries.push(entry.value);
  }
  entries.sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  return ok({
    packId: candidate.packId,
    personId: candidate.personId,
    version: candidate.version,
    entries,
    ...(hasSupersedes ? { supersedesVersion: candidate.supersedesVersion as number } : {}),
  });
}

// ---------------------------------------------------------------------------
// Deterministic serialization + content hash.
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a pack: canonical JSON (sorted keys, Dates as
 * epoch ms, undefined dropped) over the normalized view (entries sorted by
 * `entryId`). Pure and deterministic — equal content serializes
 * identically regardless of supplied entry order.
 */
export function serializeEvidencePack(pack: EvidencePack): string {
  const entries = [...pack.entries]
    .map((entry) => ({
      entryId: entry.entryId,
      metricId: entry.metricId,
      methodId: entry.methodId,
      window: { startsAt: entry.window.startsAt, endsAt: entry.window.endsAt },
      count: entry.count,
      qualityMix: {
        byEvidenceLabel: entry.qualityMix.byEvidenceLabel,
        ...(entry.qualityMix.meanQuality !== undefined
          ? { meanQuality: entry.qualityMix.meanQuality }
          : {}),
      },
      provenanceActorClass: entry.provenanceActorClass,
    }))
    .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  return canonicalJsonStringify({
    packId: pack.packId,
    personId: pack.personId,
    version: pack.version,
    ...(pack.supersedesVersion !== undefined ? { supersedesVersion: pack.supersedesVersion } : {}),
    entries,
  });
}

/**
 * Content hash of a pack: the hex SHA-256 of
 * {@link serializeEvidencePack}. This is the value the registry stamps on
 * every version record (integrity + determinism proof — same content,
 * same hash, always).
 */
export function hashEvidencePack(pack: EvidencePack): string {
  return sha256Hex(serializeEvidencePack(pack));
}
