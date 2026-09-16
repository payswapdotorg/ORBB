import type { Metadata } from "next";
import { Heading, Text } from "@orbb/ui";
import { ConsentSettingsWorkspace } from "@/components/settings/consent-settings-workspace";
import { RoleSurfaceNotice } from "@/components/role-surface-notice";

export const metadata: Metadata = {
  title: "Consent settings",
};

/**
 * Consent settings (M6-C B9, Lane B): the dedicated consent-posture
 * surface — active shares aggregation, measurement-source consents
 * (deny-by-default), notification preferences (channels + quiet hours,
 * mirroring the @orbb/notifications preference-profile shape), DataBox
 * access defaults, and the never-silent change audit. Everything is
 * synthetic (SYNTH).
 */
export default function ConsentSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <Heading level={1}>Consent settings</Heading>
        <Text variant="muted">
          Your consent posture — every control states what it changes.
        </Text>
      </div>
      <RoleSurfaceNotice surface="settings" />
      <ConsentSettingsWorkspace />
      <p className="m-0 text-xs text-fg-muted">
        Everything on this screen is synthetic (SYNTH) — no real medical
        data, no real credentials.
      </p>
    </div>
  );
}
