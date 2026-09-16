"use client";

import { Card, Heading, Text } from "@orbb/ui";
import { SYNTHETIC_CLINIC_SHARE } from "@/lib/synthetic-data";

/**
 * DataBox controls (M6-B B6): the §DataBox UX entry points — export,
 * share, revoke access, view access history.
 *
 * Honesty contract (the packet): entries that have no real behavior yet
 * are labeled FORTHCOMING and render inert (no fake success, ever). Share
 * and revoke are wired to the EXISTING M3-B consent-section flow (the
 * ConsentSheet "Share with clinician" journey below on this page): the
 * entries anchor to it. The full sharing-contract UX (B7) is the NEXT
 * wave — these entries say so.
 */

interface ControlEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: "wired" | "forthcoming";
}

const ENTRIES: readonly ControlEntry[] = [
  {
    key: "share",
    label: "Share with clinician",
    description: `Opens the existing sharing review below — a scoped, reviewable contract with ${SYNTHETIC_CLINIC_SHARE.recipientName}.`,
    kind: "wired",
  },
  {
    key: "revoke",
    label: "Revoke access",
    description:
      "Review or end an existing share below — revocation is immediate, from the same consent sheet.",
    kind: "wired",
  },
  {
    key: "export",
    label: "Export your data",
    description:
      "Forthcoming — exports are not built yet. When they arrive, they will carry provenance and checksums.",
    kind: "forthcoming",
  },
  {
    key: "access-history",
    label: "View access history",
    description:
      "Forthcoming — the access audit log is not surfaced yet. Every access is already recorded immutably at the data layer.",
    kind: "forthcoming",
  },
];

export function DataboxControls() {
  return (
    <div data-databox-controls="true">
      <Card>
      <Heading level={2}>Data controls</Heading>
      <Text variant="muted">
        Entry points for moving data in and out of your DataBox — and for
        seeing who has accessed it.
      </Text>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {ENTRIES.map((entry) => (
          <li
            key={entry.key}
            data-control-entry={entry.key}
            data-control-state={entry.kind}
            className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface px-4 py-3"
          >
            {entry.kind === "wired" ? (
              <a
                href="#sharing"
                className="min-h-[44px] text-body font-medium text-accent underline decoration-accent decoration-2 underline-offset-4"
              >
                {entry.label}
              </a>
            ) : (
              <span className="flex min-h-[44px] items-center gap-2 text-body font-medium text-fg-muted">
                {entry.label}
                <span className="rounded-card border border-border-subtle bg-canvas px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  forthcoming
                </span>
              </span>
            )}
            <span className="text-sm text-fg-muted">{entry.description}</span>
          </li>
        ))}
      </ul>
      <Text variant="small">
        The full sharing-contract experience (scoped requests, answer-only
        queries, compensation) arrives with the next wave (B7) — nothing on
        this card pretends it exists today.
      </Text>
      </Card>
    </div>
  );
}
