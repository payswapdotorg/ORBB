import type { CaptureShape } from "./types";

/**
 * Pure formatting helpers for the manual-capture journey (M4-B).
 *
 * No hooks, no DOM, no Intl — labels are derived arithmetically from local
 * time so jsdom/Playwright runs stay byte-stable. Every function takes the
 * reference "now" as a parameter (or defaults to nothing) so tests can pin
 * dates; only the capture-history view passes the live clock.
 */

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function calendarDay(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

function isSameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isNextDay(candidate: CalendarDay, reference: CalendarDay): boolean {
  const probe = new Date(reference.year, reference.month, reference.day - 1);
  return isSameDay(candidate, calendarDay(probe));
}

/**
 * Day label relative to `now`: "Today", "Yesterday", or "Sep 8" style.
 * Used both for timeline groups and captured-at labels.
 */
export function formatDayLabel(date: Date, now: Date): string {
  const target = calendarDay(date);
  const today = calendarDay(now);
  if (isSameDay(target, today)) {
    return "Today";
  }
  if (isNextDay(target, today)) {
    return "Yesterday";
  }
  const month = MONTH_LABELS[date.getMonth()] ?? "";
  return `${month} ${date.getDate()}`;
}

/** Local-time "HH:mm" label (24h). */
export function formatTimeLabel(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Combined captured-at label: "Today, 08:30" / "Sep 8, 09:12". */
export function formatCapturedLabel(date: Date, now: Date): string {
  return `${formatDayLabel(date, now)}, ${formatTimeLabel(date)}`;
}

/**
 * The `datetime-local` input value for a date (local time, minute
 * precision): "YYYY-MM-DDTHH:mm". Used to default the capture-timestamp
 * field to "now" and round-trip edits.
 */
export function toDatetimeLocalValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * Parses `datetime-local` text ("YYYY-MM-DDTHH:mm") into a Date (local
 * time semantics). Returns null when the text is not a valid local
 * datetime — the caller decides how to surface the failure.
 */
export function parseDatetimeLocal(text: string): Date | null {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/** Formats a number for display without float dust (70.5, not 70.50000). */
export function formatNumberValue(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Human value label for one captured shape:
 * - two fields sharing one unit (blood pressure): "118/76 mmHg";
 * - otherwise "70.5 kg" style per field, joined with " · ".
 */
export function formatValueLabel(
  shape: CaptureShape,
  values: Readonly<Record<string, number>>,
): string {
  if (shape.fields.length === 2) {
    const [first, second] = shape.fields;
    if (first !== undefined && second !== undefined) {
      const firstUnit = first.metric.unitDomain[0] ?? "";
      const secondUnit = second.metric.unitDomain[0] ?? "";
      if (firstUnit === secondUnit) {
        return `${formatNumberValue(values[first.id] ?? 0)}/${formatNumberValue(
          values[second.id] ?? 0,
        )} ${firstUnit}`;
      }
    }
  }
  return shape.fields
    .map((field) => {
      const unit = field.metric.unitDomain[0] ?? "";
      return `${formatNumberValue(values[field.id] ?? 0)} ${unit}`;
    })
    .join(" · ");
}
