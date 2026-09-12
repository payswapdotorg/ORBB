import type { Metadata } from "next";
import { OverviewFirstRun } from "@/components/onboarding/overview-first-run";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * Overview surface (M6-A): first-run users land in the onboarding journey
 * (welcome, persona, metric interests, source summary, completion —
 * persisted in local storage, resumable); completed first-runs see the
 * standard overview placeholder. The decision is client-side after mount
 * (local storage is not readable during SSR), with a hydration-safe
 * neutral initial state.
 */
export default function OverviewPage() {
  return <OverviewFirstRun />;
}
