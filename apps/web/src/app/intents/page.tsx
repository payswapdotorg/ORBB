import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Intents",
};

export default function IntentsPage() {
  return (
    <PlaceholderPage
      title="Intents"
      description="Health outcomes you are working toward, and the plans that serve them."
    />
  );
}
