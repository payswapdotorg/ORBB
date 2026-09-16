import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  DATABOX_QUALITY_OPTIONS,
  DATABOX_SOURCE_OPTIONS,
  DATABOX_TIME_OPTIONS,
  buildCollections,
  buildDataboxEntries,
  countActiveFilters,
  databoxConceptOptions,
  filterDataboxEntries,
  initialDataboxFilters,
  toTimelineGroups,
  type DataboxFilterOption,
  type DataboxFilters,
} from "../lib/databox/model";
import { corpusObservationDetail, type ObservationDetailView } from "../lib/observations/model";
import { ObservationDetailScreen } from "./observation-detail-screen";
import { SharingScreen } from "./sharing-screen";

/**
 * DataBox surface (M6-B B6, mobile): the real DataBox-tab content that
 * replaces the placeholder — the pinned SYNTH reference corpus (12 entries)
 * as a TIMELINE (default) or COLLECTIONS, with free-text search and the
 * four filters (time, concept/metric, source, confidence/quality).
 *
 * Mobile control choice (recorded): instead of four dropdown selects (a web
 * form control), each filter is ONE 44px cycling button labeled
 * "Time: All time" etc. that steps through its frozen option list — the
 * smallest robust RN control with no new dependencies. The visible label
 * and the accessibility label ("Filter by time, currently …") always carry
 * the CURRENT value; every state is text.
 *
 * Provenance inspection: observation entries expose a "View provenance"
 * button that opens the B5 observation-detail overlay (the corpus details
 * from the observations model); evidence entries have no detail screen
 * (the row itself is the summary — honestly labeled).
 *
 * Accessibility contract: the search input and every control keep the 44px
 * minimum target; view toggle uses accessibilityRole="tab" with
 * accessibilityState selected; result-count changes are announced through
 * a polite live region; the empty state is explicit text.
 */

/** The pinned corpus (pure fixture data — the reference world). */
const CORPUS_ENTRIES = buildDataboxEntries();

type DataboxViewMode = "timeline" | "collections";

/** Cycles a filter through its option list (wrap-around, pure). */
function cycleOption(options: readonly DataboxFilterOption[], current: string): string {
  const index = options.findIndex((option) => option.value === current);
  if (index < 0 || index >= options.length - 1) {
    return options[0]?.value ?? "all";
  }
  const next = options[index + 1];
  return next?.value ?? (options[0]?.value ?? "all");
}

