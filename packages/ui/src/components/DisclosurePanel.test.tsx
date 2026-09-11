// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DisclosurePanel } from "./DisclosurePanel";
import { touchTarget } from "../tokens";

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

describe("DisclosurePanel", () => {
  it("renders a collapsed panel by default", () => {
    render(<DisclosurePanel title="Synthetic section">Panel body</DisclosurePanel>);
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Panel body")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("expands and collapses on header activation (uncontrolled)", () => {
    render(<DisclosurePanel title="Synthetic section">Panel body</DisclosurePanel>);
    const header = screen.getByRole("button", { name: "Synthetic section" });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const body = screen.getByRole("region");
    expect(body.textContent).toBe("Panel body");

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps aria-controls and aria-labelledby mutually wired", () => {
    render(
      <DisclosurePanel title="Synthetic section" id="synthetic-panel">
        Panel body
      </DisclosurePanel>,
    );
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect(header.getAttribute("aria-controls")).toBe("synthetic-panel-body");
    fireEvent.click(header);
    const body = screen.getByRole("region");
    expect(body.id).toBe("synthetic-panel-body");
    expect(body.getAttribute("aria-labelledby")).toBe(header.id);
  });

  it("supports controlled open state and reports toggles", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <DisclosurePanel title="Synthetic section" open onOpenChange={onOpenChange}>
        Panel body
      </DisclosurePanel>,
    );
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect(screen.getByRole("region").textContent).toBe("Panel body");

    fireEvent.click(header);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Controlled: the panel stays open until the owner changes the prop.
    expect(header.getAttribute("aria-expanded")).toBe("true");

    rerender(
      <DisclosurePanel title="Synthetic section" open={false} onOpenChange={onOpenChange}>
        Panel body
      </DisclosurePanel>,
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders a type=button header so it never submits a surrounding form", () => {
    render(<DisclosurePanel title="Synthetic section">Panel body</DisclosurePanel>);
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect(header.getAttribute("type")).toBe("button");
  });

  it("guarantees the 44px minimum touch target on the header", () => {
    render(<DisclosurePanel title="Synthetic section">Panel body</DisclosurePanel>);
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect(Number.parseInt(header.style.minHeight, 10)).toBeGreaterThanOrEqual(
      touchTarget.minimum,
    );
  });

  it("respects reduced motion by removing transitions", () => {
    stubMatchMedia(true);
    render(<DisclosurePanel title="Synthetic section" defaultOpen>Panel body</DisclosurePanel>);
    const body = screen.getByRole("region");
    expect(body.style.transition).toBe("none");
    const chevron = screen
      .getByRole("button", { name: "Synthetic section" })
      .querySelector("svg");
    expect(chevron instanceof SVGElement ? chevron.style.transition : "").toBe(
      "none",
    );
  });

  it("settles the enter animation after the first frame", async () => {
    // Vitest's jsdom provides requestAnimationFrame, so the panel starts
    // off-stage and settles on the next frame.
    render(<DisclosurePanel title="Synthetic section" defaultOpen>Panel body</DisclosurePanel>);
    const body = screen.getByRole("region");
    expect(body.style.transition).not.toBe("none");
    await waitFor(() => expect(body.style.opacity).toBe("1"));
    expect(body.style.transform).toBe("translateY(0)");
  });

  it("does not toggle when disabled", () => {
    render(
      <DisclosurePanel title="Synthetic section" disabled>
        Panel body
      </DisclosurePanel>,
    );
    const header = screen.getByRole("button", { name: "Synthetic section" });
    expect((header as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(header);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
