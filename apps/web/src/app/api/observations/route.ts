import { NextResponse } from "next/server";
import { SYNTHETIC_PERSON_ID } from "@/lib/capture/catalog";
import {
  findObservationDetail,
  importDeviceObservation,
  listObservationSummaries,
  listReconciledViews,
} from "@/lib/observations/store";
import type {
  ObservationErrorEnvelope,
  ObservationIssue,
} from "@/lib/observations/types";

/**
 * Observation/provenance route stub (M6-B B5):
 *   - `GET /api/observations` — every observation summary (synthesized
 *     corpus fixtures, seeded manual duplicate, device imports, live
 *     manual captures) + the reconciled canonical views;
 *   - `GET /api/observations?id=<observationId>` — one observation's FULL
 *     provenance detail (the §Provenance UX chain);
 *   - `POST /api/observations` — the device-import act
 *     (`{ "action": "import-device" }`): imports SYNTH-Device-A's latest
 *     resting-heart-rate sample and reconciles duplicate sources in
 *     today's window (the M4 mirror — per-source provenance, nothing
 *     discarded).
 *
 * Errors use the app's error-envelope style (the M3-A contract, mirrored
 * from the capture route): stable codes, PHI-safe messages that never
 * echo received values.
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session).
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
  code: "invalid-request" | "validation-failed" | "not-found" | "conflict" | "internal-error",
  message: string,
  issues: readonly ObservationIssue[] | undefined,
): NextResponse {
  const envelope: ObservationErrorEnvelope = {
    error: {
      code,
      message,
      ...(issues !== undefined ? { details: { issues } } : {}),
      requestId: nextRequestId(),
    },
  };
  return NextResponse.json(envelope, { status });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const observationId = url.searchParams.get("id");
  const now = new Date();
  if (observationId !== null) {
    const detail = findObservationDetail(observationId, now);
    if (detail === undefined) {
      return errorResponse(
        404,
        "not-found",
        "The observation was not found.",
        undefined,
      );
    }
    return NextResponse.json({ synthetic: true, observation: detail });
  }
  return NextResponse.json({
    synthetic: true,
    personId: SYNTHETIC_PERSON_ID,
    observations: listObservationSummaries(now),
    reconciled: listReconciledViews(),
  });
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

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).action !== "import-device"
  ) {
    return errorResponse(
      422,
      "validation-failed",
      "The observation import request failed validation.",
      [{ field: "action", problem: "The only supported action is 'import-device'." }],
    );
  }

  try {
    const outcome = importDeviceObservation(new Date());
    if (outcome.ok) {
      return NextResponse.json({
        synthetic: true,
        observation: outcome.observation,
        reconciled: outcome.reconciled,
        reconciliationNote: outcome.reconciliationNote,
      });
    }
    return errorResponse(
      409,
      "conflict",
      "The device sample was already imported.",
      undefined,
    );
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while importing the device observation.",
      undefined,
    );
  }
}
