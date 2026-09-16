import { afterEach, describe, expect, it } from "vitest";
import {
  completeTodayTask,
  findTodayTask,
  listTodayBoard,
  resetTodayStore,
} from "./store";

/**
 * In-memory Today store contract tests (M6-B B4): deterministic seed, the
 * single open -> completed transition, typed rejections, and derived
 * conservative progress.
 */

afterEach(() => {
  resetTodayStore();
});

const BP_TASK_ID = "task_SYNTH-task-today-bp-0001";

describe("listTodayBoard", () => {
  it("seeds the board from the deterministic fixtures (resumable, resumable-check)", () => {
    const board = listTodayBoard();
    expect(board.synthetic).toBe(true);
    expect(board.personId).toBe("prsn_SYNTH-person-0001");
    expect(board.tasks).toHaveLength(4);
    expect(board.referenceDateLabel).toBe("Sep 10, 2026");
    // Progress is derived and conservative.
    const bp = board.progress.find(
      (entry) => entry.intentLabel === "Lower blood pressure",
    );
    expect(bp?.summary).toBe("0 of 2 measurements completed today.");
  });

  it("returns fresh clones (mutation of a returned view never corrupts the store)", () => {
    const first = listTodayBoard();
    const task = first.tasks[0]!;
    (task as { task: { state: string } }).task.state = "completed";
    const second = listTodayBoard();
    expect(second.tasks[0]!.task.state).toBe("open");
  });
});

describe("completeTodayTask", () => {
  it("transitions an open task to completed and returns updated progress", () => {
    const now = new Date("2026-09-10T08:41:00.000Z");
    const result = completeTodayTask(BP_TASK_ID, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.task.state).toBe("completed");
      expect(result.task.completedAt).toBe(now.toISOString());
      expect(result.task.completedLabel).toBe("Completed today at 08:41");
      const bp = result.progress.find(
        (entry) => entry.intentLabel === "Lower blood pressure",
      );
      expect(bp?.summary).toBe("1 of 2 measurements completed today.");
    }
    // The board reflects the transition.
    expect(listTodayBoard().tasks[0]!.task.state).toBe("completed");
  });

  it("rejects unknown ids with the typed task-not-found error", () => {
    const result = completeTodayTask("task_SYNTH-does-not-exist", new Date());
    expect(result).toEqual({
      ok: false,
      error: { kind: "task-not-found" },
    });
  });

  it("rejects repeat completions with the typed already-completed error", () => {
    const now = new Date("2026-09-10T08:41:00.000Z");
    expect(completeTodayTask(BP_TASK_ID, now).ok).toBe(true);
    const repeat = completeTodayTask(BP_TASK_ID, new Date("2026-09-10T10:00:00.000Z"));
    expect(repeat).toEqual({
      ok: false,
      error: { kind: "task-already-completed" },
    });
    // The first completion timestamp survives the rejected retry.
    const view = findTodayTask(BP_TASK_ID);
    expect(view?.completedAt).toBe(now.toISOString());
  });

  it("never transitions the fixture-completed task again (its state is terminal)", () => {
    const result = completeTodayTask("task_SYNTH-task-hr-morning-0004", new Date());
    expect(result).toEqual({
      ok: false,
      error: { kind: "task-already-completed" },
    });
  });
});

describe("findTodayTask", () => {
  it("finds by id and reflects the completed state after a transition", () => {
    expect(findTodayTask(BP_TASK_ID)?.task.state).toBe("open");
    completeTodayTask(BP_TASK_ID, new Date("2026-09-10T08:41:00.000Z"));
    expect(findTodayTask(BP_TASK_ID)?.task.state).toBe("completed");
  });

  it("returns undefined for unknown ids", () => {
    expect(findTodayTask("task_SYNTH-nope")).toBeUndefined();
  });
});
