import { describe, expect, it } from "vitest";
import * as authBoundary from "./index.js";

describe("@orbb/auth boundary package", () => {
  it("loads the M0 boundary module without runtime behavior", () => {
    expect(authBoundary).toBeDefined();
  });
});
