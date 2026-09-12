"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DueWindow,
  FieldWrapper,
  Heading,
  RadioGroup,
  Text,
  ValueInput,
} from "@orbb/ui";
import {
  GOAL_METRIC_OPTIONS,
  INTENT_CADENCE_OPTIONS,
  INTENT_METHOD_PREFERENCE_OPTIONS,
  findGoalMetricOption,
  findIntentMethodOption,
  intentDirectionLabel,
} from "@/lib/intents/catalog";
import {
  buildSyntheticEvidencePack,
  packEntriesForMetric,
} from "@/lib/intents/pack";
import {
  formatWindowLabel,
  packEntryCoverageLine,
} from "@/lib/intents/format";
import {
  isIntentCreateResponse,
  isIntentErrorEnvelope,
  type IntentEvidencePackView,
  type IntentRecordView,
  type IntentReviewEntryView,
} from "@/lib/intents/types";

/**
 * Guided intent composer (M6-A, Lane B — web): the "Create a health
 * intent" journey.
 *
 * Three steps plus the submitted state's handoff:
 *   1. GOAL — metric (SYNTH catalog vocabulary), direction, and target;
 *   2. CONSTRAINTS — cadence window + method preference, with the
 *      EvidencePack summary (coverage badges per metric/method) rendered
 *      alongside so the constraint choice is informed by real coverage;
 *   3. REVIEW — summary + submit to the typed `/api/intents` stub
 *      (in-memory store, error-envelope rejections, idempotent by the
 *      client draft id — the id stays stable across retries of the same
 *      draft, so a lost-response retry never double-creates).
 *
 * Composition rules (consume the library, never re-implement):
 * - `ValueInput` behind `FieldWrapper` for the target (guards clamp);
 * - `RadioGroup` for metric/direction/cadence/preference (self-labeled);
 * - `MethodPicker`-style rows are NOT re-implemented here — the method
 *   landscape rides the pack summary's rows;
 * - feedback lands in pre-existing polite live regions; the first invalid
 *   field receives focus on a failed step transition (the capture-flow
 *   discipline).
 *
 * On success the parent receives {intent, review} — the golden journey
 * head: intent created, candidate plan received.
 */

export interface IntentComposerProps {
  /** Fired after the stub accepts the submission (plan proposal received). */
  onCreated: (payload: {
    intent: IntentRecordView;
    review: IntentReviewEntryView;
  }) => void;
}

type ComposerStep = 1 | 2 | 3;

const STEP_LABELS: Readonly<Record<ComposerStep, string>> = {
  1: "choose your goal",
  2: "constraints and evidence",
  3: "review and submit",
};

type SubmitPhase = "idle" | "saving";

/** Generates a fresh client draft id (the idempotency key). */
function generateDraftId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `SYNTH-DRAFT-${Date.now().toString(36)}-${random}`;
}

