import { describe, expect, it } from "vitest";
import { DeterministicClock } from "./clock.js";
import { SyntheticFixtures } from "./fixtures.js";
import { DeterministicIdFactory } from "./ids.js";
import { InMemoryTestReset, TEST_RESET_STRATEGY } from "./reset.js";

describe("InMemoryTestReset", () => {
  it("resets clocks to their initial epoch, counters to zero, and clears stores", () => {
    const clock = new DeterministicClock({ epochMs: 5_000 });
    const ids = new DeterministicIdFactory({ seed: "reset-suite" });
    const fixtures = new SyntheticFixtures({ seed: "reset-suite" });
    const store = new Map<string, number>();

    const testReset = new InMemoryTestReset();
    testReset.addResettable("clock", clock);
    testReset.addResettable("ids", ids);
    testReset.addResettable("fixtures", fixtures);
    testReset.addStore("map-store", store);

    const firstPerson = JSON.stringify(fixtures.person());
    const firstId = ids.next("prsn");

    // Dirty everything a first and second time.
    clock.advance(123_456);
    ids.next("prsn");
    fixtures.person();
    fixtures.observation();
    store.set("SYNTH-key", 1);

    const actions = testReset.reset();

    expect(clock.epochMs).toBe(5_000);
    expect(ids.next("prsn")).toBe(firstId);
    expect(JSON.stringify(fixtures.person())).toBe(firstPerson);
    expect(store.size).toBe(0);
    expect(actions).toEqual([
      { label: "clock", kind: "reset" },
      { label: "ids", kind: "reset" },
      { label: "fixtures", kind: "reset" },
      { label: "map-store", kind: "cleared" },
    ]);
  });

  it("works with Set stores as well as Map stores", () => {
    const store = new Set<string>();
    const testReset = new InMemoryTestReset();
    testReset.addStore("set-store", store);
    store.add("SYNTH-member");
    const actions = testReset.reset();
    expect(store.size).toBe(0);
    expect(actions).toEqual([{ label: "set-store", kind: "cleared" }]);
  });

  it("is repeatable and counts resets", () => {
    const clock = new DeterministicClock({ epochMs: 1 });
    const testReset = new InMemoryTestReset();
    testReset.addResettable("clock", clock);
    testReset.reset();
    clock.advance(10);
    testReset.reset();
    testReset.reset();
    expect(testReset.resetCount).toBe(3);
    expect(clock.epochMs).toBe(1);
    expect(testReset.reset()).toEqual([{ label: "clock", kind: "reset" }]);
  });

  it("rejects duplicate labels", () => {
    const testReset = new InMemoryTestReset();
    testReset.addResettable("label", new DeterministicClock());
    expect(() => testReset.addStore("label", new Map<string, string>())).toThrow(RangeError);
  });

  it("rejects empty labels", () => {
    const testReset = new InMemoryTestReset();
    expect(() => testReset.addResettable("", new DeterministicClock())).toThrow(RangeError);
    expect(() => testReset.addStore("", new Map<string, string>())).toThrow(RangeError);
  });

  it("documents the reset strategy", () => {
    const testReset = new InMemoryTestReset();
    expect(testReset.description).toBe(TEST_RESET_STRATEGY);
    expect(TEST_RESET_STRATEGY.length).toBeGreaterThan(0);
    expect(() => new InMemoryTestReset("")).toThrow(RangeError);
  });
});
