// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { resetTodayStore } from "@/lib/today/store";
import { listTodayReminders } from "@/lib/reminders/store";
import { TODAY_PERSON_ID } from "@/lib/today/catalog";

/**
 * Route contract tests (M6 EXIT): `GET /api/today/reminders` returns the
 * journey-#7 reminder chain derived from the seeded today task records —
 * the ladder state per open task, PHI-free payloads, and the honest
 * quiet-hours label. Same person-scoped stub contract as `/api/today`.
 */

describe("GET /api/today/reminders", () => {
  it("returns the derived reminder chain for the synthetic person", async () => {
    resetTodayStore();
    const response = await GET();
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const record = payload as Record<string, unknown>;
    expect(record.synthetic).toBe(true);
    expect(record.personId).toBe(TODAY_PERSON_ID);
    expect(typeof record.generatedAt).toBe("string");
    expect(record.quietHoursLabel).toBe("22:00–07:00");
    const reminders = record.reminders as Record<string, unknown>[];
    // The three open tasks carry reminders; the completed task is silent.
    expect(reminders.length).toBe(3);
    const rungs = reminders.map((reminder) => reminder.rung).sort();
    expect(rungs).toEqual(["REMIND", "REMIND", "REMIND_WITH_FALLBACK_OFFER"]);
  });

  it("matches the store derivation exactly (route/read-model coherence)", async () => {
    resetTodayStore();
    const response = await GET();
    const payload = (await response.json()) as { reminders: unknown };
    // Both derivations seed identically per calendar day; the ids, rungs
    // and delivery states agree (label timestamps may differ by seconds).
    const routeReminders = payload.reminders as { taskId: string; rung: string }[];
    const storeReminders = listTodayReminders(new Date());
    for (const storeReminder of storeReminders) {
      const routed = routeReminders.find((entry) => entry.taskId === storeReminder.taskId);
      expect(routed).toBeDefined();
      expect(routed?.rung).toBe(storeReminder.rung);
    }
  });

  it("keeps every reminder payload PHI-free (ids + labels only)", async () => {
    resetTodayStore();
    const response = await GET();
    const payload = (await response.json()) as { reminders: Record<string, unknown>[] };
    expect(payload.reminders.length).toBeGreaterThan(0);
    for (const reminder of payload.reminders) {
      expect(reminder.personId).toBeUndefined();
      expect(Object.keys(reminder)).not.toContain("value");
      expect(Object.keys(reminder)).not.toContain("conceptCode");
      expect(Object.keys(reminder)).not.toContain("evidence");
      expect(JSON.stringify(reminder)).not.toContain("prsn_");
    }
  });
});
