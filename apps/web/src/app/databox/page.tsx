import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { DataboxJourney } from "@/components/databox/databox-journey";
import { DataboxControls } from "@/components/databox/databox-controls";
import { DataboxEvidence } from "@/components/databox/databox-evidence";
import { ConsentSection } from "@/components/databox/consent-section";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "DataBox",
};

/**
 * DataBox journey (M3-B, upgraded by M6-B B6): the §DataBox UX model —
 * TIMELINE PLUS COLLECTIONS as the default human-readable presentation
 * over the observation plane, with search and the four filters (time,
 * concept, source, confidence/quality), advanced inspection per entry
 * (raw evidence, metadata, provenance, model versions), and the honest
 * data-controls entry points (share/revoke wired to the existing consent
 * section; export/access-history labeled forthcoming — never faked).
 *
 * The M3-B evidence table + timeline stay mounted as the RAW-EVIDENCE
 * records layer (advanced inspection of the underlying objects), and the
 * "Share with clinician" consent flow stays the sharing contract.
 * Everything is synthetic (SYNTH) — no real medical data, no real
 * credentials, nothing leaves your DataBox.
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
      <DataboxJourney />
      <DataboxControls />
      <DataboxEvidence />
      <ConsentSection />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing leaves your DataBox.
      </p>
    </div>
  );
}
