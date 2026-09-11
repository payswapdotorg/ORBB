import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { MeasurementCaptureForm } from "@/components/measurements/measurement-capture-form";
import { MeasurementSummaryCard } from "@/components/measurements/measurement-summary-card";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Measurements",
};

/**
 * Measurements surface (M3-B): the M0 placeholder is now a real surface —
 * the measurement summary card (Sparkline + BarChart over synthetic data)
 * and the "Record a measurement" capture form (`ValueInput` +
 * `MethodPicker` + `DueWindow` behind `FieldWrapper` wiring) submitting to
 * the local route-handler stub. Everything is synthetic (SYNTH).
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
      <MeasurementSummaryCard />
      <MeasurementCaptureForm />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing is persisted.
      </p>
    </div>
  );
}
