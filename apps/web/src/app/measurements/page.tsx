import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { MeasurementsWorkspace } from "@/components/measurements/measurements-workspace";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Measurements",
};

/**
 * Measurements surface (M4-B): the manual capture journey is now
 * first-class — a three-step "Record a measurement" flow (metric → method
 * → values/context → review with quality self-assessment → submit to the
 * `/api/capture` route stub with an in-memory store) plus the recent
 * manual-observations history (table + timeline) reading the same store.
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
      <MeasurementsWorkspace />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing is persisted.
      </p>
    </div>
  );
}
