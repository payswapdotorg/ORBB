import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  NAV_ITEM_LABELS,
  NAV_ITEM_ROUTES,
  ROLE_EMPHASIS,
  ROLES,
  emphasizedItems,
  isEmphasized,
} from "./roles";

describe("web navigation model", () => {
  it("defines exactly the eight architecture nav items in order", () => {
    expect(NAV_ITEMS).toEqual([
      "overview",
      "intents",
      "measurements",
      "databox",
      "care",
      "research",
      "marketplace",
      "settings",
    ]);
  });

  it("labels and routes exist for every nav item", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_ITEM_LABELS[item].length).toBeGreaterThan(0);
      expect(NAV_ITEM_ROUTES[item].startsWith("/")).toBe(true);
    }
  });

  it("defines exactly the four switcher roles", () => {
    expect(ROLES).toEqual(["person", "clinician", "researcher", "developer"]);
  });

  it("every role emphasizes at least one nav item that exists", () => {
    const known = new Set<string>(NAV_ITEMS);
    for (const role of ROLES) {
      const emphasis = ROLE_EMPHASIS[role];
      expect(emphasis.length).toBeGreaterThan(0);
      for (const item of emphasis) {
        expect(known.has(item)).toBe(true);
      }
    }
  });

  it("role emphasis actually changes between Person and Clinician", () => {
    expect(isEmphasized("care", "person")).toBe(false);
    expect(isEmphasized("care", "clinician")).toBe(true);
    expect(isEmphasized("overview", "clinician")).toBe(false);
    expect(emphasizedItems("clinician")).toEqual(["measurements", "databox", "care"]);
  });

  it("emphasizedItems preserves canonical nav order (stable DOM)", () => {
    expect(emphasizedItems("developer")).toEqual(["databox", "marketplace", "settings"]);
  });
});
