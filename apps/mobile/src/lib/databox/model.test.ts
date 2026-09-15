import { describe, expect, it } from "vitest";
import { buildDataboxEntries } from "./model";
import {
  DATABOX_COLLECTIONS,
  DATABOX_QUALITY_OPTIONS,
  DATABOX_SOURCE_OPTIONS,
  DATABOX_TIME_OPTIONS,
  buildCollections,
  countActiveFilters,
  databoxConceptOptions,
  filterDataboxEntries,
  initialDataboxFilters,
  statusBadgeLabel,
  toTimelineGroups,
  type DataboxEntryView,
  type DataboxFilters,
} from "./model";

/**
 * Mobile DataBox model contract tests (M6-B B6): the web
 * search/filter/collection engine assertions mirrored onto the mobile
 * module — corpus enrichment over the pinned M3-B reference world (12
 * entries, byte-identical fields), the four filters + search composition,
 * empty-result honesty, concept-option derivation, the RN day-grouped
 * timeline projection, and the collections grouping.
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

  it("links observation entries to their B5 provenance detail ids", () => {
    expect(byId("SYNTH-OBS-EVT-0001")?.observationId).toBe("obs_SYNTH-corpus-hr-0001");
    expect(byId("SYNTH-OBS-EVT-0002")?.observationId).toBe("obs_SYNTH-corpus-bp-0002");
    expect(byId("SYNTH-OBS-EVT-0003")?.observationId).toBe("obs_SYNTH-corpus-temp-0003");
    expect(byId("SYNTH-OBS-EVT-0004")?.observationId).toBe("obs_SYNTH-corpus-wt-0004");
    // Evidence entries never fake an observation link.
    expect(byId("SYNTH-EV-0001")?.observationId).toBeUndefined();
  });

  it("marks every identity-like string SYNTH (zero PHI)", () => {
    for (const entry of ENTRIES) {
      expect(entry.id.startsWith("SYNTH-")).toBe(true);
      // The actor line: evidence entries carry the provenance actor;
      // observation entries carry the method/quality summary — both carry
      // a SYNTH-marked source label alongside.
      expect(entry.sourceLabel.includes("SYNTH")).toBe(true);
      if (entry.kind === "evidence") {
        expect(entry.provenanceActor.includes("SYNTH")).toBe(true);
      }
      if (entry.checksumPrefix !== undefined) {
        expect(entry.checksumPrefix.startsWith("sha256-SYNTH-")).toBe(true);
      }
      if (entry.retentionClass !== undefined) {
        expect(entry.retentionClass.startsWith("SYNTH-RT-")).toBe(true);
      }
    }
    for (const collection of DATABOX_COLLECTIONS) {
      expect(collection.collectionId.startsWith("SYNTH-COLL-")).toBe(true);
    }
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

  it("narrows 'heart' to the three heart-rate entries", () => {
    const results = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      search: "heart",
    });
    expect(results).toHaveLength(3);
    expect(results.map((entry) => entry.id).sort()).toEqual([
      "SYNTH-EV-0001",
      "SYNTH-EV-0004",
      "SYNTH-OBS-EVT-0001",
    ]);
  });

  it("filters by time (today vs last-7-days)", () => {
    const today = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      time: "today",
    });
    expect(today.every((entry) => entry.dayLabel === "Today")).toBe(true);
    expect(today).toHaveLength(4);
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

  it("exposes the filter option lists in the frozen vocabulary order", () => {
    expect(DATABOX_TIME_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "today",
      "last-7-days",
    ]);
    expect(DATABOX_SOURCE_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "device",
      "manual",
      "chw",
      "synthesized",
    ]);
    expect(DATABOX_QUALITY_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "high",
      "moderate",
      "low",
      "not-scored",
    ]);
  });
});

describe("timeline + collections projections", () => {
  it("groups the timeline into consecutive day sections with status badges", () => {
    const groups = toTimelineGroups(ENTRIES);
    expect(groups.map((group) => group.dayLabel)).toEqual([
      "Today",
      "Yesterday",
      "Sep 8",
      "Sep 7",
      "Sep 6",
    ]);
    expect(groups.map((group) => group.entries.length)).toEqual([4, 3, 3, 1, 1]);
    expect(groups.reduce((total, group) => total + group.entries.length, 0)).toBe(12);
    const today = groups[0];
    expect(today?.entries[0]?.entry.id).toBe("SYNTH-OBS-EVT-0001");
    expect(today?.entries[0]?.badge).toBe("Validated");
    expect(statusBadgeLabel(byId("SYNTH-EV-0004") ?? ENTRIES[0]!)).toBe("Superseded");
    const validated = groups
      .flatMap((group) => group.entries)
      .find((row) => row.entry.title === "Resting heart rate 62 beats/min");
    expect(validated?.badge).toBe("Validated");
  });

  it("regroups after filtering (only matching days appear)", () => {
    const filtered = filterDataboxEntries(ENTRIES, {
      ...initialDataboxFilters(),
      concept: "concept-body-weight",
    });
    const groups = toTimelineGroups(filtered);
    expect(groups.map((group) => group.dayLabel)).toEqual(["Sep 8"]);
    expect(groups[0]?.entries.map((row) => row.entry.id)).toEqual([
      "SYNTH-OBS-EVT-0004",
      "SYNTH-EV-0005",
    ]);
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
