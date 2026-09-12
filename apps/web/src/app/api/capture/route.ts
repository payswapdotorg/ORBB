import { NextResponse } from "next/server";
import { SYNTHETIC_PERSON_ID } from "@/lib/capture/catalog";
import { listRecentCaptures, storeCapture } from "@/lib/capture/store";
import type {
  CaptureErrorEnvelope,
  CaptureIssue,
} from "@/lib/capture/types";
import { validateCaptureSubmission } from "@/lib/capture/validation";

/**
 * Manual capture route stub (M4-B): `POST /api/capture` records one manual
 * capture act into the in-memory store; `GET /api/capture` lists the
 * recent manual captures (person-scoped by construction — the single
 * synthetic person of the web-shell session).
 *
 * Errors use the app's error-envelope style (the M3-A `{ error: { code,
 * message, details?, requestId } }` contract, stable codes, PHI-safe
 * messages that never echo received values):
 *   - 400 invalid-request   — unparseable JSON body;
 *   - 422 validation-failed — well-formed JSON violating the capture
 *                             contract, with field-level issues in
 *                             `details.issues` (field PATH + problem);
 *   - 500 internal-error    — unexpected store failures (generic message).
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session), no idempotency keys (the
 * packet's capture journey has no retry semantics yet — the engine
 * wiring at integration owns those).
 */

export const dynamic = "force-dynamic";

/** Synthetic request-id counter (envelope contract, stub-local). */
let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `SYNTH-REQ-${String(requestCounter).padStart(6, "0")}`;
}

function errorResponse(
  status: number,
  code: "invalid-request" | "validation-failed" | "internal-error",
  message: string,
  issues: readonly CaptureIssue[] | undefined,
): NextResponse {
  const envelope: CaptureErrorEnvelope = {
    error: {
      code,
      message,
      ...(issues !== undefined ? { details: { issues } } : {}),
      requestId: nextRequestId(),
    },
  };
  return NextResponse.json(envelope, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      400,
      "invalid-request",
      "Request body must be valid JSON.",
      undefined,
    );
  }

  const validation = validateCaptureSubmission(body, new Date());
  if (!validation.ok) {
    return errorResponse(
      422,
      "validation-failed",
      "The capture submission failed validation.",
      validation.issues,
    );
  }

  try {
    const capture = storeCapture(validation.submission, new Date());
    return NextResponse.json({ synthetic: true, capture });
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while recording the capture.",
      undefined,
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    synthetic: true,
    personId: SYNTHETIC_PERSON_ID,
    captures: listRecentCaptures(),
  });
}
