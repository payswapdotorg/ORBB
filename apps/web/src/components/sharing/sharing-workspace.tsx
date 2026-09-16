"use client";

/**
 * Sharing workspace (M6-C B7, Lane B) — the DataBox sharing section:
 * the share-contract composer entry, the active-shares list with
 * revocation, the access-history audit, and the answer-only preview.
 * Mounts under the DataBox surface (the §DataBox UX entry points).
 *
 * State is process-local (the stub-store discipline): mount seeds the
 * deterministic fixture world once per process; actions flow through
 * the typed store, and every surface re-renders from it.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Heading, Text } from "@orbb/ui";
import { ActiveShares } from "./active-shares";
import { AccessHistory } from "./access-history";
import { AnswerOnlyPreview } from "./answer-only-preview";
import { ShareComposer } from "./share-composer";
import { seedSharingFixtures } from "@/lib/sharing/fixtures";
import {
  createShare,
  listAccessEvents,
  listShares,
  recordAccessEvent,
  resetSharingStore,
  revokeShare,
} from "@/lib/sharing/store";
import type { ShareContractView, AccessAuditEventView } from "@/lib/sharing/types";

let SEEDED = false;

export function SharingWorkspace() {
  const [composing, setComposing] = useState(false);
  const [shares, setShares] = useState<readonly ShareContractView[]>([]);
  const [events, setEvents] = useState<readonly AccessAuditEventView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!SEEDED) {
      resetSharingStore(seedSharingFixtures);
      SEEDED = true;
    }
    setShares(listShares());
    setEvents(listAccessEvents());
  }, []);

  const refresh = useCallback(() => {
    setShares(listShares());
    setEvents(listAccessEvents());
  }, []);

  const handleConfirm = useCallback(
    (input: Parameters<typeof createShare>[0]) => {
      const result = createShare(input);
      if (result.ok) {
        // The recipient's first view is recorded at creation time in the
        // SYNTH stub world (honest label: fixture event).
        recordAccessEvent(
          result.share.id,
          "viewed",
          "2026-09-16T10:00:00.000Z",
          result.share.recipientLabel,
          result.share.scopeSummary,
        );
        setComposing(false);
        setNotice(`Share created: ${result.share.recipientLabel} can now access the scoped records.`);
        refresh();
      } else {
        setNotice("The share could not be created — check the contract steps.");
      }
    },
    [refresh],
  );

  const handleRevoke = useCallback(
    (shareId: string) => {
      const result = revokeShare(shareId, "2026-09-16T10:05:00.000Z");
      if (result.ok) {
        setNotice(`Access revoked for ${result.share.recipientLabel}. Future access stops immediately.`);
        refresh();
      }
    },
    [refresh],
  );

  return (
    <section data-testid="sharing-workspace" aria-labelledby="sharing-heading" className="space-y-4">
      <Card>
        <div id="sharing-heading">
          <Heading level={2}>Data shares &amp; access</Heading>
          <Text variant="muted">
            A share is a reviewable contract: recipient, purpose, exact data, window, terms,
            expiry — and revocation.
          </Text>
        </div>
        <p aria-live="polite" className="sr-only">
          {notice ?? `Sharing surface ready — ${shares.filter((s) => s.state === "active").length} contracts currently live.`}
        </p>
        {notice && (
          <span data-testid="sharing-notice" className="text-xs">
            {notice}
          </span>
        )}
        <div className="mt-4">
          {composing ? (
            <ShareComposer onConfirm={handleConfirm} onCancel={() => setComposing(false)} />
          ) : (
            <Button onClick={() => setComposing(true)} aria-label="Start creating a data share">
              Create a data share
            </Button>
          )}
        </div>
      </Card>

      <ActiveShares shares={shares} onRevoke={handleRevoke} />
      <AccessHistory events={events} />
      <AnswerOnlyPreview />
    </section>
  );
}
