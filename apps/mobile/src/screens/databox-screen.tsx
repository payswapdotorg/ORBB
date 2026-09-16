import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, spacing, touchTarget, typography } from "@orbb/ui/tokens";
import {
  EMPTY_FILTERS,
  QUALITY_FILTERS,
  QUALITY_FILTER_LABELS,
  SEEDED_OBSERVATIONS,
  SOURCE_KIND_LABELS,
  SOURCE_KINDS,
  TIME_FILTERS,
  TIME_FILTER_LABELS,
  deriveCollections,
  filterObservations,
  importDeviceObservationForToday,
  type DataboxFilters,
  type ObservationView,
  type QualityFilter,
  type TimeFilter,
} from "../lib/databox/model";
import { ObservationDetailScreen } from "./observation-detail";

/**
 * DataBox surface (M6-B B6, mobile): the §DataBox UX model — timeline plus
 * collections as the default presentation, with search and the four
 * filters (time, concept, source, confidence/quality), the
 * device-adapter import (golden journey #2: duplicate sources reconciled
 * into one canonical view with per-source provenance), and the full
 * §Provenance UX detail reachable from every entry.
 *
 * Honest controls: sharing stays on the web consent flow for now — this
 * surface shows the SYNTH data plane only; no fake affordances.
 *
 * Accessibility: filter chips carry accessibilityState selected + labels;
 * every entry row keeps the 44px minimum target; day group headers are
 * text (never color alone).
 */

type ConceptFilter = string;

