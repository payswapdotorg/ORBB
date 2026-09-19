import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_PAGE_SIZE,
  MAX_TIMELINE_PAGE_SIZE,
  applyTimelineCursor,
  applyTimelineCursorAnchor,
  clampTimelinePageLimit,
  compareTimelineEntries,
  pageTimelineOf,
  parseTimelineCursor,
  takeTimelineCursor,
  type TimelineCursorAnchor,
} from "../src/cursor.js";
import { TimelineError, isTimelineError } from "../src/errors.js";
import type { IntentTimelineEntry, TimelineEntry } from "../src/entries.js";
import { buildTimelineWorld, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

/** A minimal synthetic intent-typed entry at a fixed instant with a chosen id. */
function entryAt(occurredAt: Date, id: string): TimelineEntry {
  return {
    kind: "intent",
    id: id as IntentTimelineEntry["id"],
    personId: world.subject,
    occurredAt,
    provenance: {},
    state: "active",
  } satisfies IntentTimelineEntry;
}

// The canonical stream used across the cursor-law proofs: five entries,
// newest first, with an id tiebreak pair at t=100 and t=90.
const T100 = new Date(100_000);
const T90 = new Date(90_000);
const STREAM: readonly TimelineEntry[] = [
  entryAt(T100, "intent_SYNTH-aaaaaaaaaaaaaaaa"),
  entryAt(T100, "intent_SYNTH-bbbbbbbbbbbbbbbb"),
  entryAt(T90, "intent_SYNTH-aaaaaaaaaaaaaaaa"),
  entryAt(T90, "intent_SYNTH-bbbbbbbbbbbbbbbb"),
  entryAt(new Date(80_000), "intent_SYNTH-cccccccccccccccc"),
];

describe("the cursor grammar (opaque base64url anchor tuple)", () => {
  it("take → parse round-trips the anchor exactly (pure: same entry, same cursor)", () => {
    for (const entry of STREAM) {
      const cursor = takeTimelineCursor(entry);
      const anchor = parseTimelineCursor(cursor);
      expect(anchor.occurredAt.getTime()).toBe(entry.occurredAt.getTime());
      expect(anchor.id).toBe(entry.id);
      expect(takeTimelineCursor(entry)).toBe(cursor);
    }
  });

  it("the cursor is opaque base64url (URL-safe alphabet, no padding, no plaintext echo)", () => {
    const cursor = takeTimelineCursor(STREAM[0] as TimelineEntry);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(" ");
    expect(cursor).not.toContain("=");
  });

  it("malformed cursors fail CLOSED with the typed invalid-cursor error", () => {
    const badCursors = [
      "",
      "not-a-cursor",
      "####",
      Buffer.from("not json", "utf8").toString("base64url"),
      Buffer.from("[]", "utf8").toString("base64url"),
      Buffer.from('{"v":2,"o":"2025-01-01T00:00:00.000Z","i":"x"}', "utf8").toString("base64url"),
      Buffer.from('{"v":1}', "utf8").toString("base64url"),
      Buffer.from('{"v":1,"o":"not-a-date","i":"x"}', "utf8").toString("base64url"),
      Buffer.from('{"v":1,"o":"2025-01-01T00:00:00.000Z"}', "utf8").toString("base64url"),
      Buffer.from('{"v":1,"o":"","i":""}', "utf8").toString("base64url"),
    ];
    for (const cursor of badCursors) {
      let thrown: unknown;
      try {
        parseTimelineCursor(cursor);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `cursor <${cursor.slice(0, 12)}…> must fail closed`).toBeInstanceOf(
        TimelineError,
      );
      if (thrown instanceof TimelineError) {
        expect(thrown.code).toBe("invalid-cursor");
        expect(isTimelineError(thrown)).toBe(true);
        // PHID discipline: the offending value is never echoed (the
        // empty string trivially "appears" in every message — skipped).
        if (cursor.length > 0) {
          expect(thrown.message).not.toContain(cursor);
        }
      }
    }
  });

  it("the typed error code vocabulary includes the cursor code", () => {
    expect(() => parseTimelineCursor("garbage")).toThrowError(
      expect.objectContaining({ code: "invalid-cursor" }) as unknown as Error,
    );
  });
});

describe("the deterministic total order (occurredAt DESC, id ASC)", () => {
  it("orders the canonical stream newest-first with the id tiebreak", () => {
    const ordered = [...STREAM].sort(compareTimelineEntries);
    expect(ordered.map((entry) => entry.id)).toEqual([
      "intent_SYNTH-aaaaaaaaaaaaaaaa",
      "intent_SYNTH-bbbbbbbbbbbbbbbb",
      "intent_SYNTH-aaaaaaaaaaaaaaaa",
      "intent_SYNTH-bbbbbbbbbbbbbbbb",
      "intent_SYNTH-cccccccccccccccc",
    ]);
  });

  it("is a total order — permutation invariant", () => {
    const permutations = [
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
      [1, 0, 3, 2, 4],
      [3, 4, 0, 2, 1],
    ];
    const reference = [...STREAM].sort(compareTimelineEntries).map((entry) => entry.id);
    for (const permutation of permutations) {
      const shuffled = permutation.map((index) => STREAM[index] as TimelineEntry);
      expect([...shuffled].sort(compareTimelineEntries).map((entry) => entry.id)).toEqual(
        reference,
      );
    }
  });
});

describe("cursor application (forward-only, position-anchored)", () => {
  it("returns exactly the entries strictly AFTER the anchor", () => {
    const cursor = takeTimelineCursor(STREAM[1] as TimelineEntry); // (t=100, id=b)
    const after = applyTimelineCursor(STREAM, cursor);
    expect(after.map((entry) => entry.occurredAt.getTime())).toEqual([90_000, 90_000, 80_000]);
  });

  it("the anchor form and the string form agree", () => {
    const anchor: TimelineCursorAnchor = { occurredAt: T90, id: "intent_SYNTH-bbbbbbbbbbbbbbbb" };
    const after = applyTimelineCursorAnchor(STREAM, anchor);
    expect(after.map((entry) => entry.occurredAt.getTime())).toEqual([80_000]);
  });

  it("PAGE STABILITY: newer insertions BEFORE the anchor never shift the next page", () => {
    const cursor = takeTimelineCursor(STREAM[1] as TimelineEntry);
    const before = applyTimelineCursor(STREAM, cursor).map((entry) => entry.id);

    // Insert three entries that sort strictly BEFORE the anchor position:
    // two at newer instants, one at the same instant with a smaller id.
    const withInsertions: TimelineEntry[] = [
      entryAt(new Date(120_000), "intent_SYNTH-aaaaaaaaaaaaaaaa"),
      entryAt(new Date(110_000), "intent_SYNTH-aaaaaaaaaaaaaaaa"),
      entryAt(new Date(100_000), "intent_SYNTH-0000000000000000"),
      ...STREAM,
    ];
    const after = applyTimelineCursor(withInsertions, cursor).map((entry) => entry.id);

    expect(after).toEqual(before);
    expect(after.length).toBe(3);
  });

  it("FORWARD-ONLY: a cursor from page 2 continues strictly below page 2's end", () => {
    // Page 1 = first two entries; cursor at their end.
    const page1 = pageTimelineOf(STREAM, 2);
    expect(page1.entries.length).toBe(2);
    // Page 2 = next two; its cursor continues at the very end.
    const page2 = applyTimelineCursor(STREAM, page1.nextCursor as string);
    const page2Sliced = pageTimelineOf(page2, 2);
    expect(page2Sliced.entries.map((entry) => entry.id)).toEqual([
      "intent_SYNTH-aaaaaaaaaaaaaaaa",
      "intent_SYNTH-bbbbbbbbbbbbbbbb",
    ]);
    // Page 3 (from page 2's cursor) never returns page 1 or page 2 content.
    const page3 = applyTimelineCursor(
      STREAM,
      page2Sliced.nextCursor as string,
    );
    expect(page3.map((entry) => entry.id)).toEqual(["intent_SYNTH-cccccccccccccccc"]);
    const page3Sliced = pageTimelineOf(page3, 2);
    expect(page3Sliced.truncated).toBe(false);
    expect(page3Sliced.nextCursor).toBeUndefined();
  });

  it("walking the pages yields disjoint, ordered, complete coverage", () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const remaining =
        cursor === undefined ? STREAM : applyTimelineCursor(STREAM, cursor);
      const page = pageTimelineOf(remaining, 2);
      seen.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor !== undefined && guard < 10);
    expect(seen).toEqual([...STREAM].sort(compareTimelineEntries).map((entry) => entry.id));
  });
});

