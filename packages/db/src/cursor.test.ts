/**
 * Pure cursor-pagination tests (A15): opaque base64url cursors over
 * (createdAt, id), stable ordering, round-trips, malformed-input
 * rejection — no database involved.
 */
import { describe, expect, it } from "vitest";
import {
  applyCursor,
  clampPageLimit,
  DEFAULT_CURSOR_PAGE_SIZE,
  MAX_CURSOR_PAGE_SIZE,
  pageOf,
  parseCursor,
  takeCursor,
  type CursorAnchorRow,
} from "./cursor.js";
import { PersistenceError } from "./errors.js";

function row(atMs: number, id: string): CursorAnchorRow {
  return { createdAt: new Date(atMs), id };
}

// Fixtures: five rows sharing two timestamps to force id tie-breaks.
const ROWS: readonly CursorAnchorRow[] = [
  row(1_000, "obs_aaa"),
  row(1_000, "obs_bbb"),
  row(2_000, "obs_ccc"),
  row(3_000, "obs_ddd"),
  row(3_000, "obs_eee"),
];

const DESC_ORDERED = [...ROWS].sort((a, b) => {
  const dt = b.createdAt.getTime() - a.createdAt.getTime();
  return dt !== 0 ? dt : (a.id < b.id ? 1 : -1);
});

const ASC_ORDERED = [...DESC_ORDERED].reverse();

describe("takeCursor / parseCursor", () => {
  it("round-trips a (createdAt, id) anchor", () => {
    const anchor = row(1_715_000_000_123, "obs_SYNTH-seed-0001-00000001");
    const cursor = takeCursor(anchor);
    expect(parseCursor(cursor)).toEqual({ createdAt: anchor.createdAt, id: anchor.id });
  });

  it("is deterministic: same row → identical cursor", () => {
    const anchor = row(5, "prsn_x");
    expect(takeCursor(anchor)).toBe(takeCursor(anchor));
  });

  it("produces an opaque base64url envelope (no +, /, or = padding)", () => {
    const cursor = takeCursor(row(1, "id-with-padding-inducing-length"));
    expect(cursor).not.toMatch(/[+/=]/);
    expect(() => Buffer.from(cursor, "base64url")).not.toThrow();
  });

  it("encodes versioned JSON, not the raw row", () => {
    const cursor = takeCursor(row(42, "obs_x"));
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded).toEqual({ v: 1, c: new Date(42).toISOString(), i: "obs_x" });
  });

  it("carries ONLY the opaque id — no serial row id concept exists", () => {
    const anchor = row(7, "prsn_SYNTH-only");
    const cursor = takeCursor(anchor);
    // The cursor is the base64url of a versioned JSON envelope whose
    // ONLY id-bearing field is the opaque domain id itself.
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(decoded).sort()).toEqual(["c", "i", "v"]);
    expect(decoded.i).toBe("prsn_SYNTH-only");
    // And nothing number-row-shaped leaks into the envelope.
    expect(JSON.stringify(decoded)).not.toMatch(/row|serial|seq/i);
  });

  it("rejects malformed cursors (not base64, not JSON, wrong envelope)", () => {
    for (const bad of ["", "!!!", "AAAA", "eyJ2IjoyfQ", Buffer.from("{}").toString("base64url")]) {
      expect(() => parseCursor(bad)).toThrowError(PersistenceError);
    }
  });

  it("rejects envelopes with missing or corrupt anchors", () => {
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const bad of [
      enc({ v: 1, c: "not-a-date", i: "obs_x" }),
      enc({ v: 1, c: "", i: "obs_x" }),
      enc({ v: 1, i: "obs_x" }),
      enc({ v: 1, c: new Date(0).toISOString() }),
      enc({ v: 1, c: new Date(0).toISOString(), i: "" }),
      enc({ v: 2, c: new Date(0).toISOString(), i: "obs_x" }),
    ]) {
      expect(() => parseCursor(enc === undefined ? "" : bad)).toThrowError(PersistenceError);
    }
  });
});

