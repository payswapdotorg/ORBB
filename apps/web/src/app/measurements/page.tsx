import type { Metadata } from "next";
import { Suspense } from "react";
import { Heading, Text } from "@orbb/ui";
import { MeasurementsWorkspace } from "@/components/measurements/measurements-workspace";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Measurements",
};

/**
 * Measurements surface (M4-B, extended by M6-B B5): the manual capture
 * journey is first-class — a three-step "Record a measurement" flow
 * (metric → method → values/context → review with quality self-assessment
 * → submit to the `/api/capture` route stub with an in-memory store) plus
 * the recent manual-observations history (table + timeline) reading the
 * same store, plus the observation PROVENANCE DETAIL (B5) reachable from
 * the capture history and deep-linked from the DataBox
 * (`?observation=<id>` — the workspace reads the search param inside a
 * Suspense boundary, keeping the route statically prerenderable).
 * The measurement summary card (Sparkline + BarChart over synthetic data)
 * stays from M3-B. Everything is synthetic (SYNTH).
 */
export default function MeasurementsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <Heading level={1}>Measurements</Heading>
        <Text variant="muted">
          Measurement tasks, methods, and captured observations.
        </Text>
      </div>
      <RoleSurfaceNotice surface="measurements" />
      <Suspense
        fallback={
          <p aria-live="polite" className="m-0 text-sm text-fg-muted">
            Loading the measurements surface…
          </p>
        }
      >
        <MeasurementsWorkspace />
      </Suspense>
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing is persisted.
      </p>
    </div>
  );
}
