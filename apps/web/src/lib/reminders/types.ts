/**
 * Reminder wire types (M6 EXIT, Lane B) — the journey-#7 reminder chain's
 * type layer, mirroring the REAL `@orbb/notifications` (B8) shapes.
 *
 * THE LIB/ WIRE-TYPE PATTERN (the recorded M6-A/M6-B discipline): the
 * packages are READ-ONLY to this packet, so the Today surface consumes
 * TYPED SYNTH FIXTURES that mirror the real engine outputs
 * field-for-field. The stored fixture payloads are typed by the REAL
 * package types — `import type` only. RECORDED HANDOFF (identical to
 * `lib/today/types.ts` for `@orbb/measurement`): the packages resolve at
 * runtime to their compiled `dist/` entries, which are not built during
 * `next dev`/vitest/Playwright runs — only `import type` is safe (erased
 * at compile time). At worker/engine wiring the fixtures swap for the
 * real engine outputs with no call-site changes.
 *
 * WHAT IS MIRRORED (the B8 contract, verbatim vocabulary):
 *   - the escalation ladder `REMIND` -> `REMIND_WITH_FALLBACK_OFFER`
 *     (completed tasks never remind — completing silences the ladder);
 *   - the fallback-provider OFFER on rung 2: the task's recorded method
 *     vocabulary as DATA with `enforcementAuthority: "none"` type-encoded
 *     (the engine never orders a provider);
 *   - the quiet-hours DEFER record (defer, never drop) with reason
 *     `"quiet-hours"`;
 *   - the preference profile knobs the schedule math depends on
 *     (lead time, escalation grace, quiet-hours spec).
 *
 * Wire form (the M6-A discipline): Date-valued fields are serialized as
 * ISO-8601 strings at the `/api/today/reminders` boundary, exactly like
 * the today journey types; branded domain ids stay widened to plain
 * strings here.
 */

import type {
  FallbackMethodOption,
  FallbackOfferVocabulary,
  ReminderDeferRecord,
  ReminderPayload,
  ReminderRung,
} from "@orbb/notifications";

// ---------------------------------------------------------------------------
// The ladder vocabulary (B8 `REMINDER_RUNGS` runtime mirror).
// ---------------------------------------------------------------------------

/**
 * Mirror of the frozen `REMINDER_RUNGS` vocabulary
 * (`REMIND` | `REMIND_WITH_FALLBACK_OFFER`).
 *
 * RECORDED RUNG SEMANTICS (B8 `vocabulary.ts`, mirrored verbatim):
 *   - OPEN task, window not yet closed  -> rung `REMIND` (upcoming-due nudge).
 *   - OPEN task, window closed          -> rung `REMIND_WITH_FALLBACK_OFFER`.
 *   - COMPLETED task                    -> no rung (silence, never punishment).
 */
export const TODAY_REMINDER_RUNGS = ["REMIND", "REMIND_WITH_FALLBACK_OFFER"] as const;

/** One rung of the reminder ladder — the REAL B8 type. */
export type TodayReminderRung = ReminderRung;

