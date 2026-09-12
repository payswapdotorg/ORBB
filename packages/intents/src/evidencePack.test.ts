import { describe, expect, it } from "vitest";
import { parseQualityScore, type PersonId } from "@orbb/domain";
import {
  assembleEvidencePackEntry,
  deriveEvidencePackEntryId,
  hashEvidencePack,
  isProvenanceActorClass,
  serializeEvidencePack,
  validateEvidencePack,
  validateEvidencePackEntry,
  validateEvidencePackEntryContent,
  type EvidencePack,
  type EvidencePackEntry,
  type EvidencePackEntryContent,
} from "./evidencePack.js";
import { isEvidencePackId, type EvidencePackId } from "./ids.js";

const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
const PACK_ID = "evpack_SYNTH-pack-00000001" as EvidencePackId;

const DAY_MS = 86_400_000;

function content(overrides?: {
  metricId?: string;
  methodId?: string;
  count?: number;
  startsAtMs?: number;
  endsAtMs?: number;
  measured?: number;
  estimated?: number;
  imported?: number;
  derived?: number;
  meanQuality?: number;
  actorClass?: "person" | "device" | "source";
}): EvidencePackEntryContent {
  const count = overrides?.count ?? 12;
  const measured = overrides?.measured ?? count;
  return {
    metricId: overrides?.metricId ?? "SYNTH-metric-heart-rate",
    methodId: overrides?.methodId ?? "SYNTH-method-hr-wearable",
    window: {
      startsAt: new Date(overrides?.startsAtMs ?? 0),
      endsAt: new Date(overrides?.endsAtMs ?? DAY_MS),
    },
    count,
    qualityMix: {
      byEvidenceLabel: {
        MEASURED: measured,
        ESTIMATED: overrides?.estimated ?? 0,
        IMPORTED: overrides?.imported ?? 0,
        DERIVED: overrides?.derived ?? 0,
      },
      ...(overrides?.meanQuality !== undefined
        ? { meanQuality: parseQualityScore(overrides.meanQuality) }
        : {}),
    },
    provenanceActorClass: overrides?.actorClass ?? "device",
  };
}

const BASE = content();

describe("A36 entry content addressing", () => {
  it("derives the same entry id for identical content in any key order", () => {
    const assembled = assembleEvidencePackEntry(BASE);
    const reordered: EvidencePackEntryContent = {
      provenanceActorClass: BASE.provenanceActorClass,
      count: BASE.count,
      methodId: BASE.methodId,
      window: { endsAt: BASE.window.endsAt, startsAt: BASE.window.startsAt },
      metricId: BASE.metricId,
      qualityMix: {
        byEvidenceLabel: {
          DERIVED: BASE.qualityMix.byEvidenceLabel.DERIVED,
          IMPORTED: BASE.qualityMix.byEvidenceLabel.IMPORTED,
          MEASURED: BASE.qualityMix.byEvidenceLabel.MEASURED,
          ESTIMATED: BASE.qualityMix.byEvidenceLabel.ESTIMATED,
        },
      },
    };
    // Key insertion order differs; canonical form must not care.
    expect(deriveEvidencePackEntryId(reordered)).toBe(assembled.entryId);
    expect(deriveEvidencePackEntryId(BASE)).toBe(assembled.entryId);
  });

  it("derives a different entry id for different content", () => {
    expect(deriveEvidencePackEntryId(content({ count: 13 }))).not.toBe(
      deriveEvidencePackEntryId(BASE),
    );
    expect(deriveEvidencePackEntryId(content({ methodId: "SYNTH-method-hr-app" }))).not.toBe(
      deriveEvidencePackEntryId(BASE),
    );
    expect(deriveEvidencePackEntryId(content({ startsAtMs: 1 }))).not.toBe(
      deriveEvidencePackEntryId(BASE),
    );
  });

  it("emits grammar-valid entry ids (evpe_ + 43 URL-safe chars)", () => {
    const entryId = assembleEvidencePackEntry(BASE).entryId;
    expect(entryId).toMatch(/^evpe_[A-Za-z0-9_-]{43}$/);
  });
});

