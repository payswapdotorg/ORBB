import { describe, expect, it } from "vitest";
import {
  enqueueCaptureDraft,
  flushConfirmation,
  offlineQueueSummary,
  takeAllCaptureDrafts,
  type QueuedCaptureDraft,
} from "./offline-queue";
import type { MobileCaptureSubmission } from "./model";

/**
 * Offline queue contract tests (M4-B mobile): FIFO queue-in-state, pure
 * drain, and honest banner/confirmation copy (text carries the state).
 */

const SUBMISSION: MobileCaptureSubmission = {
  shapeId: "SYNTH-shape-heart-rate",
  methodOptionId: "SYNTH-method-manual-heart-rate",
  fieldValues: { heartRate: 64 },
  qualityState: "complete",
  capturedAtIso: "2026-09-10T08:30:00.000Z",
};

describe("enqueueCaptureDraft", () => {
  it("appends in FIFO order without mutating the input", () => {
    const first: readonly QueuedCaptureDraft[] = [];
    const afterFirst = enqueueCaptureDraft(first, SUBMISSION, new Date(0), 1);
    expect(first).toHaveLength(0);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.queueId).toBe(1);
    expect(afterFirst[0]?.submission).toEqual(SUBMISSION);

    const afterSecond = enqueueCaptureDraft(afterFirst, SUBMISSION, new Date(1_000), 2);
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[1]?.queueId).toBe(2);
    expect(afterSecond[0]?.queueId).toBe(1);
    expect(afterFirst).toHaveLength(1);
  });

  it("stamps the queued-at time for the audit line", () => {
    const queue = enqueueCaptureDraft([], SUBMISSION, new Date("2026-09-10T09:00:00.000Z"), 1);
    expect(queue[0]?.queuedAtIso).toBe("2026-09-10T09:00:00.000Z");
  });
});

describe("takeAllCaptureDrafts", () => {
  it("drains everything and leaves an empty queue", () => {
    let queue: readonly QueuedCaptureDraft[] = [];
    queue = enqueueCaptureDraft(queue, SUBMISSION, new Date(0), 1);
    queue = enqueueCaptureDraft(queue, SUBMISSION, new Date(1), 2);
    const { drafts, remaining } = takeAllCaptureDrafts(queue);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.queueId)).toEqual([1, 2]);
    expect(remaining).toHaveLength(0);
    expect(queue).toHaveLength(2);
  });

  it("handles an empty queue", () => {
    const { drafts, remaining } = takeAllCaptureDrafts([]);
    expect(drafts).toHaveLength(0);
    expect(remaining).toHaveLength(0);
  });
});

describe("offline queue copy (text carries the state)", () => {
  it("summarizes zero, one and many queued items", () => {
    expect(offlineQueueSummary(0)).toBe("No measurements queued.");
    expect(offlineQueueSummary(1)).toContain("1 measurement queued");
    expect(offlineQueueSummary(3)).toContain("3 measurements queued");
  });

  it("confirms flush counts", () => {
    expect(flushConfirmation(0)).toBe("No queued measurements to submit.");
    expect(flushConfirmation(1)).toBe("Submitted 1 queued measurement.");
    expect(flushConfirmation(2)).toBe("Submitted 2 queued measurements.");
  });
});