describe("the honest truncated flag (page-size boundary +1)", () => {
  it("exactly the limit → NOT truncated, no next cursor", () => {
    const result = pageTimelineOf(STREAM, 5);
    expect(result.entries.length).toBe(5);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it("limit+1 → truncated, with the next cursor anchored at the page's last entry", () => {
    const result = pageTimelineOf(STREAM, 4);
    expect(result.entries.length).toBe(4);
    expect(result.truncated).toBe(true);
    const last = result.entries[3] as TimelineEntry;
    expect(result.nextCursor).toBe(takeTimelineCursor(last));
  });

  it("an empty stream pages to an empty, non-truncated page", () => {
    const result = pageTimelineOf([], 3);
    expect(result.entries).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("page-limit normalization (strict — silent clamping hides caller bugs)", () => {
  it("defaults when absent", () => {
    expect(clampTimelinePageLimit(undefined)).toBe(DEFAULT_TIMELINE_PAGE_SIZE);
    expect(DEFAULT_TIMELINE_PAGE_SIZE).toBe(50);
    expect(MAX_TIMELINE_PAGE_SIZE).toBe(200);
  });

  it("accepts the legal range", () => {
    expect(clampTimelinePageLimit(1)).toBe(1);
    expect(clampTimelinePageLimit(200)).toBe(200);
  });

  it("rejects non-integer, sub-1, and over-max limits with the typed error", () => {
    for (const limit of [0, -1, 1.5, 201, Number.NaN, Number.POSITIVE_INFINITY]) {
      let thrown: unknown;
      try {
        clampTimelinePageLimit(limit);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `limit ${limit} must fail closed`).toBeInstanceOf(TimelineError);
      if (thrown instanceof TimelineError) {
        expect(thrown.code).toBe("invalid-limit");
      }
    }
  });
});
