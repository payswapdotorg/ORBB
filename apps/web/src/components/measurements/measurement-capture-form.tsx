"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DueWindow,
  FieldWrapper,
  Heading,
  MethodPicker,
  Text,
  ValueInput,
} from "@orbb/ui";
import {
  MEASUREMENT_SUBMISSION_RULES,
  parseMeasurementValue,
} from "@/lib/measurement-submission";
import {
  SYNTHETIC_METRIC,
  SYNTHETIC_METHOD_OPTIONS,
  syntheticMethodLabel,
} from "@/lib/synthetic-data";

/**
 * Measurement capture form (M3-B): "Record a measurement".
 *
 * Mounts the `@orbb/ui` measurement controls:
 * - `DueWindow` badge carrying the task's due window (text is the status
 *   carrier; tone reinforces);
 * - `ValueInput` behind a `FieldWrapper` (label/hint/error/required
 *   wiring: `id` + `aria-describedby` + `aria-invalid` + `aria-required`)
 *   with min/max/step guard semantics from the library;
 * - `MethodPicker` (its own radiogroup label — not a FieldWrapper target
 *   per the library contract), least-burden option first.
 *
 * Validation is client-side with the library's guard semantics (empty and
 * non-numeric input are rejected; finite values are clamped/snapped —
 * never invented). The first invalid field receives focus on failure.
 * Valid submissions POST to the `/api/measurements` route-handler stub,
 * which validates again server-side and returns a synthetic echo; the
 * feedback lands in pre-existing `aria-live="polite"` regions.
 */

type SubmitPhase = "idle" | "saving" | "recorded" | "failed";

interface RecordedEcho {
  readonly echoId: string;
  readonly value: number;
  readonly unit: string;
  readonly methodId: string;
  readonly capturedAt: string;
}

interface RecordedPayload {
  readonly status: "recorded";
  readonly synthetic: true;
  readonly echo: RecordedEcho;
}

interface RejectedPayload {
  readonly status: "rejected";
  readonly synthetic: true;
  readonly reason: string;
  readonly message: string;
}

function isRecordedPayload(payload: unknown): payload is RecordedPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.status === "recorded" &&
    typeof record.echo === "object" &&
    record.echo !== null
  );
}

function isRejectedPayload(payload: unknown): payload is RejectedPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.status === "rejected" &&
    typeof record.message === "string" &&
    typeof record.reason === "string"
  );
}

export function MeasurementCaptureForm() {
  const metric = SYNTHETIC_METRIC;
  const [value, setValue] = useState("");
  const [methodId, setMethodId] = useState<string | undefined>(undefined);
  const [valueError, setValueError] = useState<string | undefined>(undefined);
  const [methodError, setMethodError] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (phase === "saving") {
      return;
    }

    const parsed = parseMeasurementValue(value, MEASUREMENT_SUBMISSION_RULES);
    if (!parsed.ok) {
      setValueError(
        parsed.reason === "value-missing"
          ? "Enter a value before saving."
          : "Enter a number, e.g. 62.",
      );
      setMethodError(undefined);
      setPhase("idle");
      setFeedback(null);
      document.getElementById("measurement-value")?.focus();
      return;
    }
    setValueError(undefined);
    // Normalize the field to the guarded text (clamp + snap semantics).
    if (parsed.guardedText !== value) {
      setValue(parsed.guardedText);
    }

    if (methodId === undefined) {
      setMethodError("Choose a capture method before saving.");
      setPhase("idle");
      setFeedback(null);
      return;
    }
    setMethodError(undefined);

    setPhase("saving");
    setFeedback(null);
    try {
      const response = await fetch("/api/measurements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: parsed.value, methodId }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && isRecordedPayload(payload)) {
        const methodLabel = syntheticMethodLabel(payload.echo.methodId);
        setPhase("recorded");
        setFeedback(
          `Measurement saved: ${payload.echo.value} ${payload.echo.unit} via ${methodLabel} (${payload.echo.echoId}). Synthetic — nothing real was stored.`,
        );
      } else if (!response.ok && isRejectedPayload(payload)) {
        setPhase("failed");
        setFeedback(`Could not save the measurement: ${payload.message}`);
      } else {
        setPhase("failed");
        setFeedback(
          "Could not save the measurement: unexpected response from the stub route.",
        );
      }
    } catch {
      setPhase("failed");
      setFeedback("Could not save the measurement: network error.");
    }
  };

  return (
    <Card>
      <Heading level={2}>Record a measurement</Heading>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{metric.label}</span>
        <DueWindow tone="accent">{metric.dueLabel}</DueWindow>
      </div>
      <Text variant="small">{metric.reason}</Text>

      <form noValidate onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <FieldWrapper
          id="measurement-value"
          label="Measured value"
          hint={`Enter the value in ${metric.unit}. Out-of-range entries are clamped to ${metric.min}–${metric.max}.`}
          error={valueError}
          required
        >
          {(field) => (
            <ValueInput
              {...field}
              value={value}
              onChange={(next) => {
                setValue(next);
              }}
              unit={metric.unit}
              min={metric.min}
              max={metric.max}
              step={metric.step}
            />
          )}
        </FieldWrapper>

        <div className="flex flex-col gap-1">
          <MethodPicker
            label="Capture method"
            options={SYNTHETIC_METHOD_OPTIONS}
            {...(methodId !== undefined ? { value: methodId } : {})}
            onChange={(id) => {
              setMethodId(id);
              setMethodError(undefined);
            }}
          />
          <div aria-live="polite">
            {methodError !== undefined ? (
              <p className="m-0 text-xs text-danger">{methodError}</p>
            ) : null}
          </div>
        </div>

        <div>
          <Button type="submit" disabled={phase === "saving"}>
            {phase === "saving" ? "Saving…" : "Save measurement"}
          </Button>
        </div>

        <div aria-live="polite">
          {feedback !== null ? (
            <p
              className={`m-0 text-xs ${
                phase === "failed" ? "text-danger" : "text-fg-muted"
              }`}
            >
              {feedback}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
