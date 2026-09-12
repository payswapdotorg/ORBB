/**
 * A37 — EvidencePack registry: the versioned, append-only store of
 * EvidencePack versions with provenance (architecture §4 intent family).
 *
 * RECORDED DESIGN DECISIONS (all mirror the M4-A `MetricCatalog`
 * supersession semantics, exactly as the packet prescribes):
 *   - `register` on a FRESH pack id installs version 1 as `active`. On an
 *     EXISTING pack id, an explicit `supersedes` (the current ACTIVE
 *     version) is REQUIRED: the replacement becomes version N+1 / active
 *     and the target moves to the terminal `superseded` state — the record
 *     is still resolvable for audit (append-only: version content is
 *     never mutated; only the lifecycle fields `state`/`supersededAt`
 *     transition, mirroring domain observation supersession).
 *   - Only the ACTIVE version may be superseded; re-superseding a
 *     superseded version or resurrecting one is a typed rejection.
 *   - Every version carries PROVENANCE: `assembledBy` (a frozen domain
 *     `ProvenanceActor` — person, device, or source), `assembledAt`
 *     (stamped from the INJECTED clock so history is reproducible under
 *     the testkit `DeterministicClock`), and `sourceEntryReferences`
 *     (opaque references to the upstream summary records the assembler
 *     consumed — stored verbatim for audit, never interpreted; may be
 *     empty for bootstrap packs).
 *   - Person scope: all versions of one pack id belong to one person — a
 *     version N+1 whose person differs is a typed rejection.
 *   - DENY-BY-DEFAULT, never throws for expected rejections: malformed
 *     pack ids, malformed person ids (unknown person), malformed actor
 *     ids, malformed entries (including unknown-shaped metric ids) are
 *     all typed rejections. Resolutions return `undefined` for unknown
 *     pack ids (catalog parity — the compiler boundary converts that into
 *     its own typed rejections). Metric EXISTENCE is not checkable here
 *     (the registry has no catalog dependency by design) — the compiler
 *     gates it against the injected catalog port (handoff recorded).
 *   - Entries are registered as CONTENT (no ids): the registry derives
 *     the content-addressed ids itself, so callers cannot forge them,
 *     deduplicates by content, and stores entries in canonical order.
 *   - Sync interface (registry-shaped, in-memory reference
 *     implementation); db adaptation is a recorded handoff (same as
 *     `MetricCatalog`).
 */
import { isIdOf, isProvenanceActor, type PersonId, type ProvenanceActor } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import { err, ok, type IntentResult } from "./result.js";
import { isEvidencePackId, type EvidencePackId } from "./ids.js";
import {
  assembleEvidencePackEntry,
  hashEvidencePack,
  validateEvidencePackEntryContent,
  type EvidencePack,
  type EvidencePackEntry,
  type EvidencePackEntryContent,
  type EvidencePackEntryError,
} from "./evidencePack.js";

/**
 * Lifecycle state of an evidence-pack version. `active` is the resolvable
 * current version; `superseded` is terminal (mirrors the catalog version
 * state vocabulary).
 */
export const EVIDENCE_PACK_VERSION_STATES = ["active", "superseded"] as const;

export type EvidencePackVersionState = (typeof EVIDENCE_PACK_VERSION_STATES)[number];

/** One registered version of one EvidencePack (content + lifecycle + provenance). */
export interface EvidencePackVersionRecord {
  readonly packId: EvidencePackId;
  /** 1-based version number, monotonically increasing per pack. */
  readonly version: number;
  readonly personId: PersonId;
  /** Canonical-order (sorted by entryId), content-addressed entries. */
  readonly entries: readonly EvidencePackEntry[];
  /** Version this record supersedes (present exactly on versions >= 2). */
  readonly supersedesVersion?: number;
  readonly state: EvidencePackVersionState;
  /** Hex SHA-256 of the canonical serialization of the pack content. */
  readonly contentHash: string;
  /** Actor that assembled this version (person, device, or source). */
  readonly assembledBy: ProvenanceActor;
  /** When this version was assembled (injected clock). */
  readonly assembledAt: Date;
  /** Opaque upstream summary references the assembler consumed (audit). */
  readonly sourceEntryReferences: readonly string[];
  /** When this version was superseded (present iff state is superseded). */
  readonly supersededAt?: Date;
}

/**
 * Result of a legal version supersession, mirroring the domain
 * `SupersededPair` / catalog `SupersededMetricVersionPair` shape.
 */
export interface SupersededEvidencePackVersionPair {
  readonly superseded: EvidencePackVersionRecord;
  readonly replacement: EvidencePackVersionRecord;
}

