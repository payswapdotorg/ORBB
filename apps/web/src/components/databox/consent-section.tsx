"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  ConsentSheet,
  DueWindow,
  Heading,
  Text,
  type DueWindowTone,
} from "@orbb/ui";
import { SYNTHETIC_CLINIC_SHARE } from "@/lib/synthetic-data";

/**
 * Consent surface (M3-B): the "Share with clinician" flow.
 *
 * Mounts the `@orbb/ui` `ConsentSheet` for the frozen Sharing UX contract
 * (Recipient → Purpose → Exact data → Expiry → Revoke) driven by the
 * synthetic consent grant. The sheet's controlled state, focus trap,
 * escape/backdrop dismissal and reduced-motion behavior all come from the
 * library; this component only owns the grant phase and the feedback.
 *
 * Phase model (synthetic — nothing leaves the DataBox):
 * - `pending`  — no share exists yet; Confirm grants read access;
 * - `active`   — the grant is live until the expiry label;
 * - `revoked`  — access ended; Confirm can re-share.
 *
 * Confirm/Revoke close the sheet (closing is the caller's decision), swap
 * the status badge and status line, and fire a polite `aria-live`
 * announcement. Labels are passed through the sheet's i18n override props
 * (`confirmLabel`, `purposeLabel`, …) so the copy can be swapped for a
 * translation table without touching the library.
 */

type GrantPhase = "pending" | "active" | "revoked";

const BADGE: Readonly<Record<GrantPhase, { label: string; tone: DueWindowTone }>> = {
  pending: { label: "Not shared", tone: "neutral" },
  active: { label: "Active share", tone: "success" },
  revoked: { label: "Revoked", tone: "danger" },
};

const TRIGGER_LABEL: Readonly<Record<GrantPhase, string>> = {
  pending: "Share with clinician",
  active: "Review share",
  revoked: "Share again",
};

export interface ConsentSectionProps {
  /**
   * M6-B B6: controlled grant phase (the DataBox actions card drives the
   * same share through its entry points). Absent -> internal state (the
   * M3-B behavior, unchanged — the existing tests render it uncontrolled).
   */
  readonly phase?: GrantPhase;
  /** Fired on every phase transition (controlled and uncontrolled alike). */
  readonly onPhaseChange?: (phase: GrantPhase) => void;
  /**
   * M6-B B6: increment to request opening the sheet (the actions card's
   * Share / Revoke-access entries route through the SAME reviewable
   * contract — sharing is never a one-click toggle).
   */
  readonly openRequest?: number;
}

export function ConsentSection({ phase, onPhaseChange, openRequest }: ConsentSectionProps) {
  const [internalPhase, setInternalPhase] = useState<GrantPhase>("pending");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const lastOpenRequest = useRef(openRequest ?? 0);

  const grantPhase = phase ?? internalPhase;

  const applyPhase = (next: GrantPhase): void => {
    setInternalPhase(next);
    onPhaseChange?.(next);
  };

  // The actions card's Share/Revoke entries request the sheet here —
  // always THROUGH the sheet (the reviewable-contract discipline).
  useEffect(() => {
    const request = openRequest ?? 0;
    if (request > lastOpenRequest.current) {
      lastOpenRequest.current = request;
      setSheetOpen(true);
    }
  }, [openRequest]);

  const share = SYNTHETIC_CLINIC_SHARE;
  const badge = BADGE[grantPhase];

  const statusText =
    grantPhase === "active"
      ? `Shared with ${share.recipientName} until ${share.expiryLabel}.`
      : grantPhase === "revoked"
        ? `Access for ${share.recipientName} was revoked. No data is shared.`
        : `Not shared with ${share.recipientName} yet.`;

  const confirm = (): void => {
    applyPhase("active");
    setSheetOpen(false);
    setAnnouncement(
      `Share confirmed: ${share.recipientName} can read the scoped data until ${share.expiryLabel}.`,
    );
  };

  const revoke = (): void => {
    applyPhase("revoked");
    setSheetOpen(false);
    setAnnouncement(`Share with ${share.recipientName} revoked. Access ended immediately.`);
  };

  return (
    <Card>
      <Heading level={2}>Sharing</Heading>
      <Text variant="muted">
        Review a scoped data share before anything leaves your DataBox.
      </Text>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DueWindow tone={badge.tone}>{badge.label}</DueWindow>
          <p className="m-0 text-sm">{statusText}</p>
        </div>
        <div>
          <Button
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            {TRIGGER_LABEL[grantPhase]}
          </Button>
        </div>
        <p aria-live="polite" className="m-0 text-sm text-fg-muted">
          {announcement ?? ""}
        </p>
      </div>

      <ConsentSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
        }}
        title="Share with clinician"
        purpose={share.purpose}
        scope={share.scope}
        expiry={share.expiryLabel}
        onConfirm={confirm}
        onRevoke={revoke}
        confirmLabel="Grant access"
        revokeLabel="Revoke access"
        closeLabel="Close request"
        purposeLabel="Why this is requested"
        scopeLabel="Exactly what is shared"
        expiryLabel="Sharing ends"
      />
    </Card>
  );
}
