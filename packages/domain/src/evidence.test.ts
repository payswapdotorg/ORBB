import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import { EVIDENCE_LABELS, isEvidenceLabel, parseEvidenceLabel } from "./evidence.js";

describe("evidence labels", () => {
  it("defines the M0 baseline vocabulary", () => {
    expect(EVIDENCE_LABELS).toEqual(["MEASURED", "ESTIMATED", "IMPORTED", "DERIVED"]);
  });

  it("parses every legal label", () => {
    for (const label of EVIDENCE_LABELS) {
      expect(parseEvidenceLabel(label)).toBe(label);
      expect(isEvidenceLabel(label)).toBe(true);
    }
  });

  it("rejects unknown labels", () => {
    expect(() => parseEvidenceLabel("GUESSED")).toThrow(DomainInvariantError);
    expect(() => parseEvidenceLabel("measured")).toThrow(DomainInvariantError);
    expect(() => parseEvidenceLabel(7)).toThrow(DomainInvariantError);
    expect(() => parseEvidenceLabel(null)).toThrow(DomainInvariantError);
    expect(isEvidenceLabel("GUESSED")).toBe(false);
    expect(isEvidenceLabel(undefined)).toBe(false);
  });

  it("error messages name the vocabulary without echoing the value", () => {
    let message = "";
    try {
      parseEvidenceLabel("GUESSED");
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("MEASURED");
    expect(message).not.toContain("GUESSED");
  });
});
