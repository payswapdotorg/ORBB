import { NextResponse } from "next/server";
import { completeTodayTask, listTodayBoard } from "@/lib/today/store";

/**
 * Today task route stub (M6-B B4): `GET /api/tasks` lists the Today board
 * (task views + derived per-intent progress); `POST /api/tasks` marks a
 * task completed (the single `open -> completed` transition of the A30
 * task vocabulary, applied by the store — this route never writes task
 * state directly).
 *
 * Stub semantics (recorded): process-local module state seeded from the
 * deterministic SYNTH fixtures, no persistence, no auth (single-person
 * synthetic session — person-scoping happens in the store, the M4-B
 * /api/capture discipline).
 *
 * Errors use the app's error-envelope style (M3-A contract, PHI-safe:
 * messages describe the violated invariant, never echo values):
 *   - 400 invalid-request          — unparseable JSON body or missing taskId;
 *   - 404 task-not-found           — unknown task id;
 *   - 409 task-already-completed   — repeat completion (idempotency is the
 *                                    caller's retry discipline, M5-C
 *                                    convention);
 *   - 500 internal-error           — never expected.
 */

export const dynamic = "force-dynamic";

interface CompleteRequestBody {
  taskId?: unknown;
}

function errorResponse(
  status: number,
  code: "invalid-request" | "task-not-found" | "task-already-completed" | "internal-error",
  message: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status },
  );
}

export async function GET() {
  return NextResponse.json(listTodayBoard());
}

export async function POST(request: Request) {
  let body: CompleteRequestBody;
  try {
    body = (await request.json()) as CompleteRequestBody;
  } catch {
    return errorResponse(
      400,
      "invalid-request",
      "The request body must be JSON with a taskId.",
    );
  }
  if (typeof body.taskId !== "string" || body.taskId.length === 0) {
    return errorResponse(
      400,
      "invalid-request",
      "The request body must carry a non-empty taskId string.",
    );
  }
  const result = completeTodayTask(body.taskId, new Date());
  if (!result.ok) {
    if (result.error.kind === "task-not-found") {
      return errorResponse(404, "task-not-found", "No task with that id in your plan store.");
    }
    return errorResponse(
      409,
      "task-already-completed",
      "That task is already completed — nothing to do.",
    );
  }
  return NextResponse.json({
    synthetic: true,
    task: result.task,
    progress: result.progress,
  });
}
