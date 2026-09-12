// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingJourney } from "./onboarding-journey";
import { RoleProvider } from "@/components/role-provider";
import {
  ONBOARDING_DRAFT_STORAGE_KEY,
  clearOnboardingDraft,
  initialOnboardingDraft,
  loadOnboardingDraft,
  withPersona,
  withStep,
} from "@/lib/onboarding/model";

/**
 * Onboarding journey component tests (M6-A): the five-step flow — step
 * announcements, focus management on step changes, persona wiring into
 * the emphasis model, skipped-step resumability, and completion
 * persistence. (Repo convention: plain Chai matchers + direct DOM
 * property access; no jest-dom plugin.)
 */

afterEach(() => {
  cleanup();
  clearOnboardingDraft();
  vi.restoreAllMocks();
});

function renderJourney(
  initialDraft = initialOnboardingDraft(),
  onComplete = vi.fn(),
) {
  return render(
    <RoleProvider>
      <OnboardingJourney initialDraft={initialDraft} onComplete={onComplete} />
    </RoleProvider>,
  );
}

function continueButton(): HTMLElement {
  return screen.getByRole("button", { name: "Continue" });
}

describe("onboarding journey", () => {
  it("renders step 1 with the polite step announcement", () => {
    renderJourney();
    expect(screen.getByText("Welcome to ORBB")).toBeTruthy();
    expect(screen.getByText("Onboarding — step 1 of 5: welcome")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy();
  });

  it("announces each step and moves focus to the step heading", async () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => {
      expect(
        screen.getByText("Onboarding — step 2 of 5: choose how you will use ORBB"),
      ).toBeTruthy();
    });
    const heading = document.querySelector(
      '[data-onboarding-step-heading="2"]',
    ) as HTMLElement | null;
    expect(heading).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("persists the draft after every transition (resume-safe)", () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(loadOnboardingDraft()?.currentStep).toBe(2);
  });

  it("applies the chosen persona to the app-wide emphasis model", () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(
      screen.getByRole("radio", { name: /clinician — care and measurement focus/i }),
    );
    const radio = screen.getByRole("radio", {
      name: /clinician — care and measurement focus/i,
    }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    expect(loadOnboardingDraft()?.role).toBe("clinician");
  });

  it("toggles metric interests and shows the selection count", () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(continueButton());
    expect(
      screen.getByText("Onboarding — step 3 of 5: pick metrics you care about"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /blood pressure/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sleep duration/i }));
    expect(screen.getByText("2 metrics selected.")).toBeTruthy();
    expect(loadOnboardingDraft()?.metricInterestIds).toEqual([
      "SYNTH-shape-bp-panel",
      "SYNTH-shape-sleep-minutes",
    ]);
  });

  it("skips a step explicitly and keeps it resumable", () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(
      screen.getByText("Onboarding — step 3 of 5: pick metrics you care about"),
    ).toBeTruthy();
    const draft = loadOnboardingDraft();
    expect(draft?.skippedSteps).toEqual([2]);
    expect(draft?.role).toBeUndefined();

    // Back re-opens the skipped step (resumable by navigation).
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("How will you use ORBB?")).toBeTruthy();
  });

  it("renders the source summary with manual registered and seams display-only", () => {
    renderJourney();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    expect(
      screen.getByText("Onboarding — step 4 of 5: review your measurement sources"),
    ).toBeTruthy();
    expect(screen.getByText("Registered · active")).toBeTruthy();
    expect(screen.getAllByText("Not connected yet").length).toBeGreaterThanOrEqual(6);
    expect(
      screen.getAllByText(/display only at this milestone/).length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("completes on step 5, persists the terminal record, and fires onComplete", async () => {
    const onComplete = vi.fn();
    renderJourney(initialOnboardingDraft(), onComplete);
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    expect(
      screen.getByText("Onboarding — step 5 of 5: finish setup"),
    ).toBeTruthy();
    expect(screen.getByText(/Completion is saved in this browser/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    const draft = loadOnboardingDraft();
    expect(draft?.completedAt).toBeDefined();
    expect(draft?.currentStep).toBe(5);
  });

  it("resumes from a persisted mid-journey draft (sources step)", () => {
    const resumed = withStep(withPersona(initialOnboardingDraft(), "person"), 4);
    window.localStorage.setItem(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify(resumed),
    );
    renderJourney(resumed);
    expect(
      screen.getByText("Onboarding — step 4 of 5: review your measurement sources"),
    ).toBeTruthy();
    // The done summary reflects the stored persona choice.
    fireEvent.click(continueButton());
    expect(screen.getByText("Person — tracking my own health")).toBeTruthy();
  });
});
