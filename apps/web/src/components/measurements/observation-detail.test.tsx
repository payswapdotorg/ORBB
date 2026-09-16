// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ObservationDetail, ReconciledViewCard } from "./observation-detail";
import type {
  ObservationDetailView,
  ReconciledObservationView,
} from "@/lib/observations/types";

/**
 * Observation/provenance detail tests (M6-B B5): the full §Provenance UX
 * chain renders field by field, the measured-vs-estimated teaching states
 * are explicit text (never color alone), and the reconciled canonical
 * view shows PER-SOURCE provenance with inspect affordances.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fetch signature the detail reads through. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function detail(overrides: Partial<ObservationDetailView> = {}): ObservationDetailView {
  return {
    observationId: "obs_SYNTH-corpus-temp-0003",
    personId: "prsn_SYNTH-person-0001",
    metricId: "SYNTH-metric-body-temperature",
    metricLabel: "Body Temperature",
    conceptCode: "SYNTH-8310-5",
    value: 36.8,
    unit: "°C",
    valueLabel: "36.8 °C (estimated from an image)",
    capturedBy: {
      kind: "synthesized",
      actorLabel: "SYNTH-Person-1 (synthesized corpus fixture)",
      actorId: "prsn_SYNTH-person-0001",
      sourceId: "src_SYNTH-source-fixture",
      sourceLabel: "Synthesized fixture (SYNTH corpus)",
    },
    method: {
      methodId: "SYNTH-method-temp-photo-estimate",
      methodLabel: "Thermometer photo estimate",
      kind: "app",
    },
    deviceOrPerson: "SYNTH-ThermoVision v2.1 (estimation model) over your photo",
    time: {
      effectiveAt: "2026-09-09T20:31:00.000Z",
      observedAt: "2026-09-09T20:31:00.000Z",
      effectiveLabel: "Sep 9 (reference), 20:31",
      observedLabel: "Sep 9 (reference), 20:31",
    },
    quality: {
      state: "partial",
      score: 0.6,
      stateLabel: "Partial",
      note: "Estimation-typical quality (0.6 of 1.0).",
    },
    validation: {
      state: "validated",
      note: "Validated — the photo passed the readability checks; the ESTIMATE label stays.",
    },
    evidenceLabel: "ESTIMATED",
    evidenceState: "estimated",
    evidenceStateNote:
      "Estimated — this value was derived from a recollection or an image, not measured directly.",
    transformations: [
      {
        id: "xf_SYNTH-temp-photo-estimate-0001",
        label: "Image estimation",
        description: "The thermometer reading in the photo was estimated by the model.",
        appliedAt: "2026-09-09T20:31:00.000Z",
        seam: "M9 extension sandbox (estimation seam)",
      },
    ],
    evidence: {
      evidenceId: "SYNTH-EV-0003",
      summary: "Thermometer reading photo",
      mediaType: "image",
      checksumPrefix: "sha256-SYNTH-0aa3cd17",
      retentionClass: "SYNTH-RT-90D",
      location: "databox-corpus",
    },
    modelVersion: "SYNTH-ThermoVision v2.1 (thermometer-photo estimation)",
    ...overrides,
  };
}

function stubFetchWith(responses: Response[]): void {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchLike>(async () => {
      const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
      call += 1;
      return response;
    }),
  );
}

describe("ObservationDetail (the §Provenance UX chain)", () => {
  it("renders the full chain: captured by → method → device/person → time → quality → validation → transformations → evidence", async () => {
    stubFetchWith([
      new Response(JSON.stringify({ synthetic: true, observation: detail() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    render(<ObservationDetail observationId="obs_SYNTH-corpus-temp-0003" />);

    await waitFor(() => {
      expect(screen.getByText("Captured by")).toBeTruthy();
    });
    expect(screen.getByText("Method")).toBeTruthy();
    expect(screen.getByText("Device / Person")).toBeTruthy();
    expect(screen.getByText("Time")).toBeTruthy();
    expect(screen.getByText("Quality")).toBeTruthy();
    expect(screen.getByText("Validation")).toBeTruthy();
    expect(screen.getByText("Transformations")).toBeTruthy();
    expect(screen.getByText("Original evidence (DataBox)")).toBeTruthy();

    expect(screen.getByText("SYNTH-Person-1 (synthesized corpus fixture)")).toBeTruthy();
    expect(screen.getByText("Thermometer photo estimate")).toBeTruthy();
    expect(screen.getAllByText(/SYNTH-ThermoVision v2.1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Clinically relevant: Sep 9/)).toBeTruthy();
    expect(screen.getByText(/Partial — score 0.6 of 1.0/)).toBeTruthy();
    expect(screen.getByText("Image estimation")).toBeTruthy();
    expect(screen.getByText("Model version")).toBeTruthy();
    expect(screen.getByText(/SYNTH-EV-0003 — Thermometer reading photo/)).toBeTruthy();
  });

  it("teaches the measured-vs-estimated distinction with explicit state text", async () => {
    stubFetchWith([
      new Response(JSON.stringify({ synthetic: true, observation: detail() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    render(<ObservationDetail observationId="obs_SYNTH-corpus-temp-0003" />);
    await waitFor(() => {
      expect(screen.getByText("Estimated — ESTIMATED")).toBeTruthy();
    });
    expect(
      screen.getByText(/not measured directly/),
    ).toBeTruthy();
    // The estimation model is named explicitly (never silent).
    expect(screen.getAllByText(/SYNTH-ThermoVision/).length).toBeGreaterThanOrEqual(1);
  });

  it("honestly states 'no raw evidence object' for manual typed entries", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          synthetic: true,
          observation: detail({
            observationId: "obs_SYNTH-obs-000001",
            evidence: null,
            evidenceLabel: "MEASURED",
            evidenceState: "measured",
            evidenceStateNote: "Measured — a device or direct reading produced this value.",
            modelVersion: "No model involved — direct capture",
            transformations: [],
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<ObservationDetail observationId="obs_SYNTH-obs-000001" />);
    await waitFor(() => {
      expect(screen.getByText("Measured — MEASURED")).toBeTruthy();
    });
    expect(
      screen.getByText(/No raw evidence object — the values were typed directly/),
    ).toBeTruthy();
    expect(screen.getByText("None — recorded exactly as captured.")).toBeTruthy();
    expect(screen.getByText("No model involved — direct capture")).toBeTruthy();
  });

  it("renders the reconciliation context with the canonical-view link", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          synthetic: true,
          observation: detail({
            observationId: "obs_SYNTH-seed-hr-manual-0001",
            validation: {
              state: "superseded",
              note: "Superseded — a higher-quality source reconciled over this observation.",
            },
            reconciliation: {
              role: "superseded-source",
              canonicalObservationId: "obs_SYNTH-recon-hr-000001",
              verdict: "discordant",
              note: "This observation lost the reconciliation ranking.",
            },
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<ObservationDetail observationId="obs_SYNTH-seed-hr-manual-0001" />);
    await waitFor(() => {
      expect(screen.getByText(/Reconciliation: superseded-source · verdict discordant/)).toBeTruthy();
    });
    const canonicalLink = screen.getByRole("link", {
      name: "Open the canonical view of this window",
    });
    expect(canonicalLink.getAttribute("href")).toBe(
      "/measurements?observation=obs_SYNTH-recon-hr-000001",
    );
  });

  it("surfaces load failures from the error envelope politely", async () => {
    stubFetchWith([
      new Response(
        JSON.stringify({
          error: { code: "not-found", message: "The observation was not found.", requestId: "SYNTH-REQ-000001" },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    ]);
    render(<ObservationDetail observationId="obs_SYNTH-does-not-exist" />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load the observation: The observation was not found/)).toBeTruthy();
    });
  });
});

describe("ReconciledViewCard (per-source provenance)", () => {
  function view(): ReconciledObservationView {
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
      verdictNote: "Discordant — the two sources disagree; the divergence is flagged, never hidden.",
    };
  }

  it("shows one canonical value with the verdict and BOTH source provenance rows", () => {
    render(<ReconciledViewCard view={view()} />);
    expect(screen.getByText("Heart Rate 62 beats/min")).toBeTruthy();
    expect(screen.getByText("Discordant sources")).toBeTruthy();
    expect(screen.getByText(/never hidden/)).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Canonical source (won the ranking)")).toBeTruthy();
    expect(screen.getByText("Superseded source (kept with provenance)")).toBeTruthy();
    expect(screen.getByText(/Wearable sync — resting pulse · Imported/)).toBeTruthy();
    expect(screen.getByText(/Manual pulse check · Measured/)).toBeTruthy();
    expect(screen.getByText(/quality 0.92/)).toBeTruthy();
    expect(screen.getByText(/quality 0.7/)).toBeTruthy();
    expect(screen.getByText(/nothing discarded/i)).toBeTruthy();
  });

  it("opens each source's full provenance detail through the affordance", () => {
    const onOpenSource = vi.fn();
    render(<ReconciledViewCard view={view()} onOpenSource={onOpenSource} />);
    const buttons = screen.getAllByRole("button", { name: /Inspect provenance of / });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(onOpenSource).toHaveBeenCalledWith("obs_SYNTH-seed-hr-manual-0001");
  });
});
