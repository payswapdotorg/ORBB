/**
 * B8 — Reminder payloads (the PHI-discipline heart of the package).
 *
 * HARD RULE (architecture §6 / observability redaction discipline): a
 * reminder payload references task/metric/window identifiers and
 * human-safe vocabulary labels ONLY. It NEVER carries:
 *   - observation values,
 *   - evidence content or evidence ids,
 *   - the person id (the routing plane — `ChannelSendRequest` — carries it;
 *     payloads stay person-free),
 *   - concept codes (denied by the observability default redaction policy),
 *   - person-identifying free text of any kind.
 *
 * `dueAt` is schedule metadata (the measurement window's closing edge, from
 * the plan cadence — not an observation of the person) and is required for
 * rendering ("due at 14:00"). `metricLabel` / `FallbackMethodOption.label`
 * are optional caller-supplied VOCABULARY labels (display names from the
 * metric/method registries — not person data); the engine passes them
 * through verbatim under a hard length cap (see {@link MAX_LABEL_LENGTH})
 * and validates their shape (fail-closed typed rejection on violation).
 *
 * Journey #7 (golden journey: "User misses task → reminder → fallback
 * provider offered → authorized restriction applied only if configured"):
 * the REMIND_WITH_FALLBACK_OFFER payload carries the task's RECORDED
 * fallback vocabulary (`methodOrder` — preferred method first, fallback
 * order after, exactly as the plan compiler recorded it). The offer is
 * DATA, not a decision: the engine never ranks, filters, or chooses a
 * provider, and it never applies any restriction (that is B10's authorized
 * adherence-enforcement concern, a different lane). The payload contains
 * no selection/ordering field of the engine's own — `fallbackMethods` is
 * the recorded vocabulary, verbatim.
 */
import type { TaskId } from "@orbb/domain";

/** The escalation-ladder rungs (gentle: nudge, never punish, never gamify). */
export const REMINDER_RUNGS = ["REMIND", "REMIND_WITH_FALLBACK_OFFER"] as const;

export type ReminderRung = (typeof REMINDER_RUNGS)[number];

/** Type guard: is `value` a canonical reminder rung? */
export function isReminderRung(value: unknown): value is ReminderRung {
  return typeof value === "string" && (REMINDER_RUNGS as readonly string[]).includes(value);
}

/** Why a reminder exists: the window is about to close, or already did. */
export const REMINDER_REASONS = ["upcoming-due", "missed-window"] as const;

export type ReminderReason = (typeof REMINDER_REASONS)[number];

/** Type guard: is `value` a canonical reminder reason? */
export function isReminderReason(value: unknown): value is ReminderReason {
  return typeof value === "string" && (REMINDER_REASONS as readonly string[]).includes(value);
}

/** Hard cap for human-safe vocabulary labels carried inside payloads. */
export const MAX_LABEL_LENGTH = 80;

/** Detects control characters (C0 + DEL) without a regular expression. */
function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a caller-supplied vocabulary label: a string that is non-empty
 * after trimming, at most {@link MAX_LABEL_LENGTH} characters, and free of
 * control characters. Returns `true` when the label is safe to carry.
 */
export function isHumanSafeLabel(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) {
    return false;
  }
  return !containsControlCharacter(trimmed);
}

/** One offered fallback method: the recorded method id + optional label. */
export interface FallbackMethodOption {
  readonly methodId: string;
  readonly label?: string;
}

/** Payload of the first ladder rung (upcoming-due or missed-window nudge). */
export interface UpcomingDueReminderPayload {
  readonly kind: "REMIND";
  readonly reason: "upcoming-due" | "missed-window";
  readonly taskId: TaskId;
  readonly metricId: string;
  readonly metricLabel?: string;
  /** Window identity (the task id already encodes plan+metric+window). */
  readonly windowSequence: number;
  /** The measurement window's closing edge (schedule metadata). */
  readonly dueAt: Date;
}

