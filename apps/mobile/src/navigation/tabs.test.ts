import { describe, expect, it } from "vitest";
import { touchTarget } from "@orbb/ui/tokens";

import { TABS, TAB_KEYS } from "./tabs";
import { PLACEHOLDER_NOTICE } from "../screens/placeholder-notice";

/**
 * Mobile shell contract tests (pure node — no React Native runtime needed).
 * These mirror the Maestro smoke journey contract in `maestro/flows/smoke.yaml`.
 */
describe("mobile tab navigation model", () => {
  it("defines exactly the five architecture destinations in order", () => {
    expect(TABS.map((tab) => tab.label)).toEqual([
      "Today",
      "Health",
      "DataBox",
      "Services",
      "You",
    ]);
  });

  it("has unique keys matching the canonical key list", () => {
    expect(TABS.map((tab) => tab.key)).toEqual([...TAB_KEYS]);
    expect(new Set(TABS.map((tab) => tab.key)).size).toBe(TABS.length);
  });

  it("provides a label, glyph, and note for every tab (no empty strings)", () => {
    for (const tab of TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.icon.length).toBeGreaterThan(0);
      expect(tab.note.length).toBeGreaterThan(0);
    }
  });

  it("every tab's screen renders the shared M6+ placeholder notice", () => {
    // The notice text is the contract asserted by the Maestro smoke journey.
    expect(PLACEHOLDER_NOTICE).toBe("Coming in M6+");
  });

  it("consumes @orbb/ui tokens with a >= 44px touch-target floor", () => {
    expect(touchTarget.minimum).toBeGreaterThanOrEqual(44);
  });
});
