/**
 * Cursor pagination helpers — pure, dependency-free (A15).
 *
 * Design (frozen architecture §3 "use cursor pagination … never expose
 * raw database IDs"):
 *   - The cursor is an OPAQUE base64url envelope over the sort anchor
 *     `(createdAt, id)`. Because every ORBB table's primary key IS the
 *     opaque domain id (`prsn_`, `obs_`, …) — there are no serial row
 *     ids anywhere in the schema — the anchor can never leak a raw
 *     database row id: there is none.
 *   - Stable ordering: `(createdAt, id)` is a total order — the id
 *     tiebreaker keeps pages deterministic when timestamps collide
 *     (millisecond-precision clocks, batch inserts).
 *   - `takeCursor` encodes the anchor of a row; `applyCursor` (pure)
 *     filters rows strictly after an anchor; `parseCursor` validates
 *     and decodes; `pageOf` slices a pre-sorted window into a page and
 *     derives the next cursor. `clampPageLimit` normalizes page sizes.
 *   - The envelope carries a version field so future cursor layouts
 *     can be introduced without ambiguity (old cursors keep working
 *     until their version is retired).
 */

import { PersistenceError } from "./errors.js";

/** Default page size when a caller does not specify one. */
export const DEFAULT_CURSOR_PAGE_SIZE = 50;

/** Hard upper bound on any requested page size. */
export const MAX_CURSOR_PAGE_SIZE = 200;

/** Sort directions supported by the anchor comparison. */
export const CURSOR_SORT_DIRECTIONS = ["asc", "desc"] as const;

export type CursorSortDirection = (typeof CURSOR_SORT_DIRECTIONS)[number];

/** A row that can anchor a cursor (the pagination sort key). */
export interface CursorAnchorRow {
  readonly createdAt: Date;
  readonly id: string;
}

/** Internal, versioned cursor envelope (base64url-encoded JSON). */
interface CursorEnvelope {
  readonly v: 1;
  /** Anchor creation instant, ISO-8601. */
  readonly c: string;
  /** Anchor opaque domain id. */
  readonly i: string;
}

/** Page request: an optional opaque cursor + optional limit. */
export interface CursorPage {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** A page of results plus the cursor that continues the iteration. */
export interface CursorPageResult<T> {
  readonly items: readonly T[];
  /**
   * Cursor to the next page. Present iff the source had (or may have)
   * more rows after this page; `undefined` marks the end.
   */
  readonly nextCursor?: string | undefined;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function isCursorSortDirection(value: unknown): value is CursorSortDirection {
  return (
    typeof value === "string" &&
    (CURSOR_SORT_DIRECTIONS as readonly string[]).includes(value)
  );
}

/**
 * Encodes the opaque cursor for a row ("take" the cursor AT this row).
 * Pure: same row → same cursor, always.
 */
export function takeCursor(row: CursorAnchorRow): string {
  const envelope: CursorEnvelope = {
    v: 1,
    c: row.createdAt.toISOString(),
    i: row.id,
  };
  return base64UrlEncode(JSON.stringify(envelope));
}

/**
 * Validates and decodes an opaque cursor into its anchor.
 * Throws {@link PersistenceError} ("invalid-request") on any malformed
 * cursor — the offending value is never echoed.
 */
export function parseCursor(cursor: string): CursorAnchorRow {
  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecode(cursor)) as unknown;
  } catch {
    throw new PersistenceError(
      "invalid-request",
      "Invalid pagination cursor: expected an opaque cursor produced by this API.",
    );
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid pagination cursor: expected an opaque cursor produced by this API.",
    );
  }
  const candidate = decoded as Partial<CursorEnvelope>;
  if (candidate.v !== 1) {
    throw new PersistenceError(
      "invalid-request",
      "Unsupported pagination cursor version.",
    );
  }
  if (typeof candidate.c !== "string" || candidate.c.length === 0) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid pagination cursor: missing creation anchor.",
    );
  }
  const createdAt = new Date(candidate.c);
  if (Number.isNaN(createdAt.getTime())) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid pagination cursor: corrupt creation anchor.",
    );
  }
  if (typeof candidate.i !== "string" || candidate.i.length === 0) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid pagination cursor: missing id anchor.",
    );
  }
  return { createdAt, id: candidate.i };
}

function isAfter(
  row: CursorAnchorRow,
  anchor: CursorAnchorRow,
  direction: CursorSortDirection,
): boolean {
  const rowTime = row.createdAt.getTime();
  const anchorTime = anchor.createdAt.getTime();
  if (direction === "desc") {
    // Newest-first: "after the anchor" means strictly SMALLER tuples.
    if (rowTime !== anchorTime) {
      return rowTime < anchorTime;
    }
    return row.id < anchor.id;
  }
  // Oldest-first: "after the anchor" means strictly LARGER tuples.
  if (rowTime !== anchorTime) {
    return rowTime > anchorTime;
  }
  return row.id > anchor.id;
}

/**
 * Pure cursor application: returns the subset of `rows` strictly after
 * the cursor anchor under the `(createdAt, id)` order for `direction`.
 *
 * Rows need not be pre-sorted — the filter is order-agnostic — but the
 * database-backed repositories always feed rows already sorted in the
 * requested direction (the filter and the ORDER BY must agree).
 */
export function applyCursor<T extends CursorAnchorRow>(
  rows: readonly T[],
  cursor: string,
  direction: CursorSortDirection = "desc",
): readonly T[] {
  if (!isCursorSortDirection(direction)) {
    throw new PersistenceError(
      "invalid-request",
      "Invalid cursor sort direction: expected asc or desc.",
    );
  }
  const anchor = parseCursor(cursor);
  return rows.filter((row) => isAfter(row, anchor, direction));
}

/**
 * Normalizes a requested page limit: default when absent; strict
 * validation for explicit values (1..{@link MAX_CURSOR_PAGE_SIZE}).
 * Throws {@link PersistenceError} ("invalid-request") on non-integer,
 * sub-1, or over-max limits — silent clamping would hide caller bugs.
 */
export function clampPageLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_CURSOR_PAGE_SIZE;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CURSOR_PAGE_SIZE) {
    throw new PersistenceError(
      "invalid-request",
      `Invalid page limit: expected an integer between 1 and ${MAX_CURSOR_PAGE_SIZE}.`,
    );
  }
  return limit;
}

/**
 * Slices a pre-sorted row window (already ordered by `(createdAt, id)`
 * in `direction`) into at most `limit` items and derives the next-page
 * cursor. Feed the window via `LIMIT limit+1` from the database so the
 * presence of a `limit+1`-th row proves more data exists.
 */
export function pageOf<T extends CursorAnchorRow>(
  rows: readonly T[],
  limit: number,
): CursorPageResult<T> {
  const clamped = clampPageLimit(limit);
  if (rows.length <= clamped) {
    return { items: rows };
  }
  const items = rows.slice(0, clamped);
  const last = items[items.length - 1];
  if (last === undefined) {
    return { items: [] };
  }
  return { items, nextCursor: takeCursor(last) };
}
