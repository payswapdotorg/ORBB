"use client";

import { useEffect, useState } from "react";
import { Heading, Text } from "@orbb/ui";
import { OnboardingJourney } from "@/components/onboarding/onboarding-journey";
import { PlaceholderPage } from "@/components/placeholder-page";
import {
  initialOnboardingDraft,
  isOnboardingComplete,
  loadOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding/model";

/**
 * Overview first-run gate (M6-A): the Overview surface renders the
 * onboarding journey until the first-run record completes, then the
 * standard overview content.
 *
 * Hydration safety: the server and the first client render agree on the
 * neutral "checking" state; the real decision (journey vs overview) lands
 * after mount, once localStorage is readable (the capture-flow
 * default-after-mount discipline — no wrong-content flash).
 */
export function OverviewFirstRun() {
  const [phase, setPhase] = useState<"checking" | "onboarding" | "overview">(
    "checking",
  );
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);

  useEffect(() => {
    const stored = loadOnboardingDraft();
    if (stored === undefined) {
      setDraft(initialOnboardingDraft());
      setPhase("onboarding");
      return;
    }
    setDraft(stored);
    setPhase(isOnboardingComplete(stored) ? "overview" : "onboarding");
  }, []);

  if (phase === "checking") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <p aria-live="polite" className="m-0 text-sm text-fg-muted">
          Loading your overview…
        </p>
      </div>
    );
  }

  if (phase === "onboarding" && draft !== null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Heading level={1}>Overview</Heading>
        <Text variant="muted">
          Your starting view across intents, today&apos;s measurements, and
          health signals.
        </Text>
        <div className="mt-4">
          <OnboardingJourney
            initialDraft={draft}
            onComplete={() => {
              setPhase("overview");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <PlaceholderPage
      title="Overview"
      description="Your starting view across intents, today's measurements, and health signals."
    />
  );
}