describe("A36 entry content validation (typed errors, never throws)", () => {
  it("accepts well-formed content and rebuilds it defensively", () => {
    const result = validateEvidencePackEntryContent(BASE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metricId).toBe(BASE.metricId);
      expect(result.value.count).toBe(12);
      expect(result.value.qualityMix.byEvidenceLabel.MEASURED).toBe(12);
      expect(result.value.window.startsAt.getTime()).toBe(0);
    }
  });

  it("accepts content without a mean quality score (optional)", () => {
    // No overrides: the fixture quality mix carries label counts only.
    const result = validateEvidencePackEntryContent(content());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.qualityMix.meanQuality).toBeUndefined();
    }
  });

  it("rejects each malformed field with a typed reason", () => {
    expect(validateEvidencePackEntryContent(null)).toEqual({ ok: false, error: { kind: "not-an-object" } });
    expect(validateEvidencePackEntryContent({ ...BASE, metricId: "" })).toEqual({
      ok: false,
      error: { kind: "invalid-metric-id" },
    });
    expect(validateEvidencePackEntryContent({ ...BASE, methodId: 5 })).toEqual({
      ok: false,
      error: { kind: "invalid-method-id" },
    });
    expect(validateEvidencePackEntryContent({ ...BASE, window: { startsAt: new Date(DAY_MS), endsAt: new Date(0) } })).toEqual({
      ok: false,
      error: { kind: "invalid-window" },
    });
    expect(validateEvidencePackEntryContent({ ...BASE, window: { startsAt: new Date(0), endsAt: new Date(0) } })).toEqual({
      ok: false,
      error: { kind: "invalid-window" },
    });
    expect(validateEvidencePackEntryContent(content({ count: 0, measured: 0 }))).toEqual({
      ok: false,
      error: { kind: "invalid-count" },
    });
    expect(validateEvidencePackEntryContent(content({ count: 1.5, measured: 1.5 }))).toEqual({
      ok: false,
      error: { kind: "invalid-count" },
    });
  });

  it("rejects malformed quality mixes with typed reasons", () => {
    expect(
      validateEvidencePackEntryContent({ ...BASE, qualityMix: { byEvidenceLabel: { MEASURED: -1, ESTIMATED: 13, IMPORTED: 0, DERIVED: 0 } } }),
    ).toEqual({ ok: false, error: { kind: "invalid-quality-mix" } });
    expect(
      validateEvidencePackEntryContent({ ...BASE, qualityMix: { byEvidenceLabel: { MEASURED: 1.5, ESTIMATED: 10.5, IMPORTED: 0, DERIVED: 0 } } }),
    ).toEqual({ ok: false, error: { kind: "invalid-quality-mix" } });
    expect(
      validateEvidencePackEntryContent({ ...BASE, qualityMix: { byEvidenceLabel: {} } }),
    ).toEqual({ ok: false, error: { kind: "invalid-quality-mix" } });
    expect(
      validateEvidencePackEntryContent({ ...BASE, qualityMix: { byEvidenceLabel: { MEASURED: 12, ESTIMATED: 0, IMPORTED: 0, DERIVED: 0, EXTRA: 1 } } }),
    ).toEqual({ ok: false, error: { kind: "invalid-quality-mix" } });
    expect(
      // Built without the typed helper: parseQualityScore(1.5) would throw
      // in the fixture builder before the validator under test runs.
      validateEvidencePackEntryContent({
        ...BASE,
        qualityMix: { ...BASE.qualityMix, meanQuality: 1.5 },
      }),
    ).toEqual({ ok: false, error: { kind: "invalid-quality-mix" } });
  });

  it("rejects label counts that do not sum to the entry count", () => {
    expect(validateEvidencePackEntryContent(content({ count: 12, measured: 11 }))).toEqual({
      ok: false,
      error: { kind: "quality-mix-count-mismatch" },
    });
  });

  it("rejects an actor class outside the frozen domain actor kinds", () => {
    // Built without the typed helper: the invalid class is the input under
    // test (the validator's param is `unknown` by design).
    expect(validateEvidencePackEntryContent({ ...BASE, provenanceActorClass: "service" })).toEqual({
      ok: false,
      error: { kind: "invalid-actor-class" },
    });
  });
});

