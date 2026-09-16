"use client";

/**
 * Access-history audit view (M6-C B7, Lane B) — the §DataBox UX "view
 * access history" surface: a chronological list of access events (time +
 * actor + scope) across all shares. This is the golden journey #4
 * audit-log leg.
 */

import { Card, Heading, Text } from "@orbb/ui";
import type { AccessAuditEventView } from "@/lib/sharing/types";

export interface AccessHistoryProps {
  readonly events: readonly AccessAuditEventView[];
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  viewed: "Viewed",
  exported: "Exported",
  revoked: "Access revoked",
};

export function AccessHistory({ events }: AccessHistoryProps) {
  return (
    <div data-testid="access-history">
    <Card>
      <Heading level={2}>Access history</Heading>
      <Text variant="muted">
        Every time a shared record was viewed, exported, or a share was revoked.
      </Text>
      {events.length === 0 ? (
        <Text variant="muted">
          No access events yet.
        </Text>
      ) : (
        <ol className="mt-4 space-y-2" data-testid="access-history-list">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`access-event-${event.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border p-3"
            >
              <span>
                <Text>{KIND_LABELS[event.kind] ?? event.kind}</Text>
                <Text variant="muted">
                  {event.actorLabel} · {event.scopeSummary}
                </Text>
              </span>
              <time dateTime={event.atIso} className="text-xs text-muted">
                {event.atIso.slice(0, 16).replace("T", " ")} UTC
              </time>
            </li>
          ))}
        </ol>
      )}
      </Card>
    </div>
  );
}
