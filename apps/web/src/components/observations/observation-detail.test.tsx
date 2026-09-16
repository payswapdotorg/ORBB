// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ObservationDetail } from "./observation-detail";
import {
  DEVICE_BP_IMPORT_OBSERVATION,
  ESTIMATED_TEMPERATURE_FIXTURE,
  MANUAL_BP_FIXTURE,
  buildImportedFixtureForTests,
} from "@/lib/observations/testsupport";

/**
 * Observation detail tests (M6-B B5): the §Provenance UX chain renders
 * field-for-field in the frozen order; the measured-vs-estimated teaching
 * is explicit text (never color alone); the RECONCILED case shows
 * per-source provenance for BOTH originals with their roles and verdict.
 */

afterEach(() => {
  cleanup();
});

describe("ObservationDetail (the provenance chain)", () => {
  it("renders the full chain in the frozen order for a manual observation", () => {
    render(<ObservationDetail view={MANUAL_BP_FIXTURE} />);

    expect(screen.getByText("Observation provenance")).toBeTruthy();
    expect(screen.getByText("Blood Pressure Systolic: 118 mmHg")).toBeTruthy();
    expect(screen.getByText("MEASURED", { exact: true })).toBeTruthy();
    expect(
      screen.getAllByText("Pending — awaiting the validation layer").length,
    ).toBeGreaterThanOrEqual(1);

    // The chain fields, in order.
    expect(screen.getByText(/You \(SYNTH-Person-1, self-tracking\) · Manual entry/)).toBeTruthy();
    expect(screen.getByText(/Manual entry — home BP cuff reading \(SYNTH-method-bpsys-manual\)/)).toBeTruthy();
    expect(screen.getByText(/Person: You \(SYNTH-Person-1\) with a home BP cuff/)).toBeTruthy();
    expect(screen.getByText(/Captured Today, 07:42 · recorded Today, 07:43/)).toBeTruthy();
    expect(screen.getByText("complete", { exact: true })).toBeTruthy();
    expect(screen.getByText(/domain quality score 0.9/)).toBeTruthy();
    expect(screen.getByText(/None — the value is exactly as captured./)).toBeTruthy();
    expect(
      screen.getByText(/SYNTH-EV-0002 — Manual blood pressure log page \(document\)/),
    ).toBeTruthy();
  });

  it("teaches measured vs estimated with explicit sentences (never color alone)", () => {
    render(<ObservationDetail view={ESTIMATED_TEMPERATURE_FIXTURE} />);

    expect(screen.getByText("This value is ESTIMATED.")).toBeTruthy();
    expect(
      screen.getByText(
        /Estimated — derived from an image or a recollection, not measured directly\. It carries uncertainty\./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Estimated from an image — the true reading may differ. This is NOT a direct measurement.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Estimate model: SYNTH-thermo-estimator v0.3")).toBeTruthy();
    // The teaching block is labeled for tests + a11y assertions.
    expect(
      screen.getByText("This value is ESTIMATED.").closest("[data-evidence-teaching]"),
    ).not.toBeNull();
  });

  it("states the honest evidence gap for capture observations without a DataBox record", () => {
    const { evidence, ...view } = MANUAL_BP_FIXTURE;
    expect(evidence).toBeDefined(); // the seeded fixture normally has one
    const { container } = render(<ObservationDetail view={view} />);
    expect(
      screen.getByText(/No evidence record yet — the DataBox evidence wiring/),
    ).toBeTruthy();
    expect(container.querySelector("a[href='/databox']")).toBeNull();
  });

  it("renders the reconciled case: per-source provenance with roles, verdict, and source links", () => {
    const { canonical, imported, superseded } = buildImportedFixtureForTests();
    render(
      <ObservationDetail view={canonical.detail} canonical={canonical} onOpenSource={vi.fn()} />,
    );

    expect(screen.getByText("Two sources, one current value")).toBeTruthy();
    expect(screen.getByText(/Window Today, 07:00–09:00/)).toBeTruthy();
    expect(screen.getByText("discordant", { exact: true })).toBeTruthy();
    expect(
      screen.getByText(/The two sources disagreed — the divergence is flagged, never hidden\./),
    ).toBeTruthy();

    // Per-source provenance rows: canonical + superseded, both inspectable.
    expect(screen.getByText("Canonical source", { exact: true })).toBeTruthy();
    expect(screen.getByText("Superseded", { exact: true })).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(`${imported.method.label} · ${imported.evidenceLabel} · quality ${imported.quality.score}`),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`${superseded.method.label} · ${superseded.evidenceLabel}`)),
    ).toBeTruthy();
    expect(screen.getByText(/120 mmHg · captured Today, 08:02/)).toBeTruthy();
    expect(screen.getByText(/118 mmHg · captured Today, 07:42/)).toBeTruthy();
    expect(
      screen.getByText(/Nothing is discarded: the superseded source keeps its full provenance/),
    ).toBeTruthy();

    // The canonical detail itself is DERIVED/synthesized with the
    // reconciliation transformation in its chain.
    expect(screen.getByText("This value is DERIVED.")).toBeTruthy();
    expect(screen.getByText("Reconciliation:", { exact: true })).toBeTruthy();
  });

  it("opens per-source details through the provided callback", () => {
    const onOpenSource = vi.fn();
    const { canonical } = buildImportedFixtureForTests();
    render(
      <ObservationDetail
        view={canonical.detail}
        canonical={canonical}
        onOpenSource={onOpenSource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Inspect this source \(Device adapter import\)/ }));
    expect(onOpenSource).toHaveBeenCalledWith(DEVICE_BP_IMPORT_OBSERVATION.id);
  });

  it("does not render the reconciled panel for a plain observation", () => {
    const { container } = render(<ObservationDetail view={MANUAL_BP_FIXTURE} />);
    expect(container.querySelector("[data-reconciled-view]")).toBeNull();
  });
});
