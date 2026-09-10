import { Card, Heading, Text } from "@orbb/ui";

export interface PlaceholderPageProps {
  /** Page title (rendered as the h1). */
  title: string;
  /** One-line synthetic description of the future surface (placeholder copy). */
  description: string;
}

/**
 * Token-styled M0 placeholder for every web surface.
 *
 * Renders the shared "Coming in M6+" notice using `@orbb/ui` primitives —
 * no invented domain features, no fake data beyond the synthetic placeholder
 * string.
 */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <Heading level={1}>{title}</Heading>
      <Text variant="muted">{description}</Text>

      <Card>
        <Heading level={2}>Coming in M6+</Heading>
        <Text>
          This is a synthetic placeholder screen. ORBB builds this surface in a
          later milestone — nothing here reads or writes real medical data, and
          no real credentials are used.
        </Text>
        <Text variant="small">
          The shell exists so user-mode journeys (Playwright on web, Maestro on
          mobile) have a stable surface to run against.
        </Text>
      </Card>
    </div>
  );
}