describe("applyCursor (pure)", () => {
  it("desc: keeps rows strictly AFTER the anchor (smaller tuples)", () => {
    const anchor = ROWS[2]!; // (2000, obs_ccc)
    const rest = applyCursor(DESC_ORDERED, takeCursor(anchor), "desc");
    expect(rest.map((r) => r.id)).toEqual(["obs_bbb", "obs_aaa"]);
  });

  it("desc: tie on createdAt falls through to the id tiebreak", () => {
    const anchor = row(3_000, "obs_ddd");
    const rest = applyCursor(DESC_ORDERED, takeCursor(anchor), "desc");
    expect(rest.map((r) => r.id)).toEqual(["obs_ccc", "obs_bbb", "obs_aaa"]);
  });

  it("asc: keeps rows strictly AFTER the anchor (larger tuples)", () => {
    const anchor = ROWS[1]!; // (1000, obs_bbb)
    const rest = applyCursor(ASC_ORDERED, takeCursor(anchor), "asc");
    expect(rest.map((r) => r.id)).toEqual(["obs_ccc", "obs_ddd", "obs_eee"]);
  });

  it("asc: tie on createdAt falls through to the id tiebreak", () => {
    const anchor = row(1_000, "obs_aaa");
    const rest = applyCursor(ASC_ORDERED, takeCursor(anchor), "asc");
    expect(rest.map((r) => r.id)).toEqual(["obs_bbb", "obs_ccc", "obs_ddd", "obs_eee"]);
  });

  it("an anchor past the last row yields an empty page (end of iteration)", () => {
    const last = DESC_ORDERED[DESC_ORDERED.length - 1]!; // smallest tuple
    expect(applyCursor(DESC_ORDERED, takeCursor(last), "desc")).toEqual([]);
    const largest = ASC_ORDERED[ASC_ORDERED.length - 1]!; // largest tuple
    expect(applyCursor(ASC_ORDERED, takeCursor(largest), "asc")).toEqual([]);
  });

  it("defaults to desc direction", () => {
    const anchor = ROWS[2]!;
    expect(applyCursor(DESC_ORDERED, takeCursor(anchor))).toEqual(
      applyCursor(DESC_ORDERED, takeCursor(anchor), "desc"),
    );
  });

  it("round-trips: pagination over a list never skips or duplicates rows", () => {
    for (const direction of ["desc", "asc"] as const) {
      const ordered = direction === "desc" ? DESC_ORDERED : ASC_ORDERED;
      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const window = cursor === undefined ? ordered : applyCursor(ordered, cursor, direction);
        const page = pageOf(window, 2);
        seen.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor;
        guard += 1;
      } while (cursor !== undefined && guard < 10);
      expect(seen).toEqual(ordered.map((r) => r.id));
    }
  });
});

describe("pageOf / clampPageLimit", () => {
  it("slices at most `limit` items from a pre-sorted window", () => {
    const page = pageOf(DESC_ORDERED, 2);
    expect(page.items.map((r) => r.id)).toEqual(["obs_eee", "obs_ddd"]);
    expect(page.nextCursor).toBeTypeOf("string");
  });

  it("marks the end with an absent nextCursor when the window fits", () => {
    const page = pageOf(DESC_ORDERED, 5);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeUndefined();
  });

  it("derives nextCursor from the LAST item of the page", () => {
    const page = pageOf(DESC_ORDERED, 3);
    expect(page.nextCursor).toBe(takeCursor(page.items[2]!));
  });

  it("handles empty windows", () => {
    expect(pageOf([], 3)).toEqual({ items: [] });
  });

  it("applies the limit+1 convention (a larger window implies more data)", () => {
    const page = pageOf(DESC_ORDERED, 4); // window of 5 → one more exists
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBeTypeOf("string");
  });

  it("clampPageLimit: default, bounds, and rejection", () => {
    expect(clampPageLimit(undefined)).toBe(DEFAULT_CURSOR_PAGE_SIZE);
    expect(clampPageLimit(1)).toBe(1);
    expect(clampPageLimit(MAX_CURSOR_PAGE_SIZE)).toBe(MAX_CURSOR_PAGE_SIZE);
    for (const bad of [0, -1, 1.5, MAX_CURSOR_PAGE_SIZE + 1, Number.NaN]) {
      expect(() => clampPageLimit(bad)).toThrowError(PersistenceError);
    }
  });
});
