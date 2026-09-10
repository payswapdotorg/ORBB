// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlaceholderPage } from "./placeholder-page";

afterEach(cleanup);

describe("PlaceholderPage", () => {
  it("renders the page title as the h1 and the synthetic M6+ notice", () => {
    render(
      <PlaceholderPage
        title="DataBox"
        description="Your personal health evidence store with provenance and sharing controls."
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "DataBox" });
    expect(heading).toBeInstanceOf(HTMLHeadingElement);
    expect(
      screen.getByRole("heading", { level: 2, name: "Coming in M6+" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/synthetic placeholder screen/i),
    ).toBeTruthy();
  });

  it("states that no real medical data is used", () => {
    render(<PlaceholderPage title="Overview" description="desc" />);
    expect(screen.getByText(/no real credentials/i)).toBeTruthy();
  });
});
