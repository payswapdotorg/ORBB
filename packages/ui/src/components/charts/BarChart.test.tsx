// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BarChart, barChartGeometry } from "./BarChart";

afterEach(cleanup);

describe("barChartGeometry (pure)", () => {
  it("returns an empty array for empty data", () => {
    expect(barChartGeometry([], 320, 160)).toEqual([]);
  });

  it("sizes every bar equally and fills the plot area for the max value", () => {
    const geometry = barChartGeometry(
      [
        { label: "a", value: 0 },
        { label: "b", value: 10 },
      ],
      320,
      160,
      { padding: 4, gap: 6, labelArea: 18 },
    );
    // innerWidth = 320 - 8 = 312; barWidth = (312 - 6) / 2 = 153
    // plotHeight = 160 - 8 - 18 = 134
    expect(geometry).toHaveLength(2);
    expect(geometry[0]).toMatchObject({
      x: 4,
      y: 138,
      width: 153,
      height: 0,
      label: "a",
    });
    expect(geometry[1]).toMatchObject({
      x: 163,
      y: 4,
      width: 153,
      height: 134,
      label: "b",
    });
  });

  it("scales bars proportionally to the maximum", () => {
    const geometry = barChartGeometry(
      [
        { label: "a", value: 5 },
        { label: "b", value: 10 },
      ],
      320,
      160,
      { padding: 4, gap: 6, labelArea: 18 },
    );
    expect(geometry[0]?.height).toBe(67);
    expect(geometry[1]?.height).toBe(134);
  });

  it("clamps negative values to zero-height bars", () => {
    const geometry = barChartGeometry(
      [
        { label: "a", value: -5 },
        { label: "b", value: 10 },
      ],
      320,
      160,
      { padding: 4, gap: 6, labelArea: 18 },
    );
    expect(geometry[0]?.height).toBe(0);
    expect(geometry[0]?.value).toBe(-5);
  });

  it("renders zero-height bars when all values are zero", () => {
    const geometry = barChartGeometry(
      [
        { label: "a", value: 0 },
        { label: "b", value: 0 },
      ],
      320,
      160,
    );
    for (const bar of geometry) {
      expect(bar.height).toBe(0);
    }
  });
});

describe("BarChart", () => {
  const data = [
    { label: "Mon", value: 3 },
    { label: "Tue", value: 9 },
    { label: "Wed", value: 6 },
  ];

  it("exposes the chart as a named image via role=img + aria-label", () => {
    render(
      <BarChart data={data} summary="Synthetic completions by weekday, Tuesday highest" />,
    );
    const chart = screen.getByRole("img", {
      name: "Synthetic completions by weekday, Tuesday highest",
    });
    expect(chart).toBeInstanceOf(SVGSVGElement);
  });

  it("renders one rect per datum with proportional heights", () => {
    const { container } = render(<BarChart data={data} summary="Synthetic counts" />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(3);
    // -1 sentinel: a missing rect fails every ordering comparison below.
    const heightOf = (index: number): number => {
      const rect = rects[index];
      return rect === undefined
        ? -1
        : Number.parseFloat(rect.getAttribute("height") ?? "-1");
    };
    expect(heightOf(0)).toBeLessThan(heightOf(1));
    expect(heightOf(2)).toBeGreaterThan(heightOf(0));
    expect(heightOf(2)).toBeLessThan(heightOf(1));
  });

  it("renders value labels under the bars by default", () => {
    const { container } = render(<BarChart data={data} summary="Synthetic counts" />);
    const labels = container.querySelectorAll("text");
    expect(labels).toHaveLength(3);
    expect(labels[0]?.textContent).toBe("Mon");
  });

  it("omits labels when showLabels is false", () => {
    const { container } = render(
      <BarChart data={data} summary="Synthetic counts" showLabels={false} />,
    );
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("renders an empty named image for empty data", () => {
    const { container } = render(<BarChart data={[]} summary="No synthetic data yet" />);
    expect(screen.getByRole("img", { name: "No synthetic data yet" })).toBeTruthy();
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("honours custom dimensions", () => {
    render(<BarChart data={data} summary="Synthetic counts" width={480} height={240} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("width")).toBe("480");
    expect(chart.getAttribute("viewBox")).toBe("0 0 480 240");
  });
});
