/**
 * Sharing view model (M6-C B7, Lane B) — types only.
 *
 * The frozen §Sharing UX contract (UI_UX_ARCHITECTURE.md, BINDING):
 * "Sharing is a reviewable contract, not a one-click 'share data'
 * toggle." Every share presents the full present-tense contract:
 *
 * `Recipient → Purpose → Exact data → Time window → Derived data
 *  allowed? → Re-sharing? → Expiry → Compensation → Revoke`
 *
 * The wire types mirror the frozen domain vocabulary (`AccessGrant` /
 * `DataScope` / purpose + recipient labels — the consent lane owns the
 * vocabulary) at the boundary: branded ids widen to strings, dates
 * serialize as ISO-8601 (the M6-A wire-form discipline).
 *
 * NOTHING here performs authorization: this is the view/store layer over
 * SYNTH fixtures; the real consent evaluation stays in the domain (the
 * M1 deny-by-default model) and arrives with engine wiring (recorded
 * handoff).
 */

/** Share lifecycle states (the domain GRANT_STATES mirror). */
export const SHARE_STATES = ["active", "revoked"] as const;
export type ShareState = (typeof SHARE_STATES)[number];

/** Recipient vocabulary id (SYNTH-marked; see catalog.ts). */
export type ShareRecipientId = string;

/** Purpose-of-use vocabulary id (SYNTH-marked; see catalog.ts). */
export type SharePurposeId = string;

/** Concept (metric) scope id — reuses the DataBox concept vocabulary. */
export type ShareConceptId = string;

/** Re-sharing policy options (explicit; no default-open). */
export const RESHARING_POLICIES = ["no-resharing", "recipient-may-share-summary"] as const;
export type ResharingPolicy = (typeof RESHARING_POLICIES)[number];

/** The exact-data scope of a share (constrained pickers, never free text). */
export interface ShareScopeView {
  /** Concept ids included (at least one — there is no "everything" share). */
  readonly conceptIds: readonly ShareConceptId[];
  /** Inclusive window start (ISO-8601). */
  readonly startsAtIso: string;
  /** Inclusive window end (ISO-8601). */
  readonly endsAtIso: string;
}

/** The full share contract (the reviewable-contract model). */
export interface ShareContractView {
  readonly id: string;
  readonly state: ShareState;
  readonly recipientId: ShareRecipientId;
  readonly recipientLabel: string;
  readonly purposeId: SharePurposeId;
  readonly purposeLabel: string;
  readonly scope: ShareScopeView;
  readonly scopeSummary: string;
  /** May the recipient derive new data from the shared records? */
  readonly derivedDataAllowed: boolean;
  readonly resharing: ResharingPolicy;
  /** Expiry (ISO-8601) — when access stops automatically. */
  readonly expiresAtIso: string;
  /** Compensation display (display-only at this stage, honest). */
  readonly compensation: string;
  readonly createdAtIso: string;
  /** Present when state === "revoked" (ISO-8601). */
  readonly revokedAtIso?: string;
}

/** Access-audit event kinds (§DataBox UX "view access history"). */
export const ACCESS_EVENT_KINDS = ["viewed", "exported", "revoked"] as const;
export type AccessEventKind = (typeof ACCESS_EVENT_KINDS)[number];

/** One access-audit event (SYNTH fixtures; time + actor + scope). */
export interface AccessAuditEventView {
  readonly id: string;
  readonly shareId: string;
  readonly kind: AccessEventKind;
  readonly atIso: string;
  readonly actorLabel: string;
  readonly scopeSummary: string;
}

/** The composer's in-progress draft (steps validated incrementally). */
export interface ShareDraftView {
  readonly recipientId?: ShareRecipientId;
  readonly purposeId?: SharePurposeId;
  readonly conceptIds: readonly ShareConceptId[];
  readonly startsAtIso?: string;
  readonly endsAtIso?: string;
  readonly derivedDataAllowed: boolean;
  readonly resharing: ResharingPolicy;
  readonly compensation: string;
}

/** What one composer step must state (the consequence-in-plain-language rule). */
export interface ComposerStepSpec {
  readonly key: string;
  readonly title: string;
  readonly consequence: string;
}
