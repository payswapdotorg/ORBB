import { describe, expect, it } from "vitest";
import {
  ID_PREFIXES,
  isDeviceId,
  isEvidenceId,
  isGrantId,
  isObservationId,
  isPersonId,
  isProvenanceId,
  isSourceId,
} from "@orbb/domain";
import { DEFAULT_ID_SEED, DeterministicIdFactory, SYNTH_ID_MARKER } from "./ids.js";

describe("DeterministicIdFactory", () => {
  it("uses the documented default seed and SYNTH marker", () => {
    const ids = new DeterministicIdFactory();
    const id = ids.next(ID_PREFIXES.person);
    expect(id.startsWith(`${ID_PREFIXES.person}_`)).toBe(true);
    expect(id).toContain(`${SYNTH_ID_MARKER}-${DEFAULT_ID_SEED}-`);
    expect(ids.seed).toBe(DEFAULT_ID_SEED);
  });

  it("replays identical sequences for the same seed", () => {
    const first = new DeterministicIdFactory({ seed: "replay" });
    const second = new DeterministicIdFactory({ seed: "replay" });
    const firstSequence: string[] = [];
    const secondSequence: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const prefix = index % 2 === 0 ? ID_PREFIXES.person : ID_PREFIXES.device;
      firstSequence.push(first.next(prefix));
      secondSequence.push(second.next(prefix));
    }
    expect(firstSequence).toEqual(secondSequence);
  });

  it("differentiates ids across seeds", () => {
    const alpha = new DeterministicIdFactory({ seed: "alpha" }).next("prsn");
    const beta = new DeterministicIdFactory({ seed: "beta" }).next("prsn");
    expect(alpha).not.toBe(beta);
  });

  it("produces strictly monotonic, unique ids across prefixes", () => {
    const ids = new DeterministicIdFactory({ seed: "mono" });
    const seen: string[] = [];
    let previousCounter = 0;
    for (let index = 0; index < 50; index += 1) {
      const id = ids.next(index % 3 === 0 ? "obs" : "prsn");
      expect(seen).not.toContain(id);
      seen.push(id);
      const counter = Number(id.slice(id.lastIndexOf("-") + 1));
      expect(counter).toBeGreaterThan(previousCounter);
      previousCounter = counter;
    }
    expect(ids.issued).toBe(50);
  });

  it("emits ids that satisfy the canonical domain guards", () => {
    const ids = new DeterministicIdFactory({ seed: "guards" });
    expect(isPersonId(ids.next(ID_PREFIXES.person))).toBe(true);
    expect(isDeviceId(ids.next(ID_PREFIXES.device))).toBe(true);
    expect(isObservationId(ids.next(ID_PREFIXES.observation))).toBe(true);
    expect(isGrantId(ids.next(ID_PREFIXES.grant))).toBe(true);
    expect(isProvenanceId(ids.next(ID_PREFIXES.provenance))).toBe(true);
    expect(isSourceId(ids.next(ID_PREFIXES.source))).toBe(true);
    expect(isEvidenceId(ids.next(ID_PREFIXES.evidence))).toBe(true);
  });

  it("rejects invalid seeds", () => {
    expect(() => new DeterministicIdFactory({ seed: "" })).toThrow(RangeError);
    expect(() => new DeterministicIdFactory({ seed: "bad seed!" })).toThrow(RangeError);
    expect(() => new DeterministicIdFactory({ seed: "x".repeat(65) })).toThrow(RangeError);
  });

  it("rejects invalid prefixes without consuming the counter", () => {
    const ids = new DeterministicIdFactory({ seed: "valid" });
    expect(() => ids.next("")).toThrow(RangeError);
    expect(() => ids.next("bad prefix")).toThrow(RangeError);
    expect(() => ids.next("x".repeat(33))).toThrow(RangeError);
    expect(ids.issued).toBe(0);
    expect(ids.next("prsn")).toContain("SYNTH-valid-00000001");
  });

  it("reset() returns the counter to zero", () => {
    const ids = new DeterministicIdFactory({ seed: "reset" });
    const first = ids.next("prsn");
    ids.next("prsn");
    ids.next("obs");
    ids.reset();
    expect(ids.issued).toBe(0);
    expect(ids.next("prsn")).toBe(first);
  });
});
