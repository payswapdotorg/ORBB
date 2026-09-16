/**
 * In-memory share-contract store (M6-C B7, Lane B) — process-local
 * module state backing the `/api/shares` route stub: the same stub-store
 * pattern as the M6-A intent store, now for the §Sharing UX
 * reviewable-contract lifecycle.
 *
 * RECORDED INVARIANTS (the work order's binding rules):
 *   - A share is CREATED only through the composer's full contract
 *     (recipient + purpose + >= 1 concept + valid window + explicit
 *     terms + expiry). There is no "quick share" path and no
 *     default-open scope: `conceptIds: []` or an inverted window is a
 *     validation error, never a "share everything" fallback.
 *   - REVOCATION requires an explicit confirm step at the call site;
 *     the store records the revocation timestamp and emits a `revoked`
 *     access-audit event. Revocation is terminal for the contract id
 *     (re-sharing creates a NEW contract — the audit trail stays
 *     append-only and honest).
 *   - Every mutation appends to the access-audit trail (the §DataBox UX
 *     "view access history" leg): creation emits nothing until the
 *     first `viewed`/`exported` event is recorded — the audit trail is
 *     about ACCESS, not about contract lifecycle, except revocation
 *     which is itself an access-ending event and is recorded.
 *   - Person-scoped by construction (single-person synthetic session —
 *     the M4-B discipline; SYNTHETIC_PERSON_ID on every record).
 *   - Deterministic ids (`shr_SYNTH-…`, creation-scoped counters) and a
 *     deterministic seed fixture (see fixtures.ts) so journeys are
 *     byte-stable.
 */

import {
  findPurposeOption,
  findRecipientOption,
  SHARE_CONCEPT_OPTIONS,
} from "./catalog";
import type {
  AccessAuditEventView,
  AccessEventKind,
  ResharingPolicy,
  ShareConceptId,
  ShareContractView,
} from "./types";

/** The single synthetic person (the M4-B discipline). */
export const SHARING_PERSON_ID = "person_SYNTH-0001";

export interface CreateShareInput {
  readonly recipientId: string;
  readonly purposeId: string;
  readonly conceptIds: readonly ShareConceptId[];
  readonly startsAtIso: string;
  readonly endsAtIso: string;
  readonly derivedDataAllowed: boolean;
  readonly resharing: ResharingPolicy;
  readonly expiresAtIso: string;
  readonly compensation?: string;
}

export type CreateShareError =
  | { readonly kind: "unknown-recipient" }
  | { readonly kind: "unknown-purpose" }
  | { readonly kind: "empty-scope" }
  | { readonly kind: "unknown-concept"; readonly conceptId: string }
  | { readonly kind: "invalid-window" }
  | { readonly kind: "invalid-expiry" };

export type RevokeShareError =
  | { readonly kind: "not-found" }
  | { readonly kind: "not-active" };

interface StoredShare extends ShareContractView {
  readonly personId: string;
}

interface StoreState {
  shares: Map<string, StoredShare>;
  events: AccessAuditEventView[];
  shareCounter: number;
  eventCounter: number;
}

const STATE: StoreState = {
  shares: new Map(),
  events: [],
  shareCounter: 0,
  eventCounter: 0,
};

const KNOWN_CONCEPTS = new Set(SHARE_CONCEPT_OPTIONS.map((c) => c.id));

function nextShareId(): string {
  STATE.shareCounter += 1;
  return `shr_SYNTH-${String(STATE.shareCounter).padStart(4, "0")}`;
}

function nextEventId(): string {
  STATE.eventCounter += 1;
  return `acs_SYNTH-${String(STATE.eventCounter).padStart(4, "0")}`;
}

