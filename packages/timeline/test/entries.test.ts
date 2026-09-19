import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError, type Observation, type PersonId } from "@orbb/domain";
import {
  TIMELINE_ENTRY_KINDS,
  TIMELINE_OBSERVATION_SOURCE_ROLES,
  TIMELINE_TASK_STATES,
  assertTimelineEntry,
  isTimelineEntry,
  isTimelineEntryKind,
  isTimelinePage,
  type ObservationTimelineEntry,
  type TaskTimelineEntry,
  type IntentTimelineEntry,
  type TimelinePage,
} from "../src/entries.js";
import { buildTimelineWorld, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

// ---------------------------------------------------------------------------
// Hand-built well-formed entries (the fixture is the entry itself).
// ---------------------------------------------------------------------------

function makeObservationEntry(
  overrides: Partial<ObservationTimelineEntry> = {},
): ObservationTimelineEntry {
  const observation: Observation = world.observation();
  const entry: ObservationTimelineEntry = {
    kind: "observation",
    id: observation.id,
    personId: world.subject,
    occurredAt: observation.effectiveAt,
    provenance: { sourceId: observation.sourceId, methodId: observation.methodId },
    conceptCode: observation.conceptCode,
    value: observation.value,
    unit: observation.unit,
    effectiveAt: observation.effectiveAt,
    methodId: observation.methodId,
    validationState: observation.validationState,
    evidenceLabel: observation.evidenceLabel,
    ...(observation.quality !== undefined ? { quality: observation.quality } : {}),
    supersession: { supersededIds: [], supersededCount: 0 },
    sources: [
      {
        observationId: observation.id,
        sourceId: observation.sourceId,
        methodId: observation.methodId,
        evidenceLabel: observation.evidenceLabel,
        ...(observation.quality !== undefined ? { quality: observation.quality } : {}),
        provenanceId: observation.provenanceId,
        role: "canonical-source",
      },
    ],
    ...overrides,
  };
  return entry;
}

function makeTaskEntry(overrides: Partial<TaskTimelineEntry> = {}): TaskTimelineEntry {
  const task = world.task();
  return {
    kind: "task",
    id: task.id,
    personId: world.subject,
    occurredAt: task.window.endsAt,
    provenance: {},
    planId: task.planId,
    metricId: task.metricId,
    conceptCode: task.conceptCode,
    methodOrder: task.methodOrder,
    window: {
      sequence: task.window.sequence,
      startsAt: task.window.startsAt,
      endsAt: task.window.endsAt,
    },
    state: "open",
    rollCount: task.rollCount,
    ...overrides,
  };
}

function makeIntentEntry(overrides: Partial<IntentTimelineEntry> = {}): IntentTimelineEntry {
  const intent = world.intent();
  return {
    kind: "intent",
    id: intent.id,
    personId: world.subject,
    occurredAt: intent.createdAt,
    provenance: {},
    state: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The frozen vocabulary.
// ---------------------------------------------------------------------------

describe("the frozen entry-kind vocabulary", () => {
  it("contains exactly observation | task | intent", () => {
    expect(TIMELINE_ENTRY_KINDS).toEqual(["observation", "task", "intent"]);
    expect(new Set(TIMELINE_ENTRY_KINDS).size).toBe(TIMELINE_ENTRY_KINDS.length);
  });

  it("guards the kind vocabulary", () => {
    expect(isTimelineEntryKind("observation")).toBe(true);
    expect(isTimelineEntryKind("task")).toBe(true);
    expect(isTimelineEntryKind("intent")).toBe(true);
    expect(isTimelineEntryKind("note")).toBe(false);
    expect(isTimelineEntryKind(42)).toBe(false);
    expectTypeOf<(typeof TIMELINE_ENTRY_KINDS)[number]>().not.toBeNever();
  });

  it("the source-role and task-state mirrors are the doctrine vocabularies", () => {
    expect(TIMELINE_OBSERVATION_SOURCE_ROLES).toEqual(["canonical-source", "superseded-source"]);
    expect(TIMELINE_TASK_STATES).toEqual(["open", "completed"]);
  });
});

// ---------------------------------------------------------------------------
// Common contract + structural guards.
// ---------------------------------------------------------------------------

describe("the entry structural guards", () => {
  it("accepts a well-formed entry of every kind", () => {
    for (const entry of [makeObservationEntry(), makeTaskEntry(), makeIntentEntry()]) {
      expect(isTimelineEntry(entry)).toBe(true);
      expect(() => assertTimelineEntry(entry)).not.toThrow();
    }
  });

  it("rejects non-entries", () => {
    expect(isTimelineEntry(null)).toBe(false);
    expect(isTimelineEntry({})).toBe(false);
    expect(isTimelineEntry({ kind: "note" })).toBe(false);
    expect(() => assertTimelineEntry({ kind: "note" })).toThrow(DomainInvariantError);
  });

  it("rejects a foreign-prefix domain id", () => {
    expect(isTimelineEntry(makeObservationEntry({ id: "task_SYNTH-tl-00000001" as never }))).toBe(
      false,
    );
    expect(isTimelineEntry(makeTaskEntry({ id: "obs_SYNTH-tl-00000001" as never }))).toBe(false);
    expect(isTimelineEntry(makeIntentEntry({ id: "plan_SYNTH-tl-00000001" as never }))).toBe(false);
  });

  it("rejects a non-canonical personId", () => {
    expect(isTimelineEntry(makeObservationEntry({ personId: "prsn_short" as PersonId }))).toBe(
      false,
    );
  });

  it("rejects an invalid occurredAt", () => {
    expect(isTimelineEntry(makeTaskEntry({ occurredAt: new Date("nope") }))).toBe(false);
  });

  it("rejects a malformed provenance summary", () => {
    expect(
      isTimelineEntry(makeTaskEntry({ provenance: { sourceId: "src_short" as never } })),
    ).toBe(false);
    expect(
      isTimelineEntry(makeTaskEntry({ provenance: { methodId: "" as never } })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kind-specific cross-field invariants.
// ---------------------------------------------------------------------------

describe("observation-entry invariants (occurredAt == effectiveAt; source doctrine)", () => {
  it("rejects occurredAt != effectiveAt", () => {
    const entry = makeObservationEntry({ occurredAt: new Date(0) });
    expect(isTimelineEntry(entry)).toBe(true); // structural only
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects an empty or malformed source list", () => {
    expect(isTimelineEntry(makeObservationEntry({ sources: [] }))).toBe(false);
    expect(
      isTimelineEntry(
        makeObservationEntry({
          sources: [
            {
              observationId: "obs_short" as never,
              sourceId: makeObservationEntry().provenance.sourceId as never,
              methodId: "SYNTH-method-hr-wearable",
              evidenceLabel: "MEASURED",
              provenanceId: "prov_short" as never,
              role: "canonical-source",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a missing canonical-source first", () => {
    const base = makeObservationEntry();
    const supersededOnly = base.sources.map((source) => ({ ...source, role: "superseded-source" as const }));
    const entry = makeObservationEntry({ sources: supersededOnly });
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects two canonical-sources", () => {
    const base = makeObservationEntry();
    const entry = makeObservationEntry({ sources: [...base.sources, ...base.sources] });
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects superseded sources out of id-ascending order", () => {
    const older = world.observation({ id: "obs_SYNTH-tl-00000001" as never });
    const newer = world.observation({ id: "obs_SYNTH-tl-00000002" as never });
    const head = world.observation({ supersedesId: newer.id });
    const entry = makeObservationEntry({
      id: head.id,
      supersession: {
        supersedesId: newer.id,
        supersededIds: [older.id, newer.id],
        supersededCount: 2,
      },
      sources: [
        world.sourceProvenance(head, "canonical-source"),
        // Out of order: newer before older.
        world.sourceProvenance(newer, "superseded-source"),
        world.sourceProvenance(older, "superseded-source"),
      ],
    });
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects a supersession count that disagrees with the sources", () => {
    const loser = world.observation();
    const head = world.observation({ supersedesId: loser.id });
    const entry = makeObservationEntry({
      id: head.id,
      supersession: { supersedesId: loser.id, supersededIds: [loser.id], supersededCount: 7 },
      sources: [
        world.sourceProvenance(head, "canonical-source"),
        world.sourceProvenance(loser, "superseded-source"),
      ],
    });
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects a supersedesId that is not among the superseded sources", () => {
    const loser = world.observation();
    const head = world.observation({ supersedesId: loser.id });
    const entry = makeObservationEntry({
      id: head.id,
      supersession: { supersedesId: loser.id, supersededIds: [], supersededCount: 0 },
      sources: [world.sourceProvenance(head, "canonical-source")],
    });
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });
});

describe("task-entry invariants (occurredAt == the window's due instant)", () => {
  it("rejects occurredAt != window.endsAt", () => {
    const entry = makeTaskEntry({ occurredAt: new Date(0) });
    expect(isTimelineEntry(entry)).toBe(true); // structural only
    expect(() => assertTimelineEntry(entry)).toThrow(DomainInvariantError);
  });

  it("rejects an inverted window and illegal states", () => {
    const task = world.task();
    expect(
      isTimelineEntry(
        makeTaskEntry({
          window: { sequence: 0, startsAt: task.window.endsAt, endsAt: task.window.startsAt },
        }),
      ),
    ).toBe(false);
    expect(isTimelineEntry(makeTaskEntry({ state: "cancelled" as never }))).toBe(false);
    expect(isTimelineEntry(makeTaskEntry({ rollCount: -1 }))).toBe(false);
  });

  it("accepts both task lifecycle states", () => {
    expect(() => assertTimelineEntry(makeTaskEntry({ state: "completed" }))).not.toThrow();
    expect(() => assertTimelineEntry(makeTaskEntry({ state: "open" }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The no-smuggle key-set proof (typed shapes only — nothing extra rides along).
// ---------------------------------------------------------------------------

describe("entry key sets are exactly the frozen fields (no smuggled content)", () => {
  it("an observation entry carries exactly the frozen observation fields", () => {
    const entry = makeObservationEntry();
    expect(Object.keys(entry).sort()).toEqual([
      "conceptCode",
      "effectiveAt",
      "evidenceLabel",
      "id",
      "kind",
      "methodId",
      "occurredAt",
      "personId",
      "provenance",
      "quality",
      "sources",
      "supersession",
      "unit",
      "validationState",
      "value",
    ]);
    expect(Object.keys(entry.supersession).sort()).toEqual([
      "supersededCount",
      "supersededIds",
    ]);
  });

  it("a task entry carries exactly the frozen task fields", () => {
    const entry = makeTaskEntry();
    expect(Object.keys(entry).sort()).toEqual([
      "conceptCode",
      "id",
      "kind",
      "methodOrder",
      "metricId",
      "occurredAt",
      "personId",
      "planId",
      "provenance",
      "rollCount",
      "state",
      "window",
    ]);
  });

  it("an intent entry carries exactly the frozen intent fields — NO objective", () => {
    const entry = makeIntentEntry();
    expect(Object.keys(entry).sort()).toEqual([
      "id",
      "kind",
      "occurredAt",
      "personId",
      "provenance",
      "state",
    ]);
    expect("objective" in entry).toBe(false);
    expect(JSON.stringify(entry)).not.toContain("objective");
  });
});

// ---------------------------------------------------------------------------
// The page guard.
// ---------------------------------------------------------------------------

describe("the TimelinePage guard", () => {
  it("accepts a non-truncated page without a cursor", () => {
    const page: TimelinePage = { entries: [makeIntentEntry()], truncated: false };
    expect(isTimelinePage(page)).toBe(true);
  });

  it("accepts a truncated page with a cursor", () => {
    const page: TimelinePage = {
      entries: [makeIntentEntry()],
      nextCursor: "opaque",
      truncated: true,
    };
    expect(isTimelinePage(page)).toBe(true);
  });

  it("rejects a lying truncated flag (truncated without cursor, or vice versa)", () => {
    expect(
      isTimelinePage({ entries: [], nextCursor: "opaque", truncated: false }),
    ).toBe(false);
    expect(isTimelinePage({ entries: [], truncated: true })).toBe(false);
    expect(isTimelinePage({ entries: [], truncated: false, nextCursor: 42 as never })).toBe(false);
  });
});
