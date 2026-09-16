/**
 * Sharing seed fixtures (M6-C B7, Lane B): the deterministic starting
 * world for the sharing surface + golden journey #4 — SYNTH-marked,
 * zero PHI, byte-stable ids so Playwright assertions stay exact.
 *
 * Seed state:
 *   - one ACTIVE share with the full contract shape (Dr. Rivera /
 *     care monitoring / heart-rate + blood-pressure / the pinned
 *     reference window / no derived data / no re-sharing) + ONE
 *     `viewed` access event;
 *   - one REVOKED share (the Cardiology Service, one-time review —
 *     its audit trail shows a `viewed`, an `exported`, and the
 *     revocation event).
 */

import { createShare, recordAccessEvent, revokeShare } from "./store";

export interface SeededShares {
  readonly activeShareId: string;
  readonly revokedShareId: string;
}

/** Seed the deterministic sharing world (call after store reset). */
export function seedSharingFixtures(): SeededShares {
  const active = createShare({
    recipientId: "recipient-synth-clinician",
    purposeId: "purpose-synth-care-monitoring",
    conceptIds: ["concept-heart-rate", "concept-blood-pressure"],
    startsAtIso: "2026-09-03T00:00:00.000Z",
    endsAtIso: "2026-09-10T23:59:59.000Z",
    derivedDataAllowed: false,
    resharing: "no-resharing",
    expiresAtIso: "2026-12-10T23:59:59.000Z",
    compensation: "None recorded (display-only at this stage)",
  });
  if (!active.ok) throw new Error(`seed active share failed: ${JSON.stringify(active.error)}`);
  recordAccessEvent(
    active.share.id,
    "viewed",
    "2026-09-11T09:15:00.000Z",
    "Dr. Ana Rivera (SYNTH clinician)",
    active.share.scopeSummary,
  );

  const revoked = createShare({
    recipientId: "recipient-synth-service",
    purposeId: "purpose-synth-single-review",
    conceptIds: ["concept-temperature"],
    startsAtIso: "2026-08-01T00:00:00.000Z",
    endsAtIso: "2026-08-31T23:59:59.000Z",
    derivedDataAllowed: false,
    resharing: "no-resharing",
    expiresAtIso: "2026-09-30T23:59:59.000Z",
    compensation: "None recorded (display-only at this stage)",
  });
  if (!revoked.ok) throw new Error(`seed revoked share failed: ${JSON.stringify(revoked.error)}`);
  recordAccessEvent(
    revoked.share.id,
    "viewed",
    "2026-08-05T14:00:00.000Z",
    "SYNTH Cardiology Service",
    revoked.share.scopeSummary,
  );
  recordAccessEvent(
    revoked.share.id,
    "exported",
    "2026-08-05T14:01:30.000Z",
    "SYNTH Cardiology Service",
    revoked.share.scopeSummary,
  );
  const revocation = revokeShare(revoked.share.id, "2026-08-06T08:30:00.000Z");
  if (!revocation.ok) throw new Error("seed revocation failed");

  return { activeShareId: active.share.id, revokedShareId: revoked.share.id };
}
