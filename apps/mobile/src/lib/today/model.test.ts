import { describe, expect, it } from "vitest";
import {
  TODAY_REFERENCE_NOW_ISO,
  TODAY_TASKS,
  buildTodayBoard,
  classifyWindowPhase,
  computeIntentProgress,
  isTaskState,
} from "./model";

/**
 * Mobile Today model tests (M6-B B4): the engine-shaped mirrors (canonical
 * id grammar, task states), the §Measurement task UX fixture coverage
 * (due-today, missed window, 2+ methods, completed), least-burden-valid
 * method ordering, the completion overlay, and conservative progress.
 */

const CANONICAL_ID_PATTERN = /^[a-z]{3,4}_[A-Za-z0-9_-]{16,128}$/;

describe("TODAY_TASKS (the engine-shaped fixtures)", () => {
  it("has the four fixture tasks with unique canonical-grammar ids", () => {
    expect(TODAY_TASKS).toHaveLength(4);
    const ids = new Set(TODAY_TASKS.map((view) => view.task.id));
    expect(ids.size).toBe(4);
    for (const view of TODAY_TASKS) {
      expect(view.task.id).toMatch(CANONICAL_ID_PATTERN);
      expect(view.task.planId).toMatch(CANONICAL_ID_PATTERN);
      expect(view.task.personId).toMatch(CANONICAL_ID_PATTERN);
    }
  });

  it("covers the required fixture cases (due-today, missed, 2+ methods, completed)", () => {
    const phases = new Set(TODAY_TASKS.map((view) => view.windowPhase));
    expect(phases.has("due-now")).toBe(true);
    expect(phases.has("missed")).toBe(true);
    expect(phases.has("completed")).toBe(true);
    const multiMethod = TODAY_TASKS.filter((view) => view.methods.length >= 2);
    expect(multiMethod.length).toBeGreaterThanOrEqual(1);
    const bp = multiMethod.find(
      (view) => view.captureShapeId === "SYNTH-shape-bp-panel",
    )!;
    expect(bp.methods.map((method) => method.kind)).toContain("manual");
    expect(bp.methods.map((method) => method.kind)).toContain("device");
  });

  it("mirrors the web fixtures exactly (same ids, windows, labels)", () => {
    const bp = TODAY_TASKS.find(
      (view) => view.task.id === "task_SYNTH-task-today-bp-0001",
    )!;
    expect(bp.task.window.startsAt).toBe("2026-09-10T07:00:00.000Z");
    expect(bp.task.window.endsAt).toBe("2026-09-10T09:00:00.000Z");
    expect(bp.dueLabel).toBe("Due by 09:00");
    expect(bp.intentLabel).toBe("Lower blood pressure");
    const weight = TODAY_TASKS.find(
      (view) => view.task.id === "task_SYNTH-task-weight-0003",
    )!;
    expect(weight.task.rollCount).toBe(1);
    expect(weight.fallback.providerIds).toEqual(["SYNTH-Clinic-A", "SYNTH-CHW-2"]);
    const hr = TODAY_TASKS.find(
      (view) => view.task.id === "task_SYNTH-task-hr-morning-0004",
    )!;
    expect(hr.completedLabel).toBe(
      "Completed today at 08:05 — wearable sync (IMPORTED)",
    );
  });

  it("orders methods least-burden VALID first (available before device seams)", () => {
    for (const view of TODAY_TASKS) {
      const available = view.methods.filter((method) => method.available);
      const unavailable = view.methods.filter((method) => !method.available);
      expect(view.methods.slice(0, available.length)).toEqual(available);
      expect(view.methods.slice(available.length)).toEqual(unavailable);
    }
  });
});

describe("classifyWindowPhase", () => {
  it("classifies every fixture consistently with its stored phase", () => {
    for (const view of TODAY_TASKS) {
      expect(classifyWindowPhase(view.task)).toBe(view.windowPhase);
    }
  });

  it("accepts only the engine task states", () => {
    expect(isTaskState("open")).toBe(true);
    expect(isTaskState("completed")).toBe(true);
    expect(isTaskState("pending")).toBe(false);
    expect(isTaskState(42)).toBe(false);
  });
});

describe("computeIntentProgress", () => {
  it("derives conservative counts (never gamified)", () => {
    const progress = computeIntentProgress(TODAY_TASKS);
    const bp = progress.find((entry) => entry.intentLabel === "Lower blood pressure")!;
    expect(bp.dueToday).toBe(2);
    expect(bp.completedToday).toBe(0);
    expect(bp.summary).toBe("0 of 2 measurements completed today.");
    for (const entry of progress) {
      expect(entry.summary).not.toMatch(/streak|congrat|perfect/i);
    }
  });

  it("references the pinned SYNTH date (no wall clock)", () => {
    expect(TODAY_REFERENCE_NOW_ISO).toBe("2026-09-10T08:20:00.000Z");
  });
});

describe("buildTodayBoard (the completion overlay)", () => {
  it("completes a task once and recomputes progress", () => {
    const initial = buildTodayBoard([]);
    expect(
      initial.progress.find((entry) => entry.intentLabel === "Lower blood pressure")
        ?.summary,
    ).toBe("0 of 2 measurements completed today.");

    const completed = buildTodayBoard(["task_SYNTH-task-today-bp-0001"]);
    const task = completed.tasks.find(
      (view) => view.task.id === "task_SYNTH-task-today-bp-0001",
    )!;
    expect(task.task.state).toBe("completed");
    expect(task.windowPhase).toBe("completed");
    expect(task.completedLabel).toContain("full provenance");
    expect(
      completed.progress.find((entry) => entry.intentLabel === "Lower blood pressure")
        ?.summary,
    ).toBe("1 of 2 measurements completed today.");

    // Idempotent overlay: the fixture-completed task never double-counts.
    const again = buildTodayBoard([
      "task_SYNTH-task-today-bp-0001",
      "task_SYNTH-task-today-bp-0001",
    ]);
    expect(
      again.progress.find((entry) => entry.intentLabel === "Lower blood pressure")
        ?.completedToday,
    ).toBe(1);
  });
});
