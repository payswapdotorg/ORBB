import { describe, expect, it } from "vitest";
import * as consentBoundary from "./index.js";

describe("@orbb/consent boundary package", () => {
  it("loads the M0 boundary module without runtime behavior", () => {
    expect(consentBoundary).toBeDefined();
  });
});
