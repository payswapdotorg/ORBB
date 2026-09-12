"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DueWindow,
  FieldWrapper,
  Heading,
  MethodPicker,
  RadioGroup,
  Text,
  TextField,
  ValueInput,
} from "@orbb/ui";
import {
  CAPTURE_SHAPES,
  findCaptureShape,
  SYNTHETIC_PERSON_LABEL,
} from "@/lib/capture/catalog";
import {
  CAPTURE_NOTES_MAX_LENGTH,
  CAPTURE_FUTURE_TOLERANCE_MS,
  parseCaptureFieldText,
} from "@/lib/capture/validation";
import {
  CAPTURE_QUALITY_LABELS,
  CAPTURE_QUALITY_TONES,
} from "@/lib/capture/quality";
import type { CaptureQualityState } from "@/lib/capture/types";
import {
  CAPTURE_QUALITY_STATES,
  isCaptureErrorEnvelope,
  isCaptureQualityState,
  isCaptureSubmitResponse,
} from "@/lib/capture/types";
import {
  formatCapturedLabel,
  formatValueLabel,
  parseDatetimeLocal,
  toDatetimeLocalValue,
} from "@/lib/capture/format";

/**
 * Manual capture flow (M4-B): the "Record a measurement" journey.
 *
 * Three steps plus a recorded state:
 *   1. WHAT — pick the metric from the seeded synthetic catalog (RadioGroup);
 *   2. HOW + VALUES — pick the method (MethodPicker: the single manual
 *      option enabled, device/app routes visible but disabled), enter the
 *      per-shape values (ValueInput guards), the capture timestamp
 *      (defaults to now, editable) and optional notes;
 *   3. REVIEW — a summary plus the quality self-assessment control, then
 *      SUBMIT, which POSTs to the `/api/capture` route stub (in-memory
 *      store, typed error-envelope rejections).
 *
 * Composition rules (consume the library, never re-implement):
 * - `ValueInput` behind `FieldWrapper` (id/aria-describedby/aria-invalid/
 *   aria-required wiring) with per-field min/max/step guards;
 * - `MethodPicker` owns its radiogroup semantics (not a FieldWrapper
 *   target per the library contract);
 * - `RadioGroup` for the metric and quality self-assessment (self-labeled,
 *   hint/error wired);
 * - feedback lands in pre-existing polite live regions; the first invalid
 *   field receives focus on a failed step transition.
 *
 * Quality contract: the self-assessment maps onto the domain completion
 * quality vocabulary (complete | partial | low-quality); partial and
 * low-quality submissions land recorded as such — never silently upgraded.
 */

type CaptureStep = 1 | 2 | 3;

const STEP_LABELS: Readonly<Record<CaptureStep, string>> = {
  1: "choose what you measured",
  2: "method, values, and context",
  3: "review and save",
};

const QUALITY_DESCRIPTIONS: Readonly<Record<CaptureQualityState, string>> = {
  complete: "The reading is fully usable — everything the method typically delivers.",
  partial: "Captured something usable, but below what the method typically delivers.",
  "low-quality": "Barely usable — well below the method's typical quality.",
};

type SubmitPhase = "idle" | "saving";

interface FieldErrorMap {
  [fieldId: string]: string | undefined;
}

/** The recorded-capture summary shown after a successful submit. */
interface SavedSummary {
  readonly metricLabel: string;
  readonly valueLabel: string;
  readonly methodLabel: string;
  readonly qualityState: CaptureQualityState;
  readonly capturedLabel: string;
  readonly captureId: string;
  readonly observationLines: readonly string[];
}

export interface ManualCaptureFlowProps {
  /** Fired after a capture is stored (drives the history refresh). */
  onCaptured?: () => void;
}

