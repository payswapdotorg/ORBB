"use client";

import { useState } from "react";
import { Button, Card, Heading, Text } from "@orbb/ui";
import { EvidenceTable } from "./evidence-table";
import { EvidenceTimeline } from "./evidence-timeline";

type EvidenceView = "list" | "timeline";

const VIEW_LABEL: Readonly<Record<EvidenceView, string>> = {
  list: "Evidence list",
  timeline: "Timeline",
};

/**
 * DataBox evidence card (M3-B): the DataBox "timeline plus collections"
 * presentation from the frozen UI/UX architecture, with a view toggle
 * between the sortable evidence table and the day-grouped timeline.
 *
 * Accessibility:
 * - the toggle is a real button group (`role="group"` + `aria-pressed`)
 *   with 44px touch targets from the `Button` primitive;
 * - view changes are announced through a pre-existing
 *   `aria-live="polite"` region (polite regions are preserved — never
 *   assertive) so screen readers hear "Showing the evidence timeline.";
 * - only one view renders at a time; the inactive view's content leaves
 *   the DOM entirely (predictable screen-reader behavior).
 */
export function DataboxEvidence() {
  const [view, setView] = useState<EvidenceView>("list");

  return (
    <Card padding="none">
      <div className="flex flex-col gap-3 p-4">
        <Heading level={2}>Evidence</Heading>
        <Text variant="muted">
          Synthetic evidence and observations captured into your DataBox,
          with provenance details on every row.
        </Text>
        <div
          role="group"
          aria-label="Evidence view"
          className="flex flex-wrap gap-2"
        >
          {(["list", "timeline"] as const).map((candidate) => (
            <Button
              key={candidate}
              variant="secondary"
              aria-pressed={view === candidate}
              onClick={() => {
                setView(candidate);
              }}
            >
              {VIEW_LABEL[candidate]}
            </Button>
          ))}
        </div>
        <p aria-live="polite" className="m-0 text-sm text-fg-muted">
          {view === "list"
            ? "Showing the evidence list."
            : "Showing the evidence timeline."}
        </p>
      </div>
      {view === "list" ? (
        <EvidenceTable />
      ) : (
        <div className="px-4 pb-4">
          <EvidenceTimeline />
        </div>
      )}
    </Card>
  );
}
