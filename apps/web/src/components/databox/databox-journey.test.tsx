// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataboxJourney } from "./databox-journey";
import { DataboxControls } from "./databox-controls";
import { listObservationBoard } from "@/lib/observations/store";

/**
 * DataBox journey tests (M6-B B6): the timeline + collections default
 * presentation with search and the four filters; the advanced-inspection
 * disclosure (metadata + provenance + model versions); the device-adapter
 * import + reconciliation (golden journey #2, client path); the honest
 * forthcoming entry points.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function boardResponse(): Response {
  return new Response(JSON.stringify(listObservationBoard()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetchWith(responses: Response[]) {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DataboxJourney", () => {
  it("renders the timeline + collections default presentation over the seeded observations", async () => {
    stubFetchWith([boardResponse()]);
    render(<DataboxJourney />);

    await waitFor(() => {
      expect(screen.getByText("Your data")).toBeTruthy();
    });

    // The four seeded observations, day-grouped ("Today — Sep 10" etc.,
    // never the bare "Today" that would collide with the M3-B timeline).
    expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
    expect(screen.getByText("Today — Sep 10")).toBeTruthy();
    expect(screen.getByText("Yesterday — Sep 9")).toBeTruthy();

    // Collections (concept groupings with counts — real filter buttons).
    expect(
      screen.getByRole("button", { name: /Blood Pressure Systolic \(1\)/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Heart Rate \(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Body Temperature \(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Body Weight \(1\)/ })).toBeTruthy();

    // Search + the four filters exist as labeled controls.
    expect(screen.getByLabelText(/Search your DataBox/)).toBeTruthy();
    expect(screen.getByLabelText(/^Time$/)).toBeTruthy();
    expect(screen.getByLabelText(/Concept \(metric\)/)).toBeTruthy();
    expect(screen.getByLabelText(/^Source$/)).toBeTruthy();
    expect(screen.getByLabelText(/Confidence \/ quality/)).toBeTruthy();
  });

  it("filters by search text and announces the result count", async () => {
    stubFetchWith([boardResponse()]);
    render(<DataboxJourney />);
    await waitFor(() => {
      expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Search your DataBox/), {
      target: { value: "wearable" },
    });

    // Only the device-adapter HR observation matches "wearable".
    expect(screen.getByText("Showing 1 of 4 observations.")).toBeTruthy();
    expect(
      screen.getByText(/Filters applied — now showing 1 of 4 observations\./),
    ).toBeTruthy();
    expect(screen.getByText(/Heart Rate: 62 beats\/min/)).toBeTruthy();
    expect(screen.queryByText(/Blood Pressure Systolic: 118 mmHg/)).toBeNull();

    // The empty state + clear-filters affordance.
    fireEvent.change(screen.getByLabelText(/Search your DataBox/), {
      target: { value: "does-not-exist-anywhere" },
    });
    expect(
      screen.getByText("No observations match your search or filters."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
  });

  it("filters by source and quality through the selects", async () => {
    stubFetchWith([boardResponse()]);
    render(<DataboxJourney />);
    await waitFor(() => {
      expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "device-adapter" },
    });
    expect(screen.getByText("Showing 1 of 4 observations.")).toBeTruthy();
    expect(screen.getByText(/Heart Rate: 62 beats\/min/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Source$/), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText(/Confidence \/ quality/), {
      target: { value: "partial" },
    });
    expect(screen.getByText("Showing 1 of 4 observations.")).toBeTruthy();
    expect(screen.getByText(/Body Temperature: 36.8 °C/)).toBeTruthy();
  });

  it("reveals advanced inspection (metadata, provenance summary, model versions) per entry", async () => {
    stubFetchWith([boardResponse()]);
    render(<DataboxJourney />);
    await waitFor(() => {
      expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
    });

    // Open the ESTIMATED temperature entry's disclosure.
    const toggle = screen.getByRole("button", {
      name: /Body Temperature: 36.8 °C/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Advanced inspection: model versions + raw evidence + provenance link.
    expect(screen.getByText("Model version")).toBeTruthy();
    expect(screen.getByText("SYNTH-thermo-estimator v0.3")).toBeTruthy();
    expect(
      screen.getByText(/SYNTH-EV-0003 — Thermometer reading photo \(image\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Image extraction/, { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: /View full provenance \(obs_SYNTH-obs-temp-photo-0003\) on the Measurements surface/,
      }),
    ).toBeTruthy();
  });

  it("runs the device import and renders the reconciled canonical view with per-source provenance (journey #2)", async () => {
    const fetchMock = vi.fn<FetchLike>(async (input, init) => {
      const body = init?.body;
      if (typeof body === "string" && body.includes("import-device")) {
        // The store would run the import; emulate through the real store
        // for fidelity.
        const { importDeviceObservation } = await import(
          "@/lib/observations/store"
        );
        const result = importDeviceObservation();
        if (!result.ok) {
          return new Response(
            JSON.stringify({ error: { code: "import-already-completed", message: "already" } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            synthetic: true,
            imported: result.imported,
            superseded: result.superseded,
            canonical: result.canonical,
            observations: result.board.observations,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return boardResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DataboxJourney />);
    await waitFor(() => {
      expect(screen.getByText("Showing 4 of 4 observations.")).toBeTruthy();
    });

    // The import affordance is visible before the import.
    const importButton = screen.getByRole("button", {
      name: "Import device observation",
    });
    expect(
      screen.getByText(/SYNTH-BP-Monitor-1/),
    ).toBeTruthy();
    fireEvent.click(importButton);

    // The canonical view appears in the timeline with per-source provenance
    // and the honest discordant verdict; the announcement explains it.
    // (6 entries: canonical + device BP + superseded manual BP + the rest.)
    await waitFor(() => {
      expect(screen.getByText("Showing 6 of 6 observations.")).toBeTruthy();
    });
    expect(
      screen.getAllByText("Blood Pressure Systolic: 120 mmHg", { exact: true }),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        /Device observation imported: 120 mmHg via Automatic cuff sync\. Two sources reconciled — verdict discordant\./,
      ),
    ).toBeTruthy();

    // The import affordance disappears once the batch is imported.
    expect(
      screen.queryByRole("button", { name: "Import device observation" }),
    ).toBeNull();

    // Two entries now read "Blood Pressure Systolic: 120 mmHg" (the
    // canonical view and its winning device source) — search by the
    // canonical observation id to isolate the canonical entry.
    fireEvent.change(screen.getByLabelText(/Search your DataBox/), {
      target: { value: "obs_SYNTH-obs-bp-canonical-0006" },
    });
    expect(screen.getByText("Showing 1 of 6 observations.")).toBeTruthy();

    // The canonical entry's disclosure shows per-source provenance.
    const canonicalToggle = screen.getByRole("button", {
      name: /Blood Pressure Systolic: 120 mmHg/,
    });
    fireEvent.click(canonicalToggle);
    expect(screen.getByText("Reconciled view — verdict:")).toBeTruthy();
    expect(
      screen.getByText(
        /Canonical: Automatic cuff sync · IMPORTED · quality 0\.95 · 120 mmHg \(obs_SYNTH-obs-bp-device-0005\)/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Superseded: Manual entry — home BP cuff reading · MEASURED · quality 0\.9 · 118 mmHg \(obs_SYNTH-obs-bp-manual-0001\)/,
      ),
    ).toBeTruthy();
  });
});

describe("DataboxControls (the honest entry points)", () => {
  it("wires share + revoke to the existing consent section and labels export/access-history forthcoming", () => {
    render(<DataboxControls />);

    const share = screen.getByRole("link", { name: "Share with clinician" });
    expect(share.getAttribute("href")).toBe("#sharing");
    const revoke = screen.getByRole("link", { name: "Revoke access" });
    expect(revoke.getAttribute("href")).toBe("#sharing");

    // Forthcoming entries are inert and honestly labeled — never fake.
    expect(screen.getAllByText("forthcoming")).toHaveLength(2);
    expect(
      screen.getByText("Export your data", { exact: true }).tagName,
    ).not.toBe("A");
    expect(screen.getByText(/exports are not built yet/)).toBeTruthy();
    expect(screen.getByText(/access audit log is not surfaced yet/)).toBeTruthy();
  });
});
