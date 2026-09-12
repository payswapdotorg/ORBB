// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_PACK_CONTENT_HASH,
  SYNTHETIC_PACK_ID,
  buildSyntheticEvidencePack,
  packEntriesForMetric,
} from "./pack";

/**
 * SYNTH evidence pack fixture tests (M6-A): determinism, PHI-free shape
 * (counts/windows/classes only), and the A36 entry invariants (label counts
 * sum to the entry count; positive counts; half-open windows).
 */

const NOW = new Date("2026-09-12T10:00:00.000Z");
const NOW_2 = new Date("2026-09-12T10:00:00.000Z");

describe("synthetic evidence pack", () => {
  it("is deterministic given the same instant", () => {
    expect(buildSyntheticEvidencePack(NOW)).toEqual(buildSyntheticEvidencePack(NOW_2));
  });

  it("shifts its 30-day coverage window with `now`", () => {
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const pack = buildSyntheticEvidencePack(later);
    const entry = pack.entries[0];
    expect(entry).toBeDefined();
    const durationMs =
      new Date(entry!.windowEnd).getTime() - new Date(entry!.windowStart).getTime();
    expect(durationMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(entry!.windowEnd).toBe(later.toISOString());
  });

  it("keeps every entry PHI-free: positive counts, label sums equal counts, actor classes", () => {
    const pack = buildSyntheticEvidencePack(NOW);
    expect(pack.packId).toBe(SYNTHETIC_PACK_ID);
    expect(pack.version).toBe(1);
    expect(pack.contentHash).toBe(SYNTHETIC_PACK_CONTENT_HASH);
    for (const entry of pack.entries) {
      expect(entry.count).toBeGreaterThanOrEqual(1);
      expect(entry.entryId.startsWith("evpe_SYNTH-")).toBe(true);
      const labels = entry.qualityMix.byEvidenceLabel;
      const total =
        labels.MEASURED + labels.ESTIMATED + labels.IMPORTED + labels.DERIVED;
      expect(total).toBe(entry.count);
      expect(["person", "device", "source"]).toContain(entry.provenanceActorClass);
      if (entry.qualityMix.meanQuality !== undefined) {
        expect(entry.qualityMix.meanQuality).toBeGreaterThan(0);
        expect(entry.qualityMix.meanQuality).toBeLessThanOrEqual(1);
      }
    }
  });

  it("claims both manual and seam methods for the BP systolic metric", () => {
    const pack = buildSyntheticEvidencePack(NOW);
    const entries = packEntriesForMetric(pack, "SYNTH-metric-bp-systolic");
    const methodIds = entries.map((entry) => entry.methodId);
    expect(methodIds).toContain("SYNTH-method-bpsys-manual");
    expect(methodIds).toContain("SYNTH-method-cuff-bp-panel");
    // The manual entry is person-actor; the seam entry is device-actor.
    expect(
      entries.find((entry) => entry.methodId === "SYNTH-method-bpsys-manual")
        ?.provenanceActorClass,
    ).toBe("person");
    expect(
      entries.find((entry) => entry.methodId === "SYNTH-method-cuff-bp-panel")
        ?.provenanceActorClass,
    ).toBe("device");
  });

  it("marks typed-from-memory methods as ESTIMATED evidence", () => {
    const pack = buildSyntheticEvidencePack(NOW);
    const stepsManual = pack.entries.find(
      (entry) => entry.methodId === "SYNTH-method-steps-manual",
    );
    expect(stepsManual?.qualityMix.byEvidenceLabel.ESTIMATED).toBe(
      stepsManual?.count,
    );
    const stepsWearable = pack.entries.find(
      (entry) => entry.methodId === "SYNTH-method-wearable-step-count",
    );
    expect(stepsWearable?.qualityMix.byEvidenceLabel.MEASURED).toBe(
      stepsWearable?.count,
    );
  });
});
