// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodaySurface } from "./today-surface";
import { listTodayBoard } from "@/lib/today/store";

/**
 * Today surface tests (M6-B B4): the intent-driven consumer home loads the
 * board through the route stub, renders the per-intent progress and the
 * task cards, and routes a due task into the EXISTING manual-capture flow
 * (inlined, metric pre-selected at step 2) — not a dashboard of charts.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function boardResponse(): Response {
  return new Response(JSON.stringify(listTodayBoard()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetchWith(responses: Response[]) {
  let call = 0;
  const fetchMock = vi.fn<FetchLike>(async () => {
    const response = responses[Math.min(call, responses.length - 1)] ?? responses[0]!;
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TodaySurface", () => {
  it("renders the intent progress summaries and every task card from the board", async () => {
    stubFetchWith([boardResponse()]);
    render(<TodaySurface />);

    await waitFor(() => {
      expect(screen.getByText("What you're working on")).toBeTruthy();
    });

    // 1. What am I trying to accomplish — conservative progress sentences.
    expect(screen.getByText("Lower blood pressure")).toBeTruthy();
    expect(screen.getByText("0 of 2 measurements completed today.")).toBeTruthy();
    expect(screen.getByText("Maintain a steady weight")).toBeTruthy();
    expect(screen.getByText("1 of 1 measurements completed today.")).toBeTruthy();

    // 2. What matters today — the four task cards (the two BP windows
    //    both render the panel metric — morning and evening tasks).
    expect(screen.getByText("What's due today")).toBeTruthy();
    expect(screen.getAllByText("Blood pressure (systolic + diastolic)")).toHaveLength(2);
    expect(screen.getByText("Body weight")).toBeTruthy();
    expect(screen.getByText("Resting heart rate")).toBeTruthy();

    // No chart surfaces: the Today surface is not a dashboard.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("routes a due task into the existing manual-capture flow (shape pre-selected at step 2)", async () => {
    stubFetchWith([boardResponse()]);
    render(<TodaySurface />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /complete now — manual entry — home bp cuff reading/i }),
      ).toHaveLength(2);
    });

    // Complete the MORNING task (the due-now card, listed first).
    fireEvent.click(
      screen.getAllByRole("button", { name: /complete now — manual entry — home bp cuff reading/i })[0]!,
    );

    // The inlined M4-B flow mounts with the task context note and lands
    // directly on step 2 (method + values) — the metric is pre-selected.
    expect(screen.getByText(/Completing: Blood pressure \(systolic \+ diastolic\)/)).toBeTruthy();
    expect(screen.getByText(/task task_SYNTH-task-today-bp-0001/)).toBeTruthy();
    expect(screen.getByText("Step 2 of 3 — method, values, and context")).toBeTruthy();
    expect(screen.queryByText("Step 1 of 3 — choose what you measured")).toBeNull();
    expect(screen.getByText("Blood pressure", { exact: true })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /how did you capture it\?/i })).toBeTruthy();

    // The back affordance returns to the cards.
    fireEvent.click(screen.getByRole("button", { name: "Back to today" }));
    expect(screen.queryByText(/Completing:/)).toBeNull();
  });

  it("shows an honest load error with a retry affordance", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TodaySurface />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText(/could not load today's tasks: network error/i)).toBeTruthy();
  });
});
