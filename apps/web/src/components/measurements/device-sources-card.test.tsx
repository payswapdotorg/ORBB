// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceSourcesCard } from "./device-sources-card";
import type { ObservationDetailView, ReconciledObservationView } from "@/lib/observations/types";

/**
 * Device sources card tests (M6-B B5, golden journey #2's entry): the
 * registered sources render, the import act fires the route, and the
 * reconciliation (when it happens) renders with per-source provenance;
 * when it does not, the honest note renders verbatim — never a fake.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fetch signature the card reads/writes through. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function importedDetail(): ObservationDetailView {
  return {
    observationId: "obs_SYNTH-import-hr-000001",
    personId: "prsn_SYNTH-person-0001",
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    conceptCode: "SYNTH-8867-4",
    value: 62,
    unit: "beats/min",
    valueLabel: "62 beats/min",
    capturedBy: {
      kind: "device-adapter",
      actorLabel: "SYNTH-Device-A (automatic sync)",
      actorId: "dev_SYNTH-Device-A",
      sourceId: "src_SYNTH-source-device-a",
      sourceLabel: "SYNTH-Device-A (registered wearable)",
    },
    method: {
      methodId: "SYNTH-method-wearable-heart-rate",
      methodLabel: "Wearable sync — resting pulse",
      kind: "device",
    },
    deviceOrPerson: "SYNTH-Device-A (registered wearable)",
    time: {
      effectiveAt: "2025-09-15T13:55:00.000Z",
      observedAt: "2025-09-15T14:00:00.000Z",
      effectiveLabel: "Today, 13:55",
      observedLabel: "Today, 14:00",
    },
    quality: {
      state: "complete",
      score: 0.92,
      stateLabel: "Complete",
      note: "Device-typical quality.",
    },
    validation: { state: "validated", note: "Validated — the winning source." },
    evidenceLabel: "IMPORTED",
    evidenceState: "imported",
    evidenceStateNote: "Imported — synced from an external source.",
    transformations: [
      {
        id: "xf_SYNTH-unit-normalization-hr-0001",
        label: "Unit normalization",
        description: "Raw wearable sample 1.03 beats/s → 62 beats/min.",
        appliedAt: "2025-09-15T14:00:00.000Z",
        seam: "M4-C device-adapter seam",
      },
    ],
    evidence: {
      evidenceId: "SYNTH-EV-IMPORT-0001",
      summary: "Resting heart rate raw sample batch",
      mediaType: "waveform",
      checksumPrefix: "sha256-SYNTH-3f9a61c2",
      retentionClass: "SYNTH-RT-2Y",
      location: "session",
    },
    modelVersion: "No model involved — direct capture",
  };
}

function reconciledView(): ReconciledObservationView {
  return {
    personId: "prsn_SYNTH-person-0001",
    metricId: "SYNTH-metric-heart-rate",
    metricLabel: "Heart Rate",
    conceptCode: "SYNTH-8867-4",
    value: 62,
    unit: "beats/min",
    valueLabel: "62 beats/min",
    window: { startsAt: "2025-09-15T00:00:00.000Z", endsAt: "2025-09-15T23:59:59.999Z" },
    verdict: "discordant",
    canonicalObservationId: "obs_SYNTH-recon-hr-000001",
    sources: [
      {
        observationId: "obs_SYNTH-import-hr-000001",
        sourceId: "src_SYNTH-source-device-a",
        sourceLabel: "SYNTH-Device-A (registered wearable)",
        methodId: "SYNTH-method-wearable-heart-rate",
        methodLabel: "Wearable sync — resting pulse",
        evidenceLabel: "IMPORTED",
        evidenceState: "imported",
        quality: 0.92,
        role: "canonical-source",
        roleLabel: "Canonical source (won the ranking)",
      },
      {
        observationId: "obs_SYNTH-seed-hr-manual-0001",
        sourceId: "src_SYNTH-source-manual",
        sourceLabel: "Manual entry (this device)",
        methodId: "SYNTH-method-hr-manual",
        methodLabel: "Manual pulse check",
        evidenceLabel: "MEASURED",
        evidenceState: "measured",
        quality: 0.7,
        role: "superseded-source",
        roleLabel: "Superseded source (kept with provenance)",
      },
    ],
    reconciledAt: "2025-09-15T14:00:00.000Z",
    reconciliationProvenanceId: "prov_SYNTH-obs-store-000001",
    verdictNote: "Discordant — the divergence is flagged, never hidden.",
  };
}

function importResponse(
  reconciled: ReconciledObservationView | null,
  note: string,
): Response {
  return new Response(
    JSON.stringify({
      synthetic: true,
      observation: importedDetail(),
      reconciled,
      reconciliationNote: note,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetchWith(responses: Response[]): ReturnType<typeof vi.fn<FetchLike>> {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DeviceSourcesCard (journey #2's entry)", () => {
  it("renders the registered sources (wearable + manual) with the import act", () => {
    stubFetchWith([importResponse(null, "No duplicate manual source.")]);
    render(<DeviceSourcesCard onOpenObservation={() => {}} />);
    expect(screen.getByText("Device sources")).toBeTruthy();
    expect(screen.getByText("SYNTH-Device-A (registered wearable)")).toBeTruthy();
    expect(screen.getByText(/src_SYNTH-source-device-a · heart rate/)).toBeTruthy();
    expect(screen.getByText("Manual entry (this device)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import latest sample" })).toBeTruthy();
  });

  it("imports the sample and renders the reconciliation with per-source provenance", async () => {
    const onOpenObservation = vi.fn();
    stubFetchWith([
      importResponse(
        reconciledView(),
        "Duplicate sources reconciled: the wearable import and your manual pulse check reconciled into one canonical view — discordant.",
      ),
    ]);
    render(<DeviceSourcesCard onOpenObservation={onOpenObservation} />);

    fireEvent.click(screen.getByRole("button", { name: "Import latest sample" }));
    await waitFor(() => {
      expect(screen.getByText("Reconciled — one canonical value")).toBeTruthy();
    });
    expect(screen.getByText("Heart Rate 62 beats/min")).toBeTruthy();
    expect(screen.getByText("Discordant sources")).toBeTruthy();
    expect(screen.getByText("Canonical source (won the ranking)")).toBeTruthy();
    expect(screen.getByText("Superseded source (kept with provenance)")).toBeTruthy();
    expect(
      screen.getByText(/Duplicate sources reconciled: the wearable import/),
    ).toBeTruthy();

    // The per-source inspect affordances open each source's detail.
    const buttons = screen.getAllByRole("button", { name: /Inspect provenance of / });
    fireEvent.click(buttons[0]!);
    expect(onOpenObservation).toHaveBeenCalledWith("obs_SYNTH-import-hr-000001");
    fireEvent.click(
      screen.getByRole("button", { name: /Inspect the imported observation's provenance/ }),
    );
    expect(onOpenObservation).toHaveBeenCalledWith("obs_SYNTH-import-hr-000001");
  });

  it("renders the honest no-reconciliation note verbatim when nothing reconciled", async () => {
    stubFetchWith([
      importResponse(null, "No duplicate manual source in today's window — the import was recorded without reconciliation."),
    ]);
    render(<DeviceSourcesCard onOpenObservation={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Import latest sample" }));
    await waitFor(() => {
      expect(
        screen.getByText(/No duplicate manual source in today's window/),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Reconciled — one canonical value")).toBeNull();
  });

  it("surfaces import failures from the error envelope", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          error: { code: "internal-error", message: "An internal error occurred.", requestId: "SYNTH-REQ-000001" },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<DeviceSourcesCard onOpenObservation={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Import latest sample" }));
    await waitFor(() => {
      expect(screen.getByText(/Could not import the device sample/)).toBeTruthy();
    });
  });
});
