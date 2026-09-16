/**
 * @orbb/notifications local test support — SYNTHETIC fixtures only.
 *
 * NOT exported from the package index (mirrors the `@orbb/measurement`
 * `testsupport.ts` precedent): this module exists so the engine's own
 * tests can build deterministic, zero-PHI harnesses — every id is
 * `SYNTH`-marked testkit output, every concept code carries a `/` so it
 * can never collide with base64url-derived ids in no-PHI proofs, and
 * every label is an obviously synthetic human-safe string.
 *
 * Determinism contract: `buildReminderHarness` with the same seed/epoch
 * and the same call sequence replays byte-identically (the testkit clock
 * and id factory are the only time/identity sources; reminder identities
 * themselves are content-derived in `ids.ts`).
 */
import { parsePersonId, type PersonId, type PlanId, type TaskId } from "@orbb/domain";
import type { MeasurementTask, MeasurementWindow } from "@orbb/measurement";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { ReminderEngine } from "./engine.js";
import { InMemoryReminderDispatchLedger } from "./ledger.js";
import {
  channelRecipient,
  type ChannelRecipient,
  type ReminderPreferenceProfile,
} from "./preferences.js";

/** Canonical-id body reused across harness literals (26 chars, URL-safe). */
export const SYNTH_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

/** A canonical synthetic person id for harness fixtures. */
export function harnessPersonId(): PersonId {
  return parsePersonId(`prsn_${SYNTH_BODY}`);
}

/** A canonical synthetic plan id for harness task snapshots. */
export function harnessPlanId(): PlanId {
  return `plan_${SYNTH_BODY}` as PlanId;
}

/** Synthetic human-safe labels (obviously non-identifying). */
export const SYNTH_LABELS = {
  metric: "Synthetic metric label",
  methodWearable: "Synthetic wearable method",
  methodApp: "Synthetic app method",
  methodManual: "Synthetic manual method",
} as const;

/** Synthetic method vocabulary (the task's recorded fallback chain). */
export const SYNTH_METHOD_ORDER = [
  "SYNTH-method-wearable",
  "SYNTH-method-app",
  "SYNTH-method-manual",
] as const;

/** The full reminder harness: engine + doubles, all deterministic. */
export interface ReminderHarness {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly ledger: InMemoryReminderDispatchLedger;
  readonly engine: ReminderEngine;
  readonly personId: PersonId;
}

/** Options for {@link buildReminderHarness}. */
export interface ReminderHarnessOptions {
  readonly seed?: string;
  readonly epochMs?: number;
}

/** Builds the deterministic reminder harness. */
export function buildReminderHarness(options?: ReminderHarnessOptions): ReminderHarness {
  const clock = new DeterministicClock({ epochMs: options?.epochMs ?? 0 });
  const ids = new DeterministicIdFactory({ seed: options?.seed ?? "m6b-b8-seed" });
  const ledger = new InMemoryReminderDispatchLedger();
  const engine = new ReminderEngine({ clock, ledger });
  return { clock, ids, ledger, engine, personId: harnessPersonId() };
}

/** Overrides for {@link syntheticTask}. */
export interface SyntheticTaskOverrides {
  readonly id?: TaskId;
  readonly planId?: PlanId;
  readonly personId?: PersonId;
  readonly metricId?: string;
  readonly conceptCode?: string;
  readonly methodOrder?: readonly string[];
  readonly window?: Partial<MeasurementWindow>;
  readonly state?: "open" | "completed";
  readonly rollCount?: number;
}

/**
 * Builds a synthetic measurement-task snapshot. The default window is
 * [2024-01-02T10:00Z, 2024-01-02T11:00Z) — a Tuesday morning, chosen so
 * UTC-day-edge and week-boundary tests can anchor nearby deterministically.
 */
export function syntheticTask(
  ids: DeterministicIdFactory,
  overrides?: SyntheticTaskOverrides,
): MeasurementTask {
  const startsAt = overrides?.window?.startsAt ?? new Date(Date.UTC(2024, 0, 2, 10, 0, 0));
  const endsAt = overrides?.window?.endsAt ?? new Date(startsAt.getTime() + 3_600_000);
  return {
    id: overrides?.id ?? (ids.next("task") as TaskId),
    planId: overrides?.planId ?? harnessPlanId(),
    personId: overrides?.personId ?? harnessPersonId(),
    metricId: overrides?.metricId ?? "SYNTH-metric-heart-rate",
    // The "/" makes this concept sentinel PROVABLY impossible inside
    // base64url-derived ids (no-PHI proof soundness).
    conceptCode: overrides?.conceptCode ?? "SYNTH/8867/4",
    methodOrder: overrides?.methodOrder ?? [...SYNTH_METHOD_ORDER],
    window: {
      sequence: overrides?.window?.sequence ?? 0,
      startsAt,
      endsAt,
    },
    state: overrides?.state ?? "open",
    createdAt: new Date(Date.UTC(2024, 0, 1, 8, 0, 0)),
    rollCount: overrides?.rollCount ?? 0,
  };
}

/** Overrides for {@link syntheticProfile}. */
export interface SyntheticProfileOverrides
  extends Partial<Omit<ReminderPreferenceProfile, "personId" | "channelRecipients">> {
  readonly recipients?: Readonly<Record<string, string>>;
}

/**
 * Builds a synthetic preference profile: reminders on, the given channels
 * enabled with recipient references, UTC+0 local-of-record, default quiet
 * hours (22:00–07:00), 1h upcoming lead, 24h escalation grace — every
 * knob overridable.
 */
export function syntheticProfile(overrides?: SyntheticProfileOverrides): ReminderPreferenceProfile {
  const enabledChannelIds = overrides?.enabledChannelIds ?? ["in-memory"];
  const recipients: Readonly<Record<string, string>> = overrides?.recipients ?? {
    "in-memory": "SYNTH-recipient-in-memory",
  };
  const channelRecipients: Record<string, ChannelRecipient> = {};
  for (const [channelId, reference] of Object.entries(recipients)) {
    channelRecipients[channelId] = channelRecipient(reference);
  }
  return {
    personId: harnessPersonId(),
    remindersEnabled: overrides?.remindersEnabled ?? true,
    enabledChannelIds,
    channelRecipients,
    localUtcOffsetMinutes: overrides?.localUtcOffsetMinutes ?? 0,
    ...(overrides?.quietHours !== undefined ? { quietHours: overrides.quietHours } : {}),
    ...(overrides?.upcomingLeadMs !== undefined
      ? { upcomingLeadMs: overrides.upcomingLeadMs }
      : {}),
    ...(overrides?.escalationAfterMs !== undefined
      ? { escalationAfterMs: overrides.escalationAfterMs }
      : {}),
  };
}
