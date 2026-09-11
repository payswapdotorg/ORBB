// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConsentSheet } from "./ConsentSheet";

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

const baseProps = {
  open: true,
  onClose: vi.fn(),
  title: "Share synthetic records",
  purpose: "Supports your synthetic coaching plan",
  scope: ["Synthetic readings (30 days)", "Synthetic notes"],
  expiry: "Oct 10, 2026",
};

describe("ConsentSheet", () => {
  it("renders nothing while closed", () => {
    render(<ConsentSheet {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("renders a named modal dialog when open", () => {
    render(<ConsentSheet {...baseProps} />);
    const dialog = screen.getByRole("dialog", { name: "Share synthetic records" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders the purpose block, scope list and expiry row", () => {
    render(<ConsentSheet {...baseProps} />);
    expect(screen.getByText("Purpose")).toBeTruthy();
    expect(screen.getByText("Supports your synthetic coaching plan")).toBeTruthy();
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("Synthetic readings (30 days)")).toBeTruthy();
    expect(screen.getByText("Synthetic notes")).toBeTruthy();
    expect(screen.getByText("Expiry")).toBeTruthy();
    expect(screen.getByText("Oct 10, 2026")).toBeTruthy();
  });

  it("renders Confirm and Revoke action buttons with default labels", () => {
    render(<ConsentSheet {...baseProps} onConfirm={vi.fn()} onRevoke={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("invokes the confirm and revoke callbacks without closing itself", () => {
    const onConfirm = vi.fn();
    const onRevoke = vi.fn();
    const onClose = vi.fn();
    render(
      <ConsentSheet {...baseProps} onClose={onClose} onConfirm={onConfirm} onRevoke={onRevoke} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
    // Purely presentational: the shell never decides to close on actions.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes through the escape key", () => {
    const onClose = vi.fn();
    render(<ConsentSheet {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes through the close button", () => {
    const onClose = vi.fn();
    render(<ConsentSheet {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop itself is clicked", () => {
    const onClose = vi.fn();
    render(<ConsentSheet {...baseProps} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement?.firstElementChild;
    expect(backdrop).toBeInstanceOf(HTMLDivElement);
    if (backdrop instanceof HTMLDivElement) {
      fireEvent.mouseDown(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("moves focus into the dialog on open and restores it on unmount", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open sheet";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<ConsentSheet {...baseProps} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });

  it("traps Tab focus within the dialog", () => {
    render(<ConsentSheet {...baseProps} onConfirm={vi.fn()} onRevoke={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const close = screen.getByRole("button", { name: "Close" });

    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    // Tab from the last focusable element wraps to the first.
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first focusable element wraps to the last.
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("locks body scrolling while open and restores it on unmount", () => {
    const { unmount } = render(<ConsentSheet {...baseProps} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("skips the slide/fade animation under reduced motion", () => {
    stubMatchMedia(true);
    render(<ConsentSheet {...baseProps} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.transition).toBe("none");
    expect(dialog.style.transform).toBe("translateY(0)");
    const backdrop = dialog.parentElement?.firstElementChild;
    if (backdrop instanceof HTMLElement) {
      expect(backdrop.style.transition).toBe("none");
    }
  });

  it("supports custom action and section labels", () => {
    render(
      <ConsentSheet
        {...baseProps}
        confirmLabel="Allow"
        revokeLabel="Withdraw"
        closeLabel="Dismiss sheet"
        purposeLabel="Reason"
        scopeLabel="Shared data"
        expiryLabel="Valid until"
      />,
    );
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss sheet" })).toBeTruthy();
    expect(screen.getByText("Reason")).toBeTruthy();
    expect(screen.getByText("Shared data")).toBeTruthy();
    expect(screen.getByText("Valid until")).toBeTruthy();
  });
});
