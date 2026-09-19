/**
 * The timeline cursor law (A49, part 2) — the timeline-local mirror of
 * the `@orbb/db` cursor-pagination law (architecture §3: "Use cursor
 * pagination"), specialized to the timeline's total order:
 *
 *   `(occurredAt DESC, id ASC)`
 *
 * The anchor is the `(occurredAt, domain id)` tuple of the LAST entry of
 * a page. Because every ORBB domain id IS the opaque public identifier
 * (`obs_`, `task_`, `intent_`, …) — there are no raw database row ids
 * anywhere — the anchor can never leak a database id: there is none.
 *
 * PAGE STABILITY (position anchoring, not offsets): a cursor returns the
 * SAME page regardless of newer insertions BEFORE it — entries inserted
 * with timestamps newer than the anchor sort strictly before the anchor
 * position and can never shift it. There is no "previous page" grammar
 * at all: the cursor is FORWARD-ONLY (the next page is always the
 * entries strictly AFTER the anchor under the total order).
 *
 * The envelope is an OPAQUE base64url-encoded, versioned JSON tuple
 * `{ v, o, i }` (cursor grammar defined in-package). Malformed cursors
 * fail CLOSED with a typed {@link TimelineError}("invalid-cursor") — the
 * offending value is never echoed.
 */
import type { TimelineEntry } from "./entries.js";
import { TimelineError } from "./errors.js";

/** Default page size when a caller does not specify one (mirrors @orbb/db). */
export const DEFAULT_TIMELINE_PAGE_SIZE = 50;

/** Hard upper bound on any requested page size (mirrors @orbb/db). */
export const MAX_TIMELINE_PAGE_SIZE = 200;

/** Internal, versioned cursor envelope (base64url-encoded JSON). */
interface TimelineCursorEnvelope {
  readonly v: 1;
  /** Anchor occurredAt instant, ISO-8601. */
  readonly o: string;
  /** Anchor opaque domain id. */
  readonly i: string;
}

/** The decoded cursor anchor: an (occurredAt, domain id) tuple. */
export interface TimelineCursorAnchor {
  readonly occurredAt: Date;
  readonly id: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

const INVALID_CURSOR_MESSAGE =
  "Invalid timeline pagination cursor: expected an opaque cursor produced by this API.";

/**
 * Encodes the opaque cursor AT an entry ("take" the cursor at this row).
 * Pure: same entry → same cursor, always.
 */
export function takeTimelineCursor(entry: TimelineEntry): string {
  const envelope: TimelineCursorEnvelope = {
    v: 1,
    o: entry.occurredAt.toISOString(),
    i: entry.id,
  };
  return base64UrlEncode(JSON.stringify(envelope));
}

/**
 * Validates and decodes an opaque timeline cursor into its anchor.
 * Throws {@link TimelineError}("invalid-cursor") on any malformed cursor
 * — not base64url, not JSON, wrong version, missing or corrupt anchor
 * fields. The offending value is never echoed.
 */
export function parseTimelineCursor(cursor: string): TimelineCursorAnchor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecode(cursor)) as unknown;
  } catch {
    throw new TimelineError("invalid-cursor", INVALID_CURSOR_MESSAGE);
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new TimelineError("invalid-cursor", INVALID_CURSOR_MESSAGE);
  }
  const candidate = decoded as Partial<TimelineCursorEnvelope>;
  if (candidate.v !== 1) {
    throw new TimelineError(
      "invalid-cursor",
      "Unsupported timeline pagination cursor version.",
    );
  }
  if (typeof candidate.o !== "string" || candidate.o.length === 0) {
    throw new TimelineError(
      "invalid-cursor",
      "Invalid timeline pagination cursor: missing occurredAt anchor.",
    );
  }
  const occurredAt = new Date(candidate.o);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new TimelineError(
      "invalid-cursor",
      "Invalid timeline pagination cursor: corrupt occurredAt anchor.",
    );
  }
  if (typeof candidate.i !== "string" || candidate.i.length === 0) {
    throw new TimelineError(
      "invalid-cursor",
      "Invalid timeline pagination cursor: missing id anchor.",
    );
  }
  return { occurredAt, id: candidate.i };
}

