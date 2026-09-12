import { describe, expect, it } from "vitest";
import {
  EVIDENCE_STATUS_LABELS,
  SYNTHETIC_CAPTURE_COUNTS_BY_DAY,
  SYNTHETIC_CLINIC_SHARE,
  SYNTHETIC_EVIDENCE_ITEMS,
  SYNTHETIC_LATEST_HEART_RATE,
  SYNTHETIC_METRIC,
  SYNTHETIC_OBSERVATION_EVENTS,
  SYNTHETIC_RESTING_HEART_RATE_SERIES,
  buildSyntheticTimelineEntries,
} from "./synthetic-data";

describe("synthetic evidence fixtures", () => {
  it("marks every evidence identity field with the SYNTH marker (no-PHI discipline)", () => {
    for (const item of SYNTHETIC_EVIDENCE_ITEMS) {
      expect(item.id.startsWith("SYNTH-")).toBe(true);
      expect(item.checksumPrefix.includes("SYNTH")).toBe(true);
      expect(item.retentionClass.startsWith("SYNTH-")).toBe(true);
      expect(item.provenanceActor.includes("SYNTH-")).toBe(true);
    }
  });

  it("uses unique evidence ids", () => {
    const ids = new Set(SYNTHETIC_EVIDENCE_ITEMS.map((item) => item.id));
    expect(ids.size).toBe(SYNTHETIC_EVIDENCE_ITEMS.length);
  });

  it("defines items most-recent-first (the table's default order)", () => {
    for (let index = 1; index < SYNTHETIC_EVIDENCE_ITEMS.length; index += 1) {
      const previous = SYNTHETIC_EVIDENCE_ITEMS[index - 1];
      const current = SYNTHETIC_EVIDENCE_ITEMS[index];
      if (previous === undefined || current === undefined) {
        throw new Error("unreachable");
      }
      expect(previous.capturedAtIso >= current.capturedAtIso).toBe(true);
    }
  });

  it("labels every validation status (state is never color-only)", () => {
    for (const status of ["validated", "pending", "superseded"] as const) {
      expect(EVIDENCE_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("synthetic timeline derivation", () => {
  it("marks every observation event id with the SYNTH marker", () => {
    for (const event of SYNTHETIC_OBSERVATION_EVENTS) {
      expect(event.id.startsWith("SYNTH-")).toBe(true);
    }
  });

  it("merges evidence and observations most-recent-first", () => {
    const entries = buildSyntheticTimelineEntries();
    expect(entries.length).toBe(
      SYNTHETIC_EVIDENCE_ITEMS.length + SYNTHETIC_OBSERVATION_EVENTS.length,
    );
    const labels = entries.map((entry) => entry.at);
    const todayIndex = labels.findIndex((label) => label.startsWith("Today"));
    const sep6Index = labels.findIndex((label) => label.startsWith("Sep 6"));
    expect(todayIndex).toBe(0);
    expect(sep6Index).toBe(labels.length - 1);
  });

  it("produces consecutive day groups (Timeline grouping contract)", () => {
    const entries = buildSyntheticTimelineEntries();
    const seenGroups: string[] = [];
    for (const entry of entries) {
      const group = entry.group ?? "";
      if (seenGroups.length === 0 || seenGroups.at(-1) !== group) {
        seenGroups.push(group);
      }
    }
    // Groups render most-recent-day first, each as one contiguous run.
    expect(seenGroups).toEqual(["Today", "Yesterday", "Sep 8", "Sep 7", "Sep 6"]);
  });

  it("gives every timeline entry a time label, title and badge", () => {
    for (const entry of buildSyntheticTimelineEntries()) {
      expect(entry.at.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.badge).toBeDefined();
    }
  });
});

describe("synthetic measurement fixtures", () => {
  it("keeps the heart-rate series inside the metric's guard bounds", () => {
    for (const value of SYNTHETIC_RESTING_HEART_RATE_SERIES) {
      expect(value).toBeGreaterThanOrEqual(SYNTHETIC_METRIC.min);
      expect(value).toBeLessThanOrEqual(SYNTHETIC_METRIC.max);
    }
    expect(SYNTHETIC_LATEST_HEART_RATE).toBe(60);
  });

  it("keeps bar chart counts non-negative with short labels", () => {
    for (const datum of SYNTHETIC_CAPTURE_COUNTS_BY_DAY) {
      expect(datum.value).toBeGreaterThan(0);
      expect(datum.label.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("synthetic consent grant fixture", () => {
  it("marks the grant and recipient with the SYNTH marker", () => {
    expect(SYNTHETIC_CLINIC_SHARE.grantId.startsWith("SYNTH-")).toBe(true);
    expect(SYNTHETIC_CLINIC_SHARE.recipientName.startsWith("SYNTH-")).toBe(true);
  });

  it("states purpose, scope and expiry (reviewable-contract contract)", () => {
    expect(SYNTHETIC_CLINIC_SHARE.purpose.length).toBeGreaterThan(0);
    expect(SYNTHETIC_CLINIC_SHARE.scope.length).toBeGreaterThan(0);
    expect(SYNTHETIC_CLINIC_SHARE.expiryLabel.length).toBeGreaterThan(0);
  });
});
