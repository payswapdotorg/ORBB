"use client";

import { useState } from "react";
import { Button, Card, DueWindow, Heading, Text } from "@orbb/ui";
import {
  isObservationErrorEnvelope,
  isObservationImportResponse,
  type ReconciledObservationView,
} from "@/lib/observations/types";
import { ReconciledViewCard } from "./observation-detail";

/**
 * Device sources card (M6-B B5, golden journey #2's entry): the registered
 * measurement sources of the SYNTH session — manual (active since M4-B)
 * and the SYNTH-Device-A wearable adapter — with the IMPORT act.
 *
 * Importing SYNTH-Device-A's latest resting-heart-rate sample creates an
 * IMPORTED observation (unit-normalized at the M4-C seam, raw sample
 * retained as evidence). When a duplicate manual source exists in today's
 * window, the import RECONCILES the two sources into one canonical view
 * with per-source provenance (the M4 mirror) — nothing is discarded.
 *
 * Honesty contract: the reconciliation report and the no-reconciliation
 * note both render verbatim from the store's response; nothing is faked.
 */

export interface DeviceSourcesCardProps {
  /** Opens an observation's full provenance detail (host's decision). */
  readonly onOpenObservation: (observationId: string) => void;
  /** Fired after an import lands (drives list refreshes). */
  readonly onImported?: () => void;
}

export function DeviceSourcesCard({ onOpenObservation, onImported }: DeviceSourcesCardProps) {
  const [phase, setPhase] = useState<"idle" | "importing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ReconciledObservationView | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function importLatest(): Promise<void> {
    if (phase === "importing") {
      return;
    }
    setPhase("importing");
    setError(null);
    try {
      const response = await fetch("/api/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import-device" }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isObservationImportResponse(payload)) {
        setImportedId(payload.observation.observationId);
        setReconciled(payload.reconciled);
        setNote(payload.reconciliationNote);
        onImported?.();
      } else if (!response.ok && isObservationErrorEnvelope(payload)) {
        setError(`Could not import the device sample: ${payload.error.message}`);
      } else {
        setError("Could not import the device sample: unexpected response.");
      }
    } catch {
      setError("Could not import the device sample: network error.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div data-device-sources="true">
      <Card>
        <Heading level={2}>Device sources</Heading>
      <Text variant="muted">
        Registered measurement sources of this synthetic session — and the
        device-import journey: import a wearable sample, and duplicate
        sources reconcile into one canonical value with per-source
        provenance.
      </Text>

      <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
        <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">SYNTH-Device-A (registered wearable)</span>
            <span className="text-xs text-fg-muted">
              {`src_SYNTH-source-device-a · heart rate (resting) · latest sample: 1.03 beats/s → 62 beats/min after unit normalization`}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <DueWindow tone="success">Registered</DueWindow>
            <Button
              onClick={() => {
                void importLatest();
              }}
              disabled={phase === "importing"}
            >
              {phase === "importing" ? "Importing…" : "Import latest sample"}
            </Button>
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Manual entry (this device)</span>
            <span className="text-xs text-fg-muted">
              src_SYNTH-source-manual · the M4-B manual capture journey
            </span>
          </span>
          <DueWindow tone="success">Registered</DueWindow>
        </li>
      </ul>

      <div aria-live="polite" role="status" className="mt-3">
        {error !== null ? <p className="m-0 text-sm text-danger">{error}</p> : null}
        {note !== null ? <p className="m-0 text-sm text-fg-muted">{note}</p> : null}
        {importedId !== null && note === null ? (
          <p className="m-0 text-sm text-fg-muted">Sample imported.</p>
        ) : null}
      </div>

      {importedId !== null ? (
        <div className="mt-3">
          <Button
            variant="secondary"
            aria-label="Inspect the imported observation's provenance"
            onClick={() => {
              onOpenObservation(importedId);
            }}
          >
            Inspect the imported observation&apos;s provenance
          </Button>
        </div>
      ) : null}

      {reconciled !== null ? (
        <div className="mt-4">
          <ReconciledViewCard
            view={reconciled}
            onOpenSource={(observationId) => {
              onOpenObservation(observationId);
            }}
          />
        </div>
      ) : null}
      </Card>
    </div>
  );
}