export function ManualCaptureFlow({ onCaptured }: ManualCaptureFlowProps) {
  const [step, setStep] = useState<CaptureStep>(1);
  const [shapeId, setShapeId] = useState<string | undefined>(undefined);
  const [metricError, setMetricError] = useState<string | undefined>(undefined);
  const [methodChosen, setMethodChosen] = useState(false);
  const [methodError, setMethodError] = useState<string | undefined>(undefined);
  const [fieldTexts, setFieldTexts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
  const [capturedAtText, setCapturedAtText] = useState("");
  const [timeError, setTimeError] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [qualityState, setQualityState] = useState<CaptureQualityState | undefined>(undefined);
  const [qualityError, setQualityError] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null);

  const shape = useMemo(
    () => (shapeId !== undefined ? findCaptureShape(shapeId) : undefined),
    [shapeId],
  );

  // Default the capture timestamp to "now" AFTER mount: the server and the
  // client's first render agree on "" (hydration safety), and the effect
  // fills the real local time once.
  useEffect(() => {
    setCapturedAtText((current) =>
      current === "" ? toDatetimeLocalValue(new Date()) : current,
    );
  }, []);

  function resetDraft(): void {
    setStep(1);
    setShapeId(undefined);
    setMetricError(undefined);
    setMethodChosen(false);
    setMethodError(undefined);
    setFieldTexts({});
    setFieldErrors({});
    setCapturedAtText(toDatetimeLocalValue(new Date()));
    setTimeError(undefined);
    setNotes("");
    setQualityState(undefined);
    setQualityError(undefined);
    setPhase("idle");
    setFeedback(null);
    setFailed(false);
    setSavedSummary(null);
  }

  function chooseShape(nextShapeId: string): void {
    if (nextShapeId !== shapeId) {
      // Changing the metric resets the per-shape draft state.
      setFieldTexts({});
      setFieldErrors({});
      setMethodChosen(false);
      setMethodError(undefined);
      setQualityState(undefined);
      setQualityError(undefined);
    }
    setShapeId(nextShapeId);
    setMetricError(undefined);
  }

  function continueFromStep1(): void {
    if (shapeId === undefined) {
      setMetricError("Choose what you measured to continue.");
      return;
    }
    setMetricError(undefined);
    setStep(2);
  }

  /**
   * Validates step 2 (method, guarded values, timestamp) and advances on
   * success. Errors are computed locally first — React state updates are
   * asynchronous, so the gate decision never reads stale error state.
   */
  function continueFromStep2(): void {
    if (shape === undefined) {
      setStep(1);
      return;
    }
    let firstInvalidFieldId: string | undefined;

    const nextMethodError = methodChosen
      ? undefined
      : "Choose a capture method to continue.";
    setMethodError(nextMethodError);

    const nextFieldErrors: FieldErrorMap = {};
    for (const field of shape.fields) {
      const raw = fieldTexts[field.id] ?? "";
      const parsed = parseCaptureFieldText(raw, field);
      if (!parsed.ok) {
        nextFieldErrors[field.id] =
          parsed.reason === "value-missing"
            ? "Enter a value before continuing."
            : "Enter a number.";
        firstInvalidFieldId ??= field.id;
      } else if (parsed.guardedText !== raw) {
        // Normalize the field text to the guarded value (clamp + snap).
        setFieldTexts((current) => ({ ...current, [field.id]: parsed.guardedText }));
      }
    }
    setFieldErrors(nextFieldErrors);

    let nextTimeError: string | undefined;
    const capturedAt =
      capturedAtText.trim() === "" ? null : parseDatetimeLocal(capturedAtText);
    if (capturedAt === null) {
      nextTimeError = "Enter a valid date and time.";
      firstInvalidFieldId ??= "capture-time";
    } else if (capturedAt.getTime() > Date.now() + CAPTURE_FUTURE_TOLERANCE_MS) {
      nextTimeError = "Capture time cannot be in the future.";
      firstInvalidFieldId ??= "capture-time";
    }
    setTimeError(nextTimeError);

    const hasFieldErrors = Object.keys(nextFieldErrors).length > 0;
    if (
      nextMethodError !== undefined ||
      hasFieldErrors ||
      nextTimeError !== undefined ||
      capturedAt === null
    ) {
      if (firstInvalidFieldId !== undefined) {
        const target =
          firstInvalidFieldId === "capture-time"
            ? document.getElementById("capture-time")
            : document.getElementById(`capture-field-${firstInvalidFieldId}`);
        target?.focus();
      }
      return;
    }
    setStep(3);
  }

  async function submitFromReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === "saving" || shape === undefined) {
      return;
    }

    if (qualityState === undefined) {
      setQualityError("Choose a quality self-assessment before saving.");
      return;
    }
    setQualityError(undefined);

    // Re-validate the values and timestamp from their current texts.
    const fieldValues: Record<string, number> = {};
    for (const field of shape.fields) {
      const parsed = parseCaptureFieldText(fieldTexts[field.id] ?? "", field);
      if (!parsed.ok) {
        setStep(2);
        continueFromStep2();
        return;
      }
      fieldValues[field.id] = parsed.value;
    }
    const capturedAt = parseDatetimeLocal(capturedAtText);
    if (capturedAt === null || capturedAt.getTime() > Date.now() + CAPTURE_FUTURE_TOLERANCE_MS) {
      setStep(2);
      continueFromStep2();
      return;
    }

    const trimmedNotes = notes.trim();
    setPhase("saving");
    setFeedback(null);
    setFailed(false);
    try {
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shapeId: shape.id,
          methodOptionId: shape.manualMethodOption.id,
          fieldValues,
          qualityState,
          capturedAt: capturedAt.toISOString(),
          ...(trimmedNotes !== "" ? { notes: trimmedNotes } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && isCaptureSubmitResponse(payload)) {
        const record = payload.capture;
        setSavedSummary({
          metricLabel: shape.displayName,
          valueLabel: formatValueLabel(shape, fieldValues),
          methodLabel: shape.manualMethodOption.label,
          qualityState: record.qualityState,
          capturedLabel: formatCapturedLabel(new Date(record.capturedAt), new Date()),
          captureId: record.captureId,
          observationLines: record.observations.map(
            (observation) =>
              `${observation.metricLabel} ${observation.value} ${observation.unit} · method actually used: ${observation.methodId} · provenance actor: ${observation.provenance.actor} (self-tracking)`,
          ),
        });
        onCaptured?.();
      } else if (!response.ok && isCaptureErrorEnvelope(payload)) {
        setFailed(true);
        setFeedback(`Could not save the measurement: ${payload.error.message}`);
      } else {
        setFailed(true);
        setFeedback(
          "Could not save the measurement: unexpected response from the capture route.",
        );
      }
    } catch {
      setFailed(true);
      setFeedback("Could not save the measurement: network error.");
    } finally {
      setPhase("idle");
    }
  }

  // -------------------------------------------------------------------------
  // Recorded state: success feedback lists the new observations with their
  // provenance actor + method, and the quality recorded as-is.
  // -------------------------------------------------------------------------
  if (savedSummary !== null) {
    const summary = savedSummary;
    return (
      <Card>
        <Heading level={2}>Record a measurement</Heading>
        <div
          role="status"
          aria-live="polite"
          data-capture-recorded="true"
          className="mt-1 flex flex-col gap-3"
        >
          <p className="m-0 text-lead font-semibold text-accent">Measurement saved.</p>
          <p className="m-0 text-body">
            {`${summary.metricLabel} ${summary.valueLabel} — via ${summary.methodLabel}.`}
          </p>
          <p className="m-0 text-sm text-fg-muted">
            {`Captured ${summary.capturedLabel} · ${summary.captureId}`}
          </p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {summary.observationLines.map((line) => (
              <li key={line} className="font-mono text-xs text-fg-muted">
                {line}
              </li>
            ))}
          </ul>
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
            <span>Recorded quality:</span>
            <DueWindow tone={CAPTURE_QUALITY_TONES[summary.qualityState]}>
              {CAPTURE_QUALITY_LABELS[summary.qualityState]}
            </DueWindow>
            <span className="text-fg-muted">saved as-is — never silently upgraded.</span>
          </p>
          <p className="m-0 text-sm text-fg-muted">
            {`Provenance: recorded by ${SYNTHETIC_PERSON_LABEL} · validation state: pending · synthetic (SYNTH) — nothing real was stored.`}
          </p>
          <div>
            <Button onClick={resetDraft}>Record another measurement</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Heading level={2}>Record a measurement</Heading>
      <Text variant="muted">
        A first-class manual capture: what you measured, how, and how
        complete the reading was — recorded with full provenance.
      </Text>
      <p aria-live="polite" className="m-0 mt-2 text-sm text-fg-muted">
        {`Step ${step} of 3 — ${STEP_LABELS[step]}`}
      </p>

      <form noValidate onSubmit={submitFromReview} className="mt-4 flex flex-col gap-4">
        {step === 1 ? (
          <>
            <RadioGroup
              label="What did you measure?"
              hint="Synthetic catalog (SYNTH) — manual entry only in this milestone."
              error={metricError}
              required
              options={CAPTURE_SHAPES.map((candidate) => ({
                value: candidate.id,
                label: candidate.displayName,
                description: candidate.summary,
              }))}
              {...(shapeId !== undefined ? { value: shapeId } : {})}
              onChange={(value) => {
                chooseShape(value);
              }}
            />
            <div>
              <Button onClick={continueFromStep1}>Continue</Button>
            </div>
          </>
        ) : null}

        {step === 2 && shape !== undefined ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{shape.displayName}</span>
              <DueWindow tone="accent">{shape.summary}</DueWindow>
            </div>

            <div className="flex flex-col gap-1">
              <MethodPicker
                label="How did you capture it?"
                options={[
                  { ...shape.manualMethodOption },
                  ...shape.futureMethodOptions.map((option) => ({ ...option, disabled: true })),
                ]}
                {...(methodChosen ? { value: shape.manualMethodOption.id } : {})}
                onChange={(id) => {
                  if (id === shape.manualMethodOption.id) {
                    setMethodChosen(true);
                    setMethodError(undefined);
                  }
                }}
              />
              <div aria-live="polite">
                {methodError !== undefined ? (
                  <p className="m-0 text-xs text-danger">{methodError}</p>
                ) : null}
              </div>
            </div>

            {shape.fields.map((field) => (
              <FieldWrapper
                key={field.id}
                id={`capture-field-${field.id}`}
                label={`${field.label} (${field.metric.displayName})`}
                hint={`In ${field.metric.unitDomain[0] ?? ""}. Out-of-range entries are clamped to ${field.min}–${field.max}.`}
                error={fieldErrors[field.id]}
                required
              >
                {(fieldProps) => (
                  <ValueInput
                    {...fieldProps}
                    value={fieldTexts[field.id] ?? ""}
                    onChange={(next) => {
                      setFieldTexts((current) => ({ ...current, [field.id]: next }));
                      setFieldErrors((current) => ({ ...current, [field.id]: undefined }));
                    }}
                    unit={field.metric.unitDomain[0] ?? ""}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                  />
                )}
              </FieldWrapper>
            ))}

            <FieldWrapper
              id="capture-time"
              label="Capture time"
              hint="When you took the reading — defaults to now, and stays editable."
              error={timeError}
              required
            >
              {(fieldProps) => (
                <TextField
                  {...fieldProps}
                  type="datetime-local"
                  value={capturedAtText}
                  onChange={(event) => {
                    setCapturedAtText(event.target.value);
                    setTimeError(undefined);
                  }}
                />
              )}
            </FieldWrapper>

            <FieldWrapper
              id="capture-notes"
              label="Notes (optional)"
              hint={`Anything worth remembering about this reading (max ${CAPTURE_NOTES_MAX_LENGTH} characters).`}
            >
              {(fieldProps) => (
                <TextField
                  {...fieldProps}
                  value={notes}
                  maxLength={CAPTURE_NOTES_MAX_LENGTH}
                  onChange={(event) => {
                    setNotes(event.target.value);
                  }}
                />
              )}
            </FieldWrapper>

            {shape.evidenceNote !== undefined ? (
              <p className="m-0 text-xs text-fg-muted">{shape.evidenceNote}</p>
            ) : null}

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

        {step === 3 && shape !== undefined ? (
          <>
            <Heading level={3}>Review</Heading>
            <dl className="m-0 grid grid-cols-1 gap-2">
              <div>
                <dt className="text-xs font-semibold">What</dt>
                <dd className="m-0 text-sm">{shape.displayName}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Values</dt>
                <dd className="m-0 text-sm">
                  {shape.fields
                    .map(
                      (field) =>
                        `${field.label}: ${fieldTexts[field.id] ?? ""} ${
                          field.metric.unitDomain[0] ?? ""
                        }`,
                    )
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Method (recorded as actually used)</dt>
                <dd className="m-0 text-sm">
                  {`${shape.manualMethodOption.label} — per-observation methods: ${shape.fields
                    .map((field) => field.method.id)
                    .join(", ")}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Capture time</dt>
                <dd className="m-0 text-sm">{formatCapturedLabel(
                  parseDatetimeLocal(capturedAtText) ?? new Date(),
                  new Date(),
                )}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold">Notes</dt>
                <dd className="m-0 text-sm">{notes.trim() === "" ? "None" : notes.trim()}</dd>
              </div>
            </dl>

            {shape.evidenceNote !== undefined ? (
              <p className="m-0 text-xs text-fg-muted">{shape.evidenceNote}</p>
            ) : null}

            <RadioGroup
              label="Quality self-assessment"
              hint="How complete was this reading? Your answer is recorded as-is — partial and low-quality readings are saved with that quality, never upgraded."
              error={qualityError}
              required
              options={CAPTURE_QUALITY_STATES.map((state) => ({
                value: state,
                label: CAPTURE_QUALITY_LABELS[state],
                description: QUALITY_DESCRIPTIONS[state],
              }))}
              {...(qualityState !== undefined ? { value: qualityState } : {})}
              onChange={(value) => {
                if (isCaptureQualityState(value)) {
                  setQualityState(value);
                  setQualityError(undefined);
                }
              }}
            />

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
                {phase === "saving" ? "Saving…" : "Save measurement"}
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
