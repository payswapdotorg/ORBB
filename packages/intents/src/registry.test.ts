import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import type { DeviceId, PersonId, ProvenanceActor } from "@orbb/domain";
import {
  InMemoryEvidencePackRegistry,
  recordToEvidencePack,
  type RegisterEvidencePackInput,
} from "./registry.js";
import {
  hashEvidencePack,
  validateEvidencePack,
  type EvidencePackEntryContent,
} from "./evidencePack.js";
import type { EvidencePackId } from "./ids.js";

const PERSON = "prsn_SYNTH-person-00000001" as PersonId;
const OTHER_PERSON = "prsn_SYNTH-person-00000002" as PersonId;
const DEVICE_ACTOR = "dev_SYNTH-device-00000001" as DeviceId;
const PACK_ID = "evpack_SYNTH-pack-00000001" as EvidencePackId;

const DAY_MS = 86_400_000;

function content(metricId: string, methodId: string, count: number): EvidencePackEntryContent {
  return {
    metricId,
    methodId,
    window: { startsAt: new Date(0), endsAt: new Date(DAY_MS) },
    count,
    qualityMix: {
      byEvidenceLabel: { MEASURED: count, ESTIMATED: 0, IMPORTED: 0, DERIVED: 0 },
    },
    provenanceActorClass: "device",
  };
}

const ENTRIES: readonly EvidencePackEntryContent[] = [
  content("SYNTH-metric-heart-rate", "SYNTH-method-hr-wearable", 30),
  content("SYNTH-metric-heart-rate", "SYNTH-method-hr-app", 10),
  content("SYNTH-metric-step-count", "SYNTH-method-steps-wearable", 90),
];

function registration(
  overrides?: Partial<RegisterEvidencePackInput>,
): RegisterEvidencePackInput {
  return {
    packId: PACK_ID,
    personId: PERSON,
    entries: ENTRIES,
    assembledBy: DEVICE_ACTOR,
    sourceEntryReferences: ["SYNTH-source-ref-0001", "SYNTH-source-ref-0002"],
    ...overrides,
  };
}

function freshRegistry(epochMs = 1_000): InMemoryEvidencePackRegistry {
  return new InMemoryEvidencePackRegistry(new DeterministicClock({ epochMs }));
}

describe("A37 registry — fresh registration (version 1)", () => {
  it("registers a fresh pack as version 1, active, with full provenance", () => {
    const registry = freshRegistry();
    const result = registry.register(registration());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected registration to succeed");
    }
    const record = result.value.record;
    expect(record.packId).toBe(PACK_ID);
    expect(record.version).toBe(1);
    expect(record.state).toBe("active");
    expect(record.supersedesVersion).toBeUndefined();
    expect(record.personId).toBe(PERSON);
    expect(record.assembledBy).toBe(DEVICE_ACTOR);
    // assembled-at via the INJECTED clock.
    expect(record.assembledAt).toEqual(new Date(1_000));
    expect(record.sourceEntryReferences).toEqual([
      "SYNTH-source-ref-0001",
      "SYNTH-source-ref-0002",
    ]);
    expect(result.value.pair).toBeUndefined();
    expect(record.entries).toHaveLength(3);
  });

  it("stamps the content hash of the canonical pack content", () => {
    const registry = freshRegistry();
    const result = registry.register(registration());
    if (!result.ok) {
      throw new Error("expected registration to succeed");
    }
    expect(result.value.record.contentHash).toBe(
      hashEvidencePack(recordToEvidencePack(result.value.record)),
    );
  });

  it("stores entries in canonical (entryId-sorted) order regardless of input order", () => {
    const registry = freshRegistry();
    const reversed = registry.register(registration({ entries: [...ENTRIES].reverse() }));
    const forward = freshRegistry().register(registration());
    if (!reversed.ok || !forward.ok) {
      throw new Error("expected registrations to succeed");
    }
    expect(reversed.value.record.entries.map((entry) => entry.entryId)).toEqual(
      forward.value.record.entries.map((entry) => entry.entryId),
    );
    expect(reversed.value.record.contentHash).toBe(forward.value.record.contentHash);
  });

  it("round-trips: the registered pack re-validates via the A36 schema", () => {
    const registry = freshRegistry();
    const result = registry.register(registration());
    if (!result.ok) {
      throw new Error("expected registration to succeed");
    }
    const validated = validateEvidencePack(recordToEvidencePack(result.value.record));
    expect(validated.ok).toBe(true);
  });

  it("resolves unknown pack ids to undefined / empty lineage (deny-by-default)", () => {
    const registry = freshRegistry();
    expect(registry.resolveActive(PACK_ID)).toBeUndefined();
    expect(registry.resolveVersion(PACK_ID, 1)).toBeUndefined();
    expect(registry.listVersions(PACK_ID)).toEqual([]);
  });
});

