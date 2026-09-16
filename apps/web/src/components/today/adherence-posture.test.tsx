// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdherencePostureCard } from "./adherence-posture";
import type { TodayAdherencePostureWire } from "@/lib/adherence/types";

/**
 * Restriction-posture card tests (M6 EXIT, journey #7): the
 * provenance-style status surface for the adherence posture —
 *   - the observe-only DEFAULT is the loudest truth (rendered first,
 *     emphasized, always);
 *   - the decision record is text-carried (kind, reason, evaluation,
 *     audit steps — the B10 vocabulary);
 *   - the configured-policy fixture variant sits behind an explicit
 *     disclosure and shows the policy summary (every frozen field) plus
 *     the restriction-authorized decision (bounded token);
 *   - never gamified: no streak/score/penalty vocabulary, no state by
 *     color alone.
 */

afterEach(() => {
  cleanup();
});

function defaultPosture(): TodayAdherencePostureWire {
  return {
    variant: "observe-only",
    variantLabel: "Restriction posture: observe-only (the default)",
    defaultLine:
      "No restrictions are configured — nothing happens when you miss a measurement.",
    summaryLine:
      "Missing a measurement records adherence state and nothing else. A restriction can exist only under an explicit, authorized, configured policy — and none is configured.",
    decision: {
      kind: "no-enforcement",
      reason: "no-policy",
      decisionLabel: "Observe-only — nothing restrictive happens",
      evaluation: {
        taskId: "task_SYNTH-today-wt-000003",
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: "2026-09-14T10:00:00.000Z",
        auditSteps: [
          { step: "task-state", detail: "open" },
          { step: "window-elapsed-check", detail: "endsAt<=now" },
        ],
      },
      auditSteps: [{ step: "policy-resolution", detail: "absent:policy" }],
    },
  };
}

function configuredVariant(): TodayAdherencePostureWire {
  return {
    variant: "configured-policy",
    variantLabel: "Restriction posture: configured policy (SYNTH fixture variant)",
    defaultLine:
      "SYNTH fixture variant — demonstrates the vocabulary only. No policy is configured for you; nothing happens when you miss a measurement.",
    summaryLine:
      "What the posture looks like when every gate passes: an explicit policy, an authorization grant affirmed at decision time, an available OS capability — and a bounded restriction.",
    decision: {
      kind: "restriction-authorized",
      decisionLabel:
        "Restriction authorized — under an explicit, authorized, configured policy only",
      evaluation: {
        taskId: "task_SYNTH-today-wt-000003",
        state: "missed",
        reason: "window-elapsed",
        evaluatedAtIso: "2026-09-14T10:00:00.000Z",
        auditSteps: [
          { step: "task-state", detail: "open" },
          { step: "window-elapsed-check", detail: "endsAt<=now" },
        ],
      },
      restriction: {
        kind: "orbb/adherence/restriction-decision/v1",
        decisionId: "SYNTH-DECISION-evening-focus-wt-0001",
        policyId: "SYNTH-policy-evening-focus-0001",
        policyVersion: 1,
        capability: "ios-focus",
        authorization: {
          permission: "adherence:restrict:ios-focus",
          verifiedAtIso: "2026-09-14T10:00:00.000Z",
        },
        scope: {
          personId: "prsn_SYNTH-person-0001",
          planId: "plan_SYNTH-today-wt-mornings-0003",
          metricId: "SYNTH-metric-body-weight",
        },
        detection: { state: "available" },
        decidedAtIso: "2026-09-14T10:00:00.000Z",
        expiresAtIso: "2026-09-14T12:00:00.000Z",
      },
      auditSteps: [
        { step: "policy-resolution", detail: "SYNTH-policy-evening-focus-0001:v1:ios-focus" },
        { step: "trigger-evaluation", detail: "state=missed" },
        { step: "scope-check", detail: "in-scope" },
        { step: "authorization-gate", detail: "authorized" },
        { step: "capability-detection", detail: "state=available" },
        { step: "restriction-authorized", detail: "ios-focus" },
      ],
    },
    policy: {
      policyId: "SYNTH-policy-evening-focus-0001",
      version: 1,
      capability: "ios-focus",
      capabilityLabel: "iOS Focus (SYNTH OS seam)",
      triggerOn: "missed",
      authorization: {
        permissions: ["adherence:restrict:ios-focus"],
        grantId: "grant_SYNTH-adherence-demo-0001",
      },
      scope: {
        personIds: ["prsn_SYNTH-person-0001"],
        planIds: ["plan_SYNTH-today-wt-mornings-0003"],
        metricIds: ["SYNTH-metric-body-weight"],
      },
      restriction: { durationMs: 7_200_000 },
      durationLabel: "2 hours (bounded — restrictions are at most 24 hours)",
    },
  };
}

