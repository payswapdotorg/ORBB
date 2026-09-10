import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Research",
};

export default function ResearchPage() {
  return (
    <PlaceholderPage
      title="Research"
      description="Studies, cohorts, protocols, and governed data requests."
    />
  );
}
