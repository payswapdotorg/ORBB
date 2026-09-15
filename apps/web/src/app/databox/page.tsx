import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { DataboxWorkspace } from "@/components/databox/databox-workspace";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "DataBox",
};

/**
 * DataBox journey (M3-B, upgraded by M6-B B6): the §DataBox UX model — a
 * timeline plus collections as the DEFAULT human-readable presentation,
 * search and the four filters (time, metric, source, quality), the
 * advanced inspection affordance (raw evidence, metadata, provenance,
 * model versions — the extended M3-B disclosure pattern), the honest
 * entry points for export/share/revoke/access-history (share + revoke
 * wired to the existing ConsentSheet reviewable contract), and the B5
 * provenance-detail links for observation entries. Everything is
 * synthetic (SYNTH) — the pinned M3-B reference corpus.
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
      <DataboxWorkspace />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials, nothing leaves your DataBox.
      </p>
    </div>
  );
}