describe("AdherencePostureCard (the authorization-status surface)", () => {
  it("makes the observe-only default the loudest truth, rendered first", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    expect(
      screen.getByText(
        "No restrictions are configured — nothing happens when you miss a measurement.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Restriction posture: observe-only (the default)")).toBeTruthy();
    const root = screen.getByText(/No restrictions are configured/).closest(
      "[data-adherence-posture]",
    );
    expect(root?.getAttribute("data-adherence-posture")).toBe("observe-only");
    expect(root?.getAttribute("data-adherence-decision")).toBe("no-enforcement");
  });

  it("renders the default decision record as TEXT (kind, reason, evaluation, audit)", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    expect(
      screen.getByText(/Decision: no-enforcement — Observe-only — nothing restrictive happens/),
    ).toBeTruthy();
    expect(screen.getByText("reason: no-policy")).toBeTruthy();
    expect(
      screen.getByText(/adherence state missed \(window-elapsed\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/audit steps: policy-resolution \(absent:policy\)/),
    ).toBeTruthy();
  });

  it("hides the configured-policy variant behind an explicit disclosure", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    const toggle = screen.getByRole("button", {
      name: "View the configured-policy fixture variant (SYNTH)",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // The variant's policy summary is NOT visible before the explicit open.
    expect(screen.queryByText("The configured policy (every field)")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The configured policy (every field)")).toBeTruthy();
  });

  it("shows the policy summary with every frozen field, verbatim", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "View the configured-policy fixture variant (SYNTH)" }),
    );
    expect(screen.getByText("SYNTH-policy-evening-focus-0001")).toBeTruthy();
    expect(screen.getByText("ios-focus — iOS Focus (SYNTH OS seam)")).toBeTruthy();
    expect(
      screen.getByText(/triggerOn: missed \(the only legal trigger — recovery is never punished\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/permissions: adherence:restrict:ios-focus · pinned grant: grant_SYNTH-adherence-demo-0001/),
    ).toBeTruthy();
    expect(
      screen.getByText(/2 hours \(bounded — restrictions are at most 24 hours\)/),
    ).toBeTruthy();
  });

  it("shows the restriction-authorized decision with the bounded token", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "View the configured-policy fixture variant (SYNTH)" }),
    );
    const variantRoot = screen
      .getByText("Restriction posture: configured policy (SYNTH fixture variant)")
      .closest("[data-adherence-variant]");
    expect(variantRoot?.getAttribute("data-variant-decision")).toBe("restriction-authorized");
    expect(
      screen.getByText(/Decision: restriction-authorized — Restriction authorized/),
    ).toBeTruthy();
    expect(screen.getByText(/decisionId: SYNTH-DECISION-evening-focus-wt-0001/)).toBeTruthy();
    expect(
      screen.getByText(/authorization: adherence:restrict:ios-focus — verified at/),
    ).toBeTruthy();
    expect(
      screen.getByText(/expires: 2026-09-14T12:00:00.000Z \(bounded — restrictions are at most 24 hours\)/),
    ).toBeTruthy();
  });

  it("never gamifies the posture (no punitive vocabulary, text-carried states)", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "View the configured-policy fixture variant (SYNTH)" }),
    );
    for (const barred of [/streak/i, /score/i, /penalt/i, /badge/i, /level/i, /points/i]) {
      expect(screen.queryByText(barred)).toBeNull();
    }
  });

  it("keeps the variant honest: the disclaimer is shown inside the variant", () => {
    render(<AdherencePostureCard posture={defaultPosture()} fixtureVariant={configuredVariant()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "View the configured-policy fixture variant (SYNTH)" }),
    );
    expect(
      screen.getByText(/SYNTH fixture variant — demonstrates the vocabulary only/),
    ).toBeTruthy();
    expect(screen.getByText(/No policy is configured for you/)).toBeTruthy();
  });
});
