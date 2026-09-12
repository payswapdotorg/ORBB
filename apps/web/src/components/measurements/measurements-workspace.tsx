"use client";

import { useState } from "react";
import { MeasurementSummaryCard } from "./measurement-summary-card";
import { ManualCaptureFlow } from "./manual-capture-flow";
import { CaptureHistory } from "./capture-history";

/**
 * Measurements workspace (M4-B): client wrapper composing the summary
 * card, the manual capture flow, and the capture history on one surface.
 *
 * Owns the refresh signal: every successful capture submit increments it,
 * so the history re-reads the same in-memory store through the API route
 * (single source of truth — the flow writes, the history reads, neither
 * duplicates the other's state).
 */
export function MeasurementsWorkspace() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <MeasurementSummaryCard />
      <ManualCaptureFlow
        onCaptured={() => {
          setRefreshToken((current) => current + 1);
        }}
      />
      <CaptureHistory refreshToken={refreshToken} />
    </div>
  );
}