describe("A37 registry — versioned supersession (MetricCatalog semantics)", () => {
  it("creates version N+1 from the predecessor and supersedes the target", () => {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const registry = new InMemoryEvidencePackRegistry(clock);
    const first = registry.register(registration());
    if (!first.ok) {
      throw new Error("expected v1 registration to succeed");
    }

    const newEntries: readonly EvidencePackEntryContent[] = [
      content("SYNTH-metric-heart-rate", "SYNTH-method-hr-wearable", 40),
    ];
    const second = registry.register(
      registration({ entries: newEntries, supersedes: 1 }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected v2 registration to succeed");
    }
    const replacement = second.value.record;
    expect(replacement.version).toBe(2);
    expect(replacement.state).toBe("active");
    expect(replacement.supersedesVersion).toBe(1);
    expect(replacement.entries).toHaveLength(1);
    // v2 assembled-at moves with the (still unmoved) deterministic clock.
    expect(replacement.assembledAt).toEqual(new Date(1_000));

    // The superseded pair mirrors the domain SupersededPair shape.
    expect(second.value.pair?.superseded).toMatchObject({
      version: 1,
      state: "superseded",
    });
    expect(second.value.pair?.replacement).toBe(replacement);

    // resolveActive follows the supersession; the old version stays resolvable.
    expect(registry.resolveActive(PACK_ID)?.version).toBe(2);
    expect(registry.resolveVersion(PACK_ID, 1)?.state).toBe("superseded");
    expect(registry.resolveVersion(PACK_ID, 1)?.version).toBe(1);
    expect(registry.resolveVersion(PACK_ID, 3)).toBeUndefined();
  });

  it("returns the full lineage in ascending version order", () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ entries: [ENTRIES[0] as EvidencePackEntryContent], supersedes: 1 }));
    registry.register(registration({ entries: [ENTRIES[1] as EvidencePackEntryContent], supersedes: 2 }));
    const lineage = registry.listVersions(PACK_ID);
    expect(lineage.map((record) => record.version)).toEqual([1, 2, 3]);
    expect(lineage.map((record) => record.supersedesVersion)).toEqual([undefined, 1, 2]);
    expect(lineage.map((record) => record.state)).toEqual([
      "superseded",
      "superseded",
      "active",
    ]);
  });

  it("stamps supersededAt from the injected clock (reproducible history)", () => {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const registry = new InMemoryEvidencePackRegistry(clock);
    registry.register(registration());
    clock.advance(5_000);
    const second = registry.register(registration({ entries: [ENTRIES[0] as EvidencePackEntryContent], supersedes: 1 }));
    if (!second.ok) {
      throw new Error("expected v2 registration to succeed");
    }
    expect(second.value.pair?.superseded.supersededAt).toEqual(new Date(6_000));
    expect(second.value.record.assembledAt).toEqual(new Date(6_000));
    // Distinct content (new version + new entries) -> distinct content hash.
    expect(second.value.record.contentHash).not.toBe(
      hashEvidencePack(recordToEvidencePack({ ...second.value.pair!.superseded })),
    );
  });

  it("lineage tests: version supersession resolves active across a 3-version chain", () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ entries: [ENTRIES[0] as EvidencePackEntryContent], supersedes: 1 }));
    const third = registry.register(
      registration({ entries: [ENTRIES[2] as EvidencePackEntryContent], supersedes: 2 }),
    );
    if (!third.ok) {
      throw new Error("expected v3 registration to succeed");
    }
    const active = registry.resolveActive(PACK_ID);
    expect(active?.version).toBe(3);
    expect(active?.supersedesVersion).toBe(2);
    // Content hash differs per version even when entries repeat (version is content).
    const v2 = registry.resolveVersion(PACK_ID, 2);
    expect(v2?.contentHash).not.toBe(active?.contentHash);
  });
});

