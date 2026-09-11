// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MeasurementSummaryCard } from "./measurement-summary-card";
import {
  SYNTHETIC_CAPTURE_COUNTS_BY_DAY,
  SYNTHETIC_RESTING_HEART_RATE_SERIES,
} from "@/lib/synthetic-data";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MeasurementSummaryCard", () => {
  it("renders the sparkline as a named image over the recent series", () => {
    render(<MeasurementSummaryCard />);
    const sparkline = screen.getByRole("img", {
      name: /resting heart rate across the last 10 synthetic readings/i,
    });
    expect(sparkline).toBeTruthy();
    expect(screen.getByText(/Latest synthetic reading: 60 beats\/min\./)).toBeTruthy();
  });

  it("renders the bar chart as a named image over the day counts", () => {
    render(<MeasurementSummaryCard />);
    const barChart = screen.getByRole("img", {
      name: /synthetic measurement counts by day of week/i,
    });
    expect(barChart).toBeTruthy();
    const total = SYNTHETIC_CAPTURE_COUNTS_BY_DAY.reduce(
      (sum, datum) => sum + datum.value,
      0,
    );
    expect(screen.getByText(`${total} synthetic captures this week.`)).toBeTruthy();
  });

  it("chart summaries describe the data shape, not every value", () => {
    render(<MeasurementSummaryCard />);
    // The required accessible summaries are present (WCAG 1.1.1 contract).
    expect(
      screen.getByRole("img", { name: /gently declining from 68 to 60/i }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: /wednesday highest/i })).toBeTruthy();
    expect(SYNTHETIC_RESTING_HEART_RATE_SERIES.length).toBe(10);
  });
});
