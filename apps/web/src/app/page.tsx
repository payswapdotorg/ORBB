import type { Metadata } from "next";
import { OverviewFirstRun } from "@/components/onboarding/overview-first-run";

export const metadata: Metadata = {
  title: "Today",
};

/**
 * Overview surface (M6-A gate + M6-B B4): first-run users land in the
 * onboarding journey (welcome, persona, metric interests, source summary,
 * completion — persisted in local storage, resumable); completed first-runs
 * see the intent-driven TODAY surface (what you're trying to accomplish,
 * what's due, why, and the easiest valid way to complete it — the frozen
 * navigation model; not a dashboard of charts). The decision is
 * client-side after mount (local storage is not readable during SSR), with
 * a hydration-safe neutral initial state.
 */
export default function OverviewPage() {
  return <OverviewFirstRun />;
}
