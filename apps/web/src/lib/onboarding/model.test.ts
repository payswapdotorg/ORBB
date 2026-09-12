// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_DRAFT_STORAGE_KEY,
  ONBOARDING_PERSONA_OPTIONS,
  ONBOARDING_SOURCE_OPTIONS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  clearOnboardingDraft,
  completedDraft,
  initialOnboardingDraft,
  isOnboardingComplete,
  isOnboardingDraft,
  loadOnboardingDraft,
  onboardingStepLabel,
  onboardingStepSkippable,
  saveOnboardingDraft,
  withMetricInterests,
  withPersona,
  withSkippedStep,
  withStep,
  type OnboardingDraft,
} from "./model";

/**
 * Onboarding model contract tests (M6-A): the five-step shape, the pure
 * draft transitions (resume-safe), and the localStorage round-trip
 * (invalid payloads are ignored, not crashed on).
 */

afterEach(() => {
  clearOnboardingDraft();
});

describe("step model", () => {
  it("defines five ordered steps with welcome/done non-skippable", () => {
    expect(ONBOARDING_STEP_COUNT).toBe(5);
    expect(ONBOARDING_STEPS.map((step) => step.key)).toEqual([
      "welcome",
      "persona",
      "metrics",
      "sources",
      "done",
    ]);
    expect(onboardingStepSkippable(1)).toBe(false);
    expect(onboardingStepSkippable(2)).toBe(true);
    expect(onboardingStepSkippable(3)).toBe(true);
    expect(onboardingStepSkippable(4)).toBe(true);
    expect(onboardingStepSkippable(5)).toBe(false);
    expect(onboardingStepLabel(2)).toBe("choose how you will use ORBB");
  });

  it("derives personas from the existing emphasis model (all four roles)", () => {
    expect(ONBOARDING_PERSONA_OPTIONS.map((option) => option.role)).toEqual([
      "person",
      "clinician",
      "researcher",
      "developer",
    ]);
  });

  it("summarizes the manual source as connected and seams as not", () => {
    const manual = ONBOARDING_SOURCE_OPTIONS.find(
      (option) => option.kind === "manual",
    );
    expect(manual?.connected).toBe(true);
    const seams = ONBOARDING_SOURCE_OPTIONS.filter(
      (option) => option.kind !== "manual",
    );
    expect(seams.length).toBeGreaterThanOrEqual(6);
    for (const seam of seams) {
      expect(seam.connected).toBe(false);
      expect(seam.detail).toContain("display only");
    }
  });
});

describe("draft transitions", () => {
  it("moves steps, records personas and metric interests, and skips safely", () => {
    let draft: OnboardingDraft = initialOnboardingDraft();
    expect(draft.currentStep).toBe(1);

    draft = withStep(draft, 2);
    expect(draft.currentStep).toBe(2);

    draft = withPersona(draft, "clinician");
    expect(draft.role).toBe("clinician");

    draft = withMetricInterests(draft, [
      "SYNTH-shape-bp-panel",
      "SYNTH-shape-body-weight",
      "SYNTH-shape-not-real",
    ]);
    expect(draft.metricInterestIds).toEqual([
      "SYNTH-shape-bp-panel",
      "SYNTH-shape-body-weight",
    ]);

    draft = withSkippedStep(draft, 4);
    expect(draft.skippedSteps).toEqual([4]);
    expect(draft.currentStep).toBe(5);

    // Re-skipping an already-skipped step is idempotent.
    draft = withSkippedStep(draft, 4);
    expect(draft.skippedSteps).toEqual([4]);
    expect(draft.currentStep).toBe(5);
  });

  it("completes terminally (completion is the first-run end state)", () => {
    let draft = initialOnboardingDraft();
    expect(isOnboardingComplete(draft)).toBe(false);
    draft = completedDraft(draft, "2026-09-12T10:00:00.000Z");
    expect(isOnboardingComplete(draft)).toBe(true);
    expect(draft.completedAt).toBe("2026-09-12T10:00:00.000Z");
    expect(draft.currentStep).toBe(5);
  });
});

describe("localStorage persistence", () => {
  it("round-trips a draft and loads nothing when absent", () => {
    expect(loadOnboardingDraft()).toBeUndefined();
    const draft = withPersona(initialOnboardingDraft(), "researcher");
    saveOnboardingDraft(draft);
    expect(loadOnboardingDraft()).toEqual(draft);
    clearOnboardingDraft();
    expect(loadOnboardingDraft()).toBeUndefined();
  });

  it("ignores invalid persisted payloads (deny-by-default parse)", () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 2, currentStep: 99 }),
    );
    expect(loadOnboardingDraft()).toBeUndefined();
    window.localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, "{not json");
    expect(loadOnboardingDraft()).toBeUndefined();
    expect(isOnboardingDraft("nope")).toBe(false);
  });
});
