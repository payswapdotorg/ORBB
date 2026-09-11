// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sparkline, sparklinePoints } from "./Sparkline";

afterEach(cleanup);

describe("sparklinePoints (pure)", () => {
  it("returns an empty string for empty data", () => {
    expect(sparklinePoints([], 120, 36)).toBe("");
  });

  it("maps the extremes onto the padded box", () => {
    // padding 2: x runs 2 → 118, y runs 34 (min) → 2 (max).
    expect(sparklinePoints([0, 10], 120, 36, 2)).toBe("2,34 118,2");
  });

  it("scales intermediate values proportionally", () => {
    expect(sparklinePoints([0, 5, 10], 120, 36, 2)).toBe("2,34 60,18 118,2");
  });

  it("renders constant data as a flat center line", () => {
    expect(sparklinePoints([7, 7, 7], 120, 36, 2)).toBe("2,18 60,18 118,18");
  });

  it("handles negative values", () => {
    expect(sparklinePoints([-10, 10], 120, 36, 2)).toBe("2,34 118,2");
  });

  it("collapses a single point onto the left padding edge", () => {
    expect(sparklinePoints([5], 120, 36, 2)).toBe("2,18");
  });
});

describe("Sparkline", () => {
  it("exposes the chart as a named image via role=img + aria-label", () => {
    render(
      <Sparkline data={[1, 2, 3]} summary="Synthetic daily trend, increasing" />,
    );
    const chart = screen.getByRole("img", { name: "Synthetic daily trend, increasing" });
    expect(chart).toBeInstanceOf(SVGSVGElement);
  });

  it("renders a polyline and a last-point marker for a series", () => {
    const { container } = render(<Sparkline data={[1, 2, 1]} summary="Synthetic trend" />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")).toBe(sparklinePoints([1, 2, 1], 120, 36, 2));
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("renders only the marker for a single-point series", () => {
    const { container } = render(<Sparkline data={[5]} summary="Synthetic single value" />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("renders an empty image for an empty series", () => {
    const { container } = render(<Sparkline data={[]} summary="No synthetic data yet" />);
    expect(screen.getByRole("img", { name: "No synthetic data yet" })).toBeTruthy();
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("circle")).toBeNull();
  });

  it("honours custom dimensions", () => {
    render(<Sparkline data={[0, 10]} summary="Synthetic trend" width={200} height={50} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("width")).toBe("200");
    expect(chart.getAttribute("viewBox")).toBe("0 0 200 50");
  });
});
