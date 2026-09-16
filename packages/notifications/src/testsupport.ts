/**
 * @orbb/notifications local test support — SYNTHETIC fixtures only.
 *
 * NOT exported from the package index (the `@orbb/measurement`
 * `testsupport.ts` precedent): this module exists so the engine's own
 * tests (and the Lane C E2E harness) can build deterministic, zero-PHI
 * harnesses — every id is obviously `SYNTH-`-marked or a deterministic
 * domain-separated hash, every timestamp is testkit-clock driven, and no
 * observation value, evidence content, or person-identifying free text
 * ever enters an input.
 *
 * Determinism contract: `buildNotificationHarness` with the same
 * seed/epoch and the same call sequence replays byte-identically (the
 * testkit clock + id factory are the only time/identity sources).
 */
import { parsePersonId, type PersonId, type PlanId, type TaskId } from "@orbb/domain";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { deriveDeterministicId, type MeasurementTask, type TaskState } from "@orbb/measurement";
import {
  defaultQuietHours,
  type ChannelPreference,
  type QuietHoursSpec,
  type ReminderPreferences,
} from "./preferences.js";
import { MS_PER_HOUR, MS_PER_MINUTE } from "./quiet-hours.js";
import { InMemoryChannel } from "./inmemory-channel.js";
import { InMemoryChannelRegistry, type NotificationChannel } from "./channels.js";
import { InMemoryReminderDispatchLedger } from "./ledger.js";
import { InMemoryReminderEventSink } from "./events.js";
import { ReminderEngine } from "./engine.js";

/** Canonical-id bodies reused across harness literals (26 chars, URL-safe). */
export const SYNTH_BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

/** A canonical synthetic person id for harness fixtures. */
export function synthPersonId(): PersonId {
  return parsePersonId(`prsn_${SYNTH_BODY}`);
}

/** A canonical synthetic plan id (for direct task fixtures). */
export function synthPlanId(): PlanId {
  return `plan_${SYNTH_BODY}` as PlanId;
}

/**
 * A canonical synthetic task id: derived with the REAL deterministic id
 * helper (the production grammar), domain-separated per fixture number —
 * same number => same task id, always.
 */
export function synthTaskId(n: number): TaskId {
  return deriveDeterministicId(
    "task",
    "orbb/notifications/test/task-id/v1",
    [n],
  ) as TaskId;
}

/** Synthetic metric id aligned with the seeded measurement vocabulary style. */
export const SYNTH_METRIC_ID = "metric-synth-heart-rate";

/** Synthetic method order: preferred first, then the fallback vocabulary. */
export const SYNTH_METHOD_ORDER: readonly string[] = [
  "method-synth-wearable",
  "method-synth-app",
  "method-synth-manual",
];

/** Overrides accepted by {@link synthTask}. */
export interface SynthTaskOverrides {
  readonly id?: TaskId;
  readonly personId?: PersonId;
  readonly planId?: PlanId;
  readonly metricId?: string;
  readonly methodOrder?: readonly string[];
  readonly state?: TaskState;
  readonly sequence?: number;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly createdAt?: Date;
  readonly rollCount?: number;
}

/** Builds a synthetic open measurement task (the REAL @orbb/measurement type). */
export function synthTask(overrides?: SynthTaskOverrides): MeasurementTask {
  return {
    id: overrides?.id ?? synthTaskId(1),
    planId: overrides?.planId ?? synthPlanId(),
    personId: overrides?.personId ?? synthPersonId(),
    metricId: overrides?.metricId ?? SYNTH_METRIC_ID,
    conceptCode: "SYNTH-8867-4",
    methodOrder: overrides?.methodOrder ?? SYNTH_METHOD_ORDER,
    window: {
      sequence: overrides?.sequence ?? 0,
      startsAt: overrides?.startsAt ?? new Date(0),
      endsAt: overrides?.endsAt ?? new Date(MS_PER_HOUR),
    },
    state: overrides?.state ?? "open",
    createdAt: overrides?.createdAt ?? new Date(0),
    rollCount: overrides?.rollCount ?? 0,
  };
}

/** Overrides accepted by {@link synthPreferences}. */
export interface SynthPreferencesOverrides {
  readonly personId?: PersonId;
  readonly remindersEnabled?: boolean;
  readonly quietHours?: QuietHoursSpec;
  readonly localUtcOffsetMinutes?: number;
  readonly leadMinutes?: number;
  readonly escalationDelayMinutes?: number;
  readonly channelPreferences?: readonly ChannelPreference[];
}

/** Builds the default synthetic preference profile (22:00–07:00 UTC+0, lead 60, delay 30). */
export function synthPreferences(overrides?: SynthPreferencesOverrides): ReminderPreferences {
  return {
    personId: overrides?.personId ?? synthPersonId(),
    remindersEnabled: overrides?.remindersEnabled ?? true,
    quietHours: overrides?.quietHours ?? defaultQuietHours(),
    localUtcOffsetMinutes: overrides?.localUtcOffsetMinutes ?? 0,
    leadMinutes: overrides?.leadMinutes ?? 60,
    escalationDelayMinutes: overrides?.escalationDelayMinutes ?? 30,
    channelPreferences: overrides?.channelPreferences ?? [],
  };
}

/** The full notification harness: every port wired over in-memory doubles. */
export interface NotificationHarness {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly ledger: InMemoryReminderDispatchLedger;
  readonly eventSink: InMemoryReminderEventSink;
  readonly engine: ReminderEngine;
  readonly registry: InMemoryChannelRegistry;
  /** The default in-app test channel (programmable). */
  readonly channel: InMemoryChannel;
}

/** Options for {@link buildNotificationHarness}. */
export interface NotificationHarnessOptions {
  readonly seed?: string;
  readonly epochMs?: number;
  readonly maxDispatchAttempts?: number;
  /** Extra channels registered alongside the default in-app channel. */
  readonly extraChannels?: readonly NotificationChannel[];
  /** Replacement channel set (overrides the default in-app channel). */
  readonly channels?: readonly NotificationChannel[];
}

/** Builds the notification harness over deterministic doubles. */
export function buildNotificationHarness(options?: NotificationHarnessOptions): NotificationHarness {
  const seed = options?.seed ?? "b8-seed";
  const clock = new DeterministicClock({ epochMs: options?.epochMs ?? 0 });
  const ids = new DeterministicIdFactory({ seed });
  const channel = new InMemoryChannel({ id: "inapp-memory", clock });
  const channels =
    options?.channels ?? [channel, ...(options?.extraChannels ?? [])];
  const registry = new InMemoryChannelRegistry(channels);
  const ledger = new InMemoryReminderDispatchLedger();
  const eventSink = new InMemoryReminderEventSink();
  const engine = new ReminderEngine({
    clock,
    ids,
    ledger,
    events: eventSink,
    ...(options?.maxDispatchAttempts !== undefined
      ? { options: { maxDispatchAttempts: options.maxDispatchAttempts } }
      : {}),
  });
  return { clock, ids, ledger, eventSink, engine, registry, channel };
}

/** Convenience: minutes in milliseconds (test readability). */
export const MINUTE = MS_PER_MINUTE;

/** Convenience: hours in milliseconds (test readability). */
export const HOUR = MS_PER_HOUR;
