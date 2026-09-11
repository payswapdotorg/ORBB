import { NextResponse } from "next/server";
import {
  MEASUREMENT_SUBMISSION_RULES,
  validateMeasurementSubmission,
} from "@/lib/measurement-submission";

/**
 * Measurement capture stub route (M3-B): `POST /api/measurements`.
 *
 * A route-handler stub, not a real backend: it strictly re-validates the
 * submission (untrusted JSON is rejected, never clamped — the client owns
 * guard semantics, the server owns the contract) and returns a synthetic
 * echo. Nothing is persisted; the echo id is a process-local counter so
 * journeys can assert a stable `SYNTH-OBS-…` shape.
 */

/** Synthetic echo counter (stub-only, process-local, deterministic shape). */
let echoCounter = 0;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: "rejected",
        synthetic: true,
        reason: "body-not-json",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const validation = validateMeasurementSubmission(body, MEASUREMENT_SUBMISSION_RULES);
  if (!validation.ok) {
    return NextResponse.json(
      {
        status: "rejected",
        synthetic: true,
        reason: validation.failure.reason,
        message: validation.failure.message,
      },
      { status: 400 },
    );
  }

  echoCounter += 1;
  return NextResponse.json({
    status: "recorded",
    synthetic: true,
    echo: {
      echoId: `SYNTH-OBS-${String(echoCounter).padStart(4, "0")}`,
      value: validation.submission.value,
      unit: MEASUREMENT_SUBMISSION_RULES.unit,
      methodId: validation.submission.methodId,
      capturedAt: new Date().toISOString(),
    },
  });
}
