// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TodayTaskCard } from "./today-task-card";
import { TODAY_TASK_VIEWS } from "@/lib/today/fixtures";
import type { TodayTaskView } from "@/lib/today/types";

/**
 * Today task card tests (M6-B B4): the §Measurement task UX card contract
 * renders every field, the least-burden valid method first, the fallback
 * explicitly on missed windows, and conservative completed states — with
 * a screen-reader label summarizing the whole card (§Accessibility).
 */

afterEach(() => {
  cleanup();
});

function viewOf(taskId: string): TodayTaskView {
  const view = TODAY_TASK_VIEWS.find((candidate) => candidate.task.id === taskId);
  if (view === undefined) {
    throw new Error(`fixture task not found: ${taskId}`);
  }
  return view;
}

describe("TodayTaskCard", () => {
  it("renders the full card contract for a due-today task", () => {
    render(
      <TodayTaskCard view={viewOf("task_SYNTH-task-today-bp-0001")} onComplete={() => {}} />,
    );

    // metric | due window | reason
    expect(screen.getByText("Blood pressure (systolic + diastolic)")).toBeTruthy();
    expect(screen.getByText("Due by 09:00")).toBeTruthy();
    expect(screen.getByText("Supports your blood-pressure monitoring plan")).toBeTruthy();

    // acceptable methods — least-burden valid option first with the marker
    expect(screen.getByText("Acceptable methods (2)")).toBeTruthy();
    expect(screen.getByText("easiest valid option")).toBeTruthy();
    expect(
      screen.getAllByText(/manual entry — home bp cuff reading/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/automatic cuff sync/i).length).toBeGreaterThanOrEqual(1);
    // The device seam renders honestly unavailable (never fake-enabled).
    expect(screen.getByText(/automatic cuff sync/i)).toBeTruthy();
    expect(screen.getByText(/not available yet/i)).toBeTruthy();

    // estimated effort | privacy impact | fallback
    expect(screen.getByText(/Estimated effort: ~2 min/)).toBeTruthy();
    expect(screen.getByText(/Private — stays in your DataBox/)).toBeTruthy();
    expect(screen.getByText("Clinic or CHW fallback")).toBeTruthy();

    // The complete affordance names the least-burden valid method.
    expect(
      screen.getByRole("button", { name: /complete now — manual entry — home bp cuff reading/i }),
    ).toBeTruthy();
  });

  it("carries a screen-reader label summarizing every card field", () => {
    render(
      <TodayTaskCard view={viewOf("task_SYNTH-task-today-bp-0001")} onComplete={() => {}} />,
    );
    const article = screen.getByRole("article");
    const label = article.getAttribute("aria-label") ?? "";
    expect(label).toContain("Measurement task:");
    expect(label).toContain("Blood pressure (systolic + diastolic)");
    expect(label).toContain("Due by 09:00");
    expect(label).toContain("2 acceptable methods");
    expect(label).toContain("~2 min");
    expect(label).toContain("Clinic or CHW fallback");
  });

  it("surfaces the fallback explicitly on the missed-window card with its tone", () => {
    const { container } = render(
      <TodayTaskCard view={viewOf("task_SYNTH-task-weight-0003")} onComplete={() => {}} />,
    );
    expect(
      screen.getByText(/Missed yesterday 21:00 — rolled forward to today 21:00/),
    ).toBeTruthy();
    expect(screen.getByText("Clinic or CHW fallback")).toBeTruthy();
    expect(
      screen.getByText(/community health worker/i),
    ).toBeTruthy();
    expect(screen.getByText("SYNTH-Clinic-A · SYNTH-CHW-2")).toBeTruthy();
    // The miss state is carried by data attributes (testable emphasis).
    const article = container.querySelector('[data-task-phase="missed"]');
    expect(article).not.toBeNull();
  });

  it("renders the completed task conservatively (done state, no completion CTA)", () => {
    const { container } = render(
      <TodayTaskCard view={viewOf("task_SYNTH-task-hr-morning-0004")} onComplete={() => {}} />,
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText(/Completed today at 08:05 — wearable sync \(IMPORTED\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /complete now/i })).toBeNull();
    expect(container.querySelector('[data-task-state="completed"]')).not.toBeNull();
  });

  it("fires onComplete with the task view when the complete button is activated", () => {
    const onComplete = vi.fn();
    render(
      <TodayTaskCard view={viewOf("task_SYNTH-task-today-bp-0001")} onComplete={onComplete} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /complete now — manual entry/i }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0].task.id).toBe("task_SYNTH-task-today-bp-0001");
  });
});
