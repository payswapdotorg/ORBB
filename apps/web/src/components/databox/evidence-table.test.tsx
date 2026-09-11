// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EvidenceTable, sortEvidenceRows } from "./evidence-table";
import {
  SYNTHETIC_EVIDENCE_ITEMS,
  type SyntheticEvidenceItem,
} from "@/lib/synthetic-data";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Installs a `window.matchMedia` double (jsdom ships none). */
function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      media: query,
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

const items: readonly SyntheticEvidenceItem[] = SYNTHETIC_EVIDENCE_ITEMS;

describe("sortEvidenceRows (pure ordering)", () => {
  it("keeps fixture order when unsorted (most recent first)", () => {
    expect(sortEvidenceRows(items, null)).toEqual(items);
  });

  it("sorts by captured time ascending (oldest first)", () => {
    const sorted = sortEvidenceRows(items, { columnId: "capturedAt", direction: "asc" });
    expect(sorted[0]?.id).toBe("SYNTH-EV-0008");
    expect(sorted.at(-1)?.id).toBe("SYNTH-EV-0001");
  });

  it("sorts by captured time descending (newest first)", () => {
    const sorted = sortEvidenceRows(items, { columnId: "capturedAt", direction: "desc" });
    expect(sorted[0]?.id).toBe("SYNTH-EV-0001");
  });

  it("sorts by media type alphabetically", () => {
    const sorted = sortEvidenceRows(items, { columnId: "mediaType", direction: "asc" });
    const mediaTypes = sorted.map((item) => item.mediaType);
    expect([...mediaTypes].sort((a, b) => a.localeCompare(b))).toEqual(mediaTypes);
  });

  it("sorts by status rank (validated, then pending, then superseded)", () => {
    const sorted = sortEvidenceRows(items, { columnId: "status", direction: "asc" });
    const statuses = sorted.map((item) => item.status);
    expect(statuses.indexOf("superseded")).toBeGreaterThan(statuses.indexOf("pending"));
    expect(statuses.indexOf("pending")).toBeGreaterThan(statuses.indexOf("validated"));
  });
});

describe("EvidenceTable", () => {
  it("renders the caption and every synthetic evidence row", () => {
    stubMatchMedia(false);
    render(<EvidenceTable />);
    expect(
      screen.getByText("Synthetic evidence captured into your DataBox — no real records."),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    for (const item of items) {
      expect(screen.getByText(item.id)).toBeTruthy();
    }
    // 1 header row + 8 body rows.
    expect(screen.getAllByRole("row")).toHaveLength(items.length + 1);
  });

  it("toggles the captured column through ascending and descending", () => {
    stubMatchMedia(false);
    render(<EvidenceTable />);
    const captured = screen.getByRole("columnheader", { name: /captured/i });
    expect(captured.getAttribute("aria-sort")).toBe("none");

    const sortButton = within(captured).getByRole("button", { name: /captured/i });
    fireEvent.click(sortButton);
    expect(captured.getAttribute("aria-sort")).toBe("ascending");
    const firstBodyRow = screen.getAllByRole("row")[1];
    expect(firstBodyRow?.textContent).toContain("SYNTH-EV-0008");

    fireEvent.click(sortButton);
    expect(captured.getAttribute("aria-sort")).toBe("descending");
    const newestFirstRow = screen.getAllByRole("row")[1];
    expect(newestFirstRow?.textContent).toContain("SYNTH-EV-0001");
  });

  it("reveals row metadata through the disclosure panel", () => {
    stubMatchMedia(false);
    render(<EvidenceTable />);
    const toggle = screen.getByRole("button", { name: "Metadata: SYNTH-EV-0001" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Checksum prefix")).toBeTruthy();
    expect(screen.getByText("sha256-SYNTH-7c4a8d09")).toBeTruthy();
    expect(screen.getByText("Retention class")).toBeTruthy();
    expect(screen.getByText("Provenance actor")).toBeTruthy();
    expect(screen.getByText("SYNTH-Person-1 · wearable sync")).toBeTruthy();
  });

  it("labels every validation status in text (never color alone)", () => {
    stubMatchMedia(false);
    render(<EvidenceTable />);
    // 5 validated, 2 pending, 1 superseded — one visible label per row.
    expect(screen.getAllByText("Validated")).toHaveLength(5);
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(screen.getAllByText("Superseded")).toHaveLength(1);
  });
});
