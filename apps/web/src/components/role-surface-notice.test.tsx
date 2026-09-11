// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RoleProvider, useRole } from "./role-provider";
import { RoleSurfaceNotice } from "./role-surface-notice";

afterEach(cleanup);

/** Minimal role-switching harness (avoids `next/navigation` deps). */
function RoleHarness({ surface }: { surface: "databox" | "care" | "overview" }) {
  const { setRole } = useRole();
  return (
    <div>
      <RoleSurfaceNotice surface={surface} />
      <label>
        <input type="radio" name="harness-role" onChange={() => setRole("clinician")} />
        Clinician
      </label>
    </div>
  );
}

function renderHarness(surface: "databox" | "care" | "overview") {
  return render(
    <RoleProvider>
      <RoleHarness surface={surface} />
    </RoleProvider>,
  );
}

describe("RoleProvider + RoleSurfaceNotice", () => {
  it("defaults to the Person role (DataBox is emphasized for Person)", () => {
    renderHarness("databox");
    expect(
      screen.getByText("DataBox is emphasized for the Person role."),
    ).toBeTruthy();
  });

  it("announces emphasis changes politely when the role switches", () => {
    renderHarness("databox");
    fireEvent.click(screen.getByRole("radio", { name: "Clinician" }));
    const notice = screen.getByText(
      "DataBox is emphasized for the Clinician role.",
    );
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.getAttribute("data-surface-emphasized")).toBe("true");
  });

  it("reflects de-emphasis for surfaces the role does not emphasize", () => {
    renderHarness("overview");
    fireEvent.click(screen.getByRole("radio", { name: "Clinician" }));
    const notice = screen.getByText("Overview is not emphasized for the Clinician role.");
    expect(notice.getAttribute("data-surface-emphasized")).toBe("false");
  });

  it("keeps the Person role from emphasizing Care", () => {
    renderHarness("care");
    expect(screen.getByText("Care is not emphasized for the Person role.")).toBeTruthy();
  });
});
