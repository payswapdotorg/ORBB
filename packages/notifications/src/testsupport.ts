/**
 * @orbb/notifications local test support — SYNTHETIC fixtures only.
 *
 * NOT exported from the package index (mirrors the @orbb/measurement
 * `testsupport.ts` and @orbb/db `testing.ts` precedents): this module
 * exists so the engine's own tests (and a future Lane C E2E harness) can
 * build deterministic, zero-PHI harnesses — every id is `SYNTH-`-marked,
 * every label is a SYNTH catalog label, and the PHI DECOY vocabulary
 * below exists precisely so the no-PHI proofs can assert that
 * person-identifying or clinical content NEVER crosses into payloads,
 * deliveries, or ledger records.
 *
 * Determinism contract: `buildNotificationHarness` with the same
 * seed/epoch and the same call sequence replays byte-identically (the
 * testkit clock + id factory are the only time/identity sources).
 */
import { parsePersonId, parsePlanId, parseTaskId, type PersonId, type PlanId, type TaskId } from "@orbb/domain";
import type { MeasurementTask, MeasurementWindow } from "@orbb/measurement";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { InMemoryChannel } from "./channels.js";
import { InMemoryChannelRegistry } from "./channels.js";
import { InMemoryRecipientEndpointDirectory } from "./channels.js";
import { SyntheticEmailChannel } from "./channels.js";
import { SyntheticWebPushChannel } from "./channels.js";
import { ReminderEngine } from "./engine.js";
import { InMemoryReminderLabelDirectory } from "./labels.js";
import { InMemorySendAttemptLedger } from "./ledger.js";
import { DEFAULT_REMINDER_PROFILE, type ReminderPreferenceProfile } from "./preferences.js";
import { MS_PER_DAY, type QuietHoursSpec } from "./quietHours.js";
import { InMemoryRecipientDirectory } from "./recipients.js";
import type { NotificationChannelId } from "./vocabulary.js";

/** One millisecond/hour (pure UTC arithmetic — DST-free). */
export const MS_PER_HOUR = 3_600_000;

/** Re-exported for test brevity (the quiet-hours module owns the constant). */
export { MS_PER_DAY };

/** The canonical synthetic person the default harness registers. */
export const SYNTH_PERSON_ID: PersonId = parsePersonId("prsn_SYNTH-person-00000001");

/** The canonical synthetic plan id for harness task snapshots. */
export const SYNTH_PLAN_ID: PlanId = parsePlanId("plan_SYNTH-plan-00000001");

/** The opaque recipient pseudonym registered for {@link SYNTH_PERSON_ID}. */
export const SYNTH_RECIPIENT_REF = "SYNTH-recipient-00000001";

/** SYNTH metric vocabulary of the harness task fixtures. */
export const SYNTH_METRIC_IDS = {
  bloodPressure: "SYNTH-metric-blood-pressure",
  stepCount: "SYNTH-metric-step-count",
} as const;

/** SYNTH method vocabulary of the harness task fixtures (preferred first). */
export const SYNTH_METHOD_IDS = {
  bpCuff: "SYNTH-method-bp-cuff",
  bpManual: "SYNTH-method-bp-manual",
  stepsWearable: "SYNTH-method-steps-wearable",
} as const;

/** SYNTH human-safe labels (obviously synthetic — the AGENTS.md test-data rule). */
export const SYNTH_LABELS = {
  bloodPressure: "SYNTH-label-blood-pressure-check",
  stepCount: "SYNTH-label-step-count-check",
  bpCuff: "SYNTH-label-bp-cuff",
  bpManual: "SYNTH-label-bp-manual",
  stepsWearable: "SYNTH-label-steps-wearable",
} as const;

/**
 * The PHI DECOY vocabulary — deliberately person-identifying /
 * clinical-looking SYNTH strings planted on task snapshots (and in
 * no-PHI test fixtures) so the not.toContain proofs are meaningful:
 * none of these may ever appear in a payload, delivery, or ledger entry.
 */
export const PHI_DECOYS = {
  /** A decoy person id planted on PHI-proof task snapshots. */
  personId: "prsn_SYNTH-person-77-phi-decoy",
  /** The concept code the real task snapshot carries (denied in payloads). */
  conceptCode: "SYNTH-concept-phi-decoy-7",
  /** Decoy observation VALUE content. */
  observationValue: "SYNTH-98.6-mmhg-sys-phi",
  /** Decoy evidence blob content. */
  evidenceContent: "SYNTH-evidence-phi-blob",
  /** Decoy person-identifying free text. */
  freeText: "SYNTH-jane-doe-patient-note",
} as const;