/**
 * Payload of the escalation rung: the missed-window reminder that OFFERS
 * the task's recorded fallback vocabulary (journey #7's "fallback provider
 * offered" — data, never a decision).
 */
export interface FallbackOfferReminderPayload {
  readonly kind: "REMIND_WITH_FALLBACK_OFFER";
  readonly reason: "missed-window";
  readonly taskId: TaskId;
  readonly metricId: string;
  readonly metricLabel?: string;
  readonly windowSequence: number;
  readonly dueAt: Date;
  /** The task's preferred (first recorded) measurement method. */
  readonly preferredMethodId: string;
  /** The task's recorded fallback vocabulary, verbatim and in order. */
  readonly fallbackMethods: readonly FallbackMethodOption[];
}

/** Discriminated union of every reminder payload variant. */
export type ReminderPayload = UpcomingDueReminderPayload | FallbackOfferReminderPayload;

/** Type guard: is `value` a well-formed {@link ReminderPayload}? */
export function isReminderPayload(value: unknown): value is ReminderPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ReminderPayload> & { windowSequence?: unknown };
  if (typeof candidate.taskId !== "string" || candidate.taskId.length === 0) {
    return false;
  }
  if (typeof candidate.metricId !== "string" || candidate.metricId.length === 0) {
    return false;
  }
  if (
    typeof candidate.windowSequence !== "number" ||
    !Number.isInteger(candidate.windowSequence) ||
    candidate.windowSequence < 0
  ) {
    return false;
  }
  if (!(candidate.dueAt instanceof Date) || Number.isNaN(candidate.dueAt.getTime())) {
    return false;
  }
  if (candidate.metricLabel !== undefined && !isHumanSafeLabel(candidate.metricLabel)) {
    return false;
  }
  if (!isReminderReason(candidate.reason)) {
    return false;
  }
  if (candidate.kind === "REMIND") {
    return candidate.reason === "upcoming-due" || candidate.reason === "missed-window";
  }
  if (candidate.kind === "REMIND_WITH_FALLBACK_OFFER") {
    if (candidate.reason !== "missed-window") {
      return false;
    }
    if (typeof candidate.preferredMethodId !== "string" || candidate.preferredMethodId.length === 0) {
      return false;
    }
    if (!Array.isArray(candidate.fallbackMethods)) {
      return false;
    }
    return candidate.fallbackMethods.every((option) => {
      if (typeof option !== "object" || option === null) {
        return false;
      }
      const method = option as Partial<FallbackMethodOption>;
      if (typeof method.methodId !== "string" || method.methodId.length === 0) {
        return false;
      }
      return method.label === undefined || isHumanSafeLabel(method.label);
    });
  }
  return false;
}

/** Deep defensive copy of a payload (fresh Dates, fresh arrays/objects). */
export function cloneReminderPayload(payload: ReminderPayload): ReminderPayload {
  if (payload.kind === "REMIND") {
    return {
      kind: "REMIND",
      reason: payload.reason,
      taskId: payload.taskId,
      metricId: payload.metricId,
      ...(payload.metricLabel !== undefined ? { metricLabel: payload.metricLabel } : {}),
      windowSequence: payload.windowSequence,
      dueAt: new Date(payload.dueAt.getTime()),
    };
  }
  return {
    kind: "REMIND_WITH_FALLBACK_OFFER",
    reason: payload.reason,
    taskId: payload.taskId,
    metricId: payload.metricId,
    ...(payload.metricLabel !== undefined ? { metricLabel: payload.metricLabel } : {}),
    windowSequence: payload.windowSequence,
    dueAt: new Date(payload.dueAt.getTime()),
    preferredMethodId: payload.preferredMethodId,
    fallbackMethods: payload.fallbackMethods.map((option) => ({
      methodId: option.methodId,
      ...(option.label !== undefined ? { label: option.label } : {}),
    })),
  };
}