export function DataboxScreen() {
  const [filters, setFilters] = useState<DataboxFilters>(initialDataboxFilters());
  const [showSharing, setShowSharing] = useState(false);
  const [view, setView] = useState<DataboxViewMode>("timeline");
  const [detail, setDetail] = useState<ObservationDetailView | null>(null);

  const entries = filterDataboxEntries(CORPUS_ENTRIES, filters);
  const activeFilters = countActiveFilters(filters);
  const countLine =
    activeFilters === 0
      ? `${entries.length} of ${CORPUS_ENTRIES.length} entries shown.`
      : `${entries.length} of ${CORPUS_ENTRIES.length} entries — ${activeFilters} filter${
          activeFilters === 1 ? "" : "s"
        } active.`;
  const conceptOptions = databoxConceptOptions(CORPUS_ENTRIES);

  const timeOption = DATABOX_TIME_OPTIONS.find((option) => option.value === filters.time);
  const conceptOption = conceptOptions.find((option) => option.value === filters.concept);
  const sourceOption = DATABOX_SOURCE_OPTIONS.find((option) => option.value === filters.source);
  const qualityOption = DATABOX_QUALITY_OPTIONS.find((option) => option.value === filters.quality);

  const timeline = toTimelineGroups(entries);
  const collections = buildCollections(entries);

  if (showSharing) {
    return <SharingScreen onBack={() => setShowSharing(false)} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <Text accessibilityRole="header" style={styles.title}>
          DataBox
        </Text>
        <Text style={styles.intro}>
          Your personal health evidence store — every entry keeps its provenance.
        </Text>

        <Pressable
          accessibilityLabel="Open sharing"
          accessibilityRole="button"
          onPress={() => setShowSharing(true)}
          style={styles.sharingEntry}
        >
          <Text style={styles.sharingEntryLabel}>
            Sharing — review contracts, revoke access, see the audit trail
          </Text>
        </Pressable>

        <TextInput
          accessibilityLabel="Search your DataBox"
          placeholder="Search"
          placeholderTextColor={color.fgSubtle}
          value={filters.search}
          onChangeText={(next) => {
            setFilters((current) => ({ ...current, search: next }));
          }}
          style={styles.searchInput}
        />

        <View style={styles.filterRow}>
          <FilterButton
            label={`Time: ${timeOption?.label ?? filters.time}`}
            accessibilityLabel={`Filter by time, currently ${timeOption?.label ?? filters.time}`}
            onPress={() => {
              setFilters((current) => ({
                ...current,
                time: cycleOption(DATABOX_TIME_OPTIONS, current.time) as DataboxFilters["time"],
              }));
            }}
          />
          <FilterButton
            label={`Metric: ${conceptOption?.label ?? filters.concept}`}
            accessibilityLabel={`Filter by metric, currently ${conceptOption?.label ?? filters.concept}`}
            onPress={() => {
              setFilters((current) => ({
                ...current,
                concept: cycleOption(conceptOptions, current.concept),
              }));
            }}
          />
          <FilterButton
            label={`Source: ${sourceOption?.label ?? filters.source}`}
            accessibilityLabel={`Filter by source, currently ${sourceOption?.label ?? filters.source}`}
            onPress={() => {
              setFilters((current) => ({
                ...current,
                source: cycleOption(DATABOX_SOURCE_OPTIONS, current.source),
              }));
            }}
          />
          <FilterButton
            label={`Quality: ${qualityOption?.label ?? filters.quality}`}
            accessibilityLabel={`Filter by quality, currently ${qualityOption?.label ?? filters.quality}`}
            onPress={() => {
              setFilters((current) => ({
                ...current,
                quality: cycleOption(DATABOX_QUALITY_OPTIONS, current.quality),
              }));
            }}
          />
        </View>

        <Text accessibilityLiveRegion="polite" style={styles.countLine}>
          {countLine}
        </Text>

        <View style={styles.viewToggle} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Timeline view"
            accessibilityState={{ selected: view === "timeline" }}
            onPress={() => {
              setView("timeline");
            }}
            style={[styles.toggleButton, view === "timeline" ? styles.toggleSelected : null]}
          >
            <Text style={view === "timeline" ? styles.toggleTextSelected : styles.toggleText}>
              Timeline
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Collections view"
            accessibilityState={{ selected: view === "collections" }}
            onPress={() => {
              setView("collections");
            }}
            style={[styles.toggleButton, view === "collections" ? styles.toggleSelected : null]}
          >
            <Text style={view === "collections" ? styles.toggleTextSelected : styles.toggleText}>
              Collections
            </Text>
          </Pressable>
        </View>

        {entries.length === 0 ? (
          <Text style={styles.emptyState}>
            No entries match the current search and filters.
          </Text>
        ) : view === "timeline" ? (
          <View style={styles.timeline}>
            {timeline.map((group) => (
              <View key={group.dayLabel} style={styles.dayGroup}>
                <Text accessibilityRole="header" style={styles.groupLabel}>
                  {group.dayLabel}
                </Text>
                {group.entries.map((row) => {
                  const observationId = row.entry.observationId;
                  return (
                    <View
                      key={row.entry.id}
                      accessibilityLabel={
                        `${row.entry.atLabel}, ${row.entry.title}, ${row.badge}, ${row.entry.subtitle}` +
                        (observationId !== undefined ? ", provenance detail available." : "")
                      }
                      style={styles.entryRow}
                    >
                      <View style={styles.entryHeader}>
                        <Text style={styles.entryAt}>{row.entry.atLabel}</Text>
                        <Text
                          style={
                            row.entry.status === "validated"
                              ? styles.badgeValidated
                              : row.entry.status === "pending"
                                ? styles.badgePending
                                : styles.badgeSuperseded
                          }
                        >
                          {row.badge}
                        </Text>
                      </View>
                      <Text style={styles.entryTitle}>{row.entry.title}</Text>
                      <Text style={styles.entrySubtitle}>{row.entry.subtitle}</Text>
                      {observationId !== undefined ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`View provenance of ${row.entry.title}`}
                          onPress={() => {
                            setDetail(corpusObservationDetail(observationId) ?? null);
                          }}
                          style={styles.provenanceButton}
                        >
                          <Text style={styles.provenanceButtonText}>View provenance</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.collectionsList}>
            {collections.map((collection) => {
              const collectionEntries = entries.filter((entry) =>
                collection.entryIds.includes(entry.id),
              );
              return (
                <View
                  key={collection.collectionId}
                  accessibilityLabel={`${collection.label}, ${collection.entryIds.length} ${
                    collection.entryIds.length === 1 ? "entry" : "entries"
                  }, ${collection.description}`}
                  style={styles.collectionCard}
                >
                  <Text accessibilityRole="header" style={styles.collectionLabel}>
                    {collection.label}
                  </Text>
                  <Text style={styles.collectionCount}>
                    {`${collection.entryIds.length} ${collection.entryIds.length === 1 ? "entry" : "entries"}`}
                  </Text>
                  <Text style={styles.collectionDescription}>{collection.description}</Text>
                  {collectionEntries.map((entry) => (
                    <Text key={entry.id} style={styles.collectionEntryTitle}>
                      {entry.title}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.footnote}>Synthetic (SYNTH) — no real medical data.</Text>
      </ScrollView>

      {detail !== null ? (
        <ObservationDetailScreen detail={detail} onClose={() => { setDetail(null); }} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The cycling filter control (one 44px button; the label carries the value).
// ---------------------------------------------------------------------------

function FilterButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.filterButton}
    >
      <Text style={styles.filterButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sharingEntry: {
    borderColor: color.borderSubtle,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: touchTarget.minimum,
    justifyContent: "center",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    marginBottom: spacing[2],
  },
  sharingEntryLabel: { color: color.accent, fontSize: typography.size.sm },
  screen: {
    backgroundColor: color.canvas,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  title: {
    color: color.fgPrimary,
    fontSize: typography.size.xxl,
    fontWeight: "600" as const,
    lineHeight: typography.size.xxl * typography.lineHeight.tight,
  },
  intro: {
    color: color.fgMuted,
    fontSize: typography.size.md,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  searchInput: {
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: color.fgPrimary,
    fontFamily: typography.family.sans,
    fontSize: typography.size.md,
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  filterButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
  },
  countLine: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontWeight: "500" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  viewToggle: {
    flexDirection: "row",
    gap: spacing[2],
  },
  toggleButton: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
  },
  toggleSelected: {
    backgroundColor: color.accentSubtle,
    borderColor: color.accent,
  },
  toggleText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  toggleTextSelected: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  timeline: {
    gap: spacing[4],
  },
  dayGroup: {
    gap: spacing[2],
  },
  groupLabel: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "700" as const,
    letterSpacing: 1,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    // NOTE: the day label renders VERBATIM (not textTransform uppercase) —
    // the timeline groups are asserted verbatim by the maestro journey
    // ("Today"); the weight/size/letter-spacing carries the section look.
  },
  entryRow: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[3],
  },
  entryHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  entryAt: {
    color: color.fgMuted,
    flex: 1,
    fontSize: typography.size.xs,
    fontWeight: "500" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
  badgeValidated: {
    backgroundColor: color.successSubtle,
    borderRadius: radius.pill,
    color: color.success,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  badgePending: {
    backgroundColor: color.warningSubtle,
    borderRadius: radius.pill,
    color: color.warning,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  badgeSuperseded: {
    backgroundColor: color.canvas,
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  entryTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  entrySubtitle: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  provenanceButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing[1],
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[4],
  },
  provenanceButtonText: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  collectionsList: {
    gap: spacing[4],
  },
  collectionCard: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    padding: spacing[4],
  },
  collectionLabel: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  collectionCount: {
    color: color.accent,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  collectionDescription: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    marginBottom: spacing[2],
  },
  collectionEntryTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.relaxed,
  },
  emptyState: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontStyle: "italic" as const,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
    padding: spacing[3],
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
