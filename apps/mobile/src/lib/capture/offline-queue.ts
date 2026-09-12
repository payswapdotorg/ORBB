import type { MobileCaptureSubmission } from "./model";

/**
 * Offline-tolerant submit queue (M4-B mobile): pure operations over an
 * array of queued capture drafts. The screen owns the queue as component
 * STATE (per the packet: "queue-in-state + flush on focus — pure client
 * behavior, no native modules"); this module keeps the operations pure so
 * they are plain-node unit-testable.
 *
 * Semantics:
 * - submissions made while "offline" (the synthetic offline mode, or a
 *   failed submit attempt) are ENQUEUED in order and never lost;
 * - a flush drains the queue in FIFO order when the app is online
 *   (triggered on app focus via AppState, or when offline mode turns
 *   off);
 * - each draft carries its capture time, so a delayed flush never
 *   rewrites history: the observation keeps the user-stated
 *   effectiveAt while the record time reflects when it finally landed.
 */

/** A capture submission waiting to be delivered. */
export interface QueuedCaptureDraft {
  /** Queue-unique id (draft counter; drives React keys and a11y). */
  readonly queueId: number;
  readonly submission: MobileCaptureSubmission;
  /** When the draft was enqueued (display + audit only). */
  readonly queuedAtIso: string;
}

/** Appends a draft, preserving FIFO order. Pure (returns a new array). */
export function enqueueCaptureDraft(
  queue: readonly QueuedCaptureDraft[],
  submission: MobileCaptureSubmission,
  queuedAt: Date,
  nextQueueId: number,
): readonly QueuedCaptureDraft[] {
  const draft: QueuedCaptureDraft = {
    queueId: nextQueueId,
    submission,
    queuedAtIso: queuedAt.toISOString(),
  };
  return [...queue, draft];
}

/**
 * Partitions the queue for a flush attempt: every draft is deliverable
 * in this synthetic journey (there is no real network), so a flush
 * drains everything. Keed explicit + pure so the screen's flush loop
 * stays trivial and the contract is testable.
 */
export function takeAllCaptureDrafts(
  queue: readonly QueuedCaptureDraft[],
): { readonly drafts: readonly QueuedCaptureDraft[]; readonly remaining: readonly QueuedCaptureDraft[] } {
  return { drafts: [...queue], remaining: [] };
}

/** Visible summary for the offline queue banner (text carries state). */
export function offlineQueueSummary(count: number): string {
  if (count === 0) {
    return "No measurements queued.";
  }
  return count === 1
    ? "1 measurement queued — it will submit automatically when you are back online."
    : `${count} measurements queued — they will submit automatically when you are back online.`;
}

/** Confirmation line after a flush (text carries the outcome). */
export function flushConfirmation(count: number): string {
  if (count === 0) {
    return "No queued measurements to submit.";
  }
  return count === 1
    ? "Submitted 1 queued measurement."
    : `Submitted ${count} queued measurements.`;
}
