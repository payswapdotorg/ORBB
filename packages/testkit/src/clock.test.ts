import { describe, expect, it } from "vitest";
import { DEFAULT_CLOCK_EPOCH_MS, DeterministicClock, type Clock } from "./clock.js";

describe("DeterministicClock", () => {
  it("starts at the Unix epoch by default", () => {
    const clock = new DeterministicClock();
    expect(DEFAULT_CLOCK_EPOCH_MS).toBe(0);
    expect(clock.epochMs).toBe(0);
    expect(clock.now().getTime()).toBe(0);
  });

  it("accepts an explicit initial epoch", () => {
    const clock = new DeterministicClock({ epochMs: 60_000 });
    expect(clock.epochMs).toBe(60_000);
    expect(clock.now().getTime()).toBe(60_000);
  });

  it("returns a defensive copy from now()", () => {
    const clock = new DeterministicClock({ epochMs: 1_000 });
    const snapshot = clock.now();
    snapshot.setTime(999_999_999);
    expect(clock.now().getTime()).toBe(1_000);
  });

  it("advances forward by a millisecond delta and returns the new time", () => {
    const clock = new DeterministicClock();
    const after = clock.advance(1_500);
    expect(after.getTime()).toBe(1_500);
    expect(clock.epochMs).toBe(1_500);
    expect(clock.now().getTime()).toBe(1_500);
  });

  it("treats a zero-millisecond advance as a no-op", () => {
    const clock = new DeterministicClock({ epochMs: 42 });
    clock.advance(0);
    expect(clock.epochMs).toBe(42);
  });

  it("rejects negative and non-finite deltas without moving", () => {
    const clock = new DeterministicClock({ epochMs: 100 });
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(clock.epochMs).toBe(100);
  });

  it("advanceTo sets an absolute epoch", () => {
    const clock = new DeterministicClock({ epochMs: 100 });
    clock.advanceTo(5_000);
    expect(clock.epochMs).toBe(5_000);
    expect(clock.now().getTime()).toBe(5_000);
  });

  it("rejects invalid absolute epochs", () => {
    const clock = new DeterministicClock();
    expect(() => clock.advanceTo(-1)).toThrow(RangeError);
    expect(() => clock.advanceTo(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("reset() restores the initial epoch, not just zero", () => {
    const clock = new DeterministicClock({ epochMs: 2_000 });
    clock.advance(10_000);
    clock.reset();
    expect(clock.epochMs).toBe(2_000);
  });

  it("satisfies the Clock contract structurally", () => {
    const clock: Clock = new DeterministicClock();
    const now: Date = clock.now();
    expect(now).toBeInstanceOf(Date);
  });
});