/** A canonical synthetic task id for fixture `index` (domain-parsed). */
export function syntheticTaskId(index: number): TaskId {
  return parseTaskId(`task_SYNTH-task-${String(index).padStart(8, "0")}`);
}

/** A canonical synthetic plan id for fixture `index` (domain-parsed). */
export function syntheticPlanId(index: number): PlanId {
  return parsePlanId(`plan_SYNTH-plan-${String(index).padStart(8, "0")}`);
}

/** The branded PHI-decoy person id (the literal lives in {@link PHI_DECOYS}). */
export const PHI_DECOY_PERSON_ID: PersonId = parsePersonId("prsn_SYNTH-person-77-phi-decoy");

/** Task fixture spec — every field overridable, SYNTH defaults elsewhere. */
export interface SyntheticTaskSpec {
  /** Fixture index (default 1) — drives the default id and plan id. */
  readonly index?: number;
  readonly state?: "open" | "completed";
  readonly metricId?: string;
  /** Default: the blood-pressure chain (cuff preferred, manual fallback). */
  readonly methodOrder?: readonly string[];
  /**
   * Default: an UPCOMING window `[+1d, +1d+2h)` relative to the Unix
   * epoch (upcoming at the default harness epoch 0).
   */
  readonly window?: MeasurementWindow;
  readonly planId?: PlanId;
  readonly personId?: PersonId;
  /** Default: the PHI decoy concept code (present on real snapshots, stripped from payloads). */
  readonly conceptCode?: string;
  readonly rollCount?: number;
  readonly createdAt?: Date;
}

/** Builds one REAL-shaped `MeasurementTask` snapshot from SYNTH parts. */
export function syntheticTask(spec: SyntheticTaskSpec = {}): MeasurementTask {
  const index = spec.index ?? 1;
  return {
    id: syntheticTaskId(index),
    planId: spec.planId ?? syntheticPlanId(index),
    personId: spec.personId ?? SYNTH_PERSON_ID,
    metricId: spec.metricId ?? SYNTH_METRIC_IDS.bloodPressure,
    conceptCode: spec.conceptCode ?? PHI_DECOYS.conceptCode,
    methodOrder: spec.methodOrder ?? [SYNTH_METHOD_IDS.bpCuff, SYNTH_METHOD_IDS.bpManual],
    window:
      spec.window ?? {
        sequence: 0,
        startsAt: new Date(MS_PER_DAY),
        endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
      },
    state: spec.state ?? "open",
    createdAt: spec.createdAt ?? new Date(0),
    rollCount: spec.rollCount ?? 0,
  };
}

/** The full notification harness: the engine wired over in-memory doubles. */
export interface NotificationHarness {
  readonly clock: DeterministicClock;
  readonly ids: DeterministicIdFactory;
  readonly ledger: InMemorySendAttemptLedger;
  readonly registry: InMemoryChannelRegistry;
  readonly recipients: InMemoryRecipientDirectory;
  readonly labels: InMemoryReminderLabelDirectory;
  readonly engine: ReminderEngine;
  readonly inmem: InMemoryChannel;
  readonly webpush: SyntheticWebPushChannel;
  readonly email: SyntheticEmailChannel;
  readonly webpushEndpoints: InMemoryRecipientEndpointDirectory;
  readonly emailEndpoints: InMemoryRecipientEndpointDirectory;
}

/** Options for {@link buildNotificationHarness}. */
export interface NotificationHarnessOptions {
  readonly seed?: string;
  readonly epochMs?: number;
}