export function DataboxScreen() {
  const [filters, setFilters] = useState<DataboxFilters>(EMPTY_FILTERS);
  const [imported, setImported] = useState(false);
  const [selected, setSelected] = useState<ObservationView | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const observations = useMemo(
    () => (imported ? importDeviceObservationForTodaySet() : SEEDED_OBSERVATIONS),
    [imported],
  );
  const filtered = useMemo(
    () => filterObservations(observations, filters),
    [observations, filters],
  );
  const collections = useMemo(() => deriveCollections(filtered), [filtered]);

  // Day-grouped timeline entries (most recent first — the store's order).
  const groups = useMemo(() => {
    const result: { label: string; entries: ObservationView[] }[] = [];
    for (const observation of filtered) {
      const label = dayGroupLabel(observation.capturedAtIso);
      const last = result[result.length - 1];
      if (last !== undefined && last.label === label) {
        last.entries.push(observation);
        continue;
      }
      result.push({ label, entries: [observation] });
    }
    return result;
  }, [filtered]);

  const updateFilters = (patch: Partial<DataboxFilters>): void => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setAnnouncement(
      `Showing ${filterObservations(observations, next).length} of ${observations.length} observations.`,
    );
  };

  const runImport = (): void => {
    setImported(true);
    const result = importDeviceObservationForToday();
    setAnnouncement(
      `Device observation imported: ${result.imported.valueLabel} via ${result.imported.method.label}. Two sources reconciled — verdict ${result.canonical.verdict}. The current value is ${result.canonical.valueLabel}; the ${result.superseded.method.label} source was superseded with its provenance kept.`,
    );
  };

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
          A human-readable timeline of your observations, grouped into
          collections by metric. Search it, filter it, and inspect any
          entry&apos;s provenance and model versions.
        </Text>

        <View accessibilityLiveRegion="polite">
          {announcement !== null ? (
            <Text style={styles.announcement}>{announcement}</Text>
          ) : null}
        </View>

        {/* Search + the four §DataBox UX filters. */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Search your DataBox</Text>
          <TextInput
            accessibilityLabel="Search your DataBox"
            onChangeText={(text) => {
              updateFilters({ search: text });
            }}
            placeholder="e.g. blood pressure, wearable, SYNTH-EV-0001"
            style={styles.searchInput}
            value={filters.search}
          />
          <Text style={styles.fieldLabel}>Time</Text>
          <View style={styles.chipRow}>
            {TIME_FILTERS.map((candidate) => (
              <FilterChip
                key={candidate}
                label={TIME_FILTER_LABELS[candidate]}
                pressed={filters.time === candidate}
                onPress={() => {
                  updateFilters({ time: candidate as TimeFilter });
                }}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>Source</Text>
          <View style={styles.chipRow}>
            <FilterChip
              label="All sources"
              pressed={filters.source === "all"}
              onPress={() => {
                updateFilters({ source: "all" });
              }}
            />
            {SOURCE_KINDS.map((kind) => (
              <FilterChip
                key={kind}
                label={SOURCE_KIND_LABELS[kind]}
                pressed={filters.source === kind}
                onPress={() => {
                  updateFilters({ source: kind });
                }}
              />
            ))}
          </View>
          <Text style={styles.fieldLabel}>Confidence / quality</Text>
          <View style={styles.chipRow}>
            {QUALITY_FILTERS.map((candidate) => (
              <FilterChip
                key={candidate}
                label={QUALITY_FILTER_LABELS[candidate as QualityFilter]}
                pressed={filters.quality === candidate}
                onPress={() => {
                  updateFilters({ quality: candidate as QualityFilter });
                }}
              />
            ))}
          </View>
        </View>

        {/* Collections (concept grouping — real filter chips). */}
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Collections
          </Text>
          <View style={styles.chipRow}>
            {collections.map((collection) => {
              const active = filters.concept === collection.metricId;
              return (
                <FilterChip
                  key={collection.metricId}
                  label={`${collection.metricLabel} (${collection.count})`}
                  pressed={active}
                  onPress={() => {
                    updateFilters({
                      concept: active ? "all" : (collection.metricId as ConceptFilter),
                    });
                  }}
                />
              );
            })}
          </View>
          <Text style={styles.resultCount}>{`Showing ${filtered.length} of ${observations.length} observations.`}</Text>
        </View>

        {/* The device-adapter import (golden journey #2). */}
        {!imported ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              Import a device observation
            </Text>
            <Text style={styles.intro}>
              Runs the SYNTH device-adapter fixture: imports a second
              blood-pressure source (SYNTH-BP-Monitor-1) for this
              morning&apos;s window and reconciles the two sources into one
              current value — per-source provenance kept, nothing discarded.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Import device observation"
              onPress={runImport}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Import device observation</Text>
            </Pressable>
          </View>
        ) : null}

        {/* The timeline: day-grouped observation entries. */}
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Timeline
          </Text>
          {groups.map((group) => (
            <View key={group.label} style={styles.dayGroup}>
              <Text style={styles.dayLabel}>{group.label}</Text>
              {group.entries.map((observation) => (
                <Pressable
                  key={observation.id}
                  accessibilityLabel={entryAccessibilityLabel(observation)}
                  accessibilityRole="button"
                  onPress={() => {
                    setSelected(observation);
                  }}
                  style={styles.entry}
                >
                  <Text style={styles.entryTitle}>
                    {`${observation.metricLabel}: ${observation.valueLabel}`}
                  </Text>
                  <Text style={styles.entryBadges}>
                    {`${observation.evidenceLabel} · ${observation.quality.state}`}
                  </Text>
                  <Text style={styles.entryDetail}>
                    {`${observation.time.capturedAtLabel} · ${observation.method.label} · ${SOURCE_KIND_LABELS[observation.sourceKind]}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
          {filtered.length === 0 ? (
            <Text style={styles.empty}>
              No observations match your search or filters.
            </Text>
          ) : null}
        </View>

        <Text style={styles.footnote}>
          Synthetic session (SYNTH) — reference date Sep 10, 2026. Sharing
          controls live on the web consent flow; nothing here is faked.
        </Text>
      </ScrollView>

      {selected !== null ? (
        <ObservationDetailScreen
          observation={selected}
          {...(imported && selected.id === "obs_SYNTH-obs-bp-canonical-0006"
            ? { canonical: importDeviceObservationForToday().canonical }
            : {})}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** The post-import observation set (canonical first — mirrors the web store). */
function importDeviceObservationForTodaySet(): ObservationView[] {
  const result = importDeviceObservationForToday();
  return [
    result.canonical.detail,
    result.imported,
    ...SEEDED_OBSERVATIONS.map((observation) =>
      observation.id === result.superseded.id
        ? { ...observation, validationState: "superseded" as const }
        : observation,
    ),
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayGroupLabel(iso: string): string {
  const date = new Date(iso);
  const month = MONTHS[date.getUTCMonth()] ?? "";
  const day = `${month} ${date.getUTCDate()}`;
  const reference = "2026-09-10";
  const observationDay = iso.slice(0, 10);
  if (observationDay === reference) {
    return `Today — ${day}`;
  }
  if (observationDay === "2026-09-09") {
    return `Yesterday — ${day}`;
  }
  return day;
}

function entryAccessibilityLabel(observation: ObservationView): string {
  return (
    `Observation ${observation.metricLabel}: ${observation.valueLabel}. ` +
    `${observation.evidenceLabel}, ${observation.quality.state} quality, ${observation.validationState}. ` +
    `Captured ${observation.time.capturedAtLabel} via ${observation.method.label}. ` +
    `Opens the full provenance detail.`
  );
}

function FilterChip({
  label,
  pressed,
  onPress,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: pressed }}
      onPress={onPress}
      style={[styles.chip, pressed ? styles.chipSelected : null]}
    >
      <Text style={[styles.chipText, pressed ? styles.chipTextSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  announcement: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  card: {
    backgroundColor: color.surface,
    borderColor: color.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
    padding: spacing[5],
  },
  cardTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.md,
    fontWeight: "600" as const,
  },
  fieldLabel: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    textTransform: "uppercase",
  },
  searchInput: {
    backgroundColor: color.canvas,
    borderColor: color.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: color.fgPrimary,
    fontSize: typography.size.md,
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  chip: {
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing[3],
  },
  chipSelected: {
    backgroundColor: color.accentSubtle,
    borderColor: color.accent,
  },
  chipText: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
  },
  chipTextSelected: {
    color: color.accent,
    fontWeight: "600" as const,
  },
  resultCount: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: color.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing[4],
  },
  primaryButtonText: {
    color: "#FFFFFF" as const,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  dayGroup: {
    gap: spacing[2],
  },
  dayLabel: {
    color: color.fgMuted,
    fontSize: typography.size.xs,
    fontWeight: "600" as const,
    textTransform: "uppercase",
  },
  entry: {
    borderColor: color.borderSubtle,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
    minHeight: touchTarget.minimum,
    padding: spacing[3],
  },
  entryTitle: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
    fontWeight: "600" as const,
  },
  entryBadges: {
    color: color.fgPrimary,
    fontSize: typography.size.sm,
  },
  entryDetail: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  empty: {
    color: color.fgMuted,
    fontSize: typography.size.sm,
    fontStyle: "italic" as const,
  },
  footnote: {
    color: color.fgSubtle,
    fontSize: typography.size.xs,
    lineHeight: typography.size.xs * typography.lineHeight.normal,
  },
});