/** Type guard: is `value` a ladder rung? */
export function isTodayReminderRung(value: unknown): value is TodayReminderRung {
  return (
    typeof value === "string" &&
    (TODAY_REMINDER_RUNGS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Stored fixture payloads — the REAL B8 shapes (Dates in-process).
// ---------------------------------------------------------------------------

/**
 * A stored reminder fixture payload: the REAL `ReminderPayload` shape
 * (B8 `payload.ts`) — the auditable, PHI-free content surface. Constructed
 * as literal objects inside this app (structural typing); the type pin is
 * the compile-time proof that the fixtures mirror the engine's outputs.
 */
export type TodayReminderFixturePayload = ReminderPayload;

/** The REAL fallback-offer vocabulary shape (rung 2 only). */
export type TodayFallbackOfferFixture = FallbackOfferVocabulary;

/** The REAL offered-method option shape. */
export type TodayFallbackMethodOptionFixture = FallbackMethodOption;

/** The REAL quiet-hours defer record shape. */
export type TodayReminderDeferFixture = ReminderDeferRecord;

// ---------------------------------------------------------------------------
// Quiet-hours + preference mirrors (the schedule-math inputs).
// ---------------------------------------------------------------------------

/**
 * Mirror of the B8 `QuietHoursSpec`: half-open `[start, end)` local
 * minutes of day, wrap-aware, over a fixed UTC offset. The fixture
 * session's local-of-record is the SESSION's local timezone (see
 * `catalog.ts` for the recorded anchoring rationale).
 */
export interface TodayQuietHoursMirror {
  readonly enabled: boolean;
  readonly startMinuteOfDay: number;
  readonly endMinuteOfDay: number;
  readonly utcOffsetMinutes: number;
}

/**
 * Mirror of the B8 `ReminderPreferenceProfile` knobs the schedule math
 * reads (master gate, quiet hours, lead time, escalation grace). The
 * channel fan-out is the engine's DISPATCH concern — the Today surface
 * shows the per-task ladder state, which is channel-independent.
 */
export interface TodayReminderProfileMirror {
  readonly remindersEnabled: boolean;
  readonly quietHours: TodayQuietHoursMirror | null;
  readonly leadTimeMs: number;
  readonly escalationGraceMs: number;
}

// ---------------------------------------------------------------------------
// Wire types (client <-> /api/today/reminders; ISO-8601 strings).
// ---------------------------------------------------------------------------

/** The quiet-hours defer record in wire form. */
export interface TodayReminderDeferWire {
  /** The original (pre-deferral) fire instant (ISO-8601). */
  readonly from: string;
  /** Fixed vocabulary — always `"quiet-hours"` (B8 `ReminderDeferRecord`). */
  readonly reason: "quiet-hours";
  /** Honest display label, e.g. `"deferred to 07:00"` (defer, never drop). */
  readonly label: string;
}

/**
 * The fallback-provider offer in wire form — DATA, never an order:
 * the task's ordered method vocabulary (preferred first) with the
 * type-encoded `enforcementAuthority: "none"`.
 */
export interface TodayFallbackOfferWire {
  readonly enforcementAuthority: "none";
  readonly methods: readonly TodayFallbackMethodOptionWire[];
}

/** One offered method (wire form of B8 `FallbackMethodOption`). */
export interface TodayFallbackMethodOptionWire {
  readonly methodId: string;
  readonly methodLabel: string;
  readonly role: "preferred" | "fallback";
}

/**
 * A reminder on the wire — the payload fields (ISO-8601) plus the
 * Lane-B view projections the card renders (badge + detail labels,
 * delivery state, quiet-hours label).
 */
export interface TodayReminderWire {
  /** Deterministic SYNTH-marked reminder id (`remd_` grammar, B8 mirror). */
  readonly reminderId: string;
  readonly rung: TodayReminderRung;
  readonly taskId: string;
  readonly planId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly window: {
    readonly sequence: number;
    readonly startsAt: string;
    readonly endsAt: string;
  };
  /** The EFFECTIVE fire instant after quiet-hours deferral (ISO-8601). */
  readonly scheduledAt: string;
  /** Derived at read time: has the effective fire instant passed? */
  readonly deliveryState: "scheduled" | "delivered";
  /** Badge text, e.g. "Reminder scheduled" / "Reminder sent — fallback options offered". */
  readonly reminderLabel: string;
  /** Detail text carrying the rung vocabulary + time/deferral honesty. */
  readonly detailLabel: string;
  /** Present exactly when quiet-hours-deferred (defer, never drop). */
  readonly defer?: TodayReminderDeferWire;
  /** Present exactly on rung 2 (the missed-window fallback offer). */
  readonly fallbackOffer?: TodayFallbackOfferWire;
  /** The active quiet-hours label, e.g. "22:00–07:00". */
  readonly quietHoursLabel: string;
}

/** `GET /api/today/reminders` response body. */
export interface TodayRemindersResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly reminders: readonly TodayReminderWire[];
  /** The active quiet-hours label (honest about deferral policy). */
  readonly quietHoursLabel: string;
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own route).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: is `payload` a successful reminders response? */
export function isTodayRemindersResponse(
  payload: unknown,
): payload is TodayRemindersResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true || !isNonEmptyString(payload.personId)) {
    return false;
  }
  return Array.isArray(payload.reminders);
}
