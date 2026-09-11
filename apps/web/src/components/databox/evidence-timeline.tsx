import { Timeline } from "@orbb/ui";
import { buildSyntheticTimelineEntries } from "@/lib/synthetic-data";

/**
 * Evidence timeline view (M3-B): the DataBox timeline.
 *
 * The `@orbb/ui` `Timeline` component renders the merged synthetic
 * observation/evidence entries — most recent first, sectioned by day
 * headers (the component's own `group` contract) and badged with the
 * validation state. Entry derivation lives in the pure
 * `buildSyntheticTimelineEntries` fixture function; this component only
 * maps data onto the primitive.
 */
export function EvidenceTimeline() {
  return <Timeline entries={buildSyntheticTimelineEntries()} />;
}
