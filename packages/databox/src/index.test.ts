import { describe, expect, it } from "vitest";
import * as databoxBoundary from "./index.js";

describe("@orbb/databox boundary package", () => {
  it("loads the M0 boundary module without runtime behavior", () => {
    expect(databoxBoundary).toBeDefined();
  });
});
