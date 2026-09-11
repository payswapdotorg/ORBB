import { color, radius, spacing, typography } from "../tokens";

/**
 * One timeline entry (M1-B). Pure presentational data: `at` is a
 * pre-formatted time label string (formatting/timezones stay with the
 * caller), `badge` is a neutral pill label. No domain types involved.
 */
export interface TimelineEntry {
  /** Pre-formatted timestamp label (e.g. "Sep 10, 09:12"). */
  at: string;
  /** Primary entry title. */
  title: string;
  /** Secondary line under the title. */
  subtitle?: string;
  /** Neutral pill label (e.g. "Synthetic"). */
  badge?: string;
  /**
   * Optional group header: rendered whenever it differs from the previous
   * entry's group, producing sectioned timelines.
   */
  group?: string;
}

export interface TimelineProps {
  entries: readonly TimelineEntry[];
}

interface RenderedGroup {
  header: string | null;
  entries: TimelineEntry[];
}

/** Splits entries into consecutive runs sharing the same `group` value. */
function groupEntries(entries: readonly TimelineEntry[]): RenderedGroup[] {
  const groups: RenderedGroup[] = [];
  for (const entry of entries) {
    const header = entry.group ?? null;
    const lastGroup = groups.length > 0 ? groups[groups.length - 1] : undefined;
    if (lastGroup !== undefined && lastGroup.header === header) {
      lastGroup.entries.push(entry);
      continue;
    }
    groups.push({ header, entries: [entry] });
  }
  return groups;
}

/**
 * Timeline primitive (M1-B): renders `{ at, title, subtitle?, badge? }`
 * entries with a vertical rhythm — a connecting line, dot markers, a
 * monospaced time column, and optional section headers when `group`
 * changes between consecutive entries.
 *
 * Purely presentational: strings in, markup out. Each group renders as a
 * `<ul>` of `<li>` entries so screen readers announce list semantics.
 * The connecting line and dots are `aria-hidden` decoration.
 */
export function Timeline({ entries }: TimelineProps) {
  if (entries.length === 0) {
    return null;
  }
  const groups = groupEntries(entries);

  return (
    <div style={{ fontFamily: typography.family.sans }}>
      {groups.map((group, groupIndex) => (
        <section key={groupIndex} aria-label={group.header ?? undefined}>
          {group.header !== null ? (
            <h4
              style={{
                margin: 0,
                marginTop: groupIndex === 0 ? 0 : `${spacing[5]}px`,
                marginBottom: `${spacing[2]}px`,
                color: color.fgMuted,
                fontSize: `${typography.size.xs}px`,
                fontWeight: typography.weight.semibold,
                letterSpacing: "0.04em",
                lineHeight: typography.lineHeight.normal,
                textTransform: "uppercase",
              }}
            >
              {group.header}
            </h4>
          ) : null}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.entries.map((entry, entryIndex) => {
              const isLastInGroup = entryIndex === group.entries.length - 1;
              const isLastGroup = groupIndex === groups.length - 1;
              const showLine = !(isLastInGroup && isLastGroup);
              return (
                <li
                  key={`${entry.at}-${entry.title}-${entryIndex}`}
                  style={{
                    position: "relative",
                    paddingLeft: `${spacing[6]}px`,
                    paddingBottom: isLastInGroup ? 0 : `${spacing[4]}px`,
                  }}
                >
                  {showLine ? (
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: "9px",
                        top: "22px",
                        bottom: isLastInGroup ? `-${spacing[5]}px` : "0",
                        width: "2px",
                        backgroundColor: color.borderSubtle,
                      }}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: "4px",
                      top: "4px",
                      width: "12px",
                      height: "12px",
                      borderRadius: `${radius.pill}px`,
                      backgroundColor: color.accent,
                      border: `2px solid ${color.surface}`,
                    }}
                  />
                  <p
                    style={{
                      margin: 0,
                      color: color.fgMuted,
                      fontFamily: typography.family.mono,
                      fontSize: `${typography.size.xs}px`,
                      lineHeight: typography.lineHeight.normal,
                    }}
                  >
                    {entry.at}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      marginTop: "1px",
                      color: color.fgPrimary,
                      fontSize: `${typography.size.sm}px`,
                      fontWeight: typography.weight.medium,
                      lineHeight: typography.lineHeight.normal,
                    }}
                  >
                    {entry.title}
                    {entry.badge !== undefined ? (
                      <span
                        style={{
                          display: "inline-block",
                          marginLeft: `${spacing[2]}px`,
                          padding: `${spacing[0]}px ${spacing[2]}px`,
                          backgroundColor: color.accentSubtle,
                          borderRadius: `${radius.pill}px`,
                          color: color.accent,
                          fontSize: `${typography.size.xs}px`,
                          fontWeight: typography.weight.medium,
                          lineHeight: `${typography.size.xs + 8}px`,
                          verticalAlign: "middle",
                        }}
                      >
                        {entry.badge}
                      </span>
                    ) : null}
                  </p>
                  {entry.subtitle !== undefined ? (
                    <p
                      style={{
                        margin: 0,
                        marginTop: "1px",
                        color: color.fgMuted,
                        fontSize: `${typography.size.xs}px`,
                        lineHeight: typography.lineHeight.relaxed,
                      }}
                    >
                      {entry.subtitle}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
