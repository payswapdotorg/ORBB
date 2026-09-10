import type { Metadata } from "next";
import type { ReactNode } from "react";
import { tokensToCssCustomProperties } from "@orbb/ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ORBB",
    template: "%s · ORBB",
  },
  description:
    "ORBB web shell (M0) — synthetic placeholder surface for the Personal Health Operating System. No real medical data.",
};

/**
 * Root layout.
 *
 * PROOF OF TOKEN CONSUMPTION: `tokensToCssCustomProperties()` from `@orbb/ui`
 * generates every `--orbb-*` custom property from the token package at
 * build/render time; `globals.css` maps them into Tailwind theme utilities
 * (`bg-canvas`, `text-fg`, ...). The values are static token strings — never
 * user input — so injecting them via `dangerouslySetInnerHTML` is safe.
 *
 * Accessibility foundations: `lang`, semantic landmarks (header/nav/main/
 * footer), a skip link to the main landmark, and a `tabIndex={-1}` target so
 * the skip link moves programmatic focus, not just scroll position.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-fg antialiased">
        <style
          id="orbb-design-tokens"
          dangerouslySetInnerHTML={{ __html: tokensToCssCustomProperties() }}
        />
        <a className="skip-link rounded-card bg-surface px-4 py-2 text-body font-medium text-accent shadow-lg" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
