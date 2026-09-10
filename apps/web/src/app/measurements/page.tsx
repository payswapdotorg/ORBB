import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Measurements",
};

export default function MeasurementsPage() {
  return (
    <PlaceholderPage
      title="Measurements"
      description="Measurement tasks, methods, and captured observations."
    />
  );
}
