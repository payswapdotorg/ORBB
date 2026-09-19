import { describe, expect, it } from "vitest";
import { DomainInvariantError, parseQualityScore, type ObservationId } from "@orbb/domain";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  InMemoryObservationArchive,
  ReconciliationService,
  seedMeasurementVocabulary,
  type ReconcileInput,
  type ReconcileOutcome,
  type SourcedObservation,
} from "@orbb/measurement";
import {
  assertCanonicalObservationRecord,
  type CanonicalObservationRecord,
} from "../src/ports.js";
import type { ObservationTimelineEntry } from "../src/entries.js";
import { buildTimelineWorld, atDayAfterT0, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

/** Assembles the subject's full timeline and returns the observation entries. */
async function observationEntriesFrom(
  harness: ReturnType<TimelineWorld["makeService"]>,
): Promise<readonly ObservationTimelineEntry[]> {
  const outcome = await harness.service.assembleTimeline(
    world.subject,
    {},
    world.makeContext(),
  );
  expect(outcome.kind).toBe("granted");
  if (outcome.kind !== "granted") {
    throw new Error("unreachable");
  }
  return outcome.page.entries.filter(
    (entry): entry is ObservationTimelineEntry => entry.kind === "observation",
  );
}

// ---------------------------------------------------------------------------
// The doctrine mirror over hand-built post-reconciliation store state.
// ---------------------------------------------------------------------------

describe("reconciliation mirror — ONE canonical entry per same-metric set", () => {
  it("a never-reconciled observation yields one entry, one source, no supersession", async () => {
    const harness = world.makeService();
    const observation = world.observation({ effectiveAt: atDayAfterT0(5) });
    harness.observations.put(world.canonicalRecord(observation));

    const entries = await observationEntriesFrom(harness);
    expect(entries.length).toBe(1);
    const entry = entries[0] as ObservationTimelineEntry;
    expect(entry.id).toBe(observation.id);
    expect(entry.value).toBe(observation.value);
    expect(entry.occurredAt.getTime()).toBe(observation.effectiveAt.getTime());
    expect(entry.supersession.supersededIds).toEqual([]);
    expect(entry.supersession.supersededCount).toBe(0);
    expect("supersedesId" in entry.supersession).toBe(false);
    expect(entry.sources.length).toBe(1);
    expect(entry.sources[0]?.role).toBe("canonical-source");
    expect(entry.sources[0]?.observationId).toBe(observation.id);
    expect(entry.provenance.sourceId).toBe(observation.sourceId);
    expect(entry.provenance.methodId).toBe(observation.methodId);
  });

  it("a reconciled set yields ONE entry carrying BOTH sources as provenance (data never discarded)", async () => {
    const harness = world.makeService();
    // The post-reconciliation world of the @orbb/measurement doctrine:
    // winner (validated, retained), loser (superseded, retained as
    // provenance), canonical replacement (validated, supersedesId ->
    // loser, carries the winner's value).
    const winner = world.observation({
      effectiveAt: atDayAfterT0(5),
      value: 72,
      methodId: "SYNTH-method-hr-wearable",
    });
    const loser = world.observation({
      effectiveAt: atDayAfterT0(5),
      value: 74,
      methodId: "SYNTH-method-hr-manual",
      quality: parseQualityScore(0.4),
    });
    const replacement = world.observation({
      effectiveAt: winner.effectiveAt,
      value: winner.value,
      unit: winner.unit,
      sourceId: winner.sourceId,
      methodId: winner.methodId,
      validationState: "validated",
      supersedesId: loser.id,
    });
    harness.observations.put({
      canonical: replacement,
      sources: [
        world.sourceProvenance(winner, "canonical-source"),
        world.sourceProvenance(loser, "superseded-source"),
      ],
    });

    const entries = await observationEntriesFrom(harness);
    expect(entries.length).toBe(1);
    const entry = entries[0] as ObservationTimelineEntry;

    // The canonical view: the replacement's id, the WINNER's value.
    expect(entry.id).toBe(replacement.id);
    expect(entry.value).toBe(winner.value);
    expect(entry.methodId).toBe(winner.methodId);
    expect(entry.provenance.sourceId).toBe(winner.sourceId);

    // The supersession summary: the loser is the direct predecessor.
    expect(entry.supersession.supersedesId).toBe(loser.id);
    expect(entry.supersession.supersededIds).toEqual([loser.id]);
    expect(entry.supersession.supersededCount).toBe(1);

    // Per-source provenance: BOTH originals stay visible, roles intact —
    // the loser's value is gone from the canonical view but its SOURCE
    // record is right there (never discarded).
    expect(entry.sources.length).toBe(2);
    expect(entry.sources.map((source) => source.role)).toEqual([
      "canonical-source",
      "superseded-source",
    ]);
    expect(entry.sources[0]?.observationId).toBe(winner.id);
    expect(entry.sources[0]?.methodId).toBe(winner.methodId);
    expect(entry.sources[1]?.observationId).toBe(loser.id);
    expect(entry.sources[1]?.methodId).toBe(loser.methodId);
    expect(entry.sources[1]?.evidenceLabel).toBe(loser.evidenceLabel);
  });

  it("an amendment CHAIN (A -> B -> C) presents the head with the full correction chain", async () => {
    const harness = world.makeService();
    const a = world.observation({
      id: "obs_SYNTH-tl-00000001" as ObservationId,
      effectiveAt: atDayAfterT0(5),
      value: 70,
    });
    const b = world.observation({
      id: "obs_SYNTH-tl-00000002" as ObservationId,
      effectiveAt: atDayAfterT0(5),
      value: 71,
      supersedesId: a.id,
    });
    const c = world.observation({
      id: "obs_SYNTH-tl-00000003" as ObservationId,
      effectiveAt: atDayAfterT0(5),
      value: 72,
      supersedesId: b.id,
    });
    harness.observations.put({
      canonical: c,
      // Deliberately UNORDERED superseded sources: the assembly must
      // normalize (canonical-source first, superseded id-ascending).
      sources: [
        world.sourceProvenance(b, "superseded-source"),
        world.sourceProvenance(a, "superseded-source"),
        world.sourceProvenance(c, "canonical-source"),
      ],
    });

    const entries = await observationEntriesFrom(harness);
    expect(entries.length).toBe(1);
    const entry = entries[0] as ObservationTimelineEntry;
    expect(entry.id).toBe(c.id);
    expect(entry.value).toBe(c.value);
    expect(entry.supersession.supersedesId).toBe(b.id);
    expect(entry.supersession.supersededIds).toEqual([a.id, b.id]);
    expect(entry.supersession.supersededCount).toBe(2);
    expect(entry.sources.map((source) => source.observationId)).toEqual([c.id, a.id, b.id]);
    expect(entry.sources.map((source) => source.role)).toEqual([
      "canonical-source",
      "superseded-source",
      "superseded-source",
    ]);
  });

  it("two DIFFERENT metrics at the same instant stay two entries (sets are per-metric)", async () => {
    const harness = world.makeService();
    const heartRate = world.observation({ effectiveAt: atDayAfterT0(5), value: 72 });
    const bloodPressure = world.observation({
      effectiveAt: atDayAfterT0(5),
      conceptCode: "SYNTH-8480-5",
      unit: "mmHg",
      value: 118,
    });
    harness.observations.put(world.canonicalRecord(heartRate));
    harness.observations.put(world.canonicalRecord(bloodPressure));
    const entries = await observationEntriesFrom(harness);
    expect(entries.length).toBe(2);
    expect(new Set(entries.map((entry) => entry.conceptCode))).toEqual(
      new Set(["SYNTH-8867-4", "SYNTH-8480-5"]),
    );
  });
});

// ---------------------------------------------------------------------------
// The port-record guards (data-integrity discipline).
// ---------------------------------------------------------------------------

describe("canonical-record guards (fail-closed on malformed port data)", () => {
  it("rejects a superseded head", () => {
    const loser = world.observation();
    const head = world.observation({ validationState: "superseded" as const, supersedesId: loser.id });
    expect(() =>
      assertCanonicalObservationRecord({
        canonical: head,
        sources: [
          world.sourceProvenance(head, "canonical-source"),
          world.sourceProvenance(loser, "superseded-source"),
        ],
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects two canonical-sources and duplicate observation ids", () => {
    const winner = world.observation();
    const record = world.canonicalRecord(winner);
    expect(() =>
      assertCanonicalObservationRecord({
        canonical: winner,
        sources: [...record.sources, ...record.sources],
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects an empty source list and a non-observation canonical", () => {
    const winner = world.observation();
    expect(() => assertCanonicalObservationRecord({ canonical: winner, sources: [] })).toThrow(
      DomainInvariantError,
    );
    expect(() =>
      assertCanonicalObservationRecord({
        canonical: winner,
        sources: [{ ...world.sourceProvenance(winner, "canonical-source"), role: "neither" as never }],
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects a supersedesId that is not among the superseded sources", () => {
    const stranger = world.observation();
    const head = world.observation({ supersedesId: stranger.id });
    expect(() =>
      assertCanonicalObservationRecord({
        canonical: head,
        sources: [world.sourceProvenance(head, "canonical-source")],
      }),
    ).toThrow(DomainInvariantError);
  });

  it("accepts a well-formed record (liberal about source order)", () => {
    const loser = world.observation();
    const head = world.observation({ supersedesId: loser.id });
    expect(() =>
      assertCanonicalObservationRecord({
        canonical: head,
        sources: [
          world.sourceProvenance(loser, "superseded-source"),
          world.sourceProvenance(head, "canonical-source"),
        ],
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE REAL @orbb/measurement ReconciliationService integration: the
// doctrine proof — the timeline consumes the REAL reconciliation output.
// ---------------------------------------------------------------------------

describe("the REAL ReconciliationService feeds the timeline (doctrine link)", () => {
  it("reconcile() output maps to ONE canonical timeline entry with per-source provenance", async () => {
    const { catalog } = seedMeasurementVocabulary();
    const clock = new DeterministicClock({ epochMs: atDayAfterT0(5).getTime() });
    const ids = new DeterministicIdFactory({ seed: "tl-recon" });
    const archive = new InMemoryObservationArchive();
    const service = new ReconciliationService({ catalog, clock, ids, archive });

    const window = { startsAt: atDayAfterT0(5, 6), endsAt: atDayAfterT0(5, 10) };
    const wearable = world.observation({
      effectiveAt: atDayAfterT0(5, 7),
      value: 72,
      methodId: "SYNTH-method-hr-wearable",
      validationState: "pending",
    });
    const manual = world.observation({
      effectiveAt: atDayAfterT0(5, 7),
      value: 74,
      methodId: "SYNTH-method-hr-manual",
      quality: parseQualityScore(0.4),
      validationState: "pending",
    });
    const candidates: readonly SourcedObservation[] = [
      { observation: wearable, provenance: provenanceOf(wearable) },
      { observation: manual, provenance: provenanceOf(manual) },
    ];
    const input: ReconcileInput = {
      personId: world.subject,
      metricId: "SYNTH-metric-heart-rate",
      window,
      candidates,
    };

    const result = await service.reconcile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable: the SYNTH candidates reconcile");
    }
    const outcome: ReconcileOutcome = result.value;

    // Map the REAL reconciliation output into the timeline's port shape.
    const record: CanonicalObservationRecord = {
      canonical: outcome.canonical,
      sources: outcome.view.sources.map((source) => ({
        observationId: source.observationId,
        sourceId: source.sourceId,
        methodId: source.methodId,
        evidenceLabel: source.evidenceLabel,
        ...(source.quality !== undefined ? { quality: source.quality } : {}),
        provenanceId: source.provenance.provenanceId,
        role: source.role,
      })),
    };
    expect(() => assertCanonicalObservationRecord(record)).not.toThrow();

    const harness = world.makeService();
    harness.observations.put(record);
    const entries = await observationEntriesFrom(harness);

    expect(entries.length).toBe(1);
    const entry = entries[0] as ObservationTimelineEntry;
    // The canonical replacement is the entry; the winner's value is THE value.
    expect(entry.id).toBe(outcome.canonical.id);
    expect(entry.value).toBe(wearable.value);
    expect(entry.validationState).toBe("validated");
    // The winner outranked the loser (quality desc) — provenance says so.
    expect(entry.sources.map((source) => source.role)).toEqual([
      "canonical-source",
      "superseded-source",
    ]);
    expect(entry.sources[0]?.observationId).toBe(wearable.id);
    expect(entry.sources[1]?.observationId).toBe(manual.id);
    expect(entry.supersession.supersedesId).toBe(manual.id);
    expect(entry.supersession.supersededIds).toEqual([manual.id]);
    expect(entry.supersession.supersededCount).toBe(1);
    // The verdict flag of the REAL view rides along (discordant: 72 vs 74).
    expect(outcome.view.verdict).toBe("discordant");
  });
});

/** Builds the domain Provenance matching an observation fixture. */
function provenanceOf(observation: ReturnType<TimelineWorld["observation"]>): SourcedObservation["provenance"] {
  return {
    provenanceId: observation.provenanceId,
    actor: observation.sourceId,
    subject: observation.personId,
    occurredAt: observation.observedAt,
  };
}
