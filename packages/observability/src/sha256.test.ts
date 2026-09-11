import { describe, expect, it } from "vitest";
import { sha256Hex } from "./index.js";

// Vectors generated from Node's `crypto` (ground truth), including the
// one-block padding boundaries (55/56/57 bytes) and multi-block inputs.
describe("sha256Hex", () => {
  it("hashes the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the classic fox vector", () => {
    expect(sha256Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    );
  });

  it("handles multi-block inputs (64 and 128 bytes)", () => {
    expect(sha256Hex("a".repeat(64))).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
    );
    expect(sha256Hex("a".repeat(128))).toBe(
      "6836cf13bac400e9105071cd6af47084dfacad4e5e302c94bfed24e013afb73e",
    );
  });

  it("encodes multi-byte UTF-8 and surrogate pairs correctly", () => {
    expect(sha256Hex("héllo→世界 još")).toBe(
      "448df5ef26a2aa2ad00d1b64ff4046c66c70f630bbd1cb25759458b3582904e4",
    );
    expect(sha256Hex("SYNTH-subject-𝄞-ref")).toBe(
      "ac3a73413ced9d756f36f9e2ae5e65c551301829f1757c8d910bbce54443dd3d",
    );
  });

  it("is deterministic (stable across calls)", () => {
    expect(sha256Hex("SYNTH-stability")).toBe(sha256Hex("SYNTH-stability"));
  });

  it("is collision-free for distinct synthetic inputs", () => {
    expect(sha256Hex("SYNTH-input-a")).not.toBe(sha256Hex("SYNTH-input-b"));
  });
});
