import { NextResponse } from "next/server";
import { SYNTHETIC_PERSON_ID } from "@/lib/capture/catalog";
import { createIntentRecord, listIntents } from "@/lib/intents/store";
import type { IntentErrorEnvelope, IntentIssue } from "@/lib/intents/types";
import { validateIntentCreateRequest } from "@/lib/intents/validation";

/**
 * Intent creation route stub (M6-A): `POST /api/intents` compiles one
 * guided-intent submission into a candidate plan proposal (deterministic
 * mirror of the M5 pipeline) and enqueues it for review; `GET /api/intents`
 * lists the session's intents with their review states.
 *
 * Errors use the app's error-envelope style (the M3-A `{ error: { code,
 * message, details?, requestId } }` contract, stable codes, PHI-safe
 * messages that never echo received values — the M4-B /api/capture
 * pattern, mirrored):
 *   - 400 invalid-request   — unparseable JSON body;
 *   - 422 validation-failed — well-formed JSON violating the intent
 *                             contract, with field-level issues in
 *                             `details.issues` (field PATH + problem);
 *   - 500 internal-error    — unexpected store failures (generic message).
 *
 * IDEMPOTENCY (packet B2): creation is keyed by the client draft id —
 * re-submitting the same `draftId` replays the SAME stored intent and
 * review entry (no duplicates, no new audit records). The composer keeps
 * its draft id stable across retry attempts, so a network retry after a
 * successful-but-lost response never double-creates.
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session), reviewer = the person
 * (self-tracking) — the engine wiring at integration owns those.
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
  issues: readonly IntentIssue[] | undefined,
): NextResponse {
  const envelope: IntentErrorEnvelope = {
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

  const validation = validateIntentCreateRequest(body);
  if (!validation.ok) {
    return errorResponse(
      422,
      "validation-failed",
      "The intent submission failed validation.",
      validation.issues,
    );
  }

  try {
    const stored = createIntentRecord({
      draftId: validation.request.draftId,
      goal: validation.request.goal,
      constraints: validation.request.constraints,
      now: new Date(),
    });
    return NextResponse.json({
      synthetic: true,
      intent: stored.intent,
      review: stored.review.entry,
    });
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while compiling the intent.",
      undefined,
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({
      synthetic: true,
      personId: SYNTHETIC_PERSON_ID,
      intents: listIntents(),
    });
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while listing intents.",
      undefined,
    );
  }
}