/** Registration input: content-shaped entries + provenance + optional supersession. */
export interface RegisterEvidencePackInput {
  readonly packId: EvidencePackId;
  readonly personId: PersonId;
  /** Entry CONTENTS (ids are derived by the registry — unforgeable). */
  readonly entries: readonly EvidencePackEntryContent[];
  readonly assembledBy: ProvenanceActor;
  readonly sourceEntryReferences: readonly string[];
  /**
   * Version to supersede. REQUIRED when the pack already exists (the
   * chain only grows via explicit supersession, like the catalog); must
   * be absent for a brand-new pack id.
   */
  readonly supersedes?: number;
}

/** Successful registration outcome. */
export interface EvidencePackRegistrationOutcome {
  /** The record as registered (version 1 or a replacement). */
  readonly record: EvidencePackVersionRecord;
  /** Present iff this registration superseded a prior active version. */
  readonly pair?: SupersededEvidencePackVersionPair;
}

/**
 * Typed registration rejections (PHID-safe: structural context only,
 * received values are never echoed).
 */
export type EvidencePackRegistrationError =
  | { readonly kind: "invalid-pack-id" }
  | { readonly kind: "invalid-person-id" }
  | { readonly kind: "invalid-actor" }
  | { readonly kind: "invalid-entries" }
  | { readonly kind: "invalid-entry"; readonly entryIndex: number; readonly reason: EvidencePackEntryError }
  | { readonly kind: "duplicate-entry"; readonly entryIndex: number }
  | { readonly kind: "invalid-source-references" }
  | { readonly kind: "unknown-supersede-target" }
  | { readonly kind: "target-not-active" }
  | { readonly kind: "supersede-required" }
  | { readonly kind: "person-mismatch" };

/** The evidence-pack registry port consumed by the intent compiler. */
export interface EvidencePackRegistry {
  /**
   * Registers a pack version. Fresh pack id => version 1 (active).
   * Existing pack id => explicit supersession of the current ACTIVE
   * version, installing the next version as active and moving the target
   * to the terminal superseded state.
   */
  register(input: RegisterEvidencePackInput): IntentResult<EvidencePackRegistrationOutcome, EvidencePackRegistrationError>;
  /** Resolves the ACTIVE version record, or undefined for unknown pack ids. */
  resolveActive(packId: EvidencePackId): EvidencePackVersionRecord | undefined;
  /** Resolves one exact version record (superseded versions stay resolvable). */
  resolveVersion(packId: EvidencePackId, version: number): EvidencePackVersionRecord | undefined;
  /** All versions of one pack in ascending version order — the lineage. */
  listVersions(packId: EvidencePackId): readonly EvidencePackVersionRecord[];
}

/**
 * In-memory reference `EvidencePackRegistry`. Deterministic: lookups and
 * listings are pure functions of the registration sequence; `assembledAt`
 * and `supersededAt` are stamped from the injected clock so version
 * history is reproducible under the testkit `DeterministicClock`.
 */
