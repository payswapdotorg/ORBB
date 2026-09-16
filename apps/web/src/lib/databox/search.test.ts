import { describe, expect, it } from "vitest";
import { buildDataboxEntries, DATABOX_ACCESS_EVENT_FIXTURES } from "./fixtures";
import {
  buildCollections,
  countActiveFilters,
  databoxConceptOptions,
  filterDataboxEntries,
  statusBadgeLabel,
  toTimelineEntries,
} from "./search";
import { initialDataboxFilters, type DataboxEntryView, type DataboxFilters } from "./types";

/**
 * DataBox search/filter/collection engine tests (M6-B B6): the four
 * filters + search composition, empty-result honesty, concept-option
 * derivation, timeline projection, and the collections grouping — over
 * the enriched M3-B corpus (12 entries, pinned reference world).
 */

const ENTRIES = buildDataboxEntries();

function byId(id: string): DataboxEntryView | undefined {
  return ENTRIES.find((entry) => entry.id === id);
}

describe("databox corpus enrichment", () => {
  it("builds the merged corpus (8 evidence + 4 observations, recent-first)", () => {
    expect(ENTRIES).toHaveLength(12);
    expect(ENTRIES.filter((entry) => entry.kind === "evidence")).toHaveLength(8);
    expect(ENTRIES.filter((entry) => entry.kind === "observation")).toHaveLength(4);
    // Most recent first (pinned reference world).
    for (let index = 1; index < ENTRIES.length; index += 1) {
      const previous = ENTRIES[index - 1];
      const current = ENTRIES[index];
      if (previous === undefined || current === undefined) {
        throw new Error("unreachable");
      }
      expect(previous.iso >= current.iso).toBe(true);
    }
  });

  it("keeps the M3-B fields byte-identical (ids, titles, labels, statuses)", () => {
    const waveform = byId("SYNTH-EV-0001");
    expect(waveform?.title).toBe("Resting heart rate series");
    expect(waveform?.dayLabel).toBe("Today");
    expect(waveform?.atLabel).toBe("Today, 08:05");
    expect(waveform?.status).toBe("validated");
    const hrEvent = byId("SYNTH-OBS-EVT-0001");
    expect(hrEvent?.title).toBe("Resting heart rate 62 beats/min");
    expect(hrEvent?.status).toBe("validated");
    const tempEvent = byId("SYNTH-OBS-EVT-0003");
    expect(tempEvent?.evidenceState).toBe("estimated");
    expect(tempEvent?.modelVersion).toContain("SYNTH-ThermoVision");
  });

  it("carries the source-kind vocabulary for the source filter", () => {
    expect(byId("SYNTH-EV-0006")?.sourceKind).toBe("chw");
    expect(byId("SYNTH-EV-0008")?.sourceKind).toBe("device");
    expect(byId("SYNTH-OBS-EVT-0002")?.sourceKind).toBe("manual");
  });

  it("carries quality bands for the confidence/quality filter", () => {
    expect(byId("SYNTH-OBS-EVT-0001")?.qualityBand).toBe("high");
    expect(byId("SYNTH-OBS-EVT-0002")?.qualityBand).toBe("moderate");
    expect(byId("SYNTH-EV-0002")?.qualityBand).toBe("not-scored");
  });
});

