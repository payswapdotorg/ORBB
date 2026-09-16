// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { resetTodayStore } from "@/lib/today/store";
import { TODAY_PERSON_ID } from "@/lib/today/catalog";

/**
 * Route contract tests (M6 EXIT): `GET /api/today/adherence` returns the
 * restriction-posture surfaces — the observe-only DEFAULT posture (the
 * loudest truth) plus the explicitly-labeled configured-policy fixture
 * variant demonstrating the restriction-authorized vocabulary. Same
 * person-scoped stub contract as `/api/today`.
 */

describe("GET /api/today/adherence", () => {
  it("returns the default observe-only posture with the loud default line", async () => {
    resetTodayStore();
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.synthetic).toBe(true);
    expect(payload.personId).toBe(TODAY_PERSON_ID);
    const posture = payload.posture as Record<string, unknown>;
    expect(posture.variant).toBe("observe-only");
    expect(posture.defaultLine).toBe(
      "No restrictions are configured — nothing happens when you miss a measurement.",
    );
    expect(posture.policy).toBeUndefined();
    const decision = posture.decision as Record<string, unknown>;
    expect(decision.kind).toBe("no-enforcement");
    expect(decision.reason).toBe("no-policy");
  });

  it("returns the configured-policy fixture variant behind its explicit label", async () => {
    resetTodayStore();
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;
    const variant = payload.fixtureVariant as Record<string, unknown>;
    expect(variant.variant).toBe("configured-policy");
    expect(String(variant.variantLabel)).toContain("SYNTH fixture variant");
    expect(String(variant.defaultLine)).toContain("No policy is configured for you");
    const policy = variant.policy as Record<string, unknown>;
    expect(policy.policyId).toBe("SYNTH-policy-evening-focus-0001");
    expect(policy.capability).toBe("ios-focus");
    expect(policy.triggerOn).toBe("missed");
    const decision = variant.decision as Record<string, unknown>;
    expect(decision.kind).toBe("restriction-authorized");
    const restriction = decision.restriction as Record<string, unknown>;
    expect(restriction.kind).toBe("orbb/adherence/restriction-decision/v1");
    expect(restriction.authorization).toBeDefined();
  });

  it("keeps the payload PHI-free and non-punitive", async () => {
    resetTodayStore();
    const response = await GET();
    const serialized = JSON.stringify(await response.json()).toLowerCase();
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptcode");
    for (const barred of ["streak", "score", "penalty", "punish", "badge"]) {
      expect(serialized).not.toContain(barred);
    }
  });
});
