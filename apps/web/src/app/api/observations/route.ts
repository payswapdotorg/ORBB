import { NextResponse } from "next/server";
import {
  importDeviceObservation,
  listObservationBoard,
} from "@/lib/observations/store";

/**
 * Observation route stub (M6-B B5/B6): `GET /api/observations` lists the
 * observation board (structured-provenance detail views + the canonical
 * reconciled view + the import availability); `POST /api/observations`
 * with `{ "action": "import-device" }` runs the SYNTH device-adapter
 * import (golden journey #2): the imported BP observation reconciles with
 * the seeded manual BP original into ONE canonical view with per-source
 * provenance — the store owns the transition, this route only forwards
 * the typed action.
 *
 * Stub semantics (recorded): process-local module state seeded from the
 * deterministic SYNTH fixtures, no persistence, no auth (single-person
 * synthetic session — the M4-B /api/capture discipline).
 *
 * Errors (M3-A envelope style, PHI-safe):
 *   - 400 invalid-request         — unparseable body or unknown action;
 *   - 409 import-already-completed — repeat import (once-only fixture batch);
 *   - 500 internal-error          — never expected.
 */

export const dynamic = "force-dynamic";

interface ActionRequestBody {
  action?: unknown;
}

function errorResponse(
  status: number,
  code: "invalid-request" | "import-already-completed" | "internal-error",
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET() {
  return NextResponse.json(listObservationBoard());
}

export async function POST(request: Request) {
  let body: ActionRequestBody;
  try {
    body = (await request.json()) as ActionRequestBody;
  } catch {
    return errorResponse(
      400,
      "invalid-request",
      'The request body must be JSON, e.g. { "action": "import-device" }.',
    );
  }
  if (body.action !== "import-device") {
    return errorResponse(
      400,
      "invalid-request",
      'The only supported action is "import-device".',
    );
  }
  const result = importDeviceObservation();
  if (!result.ok) {
    return errorResponse(
      409,
      "import-already-completed",
      "That device batch was already imported — nothing to do.",
    );
  }
  return NextResponse.json({
    synthetic: true,
    imported: result.imported,
    superseded: result.superseded,
    canonical: result.canonical,
    observations: result.board.observations,
  });
}