/**
 * Is `entry` strictly AFTER `anchor` under the timeline total order
 * `(occurredAt DESC, id ASC)`? Entries with an earlier occurredAt are
 * "after" (the stream runs newest-first); at equal occurredAt the
 * LARGER id is after (id ascending tiebreak).
 */
function isAfterAnchor(entry: TimelineEntry, anchor: TimelineCursorAnchor): boolean {
  const entryTime = entry.occurredAt.getTime();
  const anchorTime = anchor.occurredAt.getTime();
  if (entryTime !== anchorTime) {
    return entryTime < anchorTime;
  }
  return entry.id > anchor.id;
}

/**
 * Pure anchor application: returns the subset of `entries` strictly
 * after the DECODED anchor under the `(occurredAt DESC, id ASC)` order.
 * Order-agnostic in its input (the assembly always feeds the ordered
 * stream). Use {@link applyTimelineCursor} for the string-cursor form.
 */
export function applyTimelineCursorAnchor(
  entries: readonly TimelineEntry[],
  anchor: TimelineCursorAnchor,
): readonly TimelineEntry[] {
  return entries.filter((entry) => isAfterAnchor(entry, anchor));
}

/**
 * Pure cursor application: returns the subset of `entries` strictly
 * after the cursor anchor under the `(occurredAt DESC, id ASC)` order.
 * The filter is order-agnostic (entries need not be pre-sorted), but the
 * assembly always feeds the fully-ordered stream (the filter and the
 * ordering must agree).
 */
export function applyTimelineCursor(
  entries: readonly TimelineEntry[],
  cursor: string,
): readonly TimelineEntry[] {
  return applyTimelineCursorAnchor(entries, parseTimelineCursor(cursor));
}

/**
 * Normalizes a requested page limit: default when absent; strict
 * validation for explicit values (1..{@link MAX_TIMELINE_PAGE_SIZE}).
 * Throws {@link TimelineError}("invalid-limit") on non-integer, sub-1,
 * or over-max limits — silent clamping would hide caller bugs (the
 * @orbb/db discipline, mirrored).
 */
export function clampTimelinePageLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_TIMELINE_PAGE_SIZE;
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_TIMELINE_PAGE_SIZE
  ) {
    throw new TimelineError(
      "invalid-limit",
      `Invalid timeline page limit: expected an integer between 1 and ${MAX_TIMELINE_PAGE_SIZE}.`,
    );
  }
  return limit;
}

/** A page of timeline entries plus the continuation cursor + truncated flag. */
export interface TimelinePageResult {
  readonly entries: readonly TimelineEntry[];
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

/**
 * Slices a pre-sorted, pre-filtered entry stream into at most `limit`
 * entries and derives the next-page cursor. Feed the stream via the
 * limit+1 probe so the presence of a (limit+1)-th entry PROVES more data
 * exists — `truncated` is exactly that proof (never silently truncated).
 */
export function pageTimelineOf(
  entries: readonly TimelineEntry[],
  limit: number,
): TimelinePageResult {
  const clamped = clampTimelinePageLimit(limit);
  if (entries.length <= clamped) {
    return { entries, truncated: false };
  }
  const pageEntries = entries.slice(0, clamped);
  const last = pageEntries[pageEntries.length - 1];
  if (last === undefined) {
    return { entries: [], truncated: false };
  }
  return { entries: pageEntries, nextCursor: takeTimelineCursor(last), truncated: true };
}

/**
 * The deterministic timeline total order: `occurredAt` DESCENDING, then
 * domain id ASCENDING as the tiebreak (mirroring the @orbb/db
 * `(createdAt, id)` anchor law in its desc direction). The order is
 * TOTAL, hence stable under any permutation of the input stream.
 */
export function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
  const aTime = a.occurredAt.getTime();
  const bTime = b.occurredAt.getTime();
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}
