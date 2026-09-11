import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Care",
};

/**
 * Care surface (M3-B): the screen itself remains an M6+ placeholder, but
 * it is one of the Clinician-emphasized surfaces — the role-emphasis
 * live-region notice mounts here so the emphasis model is integrated on
 * every surface the packet deepens.
 */
export default function CarePage() {
  return (
    <PlaceholderPage
      title="Care"
      description="Care team coordination, shared data, and clinical workflows."
      preface={<RoleSurfaceNotice surface="care" />}
    />
  );
}