describe("A36 full entry validation (content addressing is unforgeable)", () => {
  it("accepts an assembled entry", () => {
    const entry = assembleEvidencePackEntry(BASE);
    const result = validateEvidencePackEntry(entry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entryId).toBe(entry.entryId);
    }
  });

  it("rejects a forged entry id with a typed reason", () => {
    const entry = assembleEvidencePackEntry(BASE);
    const forged: EvidencePackEntry = { ...entry, entryId: "evpe_" + "A".repeat(43) };
    expect(validateEvidencePackEntry(forged)).toEqual({
      ok: false,
      error: { kind: "invalid-entry-id" },
    });
  });

  it("rejects a malformed entry id grammar", () => {
    const entry = assembleEvidencePackEntry(BASE);
    expect(validateEvidencePackEntry({ ...entry, entryId: "nope" })).toEqual({
      ok: false,
      error: { kind: "invalid-entry-id" },
    });
  });
});

describe("A36 pack validation (typed errors, version guard, lineage linkage)", () => {
  const entryA = assembleEvidencePackEntry(BASE);
  const entryB = assembleEvidencePackEntry(
    content({ metricId: "SYNTH-metric-step-count", methodId: "SYNTH-method-steps-wearable", count: 90, measured: 90 }),
  );

  function pack(candidate: Record<string, unknown>): unknown {
    return candidate;
  }

  it("accepts a valid version-1 pack with empty entries (no evidence yet is valid)", () => {
    const result = validateEvidencePack({ packId: PACK_ID, personId: PERSON, version: 1, entries: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toEqual([]);
      expect(result.value.supersedesVersion).toBeUndefined();
    }
  });

  it("accepts a valid pack and normalizes entries into canonical (entryId-sorted) order", () => {
    const result = validateEvidencePack({
      packId: PACK_ID,
      personId: PERSON,
      version: 2,
      supersedesVersion: 1,
      entries: [entryB, entryA],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expectedOrder = [entryA, entryB].sort((a, b) =>
        a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0,
      );
      expect(result.value.entries.map((entry) => entry.entryId)).toEqual(
        expectedOrder.map((entry) => entry.entryId),
      );
      expect(result.value.supersedesVersion).toBe(1);
    }
  });

  it("rejects malformed pack ids, person ids, and versions with typed reasons", () => {
    expect(validateEvidencePack(pack({ packId: "not-a-pack", personId: PERSON, version: 1, entries: [] }))).toEqual({
      ok: false,
      error: { kind: "invalid-pack-id" },
    });
    expect(validateEvidencePack(pack({ packId: PACK_ID, personId: "person", version: 1, entries: [] }))).toEqual({
      ok: false,
      error: { kind: "invalid-person-id" },
    });
    // The kernel owns the version grammar (frozen domain guard).
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(validateEvidencePack(pack({ packId: PACK_ID, personId: PERSON, version, entries: [] }))).toEqual({
        ok: false,
        error: { kind: "invalid-version" },
      });
    }
    expect(validateEvidencePack(null)).toEqual({ ok: false, error: { kind: "not-an-object" } });
  });

  it("rejects broken predecessor linkage with a typed reason", () => {
    expect(
      validateEvidencePack(pack({ packId: PACK_ID, personId: PERSON, version: 1, supersedesVersion: 1, entries: [] })),
    ).toEqual({ ok: false, error: { kind: "invalid-supersedes" } });
    expect(
      validateEvidencePack(pack({ packId: PACK_ID, personId: PERSON, version: 3, supersedesVersion: 1, entries: [] })),
    ).toEqual({ ok: false, error: { kind: "invalid-supersedes" } });
    expect(
      validateEvidencePack(pack({ packId: PACK_ID, personId: PERSON, version: 3, entries: [] })),
    ).toEqual({ ok: false, error: { kind: "invalid-supersedes" } });
  });

  it("rejects non-array entries, invalid entries, and duplicate (identical) entries", () => {
    expect(
      validateEvidencePack(pack({ packId: PACK_ID, personId: PERSON, version: 1, entries: "nope" })),
    ).toEqual({ ok: false, error: { kind: "invalid-entries" } });
    expect(
      validateEvidencePack({ packId: PACK_ID, personId: PERSON, version: 1, entries: [{ ...entryA, count: 0, qualityMix: { byEvidenceLabel: { MEASURED: 0, ESTIMATED: 0, IMPORTED: 0, DERIVED: 0 } } }] }),
    ).toEqual({ ok: false, error: { kind: "invalid-entry", entryIndex: 0, reason: { kind: "invalid-count" } } });
    // Identical content twice -> identical content-addressed id -> duplicate.
    expect(
      validateEvidencePack({ packId: PACK_ID, personId: PERSON, version: 1, entries: [entryA, entryA] }),
    ).toEqual({ ok: false, error: { kind: "duplicate-entry", entryIndex: 1 } });
  });
});

describe("A36 deterministic serialization + content hash", () => {
  const entryA = assembleEvidencePackEntry(BASE);
  const entryB = assembleEvidencePackEntry(
    content({ metricId: "SYNTH-metric-step-count", methodId: "SYNTH-method-steps-wearable", count: 90, measured: 90 }),
  );

  const packV1: EvidencePack = { packId: PACK_ID, personId: PERSON, version: 1, entries: [entryA, entryB] };

  it("serializes equal content identically regardless of entry order", () => {
    const reordered: EvidencePack = { ...packV1, entries: [entryB, entryA] };
    expect(serializeEvidencePack(reordered)).toBe(serializeEvidencePack(packV1));
  });

  it("serializes absent and present-undefined optional fields identically", () => {
    const without: EvidencePack = { packId: PACK_ID, personId: PERSON, version: 1, entries: [entryA] };
    // Present-but-undefined is NOT a legal typed value (exactOptionalPropertyTypes);
    // the cast models a deserialized/JSON-round-tripped object carrying the
    // explicit undefined key, which canonical JSON must treat as absent.
    const withUndefined = { ...without, supersedesVersion: undefined } as unknown as EvidencePack;
    expect(serializeEvidencePack(withUndefined)).toBe(serializeEvidencePack(without));
  });

  it("hashes to a stable 64-char hex digest; different content, different hash", () => {
    const hash = hashEvidencePack(packV1);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEvidencePack({ ...packV1, entries: [entryB, entryA] })).toBe(hash);
    expect(hashEvidencePack({ ...packV1, version: 2, supersedesVersion: 1 })).not.toBe(hash);
    expect(
      hashEvidencePack({ ...packV1, personId: "prsn_SYNTH-person-00000002" as PersonId }),
    ).not.toBe(hash);
  });

  it("produces a Dates-as-epoch-ms JSON body", () => {
    const body = serializeEvidencePack({ ...packV1, entries: [entryA] });
    expect(body).toContain('"startsAt":0');
    expect(body).toContain(`"endsAt":${DAY_MS}`);
  });
});

describe("provenance actor class vocabulary", () => {
  it("accepts the three frozen domain actor kinds and rejects others", () => {
    expect(isProvenanceActorClass("person")).toBe(true);
    expect(isProvenanceActorClass("device")).toBe(true);
    expect(isProvenanceActorClass("source")).toBe(true);
    expect(isProvenanceActorClass("service")).toBe(false);
    expect(isProvenanceActorClass(1)).toBe(false);
  });
});

describe("pack id grammar", () => {
  it("accepts well-formed evpack ids and rejects malformed ones", () => {
    expect(isEvidencePackId(PACK_ID)).toBe(true);
    expect(isEvidencePackId("evpack_short")).toBe(false);
    expect(isEvidencePackId("plan_SYNTH-not-a-pack-0000001")).toBe(false);
    expect(isEvidencePackId("evpack_" + "A".repeat(129))).toBe(false);
    expect(isEvidencePackId("evpack_" + "A".repeat(128))).toBe(true);
  });
});
