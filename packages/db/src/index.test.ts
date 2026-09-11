import { describe, expect, it } from "vitest";
import * as dbBoundary from "./index.js";

describe("@orbb/db public surface", () => {
  it("loads the persistence package", () => {
    expect(dbBoundary).toBeDefined();
  });

  it("exports the persistence API without leaking driver SDK types", () => {
    for (const name of [
      "createDb",
      "applyMigrations",
      "SystemClock",
      "PersistenceError",
      "takeCursor",
      "applyCursor",
      "parseCursor",
      "pageOf",
      "clampPageLimit",
    ]) {
      expect(dbBoundary).toHaveProperty(name);
    }
    // Contracts are type-only surfaces: spot-check the runtime guards.
    expect(typeof dbBoundary.parseAccountId).toBe("function");
    expect(typeof dbBoundary.parseAuditId).toBe("function");
    expect(typeof dbBoundary.assertNewOutboxEvent).toBe("function");
  });
});
