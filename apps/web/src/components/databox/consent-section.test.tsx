// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConsentSection } from "./consent-section";

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

describe("ConsentSection (share with clinician flow)", () => {
  it("starts unshared and does not render the sheet", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    expect(screen.getByText(/Not shared with SYNTH-Clinic-A yet\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share with clinician" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a focused modal sheet with the i18n-overridden labels", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    fireEvent.click(screen.getByRole("button", { name: "Share with clinician" }));

    const dialog = screen.getByRole("dialog", { name: "Share with clinician" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Focus moved into the sheet (WAI-ARIA dialog pattern).
    expect(document.activeElement).toBe(dialog);

    expect(screen.getByText("Why this is requested")).toBeTruthy();
    expect(screen.getByText("Exactly what is shared")).toBeTruthy();
    expect(screen.getByText("Sharing ends")).toBeTruthy();
    expect(screen.getByText(/SYNTH-Clinic-A requested read access/)).toBeTruthy();
    expect(screen.getByText("Resting heart rate observations (read-only)")).toBeTruthy();
    expect(screen.getByText("Dec 31, 2026")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Grant access" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Revoke access" })).toBeTruthy();
  });

  it("confirm grants access, closes the sheet and announces politely", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    fireEvent.click(screen.getByRole("button", { name: "Share with clinician" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("Shared with SYNTH-Clinic-A until Dec 31, 2026."),
    ).toBeTruthy();
    expect(screen.getByText("Active share")).toBeTruthy();
    expect(
      screen.getByText(/Share confirmed: SYNTH-Clinic-A can read the scoped data/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review share" })).toBeTruthy();
  });

  it("revoke ends access and closes the sheet", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    // Grant first, then revoke through the sheet.
    fireEvent.click(screen.getByRole("button", { name: "Share with clinician" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    fireEvent.click(screen.getByRole("button", { name: "Review share" }));
    expect(screen.getByRole("dialog", { name: "Share with clinician" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Access for SYNTH-Clinic-A was revoked\./)).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share again" })).toBeTruthy();
  });

  it("escape dismisses the sheet without changing the grant", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    fireEvent.click(screen.getByRole("button", { name: "Share with clinician" }));
    const dialog = screen.getByRole("dialog", { name: "Share with clinician" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // Escape is a dismissal, not a decision: the grant stays pending.
    expect(screen.getByText(/Not shared with SYNTH-Clinic-A yet\./)).toBeTruthy();
  });

  it("re-shares after a revocation (confirm on a revoked grant)", () => {
    stubMatchMedia(false);
    render(<ConsentSection />);
    fireEvent.click(screen.getByRole("button", { name: "Share with clinician" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    fireEvent.click(screen.getByRole("button", { name: "Review share" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    fireEvent.click(screen.getByRole("button", { name: "Share again" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));

    expect(
      screen.getByText("Shared with SYNTH-Clinic-A until Dec 31, 2026."),
    ).toBeTruthy();
  });
});
