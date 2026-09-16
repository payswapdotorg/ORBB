/**
 * Reminder payload (B8) — the AUDITABLE, PHI-free content surface.
 *
 * THE PHI CONTRACT (hard requirement, proven by not.toContain tests):
 * a reminder payload references TASK/METRIC/WINDOW IDS and HUMAN-SAFE
 * LABELS ONLY. It NEVER contains:
 *   - observation values (the redaction policy's `value`),
 *   - concept codes (the redaction policy's `conceptCode` — present on
 *     the real task snapshot but deliberately STRIPPED here),
 *   - evidence content or evidence ids,
 *   - person identifiers or person-identifying free text (`personId`
 *     stays on the internal planned reminder for recipient resolution and
 *     never crosses into payloads, deliveries, or ledger records),
 *   - any free-text generation of the engine's own.
 *
 * FALLBACK-OFFER VARIANT (journey #7): the rung-2 payload carries the
 * task's recorded method vocabulary as DATA — the ordered `methodOrder`
 * (preferred first, fallback order after), labeled through the injected
 * label directory. The offer is a VOCABULARY, never an order: the engine
 * selects nothing, ranks nothing beyond the task's own recorded order,
 * and applies nothing. `enforcementAuthority: "none"` is type-encoded on
 * the offer — this module exports no way to produce any other authority
 * value (the §8-style boundary pattern of `@orbb/intents/proposal.ts`;
 * authorized restrictions are B10's adherence-enforcement abstraction).
 *
 * DEFER VARIANT: a quiet-hours-deferred reminder records its original
 * fire instant and the defer reason — defer-not-drop is auditable data.
 */
import type { PlanId, TaskId } from "@orbb/domain";
import type { MeasurementTask } from "@orbb/measurement";
import { DEFAULT_METRIC_LABEL, DEFAULT_METHOD_LABEL, type ReminderLabelDirectory } from "./labels.js";
import type { ReminderRung } from "./vocabulary.js";

/**
 * The fallback-provider offer vocabulary recorded on the task (journey #7
 * rung 2). DATA ONLY: the ordered method chain exactly as the measurement
 * engine compiled it — preferred method first, fallback order after. The
 * engine never orders a provider.
 */
export interface FallbackOfferVocabulary {
  /**
   * LITERAL `"none"`: the reminder engine carries NO enforcement
   * authority. Authorized restrictions (journey #7's tail — "applied only
   * if configured") belong to B10's adherence-enforcement abstraction.
   */
  readonly enforcementAuthority: "none";
  /** The task's ordered method vocabulary (preferred first). */
  readonly methods: readonly FallbackMethodOption[];
}

/** One offered method of the fallback vocabulary. */
export interface FallbackMethodOption {
  readonly methodId: string;
  /** Human-safe label (injected directory; neutral fallback on miss). */
  readonly methodLabel: string;
  /** `preferred` for the task's first compiled method, `fallback` for the rest. */
  readonly role: "preferred" | "fallback";
}

/** The defer record — present exactly on quiet-hours-deferred reminders. */
export interface ReminderDeferRecord {
  /** The original (pre-deferral) fire instant. */
  readonly from: Date;
  /** The recorded defer reason. Fixed vocabulary. */
  readonly reason: "quiet-hours";
}

/** Fields shared by every payload variant. */
interface ReminderPayloadBase {
  /** The ladder rung this reminder carries (the payload discriminant). */
  readonly rung: ReminderRung;
  readonly taskId: TaskId;
  readonly planId: PlanId;
  readonly metricId: string;
  /** Human-safe metric label (injected directory; neutral fallback on miss). */
  readonly metricLabel: string;
  /** The measurement window identity: sequence + half-open UTC bounds. */
  readonly window: {
    readonly sequence: number;
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
}

/** Rung 1 — the upcoming-due nudge payload (no fallback-offer key at all). */
export interface UpcomingDueReminderPayload extends ReminderPayloadBase {
  readonly rung: "REMIND";
}

/**
 * Rung 2 — the missed-window payload with the fallback-provider offer
 * (journey #7): the task's recorded method vocabulary as DATA.
 */
export interface FallbackOfferReminderPayload extends ReminderPayloadBase {
  readonly rung: "REMIND_WITH_FALLBACK_OFFER";
  readonly fallbackOffer: FallbackOfferVocabulary;
}

/**
 * A reminder payload. Discriminated by `rung`: `fallbackOffer` exists
 * exactly on rung 2; `defer` exists exactly on quiet-hours-deferred
 * reminders of either rung. Every variant is the AUDITABLE surface —
 * serialize/hash it freely (see `serialization.ts`): it is PHID-free by
 * construction.
 */
export type ReminderPayload =
  | (UpcomingDueReminderPayload & { readonly defer?: ReminderDeferRecord })
  | (FallbackOfferReminderPayload & { readonly defer?: ReminderDeferRecord });

/** Input to the pure payload builder. */
export interface BuildReminderPayloadInput {
  /** The real measurement-task snapshot the reminder is computed from. */
  readonly task: MeasurementTask;
  readonly rung: ReminderRung;
  /** The injected human-safe label directory. */
  readonly labels: ReminderLabelDirectory;
  /** Present exactly when the fire instant was quiet-hours-deferred. */
  readonly defer?: ReminderDeferRecord;
}

/**
 * Builds the PHI-free reminder payload for a task snapshot. Pure: the
 * payload is a strict projection of (task identity fields, directory
 * labels, rung, defer record) — everything else on the task (personId,
 * conceptCode, rollCount, createdAt) is deliberately NOT projected.
 */
export function buildReminderPayload(input: BuildReminderPayloadInput): ReminderPayload {
  const { task, rung, labels, defer } = input;
  const base = {
    taskId: task.id,
    planId: task.planId,
    metricId: task.metricId,
    metricLabel: labels.metricLabel(task.metricId) ?? DEFAULT_METRIC_LABEL,
    window: {
      sequence: task.window.sequence,
      startsAt: task.window.startsAt,
      endsAt: task.window.endsAt,
    },
    ...(defer !== undefined ? { defer } : {}),
  };
  if (rung === "REMIND") {
    return { ...base, rung };
  }
  const methods = task.methodOrder.map((methodId, index) => ({
    methodId,
    methodLabel: labels.methodLabel(methodId) ?? DEFAULT_METHOD_LABEL,
    role: index === 0 ? ("preferred" as const) : ("fallback" as const),
  }));
  return {
    ...base,
    rung,
    fallbackOffer: { enforcementAuthority: "none", methods },
  };
}