/** Builds the notification harness (SYNTH vocabulary, deterministic doubles). */
export function buildNotificationHarness(
  options?: NotificationHarnessOptions,
): NotificationHarness {
  const seed = options?.seed ?? "m6b-seed";
  const clock = new DeterministicClock({ epochMs: options?.epochMs ?? 0 });
  const ids = new DeterministicIdFactory({ seed });
  const ledger = new InMemorySendAttemptLedger();
  const recipients = new InMemoryRecipientDirectory();
  recipients.register(SYNTH_PERSON_ID, SYNTH_RECIPIENT_REF);
  const labels = new InMemoryReminderLabelDirectory({
    metricLabels: {
      [SYNTH_METRIC_IDS.bloodPressure]: SYNTH_LABELS.bloodPressure,
      [SYNTH_METRIC_IDS.stepCount]: SYNTH_LABELS.stepCount,
    },
    methodLabels: {
      [SYNTH_METHOD_IDS.bpCuff]: SYNTH_LABELS.bpCuff,
      [SYNTH_METHOD_IDS.bpManual]: SYNTH_LABELS.bpManual,
      [SYNTH_METHOD_IDS.stepsWearable]: SYNTH_LABELS.stepsWearable,
    },
  });
  const webpushEndpoints = new InMemoryRecipientEndpointDirectory();
  webpushEndpoints.register(SYNTH_RECIPIENT_REF, {
    token: "SYNTH-webpush-endpoint-0001",
    status: "active",
  });
  const emailEndpoints = new InMemoryRecipientEndpointDirectory();
  emailEndpoints.register(SYNTH_RECIPIENT_REF, {
    token: "SYNTH-email-endpoint-0001",
    status: "active",
  });
  const inmem = new InMemoryChannel({ id: "inmem", clock });
  const webpush = new SyntheticWebPushChannel({ clock, endpoints: webpushEndpoints });
  const email = new SyntheticEmailChannel({ clock, endpoints: emailEndpoints });
  const registry = new InMemoryChannelRegistry([inmem, webpush, email]);
  const engine = new ReminderEngine({ clock, ids, channels: registry, ledger, recipients, labels });
  return {
    clock,
    ids,
    ledger,
    registry,
    recipients,
    labels,
    engine,
    inmem,
    webpush,
    email,
    webpushEndpoints,
    emailEndpoints,
  };
}

/** Overridable profile parts (exactOptionalPropertyTypes-safe builder). */
export interface HarnessProfileOverrides {
  readonly remindersEnabled?: boolean;
  readonly channels?: readonly NotificationChannelId[];
  readonly quietHours?: QuietHoursSpec | null;
  readonly leadTimeMs?: number;
  readonly escalationGraceMs?: number;
}

/**
 * Builds a preference profile over the recorded defaults
 * ({@link DEFAULT_REMINDER_PROFILE} semantics: default channel `inmem`,
 * default quiet hours, default knobs).
 */
export function harnessProfile(overrides: HarnessProfileOverrides = {}): ReminderPreferenceProfile {
  return {
    remindersEnabled: overrides.remindersEnabled ?? true,
    channels: overrides.channels ?? DEFAULT_REMINDER_PROFILE.channels,
    ...(overrides.quietHours !== undefined ? { quietHours: overrides.quietHours } : {}),
    ...(overrides.leadTimeMs !== undefined ? { leadTimeMs: overrides.leadTimeMs } : {}),
    ...(overrides.escalationGraceMs !== undefined
      ? { escalationGraceMs: overrides.escalationGraceMs }
      : {}),
  };
}

/** Quiet-hours spec shorthand (defaults: enabled, 22:00–07:00, offset 0). */
export function quietHours(
  spec: Partial<QuietHoursSpec> = {},
): QuietHoursSpec {
  return {
    enabled: spec.enabled ?? true,
    startMinuteOfDay: spec.startMinuteOfDay ?? 22 * 60,
    endMinuteOfDay: spec.endMinuteOfDay ?? 7 * 60,
    utcOffsetMinutes: spec.utcOffsetMinutes ?? 0,
  };
}

/**
 * Revives measurement-task snapshots from their canonical JSON form
 * (Dates as epoch-ms integers — the {@link canonical} serializer's
 * convention). Used by the serialized-re-instantiation determinism proof.
 */
export function reviveTasksFromCanonicalJson(canonical: string): MeasurementTask[] {
  const parsed = JSON.parse(canonical) as Array<Record<string, unknown>>;
  return parsed.map((entry) => {
    const window = entry.window as Record<string, unknown>;
    return {
      ...(entry as unknown as MeasurementTask),
      window: {
        sequence: window.sequence as number,
        startsAt: new Date(window.startsAt as number),
        endsAt: new Date(window.endsAt as number),
      },
      createdAt: new Date(entry.createdAt as number),
    };
  });
}
