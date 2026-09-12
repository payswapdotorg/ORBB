import { NextResponse } from "next/server";
import { SYNTHETIC_PERSON_ID } from "@/lib/capture/catalog";
import {
  actOnReviewEntry,
  listAuditTrail,
  listPendingReviews,
  listPublishedPlans,
} from "@/lib/intents/store";
import type { IntentErrorEnvelope, IntentIssue } from "@/lib/intents/types";
import { validatePlanActRequest } from "@/lib/intents/validation";

/**
 * Plan review route stub (M6-A): `POST /api/plans` applies the person's
 * reviewer act (approve-with-edits | reject) to a pending review entry;
 * `GET /api/plans` lists the published plan store, the pending reviews,
 * and the append-only audit trail.
 *
 * PUBLICATION INVARIANT (packet B3): approved plans land in the plan store
 * with `published` state ONLY through the store's domain-transition mirror
 * (the local mirror of the frozen domain `assertPlanTransition` guard —
 * see `lib/intents/store.ts`). This route never writes a plan state
 * directly; it only forwards the typed reviewer act.
 *
 * Errors use the app's error-envelope style (the M3-A contract, PHI-safe
 * messages that never echo received values — the M4-B /api/capture
 * pattern, mirrored):
 *   - 400 invalid-request   — unparseable JSON body;
 *   - 422 validation-failed — contract violations AND typed reviewer-act
 *                             refusals (unknown-entry | entry-not-pending |
 *                             invalid-edit | domain-transition-refused),
 *                             with field-level issues carrying the typed
 *                             reason kinds (no values echoed);
 *   - 500 internal-error    — unexpected store failures (generic message).
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session — the reviewer is the person,
 * self-tracking), rejection terminal, approval once-only (the M5-C
 * semantics, mirrored).
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

  const validation = validatePlanActRequest(body);
  if (!validation.ok) {
    return errorResponse(
      422,
      "validation-failed",
      "The plan review action failed validation.",
      validation.issues,
    );
  }

  try {
    const outcome = actOnReviewEntry(validation.request, new Date());
    if (!outcome.ok) {
      // Typed reviewer-act refusals (M5-C vocabulary) surface as field
      // issues on the entry field — PHI-safe: the kind only, never values.
      const problem: Record<string, string> = {
        "unknown-entry": "No pending review entry matches this entry id.",
        "entry-not-pending": "This review entry was already acted on (terminal).",
        "invalid-edit":
          "The edits cannot be applied to the proposed plan (no executable candidate or invalid codes).",
        "domain-transition-refused":
          "The plan state transition was refused by the domain guard.",
      };
      return errorResponse(
        422,
        "validation-failed",
        "The plan review action was refused.",
        [{ field: "entryId", problem: problem[outcome.error.kind] ?? "Refused." }],
      );
    }
    return NextResponse.json({
      synthetic: true,
      kind: outcome.kind,
      ...(outcome.kind === "approved" ? { plan: outcome.plan } : {}),
      review: outcome.review,
      audit: outcome.audit,
    });
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while applying the review action.",
      undefined,
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({
      synthetic: true,
      personId: SYNTHETIC_PERSON_ID,
      published: listPublishedPlans(),
      pending: listPendingReviews(),
      audit: listAuditTrail(),
    });
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while listing plans.",
      undefined,
    );
  }
}
