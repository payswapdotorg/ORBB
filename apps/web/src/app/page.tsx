import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Overview",
};

export default function OverviewPage() {
  return (
    <PlaceholderPage
      title="Overview"
      description="Your starting view across intents, today's measurements, and health signals."
    />
  );
}
