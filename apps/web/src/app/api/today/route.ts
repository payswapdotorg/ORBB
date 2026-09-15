import { NextResponse } from "next/server";
import { TODAY_PERSON_ID } from "@/lib/today/catalog";
import {
  completeTodayTask,
  listTodayIntents,
  listTodayTasks,
} from "@/lib/today/store";
import type { TodayErrorEnvelope, TodayIssue } from "@/lib/today/types";

/**
 * Today-surface route stub (M6-B B4): `GET /api/today` returns the
 * intent-driven Today board (active intents with per-intent progress +
 * the measurement task cards); `POST /api/today` applies a task
 * completion (open -> completed) linked to a capture from the M4-B
 * capture store.
 *
 * Errors use the app's error-envelope style (the M3-A contract, mirrored
 * from the capture route): stable codes, PHI-safe messages that never
 * echo received values:
 *   - 400 invalid-request   — unparseable JSON body;
 *   - 422 validation-failed — well-formed JSON violating the completion
 *                             contract, with field-level issues;
 *   - 404 not-found         — unknown task or capture (no values echoed);
 *   - 409 conflict          — the task is not open (already completed);
 *   - 500 internal-error    — unexpected store failures (generic message).
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session). The deterministic seed and
 * the in-process resumability live in the store (see its header).
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
  issues: readonly TodayIssue[] | undefined,
): NextResponse {
  const envelope: TodayErrorEnvelope = {
    error: {
      code,
      message,
      ...(issues !== undefined ? { details: { issues } } : {}),
      requestId: nextRequestId(),
    },
  };
  return NextResponse.json(envelope, { status });
}

/** Field-level validation of the completion request (PHID-safe issues). */
function validateCompletionBody(
  body: unknown,
): { ok: true; taskId: string; captureId: string } | { ok: false; issues: readonly TodayIssue[] } {
  const issues: TodayIssue[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, issues: [{ field: "body", problem: "Must be a JSON object." }] };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.taskId !== "string" || record.taskId.length === 0) {
    issues.push({ field: "taskId", problem: "A task id is required." });
  }
  if (typeof record.captureId !== "string" || record.captureId.length === 0) {
    issues.push({ field: "captureId", problem: "A capture id is required." });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    taskId: record.taskId as string,
    captureId: record.captureId as string,
  };
}

export async function GET(): Promise<NextResponse> {
  const now = new Date();
  return NextResponse.json({
    synthetic: true,
    personId: TODAY_PERSON_ID,
    intents: listTodayIntents(now),
    tasks: listTodayTasks(now),
    generatedAt: now.toISOString(),
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

  const validation = validateCompletionBody(body);
  if (!validation.ok) {
    return errorResponse(
      422,
      "validation-failed",
      "The task completion failed validation.",
      validation.issues,
    );
  }

  try {
    const outcome = completeTodayTask(validation.taskId, validation.captureId, new Date());
    if (outcome.ok) {
      return NextResponse.json({
        synthetic: true,
        task: outcome.task,
        intents: outcome.intents,
      });
    }
    const message =
      outcome.error.kind === "task-not-found"
        ? "The task to complete was not found."
        : outcome.error.kind === "task-not-open"
          ? "The task is already completed — it cannot be completed again."
          : "The linked capture record was not found.";
    const status =
      outcome.error.kind === "capture-not-found" || outcome.error.kind === "task-not-found"
        ? 404
        : 409;
    const code =
      outcome.error.kind === "capture-not-found" || outcome.error.kind === "task-not-found"
        ? "not-found"
        : "conflict";
    return errorResponse(status, code, message, undefined);
  } catch {
    return errorResponse(
      500,
      "internal-error",
      "An internal error occurred while completing the task.",
      undefined,
    );
  }
}
