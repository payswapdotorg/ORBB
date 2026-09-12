"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  DueWindow,
  Heading,
  RadioGroup,
  Text,
  usePrefersReducedMotion,
} from "@orbb/ui";
import { useRole } from "@/components/role-provider";
import {
  ONBOARDING_METRIC_OPTIONS,
  ONBOARDING_PERSONA_OPTIONS,
  ONBOARDING_SOURCE_OPTIONS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  completedDraft,
  onboardingStepLabel,
  onboardingStepSkippable,
  saveOnboardingDraft,
  withMetricInterests,
  withPersona,
  withSkippedStep,
  withStep,
  type OnboardingDraft,
  type OnboardingStep,
} from "@/lib/onboarding/model";

/**
 * Onboarding journey (M6-A, Lane B — web): the first-run five-step flow —
 * welcome, persona (the EXISTING role/emphasis model), metric interests
 * (M4-B SYNTH catalog vocabulary), source registration summary (manual +
 * the M4-C device seam vocabulary, display only), completion.
 *
 * Accessibility contract (packet B1):
 * - FOCUS MANAGEMENT: every step transition moves programmatic focus to
 *   the step heading (`tabIndex={-1}` target) — the layout's skip-link
 *   pattern, so screen readers announce the new step's title immediately;
 * - the step position is announced politely through a pre-existing
 *   aria-live region ("Step X of 5 — …", the capture-flow discipline);
 * - REDUCED MOTION is respected: the step-content fade is applied only
 *   when `prefers-reduced-motion: reduce` is NOT set (the library hook);
 * - selection state is never communicated by color alone (native radios
 *   and checkboxes through the library primitives carry checked state).
 *
 * Persistence: the draft persists after EVERY transition (resume-safe);
 * a persona choice applies to the app-wide RoleProvider immediately (the
 * emphasis model's only integration point), so nav emphasis reacts live.
 */

export interface OnboardingJourneyProps {
  /** The resumed draft (initial when first run). */
  initialDraft: OnboardingDraft;
  /** Fired when the journey completes (the caller swaps surfaces). */
  onComplete: (draft: OnboardingDraft) => void;
}

const STEP_HEADINGS: Readonly<Record<OnboardingStep, string>> = {
  1: "Welcome to ORBB",
  2: "How will you use ORBB?",
  3: "Which metrics matter to you?",
  4: "Your measurement sources",
  5: "You are set up",
};

