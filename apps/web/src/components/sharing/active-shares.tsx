"use client";

/**
 * Active shares list + revocation (M6-C B7, Lane B).
 *
 * Each live contract shows its remaining window, scope summary and the
 * explicit REVOKE action. Revocation REQUIRES a confirm step that states
 * what stops happening (future access; already-accessed history remains
 * in the audit). Post-revoke state is visually distinct and honest
 * ("Revoked on …"). Revoked contracts remain listed (the audit trail is
 * append-only); the journey asserts the distinct state.
 */

import { useState } from "react";
import { Button, Card, Heading, Text } from "@orbb/ui";
import type { ShareContractView } from "@/lib/sharing/types";

export interface ActiveSharesProps {
  readonly shares: readonly ShareContractView[];
  readonly onRevoke: (shareId: string) => void;
}

export function ActiveShares({ shares, onRevoke }: ActiveSharesProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div data-testid="active-shares">
    <Card>
      <Heading level={2}>Your data shares</Heading>
      <Text variant="muted">
        Every share is a reviewable contract. Revoking stops future access; the access history
        remains in the audit trail.
      </Text>
      <p aria-live="polite" className="sr-only">
        {shares.length} share contracts
      </p>

      <ul className="mt-4 space-y-3">
        {shares.map((share) => (
          <li
            key={share.id}
            data-testid={`share-contract-${share.id}`}
            className="rounded-md border border-border p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Text>{share.recipientLabel}</Text>
                <Text variant="muted">
                  {share.purposeLabel} · expires {share.expiresAtIso.slice(0, 10)}
                </Text>
                <Text variant="muted">
                  {share.scopeSummary}
                </Text>
                <Text variant="muted">
                  Derived data: {share.derivedDataAllowed ? "allowed" : "not allowed"} ·
                  Re-sharing:{" "}
                  {share.resharing === "no-resharing" ? "not allowed" : "summary only"}
                </Text>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  data-testid={`share-state-${share.id}`}
                  className={
                    share.state === "active"
                      ? "rounded-full border border-border px-2 py-0.5 text-xs"
                      : "rounded-full border-2 border-border px-2 py-0.5 text-xs font-semibold"
                  }
                >
                  {share.state === "active" ? "Active" : `Revoked on ${share.revokedAtIso?.slice(0, 10)}`}
                </span>
                {share.state === "active" &&
                  (confirmingId === share.id ? (
                    <div className="text-right" data-testid={`revoke-confirm-${share.id}`}>
                      <Text variant="small">
                        Revoke access for {share.recipientLabel}? They will immediately stop being
                        able to view or export the scoped records. Their past accesses stay in the
                        audit trail.
                      </Text>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="default"
                          onClick={() => setConfirmingId(null)}
                          aria-label="Keep share active"
                        >
                          Keep active
                        </Button>
                        <Button
                          variant="primary"
                          size="default"
                          onClick={() => {
                            setConfirmingId(null);
                            onRevoke(share.id);
                          }}
                          aria-label={`Confirm revoke share with ${share.recipientLabel}`}
                        >
                          Revoke access
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="default"
                      onClick={() => setConfirmingId(share.id)}
                      aria-label={`Revoke share with ${share.recipientLabel}`}
                    >
                      Revoke
                    </Button>
                  ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      </Card>
    </div>
  );
}
