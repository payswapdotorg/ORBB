import { describe, expect, it } from "vitest";
import { toggleColumnSort } from "./sort";
import type { ColumnSort } from "./sort";

describe("toggleColumnSort", () => {
  it("starts sorting a fresh column ascending", () => {
    expect(toggleColumnSort(null, "alpha")).toEqual({
      columnId: "alpha",
      direction: "asc",
    });
  });

  it("flips an armed column between ascending and descending", () => {
    const ascending = toggleColumnSort(null, "alpha");
    const descending = toggleColumnSort(ascending, "alpha");
    expect(descending).toEqual({ columnId: "alpha", direction: "desc" });
    expect(toggleColumnSort(descending, "alpha")).toEqual({
      columnId: "alpha",
      direction: "asc",
    });
  });

  it("resets to ascending when a different column is activated", () => {
    const alphaDescending = toggleColumnSort(
      toggleColumnSort(null, "alpha"),
      "alpha",
    );
    expect(toggleColumnSort(alphaDescending, "beta")).toEqual({
      columnId: "beta",
      direction: "asc",
    });
  });

  it("is pure — it never mutates the current state object", () => {
    const current: ColumnSort = { columnId: "alpha", direction: "asc" };
    const snapshot = { ...current };
    toggleColumnSort(current, "alpha");
    expect(current).toEqual(snapshot);
  });
});
