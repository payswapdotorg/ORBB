import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { DataboxEvidence } from "@/components/databox/databox-evidence";
import { ConsentSection } from "@/components/databox/consent-section";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "DataBox",
};

/**
 * DataBox journey (M3-B): the M0 placeholder is now a real surface mounted
 * on the `@orbb/ui` design system — evidence list (sortable table with
 * disclosure metadata rows) + timeline view, and the "Share with
 * clinician" consent flow. Everything is synthetic (SYNTH) — no real
 * medical data, no backend calls beyond the local route-handler stub.
 */
export default function DataboxPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <Heading level={1}>DataBox</Heading>
        <Text variant="muted">
          Your personal health evidence store with provenance and sharing
          controls.
        </Text>
      </div>
      <RoleSurfaceNotice surface="databox" />
      <DataboxEvidence />
      <ConsentSection />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing leaves your DataBox.
      </p>
    </div>
  );
}