describe("search + the four filters", () => {
  it("returns the full corpus with the initial filters", () => {
    expect(filterDataboxEntries(ENTRIES, initialDataboxFilters())).toHaveLength(12);
    expect(countActiveFilters(initialDataboxFilters())).toBe(0);
  });

  it("searches over titles, subtitles, concepts, and sources (case-insensitive)", () => {
    const results = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      search: "HEART RATE",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.conceptId === "concept-heart-rate")).toBe(true);
    expect(countActiveFilters({ ...initialDataboxFilters(), search: "heart" })).toBe(1);
  });

  it("filters by time (today vs last-7-days)", () => {
    const today = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      time: "today",
    });
    expect(today.every((entry) => entry.dayLabel === "Today")).toBe(true);
    expect(today.length).toBeGreaterThan(0);
    // The whole pinned corpus is within the last 7 days.
    expect(
      filterDataboxEntries(ENTRIES, { ...initialDataboxFilters(), time: "last-7-days" }),
    ).toHaveLength(12);
    expect(countActiveFilters({ ...initialDataboxFilters(), time: "today" })).toBe(1);
  });

  it("filters by concept (metric)", () => {
    const results = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      concept: "concept-body-weight",
    });
    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.conceptLabel === "Body weight")).toBe(true);
  });

  it("filters by source kind", () => {
    const chw = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      source: "chw",
    });
    expect(chw).toHaveLength(1);
    expect(chw[0]?.id).toBe("SYNTH-EV-0006");
    const devices = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      source: "device",
    });
    expect(devices.length).toBeGreaterThan(1);
    expect(devices.every((entry) => entry.sourceKind === "device")).toBe(true);
  });

  it("filters by confidence/quality band", () => {
    const high = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      quality: "high",
    });
    expect(high.every((entry) => entry.qualityBand === "high")).toBe(true);
    expect(high).toHaveLength(2);
    const notScored = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      quality: "not-scored",
    });
    expect(notScored.every((entry) => entry.qualityBand === "not-scored")).toBe(true);
    expect(notScored).toHaveLength(8);
  });

  it("composes search + all four filters, and yields honest empty results", () => {
    const composed = filterDataboxEntries(ENTRIES, {
      search: "heart rate",
      time: "today",
      concept: "concept-heart-rate",
      source: "device",
      quality: "high",
    });
    expect(composed.length).toBeGreaterThan(0);
    expect(composed.every((entry) => entry.sourceKind === "device")).toBe(true);

    const impossibleFilters: DataboxFilters = {
      search: "heart rate",
      time: "today",
      concept: "concept-heart-rate",
      source: "chw",
      quality: "high",
    };
    const impossible = filterDataboxEntries(ENTRIES, impossibleFilters);
    expect(impossible).toEqual([]);
    expect(countActiveFilters(impossibleFilters)).toBe(5);
  });

  it("derives the concept options from the corpus (stable, no duplicates)", () => {
    const options = databoxConceptOptions(ENTRIES);
    expect(options[0]).toEqual({ value: "all", label: "All metrics" });
    const values = options.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("concept-heart-rate");
    expect(values).toContain("concept-documents");
  });
});

describe("timeline + collections projections", () => {
  it("projects the timeline entries with day groups and status badges", () => {
    const timeline = toTimelineEntries(ENTRIES);
    expect(timeline).toHaveLength(12);
    expect(timeline[0]?.group).toBe("Today");
    expect(statusBadgeLabel(byId("SYNTH-EV-0004") ?? ENTRIES[0]!)).toBe("Superseded");
    const validated = timeline.find((entry) => entry.title === "Resting heart rate 62 beats/min");
    expect(validated?.badge).toBe("Validated");
  });

  it("groups the corpus into human-readable collections", () => {
    const collections = buildCollections(ENTRIES);
    expect(collections.map((collection) => collection.label)).toEqual([
      "Vital signs monitoring",
      "Body composition",
      "Activity & sleep",
      "Documents & notes",
    ]);
    const vitals = collections[0];
    expect(vitals?.entryIds).toContain("SYNTH-EV-0001");
    expect(vitals?.entryIds).toContain("SYNTH-OBS-EVT-0001");
    const documents = collections[3];
    expect(documents?.entryIds).toContain("SYNTH-EV-0006");
    expect(documents?.entryIds).toContain("SYNTH-EV-0007");
    // Every corpus entry belongs to at least one collection.
    const collected = new Set(collections.flatMap((collection) => collection.entryIds));
    expect(collected.size).toBe(12);
  });

  it("respects filters inside the collections view", () => {
    const filtered = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      source: "chw",
    });
    const collections = buildCollections(filtered);
    const documents = collections[3];
    expect(documents?.entryIds).toEqual(["SYNTH-EV-0006"]);
    expect(collections[0]?.entryIds).toEqual([]);
  });
});

describe("access-history fixtures", () => {
  it("carries SYNTH-marked fixture events with honest origin labels", () => {
    expect(DATABOX_ACCESS_EVENT_FIXTURES).toHaveLength(2);
    for (const event of DATABOX_ACCESS_EVENT_FIXTURES) {
      expect(event.eventId.startsWith("SYNTH-ACCESS-")).toBe(true);
      expect(event.origin).toBe("fixture");
      expect(event.actor).toBe("SYNTH-Clinic-A");
    }
  });
});
