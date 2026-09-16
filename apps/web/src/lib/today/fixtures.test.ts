import { describe, expect, it } from "vitest";
import type { MeasurementTask } from "@orbb/measurement";
import {
  TODAY_REFERENCE_NOW_ISO,
  TODAY_TASK_VIEWS,
  classifyWindowPhase,
  computeIntentProgress,
  isWindowToday,
} from "./fixtures";

/**
 * Today fixture contract tests (M6-B B4): the deterministic SYNTH task
 * fixtures satisfy the packet's required coverage (due-today, missed
 * window, 2+ acceptable methods, completed), the canonical domain id
 * grammar, the least-burden-first method ordering, and conservative
 * progress derivations.
 */

const CANONICAL_ID_PATTERN = /^[a-z]{3,4}_[A-Za-z0-9_-]{16,128}$/;

const REFERENCE_NOW = new Date(TODAY_REFERENCE_NOW_ISO);

describe("TODAY_TASK_VIEWS", () => {
  it("has exactly the four fixture tasks with unique canonical ids", () => {
    expect(TODAY_TASK_VIEWS).toHaveLength(4);
    const ids = new Set(TODAY_TASK_VIEWS.map((view) => view.task.id));
    expect(ids.size).toBe(4);
    for (const view of TODAY_TASK_VIEWS) {
      expect(view.task.id).toMatch(CANONICAL_ID_PATTERN);
      expect(view.task.planId).toMatch(CANONICAL_ID_PATTERN);
      expect(view.task.personId).toMatch(CANONICAL_ID_PATTERN);
    }
  });

  it("includes a due-today task (window contains the reference instant)", () => {
    const due = TODAY_TASK_VIEWS.filter(
      (view) => view.windowPhase === "due-now",
    );
    expect(due.length).toBeGreaterThanOrEqual(1);
    for (const view of due) {
      const task: MeasurementTask = view.task;
      expect(task.window.startsAt.getTime()).toBeLessThanOrEqual(
        REFERENCE_NOW.getTime(),
      );
      expect(task.window.endsAt.getTime()).toBeGreaterThan(
        REFERENCE_NOW.getTime(),
      );
      expect(task.state).toBe("open");
      expect(task.rollCount).toBe(0);
    }
  });

  it("includes a missed-window task with the fallback surfaced explicitly", () => {
    const missed = TODAY_TASK_VIEWS.filter(
      (view) => view.windowPhase === "missed",
    );
    expect(missed).toHaveLength(1);
    const view = missed[0]!;
    expect(view.task.rollCount).toBe(1);
    expect(view.task.state).toBe("open");
    expect(view.dueLabel).toContain("Missed yesterday");
    expect(view.dueLabel).toContain("rolled forward");
    // The missed-window card surfaces the clinic/CHW fallback explicitly.
    expect(view.fallback.available).toBe(true);
    expect(view.fallback.label).toBe("Clinic or CHW fallback");
    expect(view.fallback.providerIds).toContain("SYNTH-Clinic-A");
    expect(view.fallback.providerIds).toContain("SYNTH-CHW-2");
  });

  it("includes a task with 2+ acceptable methods (manual + device)", () => {
    const multiMethod = TODAY_TASK_VIEWS.filter(
      (view) => view.methods.length >= 2,
    );
    expect(multiMethod.length).toBeGreaterThanOrEqual(1);
    const bp = multiMethod.find(
      (view) => view.captureShapeId === "SYNTH-shape-bp-panel",
    );
    expect(bp).toBeDefined();
    const kinds = new Set(bp!.methods.map((method) => method.kind));
    expect(kinds.has("manual")).toBe(true);
    expect(kinds.has("device")).toBe(true);
  });

  it("orders methods least-burden VALID option first (available before seams)", () => {
    for (const view of TODAY_TASK_VIEWS) {
      const available = view.methods.filter((method) => method.available);
      const unavailable = view.methods.filter((method) => !method.available);
      expect(view.methods.slice(0, available.length)).toEqual(available);
      expect(view.methods.slice(available.length)).toEqual(unavailable);
      // Within each partition, ascending burden.
      const burdens = view.methods.map((method) => method.relativeBurden);
      const availableBurdens = burdens.slice(0, available.length);
      const unavailableBurdens = burdens.slice(available.length);
      expect([...availableBurdens].sort((a, b) => a - b)).toEqual(
        availableBurdens,
      );
      expect([...unavailableBurdens].sort((a, b) => a - b)).toEqual(
        unavailableBurdens,
      );
    }
  });

  it("includes a completed task with a completion label", () => {
    const completed = TODAY_TASK_VIEWS.filter(
      (view) => view.task.state === "completed",
    );
    expect(completed).toHaveLength(1);
    const view = completed[0]!;
    expect(view.completedLabel).toContain("Completed today at 08:05");
    expect(view.completedLabel).toContain("wearable sync (IMPORTED)");
    expect(completed[0]!.task.window.endsAt.getTime()).toBeGreaterThan(
      new Date(view.completedAt ?? 0).getTime(),
    );
  });

  it("every card carries the full §Measurement task UX field set", () => {
    for (const view of TODAY_TASK_VIEWS) {
      expect(view.metricLabel.length).toBeGreaterThan(0);
      expect(view.dueLabel.length).toBeGreaterThan(0);
      expect(view.reason.length).toBeGreaterThan(0);
      expect(view.methods.length).toBeGreaterThan(0);
      expect(view.estimatedEffort.length).toBeGreaterThan(0);
      expect(view.privacyImpact.length).toBeGreaterThan(0);
      expect(view.fallback.label.length).toBeGreaterThan(0);
      expect(view.intentLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyWindowPhase", () => {
  it("classifies the fixture tasks consistently with their stored phase", () => {
    for (const view of TODAY_TASK_VIEWS) {
      expect(classifyWindowPhase(view.task, REFERENCE_NOW)).toBe(
        view.windowPhase,
      );
    }
  });

  it("a completed task always reports completed regardless of the clock", () => {
    const completed = TODAY_TASK_VIEWS.find(
      (view) => view.task.state === "completed",
    )!;
    expect(
      classifyWindowPhase(completed.task, new Date("2030-01-01T00:00:00.000Z")),
    ).toBe("completed");
  });

  it("an open un-rolled future window reports due-later-today", () => {
    const task: MeasurementTask = {
      ...TODAY_TASK_VIEWS[0]!.task,
      window: {
        sequence: 9,
        startsAt: new Date("2026-09-10T22:00:00.000Z"),
        endsAt: new Date("2026-09-10T23:00:00.000Z"),
      },
      rollCount: 0,
      state: "open",
    };
    expect(classifyWindowPhase(task, REFERENCE_NOW)).toBe("due-later-today");
  });
});

describe("computeIntentProgress", () => {
  it("derives conservative counts per intent (no gamification vocabulary)", () => {
    const progress = computeIntentProgress(TODAY_TASK_VIEWS, REFERENCE_NOW);
    const labels = progress.map((entry) => entry.intentLabel);
    expect(labels).toContain("Lower blood pressure");
    expect(labels).toContain("Maintain a steady weight");
    expect(labels).toContain("Keep an eye on resting heart rate");

    const bp = progress.find((entry) => entry.intentLabel === "Lower blood pressure")!;
    expect(bp.dueToday).toBe(2);
    expect(bp.completedToday).toBe(0);
    expect(bp.summary).toBe("0 of 2 measurements completed today.");

    const hr = progress.find(
      (entry) => entry.intentLabel === "Keep an eye on resting heart rate",
    )!;
    expect(hr.dueToday).toBe(1);
    expect(hr.completedToday).toBe(1);

    for (const entry of progress) {
      // No streaks, no emojis, no celebratory vocabulary.
      expect(entry.summary).not.toMatch(/streak|🎉|congrat|perfect|great job/i);
    }
  });

  it("recomputes after a completion (the progress update path)", () => {
    const bpTask = TODAY_TASK_VIEWS.find(
      (view) => view.task.id === "task_SYNTH-task-today-bp-0001",
    )!;
    const updated: typeof TODAY_TASK_VIEWS = TODAY_TASK_VIEWS.map((view) =>
      view.task.id === bpTask.task.id
        ? {
            ...view,
            task: { ...view.task, state: "completed" },
            windowPhase: "completed" as const,
          }
        : view,
    );
    const progress = computeIntentProgress(updated, REFERENCE_NOW);
    const bp = progress.find((entry) => entry.intentLabel === "Lower blood pressure")!;
    expect(bp.completedToday).toBe(1);
    expect(bp.summary).toBe("1 of 2 measurements completed today.");
  });

  it("counts only windows on the reference day", () => {
    expect(isWindowToday(TODAY_TASK_VIEWS[0]!.task, REFERENCE_NOW)).toBe(true);
    const offDay: MeasurementTask = {
      ...TODAY_TASK_VIEWS[0]!.task,
      window: {
        sequence: 7,
        startsAt: new Date("2026-09-17T07:00:00.000Z"),
        endsAt: new Date("2026-09-17T09:00:00.000Z"),
      },
    };
    expect(computeIntentProgress(
      [
        {
          ...TODAY_TASK_VIEWS[0]!,
          task: offDay,
        },
      ],
      REFERENCE_NOW,
    )).toEqual([]);
  });
});
