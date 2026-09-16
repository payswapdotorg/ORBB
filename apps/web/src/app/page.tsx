import type { Metadata } from "next";
import { OverviewFirstRun } from "@/components/onboarding/overview-first-run";

export const metadata: Metadata = {
  title: "Today",
};

/**
 * Overview surface (M6-A onboarding + M6-B B4 Today): first-run users land
 * in the onboarding journey (welcome, persona, metric interests, source
 * summary, completion — persisted in local storage, resumable); completed
 * first-runs see the INTENT-DRIVEN TODAY surface — active intents with
 * progress, measurement task cards (§Measurement task UX), and the
 * completion route into the M4-B manual-capture flow. The web nav item
 * stays "Overview" (the frozen web navigation model); the surface itself
 * IS the Today experience per the architecture's §Navigation model.
 * The decision is client-side after mount (local storage is not readable
 * during SSR), with a hydration-safe neutral initial state.
 */
export default function OverviewPage() {
  return <OverviewFirstRun />;
}
