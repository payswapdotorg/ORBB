import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Care",
};

export default function CarePage() {
  return (
    <PlaceholderPage
      title="Care"
      description="Clinical surfaces for care teams working with shared patient data."
    />
  );
}
