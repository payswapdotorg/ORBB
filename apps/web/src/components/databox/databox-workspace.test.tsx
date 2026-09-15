// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataboxWorkspace } from "./databox-workspace";

/**
 * DataBox workspace tests (M6-B B6): the §DataBox UX model — timeline plus
 * collections as the DEFAULT presentation, search + the four filters, the
 * advanced inspection disclosure, the honest entry points (export
 * forthcoming; share/revoke through the reviewable consent sheet; access
 * history with fixture + session events), and the B5 provenance links.
 */

function stubMatchMedia(): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DataboxWorkspace (the §DataBox UX model)", () => {
  it("defaults to the TIMELINE presentation (not the table) with all three views", () => {
    render(<DataboxWorkspace />);
    // The view toggle: Timeline (default) | Collections | Evidence list.
    expect(
      screen.getByRole("button", { name: "Timeline" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Collections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Evidence list" })).toBeTruthy();
    expect(screen.getByText("Showing the evidence timeline.")).toBeTruthy();
    // Day-grouped, human-readable entries render (pinned corpus); the
    // select's "Today" option never collides with the timeline group header.
    expect(screen.getByRole("heading", { name: "Today", level: 4 })).toBeTruthy();
    expect(screen.getByText("Resting heart rate 62 beats/min")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("switches to the collections view and back to the timeline politely", () => {
    render(<DataboxWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    expect(screen.getByText("Showing the evidence collections.")).toBeTruthy();
    expect(screen.getByText("Vital signs monitoring")).toBeTruthy();
    expect(screen.getByText("Body composition")).toBeTruthy();
    expect(screen.getByText("Activity & sleep")).toBeTruthy();
    // The Documents & notes collection renders (label + concept option).
    expect(screen.getAllByText("Documents & notes").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByText("Showing the evidence timeline.")).toBeTruthy();
  });

  it("still offers the sortable evidence LIST view (the M3-B table)", () => {
    render(<DataboxWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Evidence list" }));
    expect(screen.getByText("Showing the evidence list.")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(9); // header + 8 evidence rows
  });

  it("searches the corpus (titles, sources, concepts) and clears honestly", async () => {
    render(<DataboxWorkspace />);
    const search = screen.getByLabelText(/search your databox/i);
    fireEvent.change(search, { target: { value: "heart rate" } });
    await waitFor(() => {
      expect(screen.getByText("3 of 12 entries — 1 filter active.")).toBeTruthy();
    });
    // Only heart-rate entries remain.
    expect(screen.getByText("Resting heart rate 62 beats/min")).toBeTruthy();
    expect(screen.queryByText("Thermometer reading photo")).toBeNull();

    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    await waitFor(() => {
      expect(
        screen.getByText(/No entries match the current search and filters/),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => {
      expect(screen.getByText("12 of 12 entries.")).toBeTruthy();
    });
  });

  it("filters by the four filters: time, concept, source, quality", async () => {
    render(<DataboxWorkspace />);

    // Time: today only (the pinned reference day).
    fireEvent.change(screen.getByLabelText(/filter by time/i), { target: { value: "today" } });
    await waitFor(() => {
      expect(screen.getByText("4 of 12 entries — 1 filter active.")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => {
      expect(screen.getByText("12 of 12 entries.")).toBeTruthy();
    });

    // Concept: body weight (evidence + observation).
    fireEvent.change(screen.getByLabelText(/filter by metric/i), {
      target: { value: "concept-body-weight" },
    });
    await waitFor(() => {
      expect(screen.getByText("2 of 12 entries — 1 filter active.")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => {
      expect(screen.getByText("12 of 12 entries.")).toBeTruthy();
    });

    // Source: CHW-assisted.
    fireEvent.change(screen.getByLabelText(/filter by source/i), { target: { value: "chw" } });
    await waitFor(() => {
      expect(screen.getByText("1 of 12 entries — 1 filter active.")).toBeTruthy();
    });
    expect(screen.getByText("Clinic letter scan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => {
      expect(screen.getByText("12 of 12 entries.")).toBeTruthy();
    });

    // Quality: high band.
    fireEvent.change(screen.getByLabelText(/filter by quality/i), { target: { value: "high" } });
    await waitFor(() => {
      expect(screen.getByText("2 of 12 entries — 1 filter active.")).toBeTruthy();
    });
    expect(screen.getByText("Weight 70.5 kg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => {
      expect(screen.getByText("12 of 12 entries.")).toBeTruthy();
    });
  });

  it("reveals the advanced inspection panel (raw evidence, provenance, model versions)", () => {
    render(<DataboxWorkspace />);
    const toggle = screen.getByRole("button", { name: "Inspect: SYNTH-OBS-EVT-0003" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Raw evidence")).toBeTruthy();
    expect(screen.getByText("Metadata")).toBeTruthy();
    expect(screen.getByText("Provenance")).toBeTruthy();
    expect(screen.getByText("Model version")).toBeTruthy();
    // The estimated temperature observation carries its estimation model.
    expect(screen.getAllByText(/SYNTH-ThermoVision v2.1/).length).toBeGreaterThanOrEqual(1);
    // And the full provenance chain link (B5) is offered.
    expect(
      screen.getByRole("link", { name: /Open the provenance detail of obs_SYNTH-corpus-temp-0003/ }),
    ).toBeTruthy();
  });

  it("marks the export entry as forthcoming (honest, disabled, never fake)", () => {
    render(<DataboxWorkspace />);
    const exportButton = screen.getByRole("button", { name: /Export — forthcoming/ });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/Dataset export with provenance arrives with the export pipeline/),
    ).toBeTruthy();
  });

  it("routes sharing through the reviewable consent sheet (existing flow)", async () => {
    stubMatchMedia();
    render(<DataboxWorkspace />);
    // The actions entry opens the SAME sheet the consent section owns.
    fireEvent.click(screen.getByRole("button", { name: "Share data with clinician" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Share with clinician" })).toBeTruthy();
    });
    // The sheet is the reviewable contract (purpose/scope/expiry).
    expect(screen.getByText("Why this is requested")).toBeTruthy();
    expect(screen.getByText("Exactly what is shared")).toBeTruthy();
    expect(screen.getByText("Sharing ends")).toBeTruthy();
  });

  it("records session grant/revoke events in the access history (honestly labeled)", async () => {
    stubMatchMedia();
    render(<DataboxWorkspace />);

    // Open the access history BEFORE any session events: fixture events only.
    fireEvent.click(screen.getByRole("button", { name: /View access history/i }));
    expect(screen.getByText(/Share granted \(scoped read, heart rate \+ BP log\)/)).toBeTruthy();
    expect(screen.getAllByText(/synthetic fixture event/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/· this session/)).toBeNull();

    // Grant through the sheet, then the session event appears (origin session).
    const trigger = screen.getByRole("button", { name: "Share with clinician" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => {
      expect(screen.getByText(/Share confirmed: SYNTH-Clinic-A/)).toBeTruthy();
    });
    expect(screen.getAllByText(/this session/).length).toBeGreaterThanOrEqual(1);
  });
});
