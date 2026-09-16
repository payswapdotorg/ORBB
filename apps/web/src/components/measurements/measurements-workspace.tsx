"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MeasurementSummaryCard } from "./measurement-summary-card";
import { ManualCaptureFlow } from "./manual-capture-flow";
import { CaptureHistory } from "./capture-history";
import { ObservationDetail } from "@/components/observations/observation-detail";
import { observationViewFromCapture } from "@/lib/observations/fixtures";
import {
  isObservationListResponse,
  type CanonicalObservationDetailView,
  type ObservationDetailView,
} from "@/lib/observations/types";
import type {
  CaptureObservationDto,
  CaptureRecordDto,
} from "@/lib/capture/types";

/**
 * Measurements workspace (M4-B, extended by M6-B B5): composes the summary
 * card, the manual capture flow, the capture history, and the observation
 * PROVENANCE DETAIL on one surface.
 *
 * Owns the refresh signal (every successful capture submit increments it)
 * and the observation-detail selection:
 *   - from CAPTURE HISTORY — an in-session capture observation is adapted
 *     to the §Provenance UX detail view (pure adapter, no fake evidence);
 *   - from the DATABOX (and per-source links) — the `?observation=<id>`
 *     search parameter deep-links into the /api/observations store (the
 *     canonical reconciled view included, when the id is canonical).
 */

interface SelectedObservation {
  readonly view: ObservationDetailView;
  readonly canonical?: CanonicalObservationDetailView;
  readonly loading?: false;
}

export function MeasurementsWorkspace() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [selected, setSelected] = useState<SelectedObservation | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const requestedObservationId = searchParams.get("observation");

  /** Deep-link lookup: /measurements?observation=<id> (DataBox entry point). */
  const openRequestedObservation = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch("/api/observations");
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isObservationListResponse(payload)) {
        const board = payload;
        const canonical = board.canonical;
        if (canonical !== null && canonical.id === id) {
          setSelected({ view: canonical.detail, canonical });
          setDetailError(null);
          return;
        }
        const view = board.observations.find(
          (candidate) => candidate.id === id,
        );
        if (view !== undefined) {
          setSelected({ view, ...(canonical !== null ? { canonical } : {}) });
          setDetailError(null);
          return;
        }
        setDetailError(
          `No observation with id ${id} in the current session — it may have been recorded before this server session started.`,
        );
        return;
      }
      setDetailError("Could not load the observation: unexpected response.");
    } catch {
      setDetailError("Could not load the observation: network error.");
    }
  }, []);

  useEffect(() => {
    if (requestedObservationId !== null) {
      void openRequestedObservation(requestedObservationId);
    }
  }, [requestedObservationId, openRequestedObservation]);

  return (
    <div className="flex flex-col gap-6">
      <MeasurementSummaryCard />
      <ManualCaptureFlow
        onCaptured={() => {
          setRefreshToken((current) => current + 1);
        }}
      />
      <CaptureHistory
        refreshToken={refreshToken}
        onOpenObservation={(
          observation: CaptureObservationDto,
          record: CaptureRecordDto,
        ) => {
          setSelected({
            view: observationViewFromCapture(observation, record, new Date()),
          });
          setDetailError(null);
        }}
      />

      {/* The observation provenance detail (B5) — reachable from the
          capture history above and from the DataBox (?observation=). */}
      {detailError !== null ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {detailError}
        </p>
      ) : null}
      {selected !== null ? (
        <ObservationDetail
          view={selected.view}
          {...(selected.canonical !== undefined
            ? { canonical: selected.canonical }
            : {})}
          onOpenSource={(observationId) => {
            void openRequestedObservation(observationId);
          }}
          onClose={() => {
            setSelected(null);
            setDetailError(null);
          }}
        />
      ) : null}
    </div>
  );
}
