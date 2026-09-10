import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "DataBox",
};

export default function DataboxPage() {
  return (
    <PlaceholderPage
      title="DataBox"
      description="Your personal health evidence store with provenance and sharing controls."
    />
  );
}
