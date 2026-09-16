"use client";

import { useEffect, useState } from "react";
import { Heading, Text } from "@orbb/ui";
import { OnboardingJourney } from "@/components/onboarding/onboarding-journey";
import { TodaySurface } from "@/components/today/today-surface";
import {
  initialOnboardingDraft,
  isOnboardingComplete,
  loadOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding/model";

/**
 * Overview first-run gate (M6-A, upgraded by M6-B B4): the `/` surface
 * renders the first-run onboarding journey until the record completes,
 * then the surface BECOMES the intent-driven Today surface (the frozen
 * navigation model — NOT a dashboard of charts).
 *
 * Hydration safety: the server and the first client render agree on the
 * neutral "checking" state; the real decision (journey vs Today) lands
 * after mount, once localStorage is readable (the capture-flow
 * default-after-mount discipline — no wrong-content flash).
 */
export function OverviewFirstRun() {
  const [phase, setPhase] = useState<"checking" | "onboarding" | "today">(
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
    setPhase(isOnboardingComplete(stored) ? "today" : "onboarding");
  }, []);

  if (phase === "checking") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <p aria-live="polite" className="m-0 text-sm text-fg-muted">
          Loading your today surface…
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
              setPhase("today");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <Heading level={1}>Today</Heading>
      <Text variant="muted">
        What you&apos;re trying to accomplish, what matters today, and the
        easiest valid way to complete it.
      </Text>
      <div className="mt-4">
        <TodaySurface />
      </div>
    </div>
  );
}
