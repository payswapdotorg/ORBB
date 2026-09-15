"use client";

import { useEffect, useState } from "react";
import { MeasurementSummaryCard } from "./measurement-summary-card";
import { ManualCaptureFlow } from "./manual-capture-flow";
import { CaptureHistory } from "./capture-history";
import { DeviceSourcesCard } from "./device-sources-card";
import { ObservationDetail } from "./observation-detail";

/**
 * Measurements workspace (M4-B, extended by M6-B B5): client wrapper
 * composing the summary card, the manual capture flow, the capture
 * history, the device-sources import journey, and the observation
 * provenance detail.
 *
 * Owns two signals:
 * - the capture refresh token: every successful capture submit increments
 *   it, so the history re-reads the same in-memory store through the API
 *   route (single source of truth);
 * - the SELECTED OBSERVATION: capture-history rows, the Today surface's
 *   completed-task link, the DataBox observation entries, and the
 *   reconciled per-source links all open the provenance detail here.
 *   Deep links (`/measurements?observation=<id>`, e.g. from the DataBox)
 *   are honored AFTER MOUNT (window.location.search is not readable
 *   during SSR — the same hydration-safe discipline as the onboarding
 *   draft; no wrong-content flash).
 */

export function MeasurementsWorkspace() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);

  useEffect(() => {
    // Deep-link affordance (B5: reachable from the DataBox): read the
    // observation param once after mount.
    const params = new URLSearchParams(window.location.search);
    const observation = params.get("observation");
    if (observation !== null && observation !== "") {
      setSelectedObservationId(observation);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <MeasurementSummaryCard />
      <ManualCaptureFlow
        onCaptured={() => {
          setRefreshToken((current) => current + 1);
        }}
      />
      <DeviceSourcesCard
        onOpenObservation={(observationId) => {
          setSelectedObservationId(observationId);
        }}
        onImported={() => {
          setRefreshToken((current) => current + 1);
        }}
      />
      <CaptureHistory
        refreshToken={refreshToken}
        onOpenObservation={(observationId) => {
          setSelectedObservationId(observationId);
        }}
      />
      {selectedObservationId !== null ? (
        <div id="observation-detail">
          <ObservationDetail
            observationId={selectedObservationId}
            onClose={() => {
              setSelectedObservationId(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
