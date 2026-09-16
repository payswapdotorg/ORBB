/**
 * Mobile sharing model (M6-C B7, Lane B) — pure data + pure functions.
 *
 * The MIRROR of the web `apps/web/src/lib/sharing/{types,catalog,store,fixtures}.ts`
 * over the same SYNTH sharing world: the seeded contracts (one active
 * clinician share + one revoked service share), their access-audit
 * events, and the same reviewable-contract vocabulary. Pure module —
 * no react-native imports — so vitest (node) can test it directly and
 * the screens render from it (the M6-B mobile-model discipline).
 */

/** The seeded share-contract world (mirrors the web fixtures byte-for-byte). */
export interface ShareContract {
  readonly id: string;
  readonly state: "active" | "revoked";
  readonly recipientLabel: string;
  readonly purposeLabel: string;
  readonly scopeSummary: string;
  readonly derivedDataAllowed: boolean;
  readonly resharingLabel: string;
  readonly expiresLabel: string;
  readonly revokedOnLabel?: string;
}

export interface AccessEvent {
  readonly id: string;
  readonly shareId: string;
  readonly kind: "viewed" | "exported" | "revoked";
  readonly atLabel: string;
  readonly actorLabel: string;
}

export const SEED_SHARES: readonly ShareContract[] = [
  {
    id: "shr_SYNTH-0001",
    state: "active",
    recipientLabel: "Dr. Ana Rivera (SYNTH clinician)",
    purposeLabel: "Ongoing care monitoring",
    scopeSummary: "Heart rate + Blood pressure · 2026-09-03 to 2026-09-10",
    derivedDataAllowed: false,
    resharingLabel: "No re-sharing",
    expiresLabel: "2026-12-10",
  },
  {
    id: "shr_SYNTH-0002",
    state: "revoked",
    recipientLabel: "SYNTH Cardiology Service",
    purposeLabel: "One-time review",
    scopeSummary: "Temperature · 2026-08-01 to 2026-08-31",
    derivedDataAllowed: false,
    resharingLabel: "No re-sharing",
    expiresLabel: "2026-09-30",
    revokedOnLabel: "2026-08-06",
  },
];

export const SEED_EVENTS: readonly AccessEvent[] = [
  {
    id: "acs_SYNTH-0001",
    shareId: "shr_SYNTH-0001",
    kind: "viewed",
    atLabel: "2026-09-11 09:15",
    actorLabel: "Dr. Ana Rivera (SYNTH clinician)",
  },
  {
    id: "acs_SYNTH-0002",
    shareId: "shr_SYNTH-0002",
    kind: "viewed",
    atLabel: "2026-08-05 14:00",
    actorLabel: "SYNTH Cardiology Service",
  },
  {
    id: "acs_SYNTH-0003",
    shareId: "shr_SYNTH-0002",
    kind: "exported",
    atLabel: "2026-08-05 14:01",
    actorLabel: "SYNTH Cardiology Service",
  },
  {
    id: "acs_SYNTH-0004",
    shareId: "shr_SYNTH-0002",
    kind: "revoked",
    atLabel: "2026-08-06 08:30",
    actorLabel: "You",
  },
];

/** The share-state badge label (conservative; never color alone). */
export function shareStateLabel(share: ShareContract): string {
  return share.state === "active" ? "Active share" : `Revoked on ${share.revokedOnLabel ?? "—"}`;
}

/** Access events for one share (or all), newest first. */
export function accessEvents(shareId?: string): readonly AccessEvent[] {
  const events = shareId ? SEED_EVENTS.filter((e) => e.shareId === shareId) : SEED_EVENTS;
  return [...events].sort((a, b) => (a.atLabel < b.atLabel ? 1 : -1));
}

/** Active shares only (the revoke list). */
export function activeShares(shares: readonly ShareContract[] = SEED_SHARES): readonly ShareContract[] {
  return shares.filter((s) => s.state === "active");
}

/** The consent-settings posture summary (B9, mobile you-tab section). */
export interface ConsentPostureSummary {
  readonly activeShareCount: number;
  readonly enabledSourceCount: number;
  readonly quietHoursLabel: string;
}

export function consentPostureSummary(
  shares: readonly ShareContract[] = SEED_SHARES,
): ConsentPostureSummary {
  return {
    activeShareCount: activeShares(shares).length,
    enabledSourceCount: 1, // manual entry only — deny-by-default (mirrors web store)
    quietHoursLabel: "22:00–07:00 (on)",
  };
}
