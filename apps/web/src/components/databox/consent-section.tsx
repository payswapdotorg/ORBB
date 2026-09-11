"use client";

import { useState } from "react";
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

export function ConsentSection() {
  const [phase, setPhase] = useState<GrantPhase>("pending");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const share = SYNTHETIC_CLINIC_SHARE;
  const badge = BADGE[phase];

  const statusText =
    phase === "active"
      ? `Shared with ${share.recipientName} until ${share.expiryLabel}.`
      : phase === "revoked"
        ? `Access for ${share.recipientName} was revoked. No data is shared.`
        : `Not shared with ${share.recipientName} yet.`;

  const confirm = (): void => {
    setPhase("active");
    setSheetOpen(false);
    setAnnouncement(
      `Share confirmed: ${share.recipientName} can read the scoped data until ${share.expiryLabel}.`,
    );
  };

  const revoke = (): void => {
    setPhase("revoked");
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
            {TRIGGER_LABEL[phase]}
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
