import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Marketplace",
};

export default function MarketplacePage() {
  return (
    <PlaceholderPage
      title="Marketplace"
      description="Measurement services, equipment, and extensions."
    />
  );
}
