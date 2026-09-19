import { describe, expect, expectTypeOf, it } from "vitest";
import { timelineSummary, type TimelineSummary } from "../src/summary.js";
import type { IntentTimelineEntry, TaskTimelineEntry, TimelineEntry } from "../src/entries.js";
import { buildTimelineWorld, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

function makeEntries(): TimelineEntry[] {
  const observation = world.observation();
  return [
    {
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
      supersession: { supersededIds: [], supersededCount: 0 },
      sources: [world.sourceProvenance(observation, "canonical-source")],
    },
    {
      kind: "task",
      id: world.task().id,
      personId: world.subject,
      occurredAt: world.task().window.endsAt,
      provenance: {},
      planId: world.task().planId,
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      methodOrder: ["SYNTH-method-hr-wearable"],
      window: { sequence: 0, startsAt: world.task().window.startsAt, endsAt: world.task().window.endsAt },
      state: "open",
      rollCount: 0,
    } satisfies TaskTimelineEntry,
    {
      kind: "intent",
      id: world.intent().id,
      personId: world.subject,
      occurredAt: world.intent().createdAt,
      provenance: {},
      state: "active",
    } satisfies IntentTimelineEntry,
  ];
}

describe("timelineSummary — honest counts as a pure derivation", () => {
  it("counts entries by kind and total", () => {
    const entries = makeEntries();
    const summary = timelineSummary(entries);
    expect(summary.total).toBe(3);
    expect(summary.byKind).toEqual({ observation: 1, task: 1, intent: 1 });
  });

  it("an empty input yields zero counts with EVERY kind present", () => {
    const summary = timelineSummary([]);
    expect(summary).toEqual({
      total: 0,
      byKind: { observation: 0, task: 0, intent: 0 },
    });
  });

  it("is deterministic under input permutation (counts do not depend on order)", () => {
    const entries = makeEntries();
    const reference = timelineSummary(entries);
    for (const permutation of [
      [2, 1, 0],
      [1, 0, 2],
    ]) {
      const shuffled = permutation.map((index) => entries[index] as TimelineEntry);
      expect(timelineSummary(shuffled)).toEqual(reference);
    }
  });

  it("is pure — the input array is never mutated", () => {
    const entries = makeEntries();
    const before = JSON.stringify(entries.map((entry) => [entry.kind, entry.id]));
    timelineSummary(entries);
    timelineSummary(entries);
    expect(JSON.stringify(entries.map((entry) => [entry.kind, entry.id]))).toBe(before);
  });

  it("the summary shape carries ONLY counts — no inference, no trend claims (M12 owns interpretation)", () => {
    const summary: TimelineSummary = timelineSummary(makeEntries());
    expect(Object.keys(summary).sort()).toEqual(["byKind", "total"]);
    expect(Object.keys(summary.byKind).sort()).toEqual(["intent", "observation", "task"]);
    expectTypeOf<TimelineSummary>().not.toHaveProperty("trend");
    expectTypeOf<TimelineSummary>().not.toHaveProperty("interpretation");
    expectTypeOf<TimelineSummary>().not.toHaveProperty("baseline");
  });

  it("summarizing a walked timeline (page accumulation) stays honest", async () => {
    const harness = world.makeService();
    for (let day = 0; day < 5; day += 1) {
      harness.observations.put(
        world.canonicalRecord(world.observation({ effectiveAt: new Date(2025, 4, day + 1) })),
      );
    }
    harness.intents.put(world.intent());
    const collected: TimelineEntry[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const outcome = await harness.service.assembleTimeline(
        world.subject,
        cursor === undefined ? {} : { cursor },
        world.makeContext(),
      );
      expect(outcome.kind).toBe("granted");
      if (outcome.kind === "granted") {
        collected.push(...outcome.page.entries);
        cursor = outcome.page.nextCursor;
      }
      guard += 1;
    } while (cursor !== undefined && guard < 10);
    expect(timelineSummary(collected)).toEqual({
      total: 6,
      byKind: { observation: 5, task: 0, intent: 1 },
    });
  });
});