export class InMemoryEvidencePackRegistry implements EvidencePackRegistry {
  readonly #versions = new Map<EvidencePackId, EvidencePackVersionRecord[]>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  register(
    input: RegisterEvidencePackInput,
  ): IntentResult<EvidencePackRegistrationOutcome, EvidencePackRegistrationError> {
    if (typeof input !== "object" || input === null) {
      // Non-object input: rejected as the first field's validation failure.
      return err({ kind: "invalid-pack-id" });
    }
    if (!isEvidencePackId(input.packId)) {
      return err({ kind: "invalid-pack-id" });
    }
    if (!isIdOf("person", input.personId)) {
      // Deny-by-default on unknown/malformed person ids (typed, no throw).
      return err({ kind: "invalid-person-id" });
    }
    if (!isProvenanceActor(input.assembledBy)) {
      return err({ kind: "invalid-actor" });
    }
    if (!Array.isArray(input.entries)) {
      return err({ kind: "invalid-entries" });
    }
    if (
      !Array.isArray(input.sourceEntryReferences) ||
      input.sourceEntryReferences.some(
        (reference) => typeof reference !== "string" || reference.length === 0,
      )
    ) {
      return err({ kind: "invalid-source-references" });
    }

    const entries = this.#assembleEntries(input.entries);
    if (!entries.ok) {
      return entries;
    }

    const packId = input.packId;
    const chain = this.#versions.get(packId);
    const now = this.#clock.now();
    const sourceEntryReferences = [...input.sourceEntryReferences];

    if (chain === undefined || chain.length === 0) {
      if (input.supersedes !== undefined) {
        // Superseding a version of a pack the registry has never seen.
        return err({ kind: "unknown-supersede-target" });
      }
      const record = this.#buildRecord({
        packId,
        version: 1,
        personId: input.personId,
        entries: entries.value,
        supersedesVersion: undefined,
        assembledBy: input.assembledBy,
        assembledAt: now,
        sourceEntryReferences,
      });
      this.#versions.set(packId, [record]);
      return ok({ record });
    }

    if (input.supersedes === undefined) {
      // Existing pack: the chain only grows via explicit supersession.
      return err({ kind: "supersede-required" });
    }

    const targetVersion = input.supersedes;
    const target =
      targetVersion >= 1 && targetVersion <= chain.length
        ? chain[targetVersion - 1]
        : undefined;
    if (target === undefined) {
      return err({ kind: "unknown-supersede-target" });
    }
    if (target.state !== "active") {
      // Catalog/domain mirror: only the ACTIVE version can be superseded.
      return err({ kind: "target-not-active" });
    }
    if (target.personId !== input.personId) {
      // Person scope is invariant across the lineage of one pack.
      return err({ kind: "person-mismatch" });
    }

    const superseded: EvidencePackVersionRecord = {
      ...target,
      state: "superseded",
      supersededAt: now,
    };
    const replacement = this.#buildRecord({
      packId,
      version: chain.length + 1,
      personId: input.personId,
      entries: entries.value,
      supersedesVersion: targetVersion,
      assembledBy: input.assembledBy,
      assembledAt: now,
      sourceEntryReferences,
    });
    const nextChain: EvidencePackVersionRecord[] = [...chain];
    nextChain[targetVersion - 1] = superseded;
    nextChain.push(replacement);
    this.#versions.set(packId, nextChain);
    return ok({ record: replacement, pair: { superseded, replacement } });
  }

  resolveActive(packId: EvidencePackId): EvidencePackVersionRecord | undefined {
    return this.#activeRecord(packId);
  }

  resolveVersion(packId: EvidencePackId, version: number): EvidencePackVersionRecord | undefined {
    const chain = this.#versions.get(packId);
    if (chain === undefined) {
      return undefined;
    }
    return version >= 1 && version <= chain.length ? chain[version - 1] : undefined;
  }

  listVersions(packId: EvidencePackId): readonly EvidencePackVersionRecord[] {
    const chain = this.#versions.get(packId);
    return chain === undefined ? [] : [...chain];
  }

  #assembleEntries(
    contents: readonly EvidencePackEntryContent[],
  ): IntentResult<readonly EvidencePackEntry[], EvidencePackRegistrationError> {
    const entries: EvidencePackEntry[] = [];
    const seenEntryIds = new Set<string>();
    for (const [entryIndex, content] of contents.entries()) {
      const validated = validateEvidencePackEntryContent(content);
      if (!validated.ok) {
        return err({ kind: "invalid-entry", entryIndex, reason: validated.error });
      }
      const entry = assembleEvidencePackEntry(validated.value);
      if (seenEntryIds.has(entry.entryId)) {
        return err({ kind: "duplicate-entry", entryIndex });
      }
      seenEntryIds.add(entry.entryId);
      entries.push(entry);
    }
    entries.sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
    return ok(entries);
  }

  #buildRecord(input: {
    packId: EvidencePackId;
    version: number;
    personId: PersonId;
    entries: readonly EvidencePackEntry[];
    supersedesVersion: number | undefined;
    assembledBy: ProvenanceActor;
    assembledAt: Date;
    sourceEntryReferences: readonly string[];
  }): EvidencePackVersionRecord {
    const pack: EvidencePack = {
      packId: input.packId,
      personId: input.personId,
      version: input.version,
      entries: input.entries,
      ...(input.supersedesVersion !== undefined
        ? { supersedesVersion: input.supersedesVersion }
        : {}),
    };
    return {
      packId: input.packId,
      version: input.version,
      personId: input.personId,
      entries: input.entries,
      ...(input.supersedesVersion !== undefined
        ? { supersedesVersion: input.supersedesVersion }
        : {}),
      state: "active",
      contentHash: hashEvidencePack(pack),
      assembledBy: input.assembledBy,
      assembledAt: input.assembledAt,
      sourceEntryReferences: input.sourceEntryReferences,
    };
  }

  #activeRecord(packId: EvidencePackId): EvidencePackVersionRecord | undefined {
    const chain = this.#versions.get(packId);
    if (chain === undefined) {
      return undefined;
    }
    // The active version is always the latest registered replacement.
    const latest = chain[chain.length - 1];
    return latest !== undefined && latest.state === "active" ? latest : undefined;
  }
}

/**
 * Extracts the pure {@link EvidencePack} content view from a registry
 * record (content only — lifecycle and provenance stay on the record).
 */
export function recordToEvidencePack(record: EvidencePackVersionRecord): EvidencePack {
  return {
    packId: record.packId,
    personId: record.personId,
    version: record.version,
    entries: record.entries,
    ...(record.supersedesVersion !== undefined
      ? { supersedesVersion: record.supersedesVersion }
      : {}),
  };
}