function parseIso(value: string): number | null {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function scopeSummaryOf(conceptIds: readonly ShareConceptId[], startsAtIso: string, endsAtIso: string): string {
  const labels = conceptIds.map(
    (id) => SHARE_CONCEPT_OPTIONS.find((c) => c.id === id)?.label ?? id,
  );
  const head = labels.length <= 2 ? labels.join(" + ") : `${labels.slice(0, 2).join(" + ")} +${labels.length - 2} more`;
  return `${head} · ${startsAtIso.slice(0, 10)} to ${endsAtIso.slice(0, 10)}`;
}

/** Create a share contract (the composer's confirm action). */
export function createShare(input: CreateShareInput): { ok: true; share: ShareContractView } | { ok: false; error: CreateShareError } {
  const recipient = findRecipientOption(input.recipientId);
  if (!recipient) return { ok: false, error: { kind: "unknown-recipient" } };
  const purpose = findPurposeOption(input.purposeId);
  if (!purpose) return { ok: false, error: { kind: "unknown-purpose" } };
  if (input.conceptIds.length === 0) return { ok: false, error: { kind: "empty-scope" } };
  for (const id of input.conceptIds) {
    if (!KNOWN_CONCEPTS.has(id)) return { ok: false, error: { kind: "unknown-concept", conceptId: id } };
  }
  const start = parseIso(input.startsAtIso);
  const end = parseIso(input.endsAtIso);
  if (start === null || end === null || end <= start) {
    return { ok: false, error: { kind: "invalid-window" } };
  }
  const expiry = parseIso(input.expiresAtIso);
  if (expiry === null || expiry <= end) {
    return { ok: false, error: { kind: "invalid-expiry" } };
  }
  const id = nextShareId();
  const share: StoredShare = {
    personId: SHARING_PERSON_ID,
    id,
    state: "active",
    recipientId: recipient.id,
    recipientLabel: recipient.label,
    purposeId: purpose.id,
    purposeLabel: purpose.label,
    scope: {
      conceptIds: [...input.conceptIds],
      startsAtIso: input.startsAtIso,
      endsAtIso: input.endsAtIso,
    },
    scopeSummary: scopeSummaryOf(input.conceptIds, input.startsAtIso, input.endsAtIso),
    derivedDataAllowed: input.derivedDataAllowed,
    resharing: input.resharing,
    expiresAtIso: input.expiresAtIso,
    compensation: input.compensation ?? "None recorded (display-only at this stage)",
    createdAtIso: new Date(start).toISOString(),
  };
  STATE.shares.set(id, share);
  return { ok: true, share: toView(share) };
}

/** Revoke a share (terminal for the id; requires the caller's confirm step). */
export function revokeShare(shareId: string, atIso: string): { ok: true; share: ShareContractView } | { ok: false; error: RevokeShareError } {
  const share = STATE.shares.get(shareId);
  if (!share) return { ok: false, error: { kind: "not-found" } };
  if (share.state !== "active") return { ok: false, error: { kind: "not-active" } };
  const revoked: StoredShare = { ...share, state: "revoked", revokedAtIso: atIso };
  STATE.shares.set(shareId, revoked);
  recordAccessEvent(shareId, "revoked", atIso, "You", share.scopeSummary);
  return { ok: true, share: toView(revoked) };
}

/** Record a recipient access event (viewed/exported — SYNTH fixtures). */
export function recordAccessEvent(
  shareId: string,
  kind: AccessEventKind,
  atIso: string,
  actorLabel: string,
  scopeSummary: string,
): { ok: true; event: AccessAuditEventView } | { ok: false; error: { kind: "not-found" } } {
  const share = STATE.shares.get(shareId);
  if (!share) return { ok: false, error: { kind: "not-found" } };
  const event: AccessAuditEventView = {
    id: nextEventId(),
    shareId,
    kind,
    atIso,
    actorLabel,
    scopeSummary,
  };
  STATE.events.push(event);
  return { ok: true, event };
}

/** Active + revoked contracts, newest first (deterministic). */
export function listShares(): readonly ShareContractView[] {
  return [...STATE.shares.values()]
    .sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : a.createdAtIso > b.createdAtIso ? -1 : a.id < b.id ? 1 : -1))
    .map(toView);
}

export function listActiveShares(): readonly ShareContractView[] {
  return listShares().filter((s) => s.state === "active");
}

/** Access-audit events, newest first (§DataBox UX "view access history"). */
export function listAccessEvents(shareId?: string): readonly AccessAuditEventView[] {
  const events = shareId ? STATE.events.filter((e) => e.shareId === shareId) : [...STATE.events];
  return events.sort((a, b) => (a.atIso < b.atIso ? 1 : a.atIso > b.atIso ? -1 : a.id < b.id ? 1 : -1));
}

export function findShare(shareId: string): ShareContractView | undefined {
  const share = STATE.shares.get(shareId);
  return share ? toView(share) : undefined;
}

function toView(share: StoredShare): ShareContractView {
  const view: ShareContractView = {
    id: share.id,
    state: share.state,
    recipientId: share.recipientId,
    recipientLabel: share.recipientLabel,
    purposeId: share.purposeId,
    purposeLabel: share.purposeLabel,
    scope: share.scope,
    scopeSummary: share.scopeSummary,
    derivedDataAllowed: share.derivedDataAllowed,
    resharing: share.resharing,
    expiresAtIso: share.expiresAtIso,
    compensation: share.compensation,
    createdAtIso: share.createdAtIso,
  };
  return share.revokedAtIso === undefined ? view : { ...view, revokedAtIso: share.revokedAtIso };
}

/** Test hook: reset + reseed (deterministic — see fixtures.ts). */
export function resetSharingStore(seed?: () => void): void {
  STATE.shares.clear();
  STATE.events.length = 0;
  STATE.shareCounter = 0;
  STATE.eventCounter = 0;
  seed?.();
}