describe("A37 registry — typed rejections (deny-by-default, never throws)", () => {
  it("rejects non-object input without throwing", () => {
    const registry = freshRegistry();
    expect(registry.register(null as unknown as RegisterEvidencePackInput)).toEqual({
      ok: false,
      error: { kind: "invalid-pack-id" },
    });
  });

  it("rejects malformed pack ids", () => {
    const registry = freshRegistry();
    expect(
      registry.register(registration({ packId: "not-a-pack" as unknown as EvidencePackId })),
    ).toEqual({ ok: false, error: { kind: "invalid-pack-id" } });
  });

  it("rejects unknown/malformed person ids (typed, no throw)", () => {
    const registry = freshRegistry();
    expect(
      registry.register(registration({ personId: "nope" as unknown as PersonId })),
    ).toEqual({ ok: false, error: { kind: "invalid-person-id" } });
  });

  it("rejects malformed assembled-by actors", () => {
    const registry = freshRegistry();
    expect(
      registry.register(registration({ assembledBy: "bogus" as unknown as ProvenanceActor })),
    ).toEqual({ ok: false, error: { kind: "invalid-actor" } });
  });

  it("rejects non-array entries and malformed entry contents with index + reason", () => {
    const registry = freshRegistry();
    expect(
      registry.register(registration({ entries: "nope" as unknown as readonly EvidencePackEntryContent[] })),
    ).toEqual({ ok: false, error: { kind: "invalid-entries" } });
    const badEntries: readonly EvidencePackEntryContent[] = [
      ENTRIES[0] as EvidencePackEntryContent,
      { ...(ENTRIES[1] as EvidencePackEntryContent), count: 0 },
    ];
    expect(registry.register(registration({ entries: badEntries }))).toEqual({
      ok: false,
      error: { kind: "invalid-entry", entryIndex: 1, reason: { kind: "invalid-count" } },
    });
  });

  it("rejects duplicate (identical-content) entries by content-addressed id", () => {
    const registry = freshRegistry();
    const duplicated: readonly EvidencePackEntryContent[] = [ENTRIES[0]!, ENTRIES[0]!];
    expect(registry.register(registration({ entries: duplicated }))).toEqual({
      ok: false,
      error: { kind: "duplicate-entry", entryIndex: 1 },
    });
  });

  it("rejects malformed source-entry references", () => {
    const registry = freshRegistry();
    expect(
      registry.register(registration({ sourceEntryReferences: [""] })),
    ).toEqual({ ok: false, error: { kind: "invalid-source-references" } });
    expect(
      registry.register(registration({ sourceEntryReferences: "nope" as unknown as readonly string[] })),
    ).toEqual({ ok: false, error: { kind: "invalid-source-references" } });
  });

  it("rejects a supersede target on a fresh pack and unknown versions", () => {
    const registry = freshRegistry();
    expect(registry.register(registration({ supersedes: 1 }))).toEqual({
      ok: false,
      error: { kind: "unknown-supersede-target" },
    });
    registry.register(registration());
    expect(registry.register(registration({ supersedes: 7 }))).toEqual({
      ok: false,
      error: { kind: "unknown-supersede-target" },
    });
  });

  it("requires explicit supersession when the pack already exists", () => {
    const registry = freshRegistry();
    registry.register(registration());
    expect(
      registry.register(registration({ entries: [ENTRIES[0] as EvidencePackEntryContent] })),
    ).toEqual({ ok: false, error: { kind: "supersede-required" } });
  });

  it("refuses to supersede a non-active (superseded) version", () => {
    const registry = freshRegistry();
    registry.register(registration());
    registry.register(registration({ entries: [ENTRIES[0] as EvidencePackEntryContent], supersedes: 1 }));
    // Version 1 is terminal now: only the ACTIVE version may be superseded.
    expect(registry.register(registration({ entries: [ENTRIES[1] as EvidencePackEntryContent], supersedes: 1 }))).toEqual({
      ok: false,
      error: { kind: "target-not-active" },
    });
  });

  it("refuses version N+1 whose person differs from the lineage (scope invariant)", () => {
    const registry = freshRegistry();
    registry.register(registration());
    expect(
      registry.register(
        registration({ personId: OTHER_PERSON, supersedes: 1 }),
      ),
    ).toEqual({ ok: false, error: { kind: "person-mismatch" } });
  });
});