export function OnboardingJourney({
  initialDraft,
  onComplete,
}: OnboardingJourneyProps) {
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const { setRole } = useRole();
  const prefersReducedMotion = usePrefersReducedMotion();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const step = draft.currentStep;
  const stepDefinition = ONBOARDING_STEPS[step - 1];

  // Focus management: every step change moves focus to the step heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function transition(next: OnboardingDraft): void {
    setDraft(next);
    saveOnboardingDraft(next);
  }

  function advance(): void {
    if (step < ONBOARDING_STEP_COUNT) {
      transition(withStep(draft, (step + 1) as OnboardingStep));
    }
  }

  function goBack(): void {
    if (step > 1) {
      transition(withStep(draft, (step - 1) as OnboardingStep));
    }
  }

  function skip(): void {
    transition(withSkippedStep(draft, step));
  }

  function finish(): void {
    const completed = completedDraft(draft, new Date().toISOString());
    transition(completed);
    onComplete(completed);
  }

  function toggleMetricInterest(shapeId: string, checked: boolean): void {
    const current = draft.metricInterestIds;
    const next = checked
      ? [...current, shapeId]
      : current.filter((id) => id !== shapeId);
    transition(withMetricInterests(draft, next));
  }

  const selectedMetricCount = draft.metricInterestIds.length;

  return (
    <Card>
      <p aria-live="polite" className="m-0 text-sm text-fg-muted">
        {`Onboarding — step ${step} of ${ONBOARDING_STEP_COUNT}: ${onboardingStepLabel(step)}`}
      </p>
      <div
        key={step}
        data-onboarding-step={stepDefinition?.key ?? step}
        data-prefers-reduced-motion={prefersReducedMotion ? "true" : "false"}
        className={
          prefersReducedMotion
            ? "flex flex-col gap-3"
            : "flex flex-col gap-3 transition-opacity duration-200 ease-out"
        }
      >
        <Heading level={2}>
          <span
            ref={headingRef}
            tabIndex={-1}
            data-onboarding-step-heading={step}
            className="focus:outline-none"
          >
            {STEP_HEADINGS[step]}
          </span>
        </Heading>

        {step === 1 ? (
          <>
            <Text>
              ORBB is a Personal Health Operating System: you state health
              intents, ORBB proposes measurement plans, and you stay in
              control of every decision.
            </Text>
            <Text variant="muted">
              This session is synthetic (SYNTH) — a single-person sandbox
              with no real medical data, no real credentials, and nothing
              persisted beyond this browser&apos;s local storage.
            </Text>
            <Text variant="small">
              Five short steps: a persona, the metrics you care about, your
              measurement sources, and you are done. Skipped steps stay
              resumable.
            </Text>
            <div>
              <Button onClick={advance}>Get started</Button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text variant="muted">
              How will you use ORBB? Your choice drives which surfaces are
              emphasized in the navigation (you can change it anytime in the
              header).
            </Text>
            <RadioGroup
              label="Persona"
              hint="Optional — the Person persona is the default."
              {...(draft.role !== undefined ? { value: draft.role } : {})}
              onChange={(value) => {
                const persona = ONBOARDING_PERSONA_OPTIONS.find(
                  (option) => option.role === value,
                );
                if (persona !== undefined) {
                  // Apply to the app-wide emphasis model immediately —
                  // the nav emphasis reacts live to the choice.
                  setRole(persona.role);
                  transition(withPersona(draft, persona.role));
                }
              }}
              options={ONBOARDING_PERSONA_OPTIONS.map((option) => ({
                value: option.role,
                label: option.label,
                description: option.description,
              }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={goBack}>
                Back
              </Button>
              {onboardingStepSkippable(step) ? (
                <Button variant="quiet" onClick={skip}>
                  Skip this step
                </Button>
              ) : null}
              <Button onClick={advance}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text variant="muted">
              Pick the metrics you want ORBB to work with first. These come
              from the synthetic measurement catalog — the same vocabulary
              the capture journey records.
            </Text>
            <div className="flex flex-col gap-2">
              {ONBOARDING_METRIC_OPTIONS.map((option) => (
                <Checkbox
                  key={option.shapeId}
                  label={option.label}
                  hint={option.summary}
                  checked={draft.metricInterestIds.includes(option.shapeId)}
                  onChange={(event) => {
                    toggleMetricInterest(option.shapeId, event.target.checked);
                  }}
                />
              ))}
            </div>
            <p className="m-0 text-xs text-fg-muted">
              {selectedMetricCount === 0
                ? "Nothing selected yet — this step is optional."
                : `${selectedMetricCount} metric${
                    selectedMetricCount === 1 ? "" : "s"
                  } selected.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={goBack}>
                Back
              </Button>
              {onboardingStepSkippable(step) ? (
                <Button variant="quiet" onClick={skip}>
                  Skip this step
                </Button>
              ) : null}
              <Button onClick={advance}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text variant="muted">
              Your measurement sources today: manual entry is registered and
              active; device and app seams are visible but not connected
              yet (display only — nothing is authorized by viewing them).
            </Text>
            <ul className="m-0 flex list-none flex-col gap-2 pl-0">
              {ONBOARDING_SOURCE_OPTIONS.map((option) => (
                <li
                  key={option.label}
                  className="flex flex-col gap-1 rounded-card border border-border-subtle bg-canvas p-3"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{option.label}</span>
                    <DueWindow
                      tone={option.connected ? "success" : "neutral"}
                    >
                      {option.connected ? "Registered · active" : "Not connected yet"}
                    </DueWindow>
                    <span className="text-xs text-fg-muted">
                      {option.kind === "manual"
                        ? "Manual source"
                        : option.kind === "device"
                          ? "Device seam"
                          : "App seam"}
                    </span>
                  </span>
                  <span className="m-0 text-xs text-fg-muted">{option.detail}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={goBack}>
                Back
              </Button>
              {onboardingStepSkippable(step) ? (
                <Button variant="quiet" onClick={skip}>
                  Skip this step
                </Button>
              ) : null}
              <Button onClick={advance}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <Text>
              Your first-run setup is complete. Here is what ORBB recorded:
            </Text>
            <dl className="m-0 grid grid-cols-1 gap-2">
              <div>
                <dt className="text-xs font-semibold">Persona</dt>
                <dd className="m-0 text-sm">
                  {draft.role !== undefined
                    ? ONBOARDING_PERSONA_OPTIONS.find(
                        (option) => option.role === draft.role,
                      )?.label ?? "Person (default)"
                    : "Person (default — persona step skipped)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Metric interests</dt>
                <dd className="m-0 text-sm">
                  {selectedMetricCount === 0
                    ? "None selected (skipped — resumable anytime)"
                    : ONBOARDING_METRIC_OPTIONS.filter((option) =>
                        draft.metricInterestIds.includes(option.shapeId),
                      )
                        .map((option) => option.label)
                        .join(", ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Sources</dt>
                <dd className="m-0 text-sm">
                  Manual entry registered; device and app seams remain
                  display-only until connected.
                </dd>
              </div>
            </dl>
            <Text variant="small">
              Completion is saved in this browser&apos;s local storage. The
              next golden journey step is creating your first health intent.
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={goBack}>
                Back
              </Button>
              <Button onClick={finish}>Finish setup</Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
