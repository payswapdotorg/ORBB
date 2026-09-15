/**
 * @orbb/notifications frozen vocabulary (B8, M6-B Lane A).
 *
 * The reminder escalation ladder and the channel-id grammar are the
 * package's stable vocabulary. Everything here is a pure literal union +
 * guard — mirroring the frozen-vocabulary discipline of
 * `@orbb/measurement` (`COMPLETION_QUALITY_STATES`, `MISSED_WINDOW_
 * POLICIES`) and `@orbb/intents` (`RATIONALE_STEP_KINDS`).
 *
 * RECORDED LADDER SEMANTICS (journey #7, "User misses task -> reminder ->
 * fallback provider offered -> authorized restriction applied only if
 * configured"):
 *   - `REMIND` — the upcoming-due nudge for an OPEN task whose window has
 *     not yet closed. Neutral, non-authoritative wording territory: a
 *     reminder NUDGES, it never asserts a clinical conclusion, never
 *     punishes, never gamifies (AGENTS.md operating rule).
 *   - `REMIND_WITH_FALLBACK_OFFER` — the missed-window rung for an OPEN
 *     task whose window has closed. The fallback-provider offer is DATA,
 *     not a decision: the payload carries the method vocabulary recorded
 *     on the task (`methodOrder`, preferred first) and the engine never
 *     orders a provider. The "authorized restriction" tail of journey #7
 *     is B10's adherence-enforcement abstraction, NOT this engine; the
 *     type-encoded `enforcementAuthority: "none"` field on the offer
 *     vocabulary (see `payload.ts`) makes that boundary structural.
 */

/**
 * The gentle escalation ladder rungs, in escalation order.
 *
 * RECORDED CONDITIONS for rung advancement (the complete decision table):
 *   - OPEN task, `window.endsAt > now`  -> rung `REMIND` only.
 *   - OPEN task, `window.endsAt <= now` -> rung `REMIND_WITH_FALLBACK_
 *     OFFER` only (after the escalation grace delay — see `preferences.ts`).
 *   - COMPLETED task                     -> no rung (completing silences
 *     the ladder; data is never used to punish).
 * Exactly ONE rung is active per (task, window) at any computation
 * instant; rungs never coexist for the same task window.
 */
export const REMINDER_RUNGS = ["REMIND", "REMIND_WITH_FALLBACK_OFFER"] as const;

/** One rung of the reminder escalation ladder. */
export type ReminderRung = (typeof REMINDER_RUNGS)[number];

/** Type guard: is `value` a ladder rung? */
export function isReminderRung(value: unknown): value is ReminderRung {
  return (
    typeof value === "string" &&
    (REMINDER_RUNGS as readonly string[]).includes(value)
  );
}

/**
 * Index of a rung in the escalation order (`REMIND` = 0). Used ONLY for
 * deterministic ordering — escalation itself is decided by the recorded
 * window-state conditions above, never by comparing indices.
 */
export function reminderRungIndex(rung: ReminderRung): number {
  return REMINDER_RUNGS.indexOf(rung);
}

/**
 * Lane-local channel identifier grammar: `^[a-z][a-z0-9-]{0,31}$`
 * (lowercase, hyphen-separated — configuration vocabulary, obviously not
 * person data). Channel ids name DELIVERY ADAPTERS ("inmem",
 * "webpush-synth", "email-synth", later real provider adapters); they are
 * chosen by the application, never derived from person data.
 */
const CHANNEL_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Opaque channel identifier (lane-local grammar above). */
export type NotificationChannelId = string;

/** Type guard: is `value` a well-formed channel identifier? */
export function isNotificationChannelId(value: unknown): value is NotificationChannelId {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value);
}
