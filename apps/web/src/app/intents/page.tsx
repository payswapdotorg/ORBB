import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { IntentsWorkspace } from "@/components/intents/intents-workspace";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Intents",
};

/**
 * Intents surface (M6-A): the consumer intent journey is first-class —
 * a guided composer (goal + constraints against the evidence pack), the
 * candidate plan review screen (explainability audit trail, burden,
 * safety badges, approve-with-edits / reject through the /api/plans stub),
 * and the published plan store view. Everything is synthetic (SYNTH) —
 * in-memory stores behind typed route stubs, no real data.
 */
export default function IntentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <Heading level={1}>Intents</Heading>
        <Text variant="muted">
          Health outcomes you are working toward, and the plans that serve
          them.
        </Text>
      </div>
      <RoleSurfaceNotice surface="intents" />
      <IntentsWorkspace />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials; stores are in-memory route stubs and
        nothing is persisted.
      </p>
    </div>
  );
}