export function IntentComposer({ onCreated }: IntentComposerProps) {
  const [step, setStep] = useState<ComposerStep>(1);
  const [draftId, setDraftId] = useState("");
  const [pack, setPack] = useState<IntentEvidencePackView | null>(null);

  const [metricId, setMetricId] = useState<string | undefined>(undefined);
  const [metricError, setMetricError] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<string | undefined>(undefined);
  const [directionError, setDirectionError] = useState<string | undefined>(
    undefined,
  );
  const [targetText, setTargetText] = useState("");
  const [targetError, setTargetError] = useState<string | undefined>(undefined);

  const [cadenceId, setCadenceId] = useState<string | undefined>(undefined);
  const [cadenceError, setCadenceError] = useState<string | undefined>(
    undefined,
  );
  const [preference, setPreference] = useState<string | undefined>(undefined);
  const [preferenceError, setPreferenceError] = useState<string | undefined>(
    undefined,
  );

  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Draft id + evidence pack resolve after mount (hydration-safe: the SSR
  // render and the first client render agree on the empty defaults).
  useEffect(() => {
    setDraftId((current) => (current === "" ? generateDraftId() : current));
    setPack((current) => current ?? buildSyntheticEvidencePack(new Date()));
  }, []);

  const metricOption = useMemo(
    () => (metricId !== undefined ? findGoalMetricOption(metricId) : undefined),
    [metricId],
  );

  function focusField(id: string): void {
    document.getElementById(id)?.focus();
  }

  function continueFromStep1(): void {
    let firstInvalid: string | undefined;
    if (metricId === undefined) {
      setMetricError("Choose a metric to continue.");
      firstInvalid = "intent-goal-metric";
    } else {
      setMetricError(undefined);
    }
    if (direction === undefined) {
      setDirectionError("Choose a direction to continue.");
      firstInvalid ??= "intent-goal-direction";
    } else {
      setDirectionError(undefined);
    }
    const target = parseTarget();
    if (target === null) {
      setTargetError(
        targetText.trim() === ""
          ? "Enter a target value before continuing."
          : "Enter a number.",
      );
      firstInvalid ??= "intent-goal-target";
    } else {
      setTargetError(undefined);
    }
    if (firstInvalid !== undefined) {
      focusField(firstInvalid);
      return;
    }
    setStep(2);
  }

  function parseTarget(): number | null {
    if (metricOption === undefined) {
      return null;
    }
    const trimmed = targetText.trim();
    if (trimmed === "") {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  function continueFromStep2(): void {
    let firstInvalid: string | undefined;
    if (cadenceId === undefined) {
      setCadenceError("Choose a cadence window to continue.");
      firstInvalid = "intent-cadence";
    } else {
      setCadenceError(undefined);
    }
    if (preference === undefined) {
      setPreferenceError("Choose a method preference to continue.");
      firstInvalid ??= "intent-preference";
    } else {
      setPreferenceError(undefined);
    }
    if (firstInvalid !== undefined) {
      focusField(firstInvalid);
      return;
    }
    setStep(3);
  }

  async function submitFromReview(): Promise<void> {
    if (phase === "saving") {
      return;
    }
    if (
      metricId === undefined ||
      direction === undefined ||
      cadenceId === undefined ||
      preference === undefined ||
      pack === null ||
      draftId === ""
    ) {
      // Defensive: the review step is only reachable with a complete draft.
      setStep(1);
      return;
    }
    const target = parseTarget();
    const cadenceOption = INTENT_CADENCE_OPTIONS.find(
      (option) => option.id === cadenceId,
    );
    if (target === null || cadenceOption === undefined) {
      setStep(metricOption === undefined || target === null ? 1 : 2);
      return;
    }

    setPhase("saving");
    setFeedback(null);
    setFailed(false);
    try {
      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId,
          goal: {
            metricId,
            direction,
            target,
          },
          constraints: {
            cadencePerDay: cadenceOption.cadencePerDay,
            methodPreference: preference,
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && isIntentCreateResponse(payload)) {
        onCreated({ intent: payload.intent, review: payload.review });
      } else if (!response.ok && isIntentErrorEnvelope(payload)) {
        setFailed(true);
        setFeedback(`Could not create the intent: ${payload.error.message}`);
      } else {
        setFailed(true);
        setFeedback(
          "Could not create the intent: unexpected response from the intents route.",
        );
      }
    } catch {
      setFailed(true);
      setFeedback("Could not create the intent: network error.");
    } finally {
      setPhase("idle");
    }
  }

  const cadenceOption =
    cadenceId !== undefined
      ? INTENT_CADENCE_OPTIONS.find((option) => option.id === cadenceId)
      : undefined;

  return (
    <Card>
      <Heading level={2}>Create a health intent</Heading>
      <Text variant="muted">
        State what you want to accomplish. ORBB compiles your goal against
        your evidence pack and proposes a candidate measurement plan for
        your review — nothing is decided without you.
      </Text>
      <p aria-live="polite" className="m-0 mt-2 text-sm text-fg-muted">
        {`Step ${step} of 3 — ${STEP_LABELS[step]}`}
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submitFromReview();
        }}
        className="mt-4 flex flex-col gap-4"
      >
        {step === 1 ? (
          <>
            <RadioGroup
              id="intent-goal-metric"
              label="Which metric is this intent about?"
              hint="Synthetic catalog (SYNTH) — the same vocabulary the capture journey records."
              error={metricError}
              required
              options={GOAL_METRIC_OPTIONS.map((option) => ({
                value: option.metricId,
                label: option.metricLabel,
                description: option.summary,
              }))}
              {...(metricId !== undefined ? { value: metricId } : {})}
              onChange={(value) => {
                setMetricId(value);
                setMetricError(undefined);
                setTargetText("");
                setTargetError(undefined);
              }}
            />

            <RadioGroup
              id="intent-goal-direction"
              label="Which direction should the metric move?"
              hint="The aim your plan works toward."
              error={directionError}
              required
              orientation="horizontal"
              options={["decrease", "increase", "maintain"].map((value) => ({
                value,
                label: intentDirectionLabel(value),
              }))}
              {...(direction !== undefined ? { value: direction } : {})}
              onChange={(value) => {
                setDirection(value);
                setDirectionError(undefined);
              }}
            />

            {metricOption !== undefined ? (
              <FieldWrapper
                id="intent-goal-target"
                label={`Target (${metricOption.metricLabel})`}
                hint={`In ${metricOption.unit}. Out-of-range entries are clamped to ${metricOption.targetMin}–${metricOption.targetMax}.`}
                error={targetError}
                required
              >
                {(fieldProps) => (
                  <ValueInput
                    {...fieldProps}
                    value={targetText}
                    onChange={(next) => {
                      setTargetText(next);
                      setTargetError(undefined);
                    }}
                    unit={metricOption.unit}
                    min={metricOption.targetMin}
                    max={metricOption.targetMax}
                    step={metricOption.targetStep}
                  />
                )}
              </FieldWrapper>
            ) : null}

            <div>
              <Button onClick={continueFromStep1}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 2 && pack !== null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {metricOption?.metricLabel ?? "Goal"}
              </span>
              <DueWindow tone="accent">
                {`target ${targetText || "—"} ${metricOption?.unit ?? ""}`}
              </DueWindow>
            </div>

            <RadioGroup
              id="intent-cadence"
              label="How often should the plan measure?"
              hint="The cadence window — safety rules check it against per-domain bounds."
              error={cadenceError}
              required
              options={INTENT_CADENCE_OPTIONS.map((option) => ({
                value: option.id,
                label: option.label,
                description: option.description,
              }))}
              {...(cadenceId !== undefined ? { value: cadenceId } : {})}
              onChange={(value) => {
                setCadenceId(value);
                setCadenceError(undefined);
              }}
            />

            <RadioGroup
              id="intent-preference"
              label="Method preference"
              hint="Measured-evidence-only excludes estimated-from-memory methods."
              error={preferenceError}
              required
              options={INTENT_METHOD_PREFERENCE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                description: option.description,
              }))}
              {...(preference !== undefined ? { value: preference } : {})}
              onChange={(value) => {
                setPreference(value);
                setPreferenceError(undefined);
              }}
            />

            <EvidencePackSummaryCard pack={pack} />

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(1);
                }}
              >
                Back
              </Button>
              <Button onClick={continueFromStep2}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 3 && metricOption !== undefined && cadenceOption !== undefined ? (
          <>
            <Heading level={3}>Review</Heading>
            <dl className="m-0 grid grid-cols-1 gap-2">
              <div>
                <dt className="text-xs font-semibold">Objective</dt>
                <dd className="m-0 text-sm">
                  {`${intentDirectionLabel(direction ?? "")} ${metricOption.metricLabel} toward ${targetText} ${metricOption.unit}.`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Goal metric</dt>
                <dd className="m-0 text-sm">
                  {`${metricOption.metricLabel} (${metricOption.conceptCode})`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Cadence window</dt>
                <dd className="m-0 text-sm">{cadenceOption.label}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Method preference</dt>
                <dd className="m-0 text-sm">
                  {INTENT_METHOD_PREFERENCE_OPTIONS.find(
                    (option) => option.value === preference,
                  )?.label ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Evidence pack</dt>
                <dd className="m-0 text-sm">
                  {`v${pack?.version ?? "—"} · ${pack?.contentHash ?? "—"} · ${pack?.entries.length ?? 0} capability entries`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Draft id (idempotency key)</dt>
                <dd className="m-0 font-mono text-xs text-fg-muted">
                  {draftId === "" ? "generating…" : draftId}
                </dd>
              </div>
            </dl>
            <Text variant="small">
              Submitting compiles a candidate plan proposal for your review —
              a draft, never an activated plan. Retrying the same draft
              replays the same intent (idempotent by draft id).
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(2);
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={phase === "saving"}>
                {phase === "saving" ? "Submitting…" : "Submit intent"}
              </Button>
            </div>
          </>
        ) : null}

        <div aria-live="polite">
          {feedback !== null ? (
            <p className={`m-0 text-xs ${failed ? "text-danger" : "text-fg-muted"}`}>
              {feedback}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// EvidencePack summary (coverage badges per metric/method) — the packet's
// B2 display. Rendered inside the composer's constraint step.
// ---------------------------------------------------------------------------

function EvidencePackSummaryCard({
  pack,
}: {
  pack: IntentEvidencePackView;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-canvas p-4">
      <Heading level={3}>Your evidence pack</Heading>
      <Text variant="small">
        {`Synthetic summary (SYNTH) of your measurement capabilities — v${pack.version}, content ${pack.contentHash}. Coverage badges per metric and method; no values, only counts, windows, and provenance classes.`}
      </Text>
      <ul className="m-0 flex list-none flex-col gap-2 pl-0">
        {GOAL_METRIC_OPTIONS.map((metric) => {
          const entries = packEntriesForMetric(pack, metric.metricId);
          return (
            <li key={metric.metricId} className="flex flex-col gap-1">
              <span className="text-sm font-medium">{metric.metricLabel}</span>
              {entries.length === 0 ? (
                <span className="text-xs text-fg-muted">
                  No summarized evidence yet.
                </span>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 pl-0">
                  {entries.map((entry) => {
                    const method = findIntentMethodOption(entry.methodId);
                    return (
                      <li
                        key={entry.entryId}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <DueWindow tone="accent">
                          {packEntryCoverageLine(entry)}
                        </DueWindow>
                        <span className="text-xs text-fg-muted">
                          {method?.label ?? entry.methodId}
                        </span>
                        <DueWindow tone="neutral">
                          {formatWindowLabel(entry.windowStart, entry.windowEnd)}
                        </DueWindow>
                        <DueWindow tone="neutral">
                          {`actor: ${entry.provenanceActorClass}`}
                        </DueWindow>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
