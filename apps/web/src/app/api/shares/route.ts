import { NextResponse } from "next/server";

/**
 * Sharing route stub (M6-C B7): `GET /api/shares` lists the share
 * contracts (+ access events); `POST /api/shares` applies composer
 * confirmations, revocations (with the caller's confirm flag), and
 * records access events.
 *
 * Errors use the app's error-envelope style (the M3-A contract):
 *   - 400 invalid-request   — unparseable JSON body;
 *   - 422 validation-failed — well-formed JSON violating the contract
 *                             (unknown vocabulary, empty scope, inverted
 *                             window), with the stable error kind;
 *   - 404 not-found         — unknown share id (no values echoed);
 *   - 409 conflict          — revoking a non-active share;
 *   - 500 internal-error    — unexpected store failures.
 *
 * Stub semantics (recorded): process-local module state, no persistence,
 * no auth (single-person synthetic session — the M4-B discipline).
 */

type ShareAction =
  | { kind: "create"; input: CreateSharePayload }
  | { kind: "revoke"; shareId: string; confirmed: boolean }
  | { kind: "record-access"; shareId: string; eventKind: string; actorLabel: string };

interface CreateSharePayload {
  recipientId: string;
  purposeId: string;
  conceptIds: string[];
  startsAtIso: string;
  endsAtIso: string;
  derivedDataAllowed: boolean;
  resharing: "no-resharing" | "recipient-may-share-summary";
  expiresAtIso: string;
  compensation?: string;
}

function envelope(code: string, message: string, details?: unknown) {
  return { code, message, details, requestId: `req_SYNTH-shares-${Math.random().toString(36).slice(2, 8)}` };
}

export async function GET() {
  const { listAccessEvents, listShares } = await import("@/lib/sharing/store");
  return NextResponse.json({
    shares: listShares(),
    accessEvents: listAccessEvents(),
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(envelope("invalid-request", "Request body must be valid JSON."), { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("kind" in body)) {
    return NextResponse.json(envelope("invalid-request", "Body must name an action kind."), { status: 400 });
  }
  const action = body as ShareAction;
  const store = await import("@/lib/sharing/store");

  if (action.kind === "create") {
    const result = store.createShare(action.input);
    if (!result.ok) {
      return NextResponse.json(
        envelope("validation-failed", "The share contract failed validation.", result.error),
        { status: 422 },
      );
    }
    return NextResponse.json({ share: result.share }, { status: 201 });
  }

  if (action.kind === "revoke") {
    if (!action.confirmed) {
      return NextResponse.json(
        envelope("validation-failed", "Revocation requires the explicit confirm step.", { kind: "confirm-required" }),
        { status: 422 },
      );
    }
    const result = store.revokeShare(action.shareId, new Date().toISOString());
    if (!result.ok) {
      const status = result.error.kind === "not-found" ? 404 : 409;
      const message =
        result.error.kind === "not-found" ? "No such share." : "The share is not active.";
      return NextResponse.json(envelope(status === 404 ? "not-found" : "conflict", message, result.error), { status });
    }
    return NextResponse.json({ share: result.share });
  }

  if (action.kind === "record-access") {
    const share = store.findShare(action.shareId);
    if (!share) {
      return NextResponse.json(envelope("not-found", "No such share."), { status: 404 });
    }
    if (!["viewed", "exported"].includes(action.eventKind)) {
      return NextResponse.json(
        envelope("validation-failed", "Unknown access event kind.", { kind: action.eventKind }),
        { status: 422 },
      );
    }
    const result = store.recordAccessEvent(
      action.shareId,
      action.eventKind as "viewed" | "exported",
      new Date().toISOString(),
      action.actorLabel,
      share.scopeSummary,
    );
    if (!result.ok) {
      return NextResponse.json(envelope("not-found", "No such share."), { status: 404 });
    }
    return NextResponse.json({ event: result.event });
  }

  return NextResponse.json(envelope("invalid-request", "Unknown action kind."), { status: 400 });
}
