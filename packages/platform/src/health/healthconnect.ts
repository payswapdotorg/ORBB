/**
 * A35 — Health Connect seam (Lane C packet M4-C).
 *
 * `HealthConnectAdapter` implements the A32 `DeviceSourceAdapter`
 * contract over a `HealthConnectNativeModule` interface: the permissions
 * flow (`hasPermissions` / `requestPermissions` launching the Health
 * Connect permission intent) and `readRecords` by record type + range.
 * Health Connect record shapes (HeartRateRecord, StepsRecord,
 * SleepSessionRecord) are mirrored in TypeScript with the units per the
 * Health Connect documentation — heart rate in beats per minute ("bpm"),
 * step count in "count", sleep duration in "min".
 *
 * Mobile reality (packet): Health Connect needs Android intents. THIS
 * packet ships the TypeScript seam — the `HealthConnectNativeModule`
 * interface is the contract for the real native binding
 * (deployment/mobile-integration milestone, handoff recorded) — plus a
 * SYNTHETIC native double returning the same metric set as the HealthKit
 * seam with deterministic records.
 *
 * Authorization gate (packet rule): a fetch for which the permissions
 * check fails resolves to a TYPED EMPTY result — never a throw, never
 * partial data. Fetching never auto-requests permissions; the UX flow
 * calls {@link HealthConnectAdapter.requestAuthorization} explicitly.
 */
import { parseQualityScore, type EvidenceLabel, type QualityScore, type SourceId } from "@orbb/domain";
import type { Logger } from "@orbb/observability";
import { err, ok, type HealthResult } from "./result.js";
import type {
  AuthorizationStatus,
  DeviceSourceAdapter,
  MeasurementSourceRegistry,
  MeasurementWindow,
  NormalizeSamplesInput,
  NormalizationError,
  ObservationDraft,
  RawDeviceSample,
  SampleFetchError,
  SampleFetchRequest,
  SampleFetchResult,
} from "./sources.js";
import { normalizeSamplesForBinding } from "./sources.js";

// ---------------------------------------------------------------------------
// Health Connect native surface, mirrored in TypeScript.
// ---------------------------------------------------------------------------

/** Health Connect record types this seam covers (typed subset). */
export const HC_RECORD_TYPES = ["HeartRateRecord", "StepsRecord", "SleepSessionRecord"] as const;

export type HCRecordType = (typeof HC_RECORD_TYPES)[number];

/**
 * Health Connect read permissions this seam needs (manifest declarations
 * land via the Expo Android config surface — TEXT ONLY in this packet).
 */
export const HEALTH_CONNECT_PERMISSIONS = [
  "android.permission.health.READ_HEART_RATE",
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_SLEEP",
] as const;

export type HealthConnectPermission = (typeof HEALTH_CONNECT_PERMISSIONS)[number];

/** HeartRateRecord sample: instantaneous beats-per-minute measurements. */
export interface HCHeartRateSample {
  readonly time: Date;
  readonly beatsPerMinute: number;
}

/** Health Connect HeartRateRecord mirrored (units: beats per minute). */
export interface HCHeartRateRecord {
  readonly recordId: string;
  readonly recordType: "HeartRateRecord";
  readonly startTime: Date;
  readonly endTime: Date;
  readonly samples: readonly HCHeartRateSample[];
}

/** Health Connect StepsRecord mirrored (units: count). */
export interface HCStepsRecord {
  readonly recordId: string;
  readonly recordType: "StepsRecord";
  readonly startTime: Date;
  readonly endTime: Date;
  readonly count: number;
}

/**
 * Health Connect SleepSessionRecord mirrored. Per the packet's unit table
 * (Health Connect docs), sleep durations are expressed in MINUTES; the
 * record carries the session interval plus the explicit minutes field.
 */
export interface HCSleepSessionRecord {
  readonly recordId: string;
  readonly recordType: "SleepSessionRecord";
  readonly startTime: Date;
  readonly endTime: Date;
  readonly minutes: number;
}

/** Any Health Connect record this seam understands. */
export type HCRecord = HCHeartRateRecord | HCStepsRecord | HCSleepSessionRecord;

/**
 * The native module contract for the REAL Health Connect binding (handoff
 * to the deployment/mobile-integration milestone): the permissions check,
 * the permission-request intent flow, and a records read by type + range
 * (half-open [startsAt, endsAt) on the record start).
 */
export interface HealthConnectNativeModule {
  hasPermissions(permissions: readonly HealthConnectPermission[]): Promise<boolean>;
  requestPermissions(permissions: readonly HealthConnectPermission[]): Promise<boolean>;
  readRecords(input: {
    readonly recordType: HCRecordType;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }): Promise<readonly HCRecord[]>;
}

// ---------------------------------------------------------------------------
// Metric bindings: the adapter's typed native metric surface.
// ---------------------------------------------------------------------------

/**
 * One bound metric: which HC record type serves it, the Health Connect
 * read permission it needs, the method it maps to (app-import vocabulary,
 * engine-owned — ids align with the Lane A seed), the native unit the
 * adapter reports raw samples in, and the domain evidence label + quality
 * the drafts carry until the engine's quality policy takes over (recorded
 * assumption: adapters stamp the app-import method's typical quality
 * midpoint).
 */
export interface HCMetricBinding {
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodId: string;
  readonly recordType: HCRecordType;
  readonly permission: HealthConnectPermission;
  /** Native unit the adapter reports raw samples in. */
  readonly nativeUnit: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
}

/**
 * The seeded Health Connect metric surface (ids/units align with the Lane
 * A engine seed; concept codes are SYNTH-marked per the test-data rules;
 * units per the Health Connect documentation — bpm, count, minutes):
 *   - heart rate — HeartRateRecord — native "bpm"
 *   - step count — StepsRecord — native "count"
 *   - sleep minutes — SleepSessionRecord — native "min"
 */
export const HEALTH_CONNECT_METRIC_BINDINGS: readonly HCMetricBinding[] = [
  {
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    methodId: "SYNTH-method-hr-app",
    recordType: "HeartRateRecord",
    permission: "android.permission.health.READ_HEART_RATE",
    nativeUnit: "bpm",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.9),
  },
  {
    metricId: "SYNTH-metric-step-count",
    conceptCode: "SYNTH-41950-7",
    methodId: "SYNTH-method-steps-app",
    recordType: "StepsRecord",
    permission: "android.permission.health.READ_STEPS",
    nativeUnit: "count",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.85),
  },
  {
    metricId: "SYNTH-metric-sleep-minutes",
    conceptCode: "SYNTH-94641-0",
    methodId: "SYNTH-method-sleep-app",
    recordType: "SleepSessionRecord",
    permission: "android.permission.health.READ_SLEEP",
    nativeUnit: "min",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.82),
  },
];

// ---------------------------------------------------------------------------
// Synthetic native double (deterministic; SYNTH- marked ids only).
// ---------------------------------------------------------------------------

/** Options for the synthetic native double. */
export interface SyntheticHealthConnectOptions {
  /** Deterministic record script (SYNTH- ids only). Default: empty. */
  readonly records?: readonly HCRecord[];
  /** Are the permissions already granted? Default: false. */
  readonly permissionsGranted?: boolean;
  /** Does requestPermissions model a grant? Default: true. */
  readonly grantOnRequest?: boolean;
}

/**
 * Synthetic `HealthConnectNativeModule` double for tests: serves the exact
 * seeded records whose startTime falls in the requested half-open window,
 * ordered by startTime then recordId. Deterministic; never throws.
 */
export class SyntheticHealthConnectNativeModule implements HealthConnectNativeModule {
  readonly #records: readonly HCRecord[];
  #granted: boolean;
  readonly #grantOnRequest: boolean;

  constructor(options?: SyntheticHealthConnectOptions) {
    this.#records = options?.records ?? [];
    this.#granted = options?.permissionsGranted ?? false;
    this.#grantOnRequest = options?.grantOnRequest ?? true;
  }

  async hasPermissions(): Promise<boolean> {
    return this.#granted;
  }

  async requestPermissions(): Promise<boolean> {
    if (this.#grantOnRequest) {
      this.#granted = true;
      return true;
    }
    return false;
  }

  async readRecords(input: {
    readonly recordType: HCRecordType;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }): Promise<readonly HCRecord[]> {
    const matches = this.#records.filter((record) => {
      if (record.recordType !== input.recordType) {
        return false;
      }
      const start = record.startTime.getTime();
      return start >= input.startsAt.getTime() && start < input.endsAt.getTime();
    });
    const ordered = [...matches].sort((a, b) => {
      const delta = a.startTime.getTime() - b.startTime.getTime();
      if (delta !== 0) {
        return delta;
      }
      return a.recordId < b.recordId ? -1 : 1;
    });
    return ordered;
  }
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link HealthConnectAdapter} (all injectable). */
export interface HealthConnectAdapterDeps {
  readonly native: HealthConnectNativeModule;
  readonly registry: MeasurementSourceRegistry;
  readonly logger: Logger;
  readonly bindings?: readonly HCMetricBinding[];
  readonly nowMs?: () => number;
}

/** `HealthConnectAdapter` — the A32 DeviceSourceAdapter over Health Connect. */
export class HealthConnectAdapter implements DeviceSourceAdapter {
  readonly sourceId: SourceId;
  readonly #native: HealthConnectNativeModule;
  readonly #registry: MeasurementSourceRegistry;
  readonly #logger: Logger;
  readonly #bindings: readonly HCMetricBinding[];
  readonly #nowMs: () => number;

  constructor(sourceId: SourceId, deps: HealthConnectAdapterDeps) {
    this.sourceId = sourceId;
    this.#native = deps.native;
    this.#registry = deps.registry;
    this.#logger = deps.logger;
    this.#bindings = deps.bindings ?? HEALTH_CONNECT_METRIC_BINDINGS;
    this.#nowMs = deps.nowMs ?? Date.now;
  }

  get supportedMetrics(): readonly string[] {
    return this.#bindings.map((binding) => binding.metricId);
  }

  async authorizationStatus(metricId: string): Promise<AuthorizationStatus> {
    const binding = this.#bindingFor(metricId);
    if (binding === undefined) {
      return "not-determined";
    }
    const granted = await this.#native.hasPermissions([binding.permission]);
    return granted ? "authorized" : "denied";
  }

  async requestAuthorization(): Promise<boolean> {
    const permissions = this.#bindings.map((binding) => binding.permission);
    const granted = await this.#native.requestPermissions(permissions);
    this.#logger.info("Health Connect permission request completed", {
      event: "healthconnect.authorization.request",
      isAuthorized: granted,
    });
    return granted;
  }

  async fetchSamples(
    request: SampleFetchRequest,
  ): Promise<HealthResult<SampleFetchResult, SampleFetchError>> {
    const source = this.#registry.find(request.sourceId);
    if (source === undefined) {
      this.#logger.warn("Health Connect fetch denied: source not registered", {
        event: "healthconnect.fetch.denied",
      });
      return err({ kind: "source-not-registered" });
    }
    if (!source.active) {
      this.#logger.warn("Health Connect fetch denied: source inactive", {
        event: "healthconnect.fetch.denied",
      });
      return err({ kind: "source-inactive" });
    }
    const resolution = this.#registry.resolve({
      personId: request.personId,
      metricId: request.metricId,
    });
    if (!resolution.ok) {
      this.#logger.warn("Health Connect fetch denied by the source registry", {
        event: "healthconnect.fetch.denied",
        denyKind: resolution.error.kind,
      });
      return err({ kind: "capability-denied", reason: resolution.error });
    }
    const binding = this.#bindingFor(request.metricId);
    if (binding === undefined) {
      this.#logger.warn("Health Connect fetch denied: metric outside the native surface", {
        event: "healthconnect.fetch.denied",
      });
      return err({ kind: "metric-unsupported" });
    }
    const window: MeasurementWindow = request.window;
    if (
      !(window.startsAt instanceof Date) ||
      !(window.endsAt instanceof Date) ||
      Number.isNaN(window.startsAt.getTime()) ||
      Number.isNaN(window.endsAt.getTime()) ||
      window.startsAt.getTime() >= window.endsAt.getTime()
    ) {
      return err({ kind: "invalid-window" });
    }
    const granted = await this.#native.hasPermissions([binding.permission]);
    if (!granted) {
      // Packet rule: unauthorized -> typed EMPTY, never a throw.
      this.#logger.warn("Health Connect fetch returned no samples: permissions not granted", {
        event: "healthconnect.fetch.unauthorized",
        personId: request.personId,
        metricId: request.metricId,
        sourceId: request.sourceId,
      });
      return ok({ authorized: false, samples: [] });
    }
    let records: readonly HCRecord[];
    try {
      records = await this.#native.readRecords({
        recordType: binding.recordType,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      });
    } catch {
      this.#logger.error("Health Connect native read failed", {
        event: "healthconnect.fetch.native-error",
        personId: request.personId,
        metricId: request.metricId,
        sourceId: request.sourceId,
      });
      return err({ kind: "native-error" });
    }
    const samples: RawDeviceSample[] = [];
    for (const record of records) {
      samples.push(...this.#toRawSamples(record, binding));
    }
    this.#logger.info("Health Connect fetch completed", {
      event: "healthconnect.fetch.completed",
      personId: request.personId,
      metricId: request.metricId,
      sourceId: request.sourceId,
      sampleCount: samples.length,
    });
    return ok({ authorized: true, samples });
  }

  normalizeSamples(
    input: NormalizeSamplesInput,
  ): HealthResult<readonly ObservationDraft[], NormalizationError> {
    const result = normalizeSamplesForBinding(
      input,
      this.#registry,
      (metricId) => this.#bindingFor(metricId),
      this.#nowMs,
    );
    if (result.ok) {
      this.#logger.info("Health Connect normalization completed", {
        event: "healthconnect.normalize.completed",
        personId: input.personId,
        sourceId: input.sourceId,
        sampleCount: result.value.length,
      });
    } else {
      this.#logger.warn("Health Connect normalization rejected the sample batch", {
        event: "healthconnect.normalize.rejected",
        personId: input.personId,
        sourceId: input.sourceId,
        rejectKind: result.error.kind,
        sampleCount: input.samples.length,
      });
    }
    return result;
  }

  #bindingFor(metricId: string): HCMetricBinding | undefined {
    return this.#bindings.find((binding) => binding.metricId === metricId);
  }

  /**
   * Maps one Health Connect record to raw samples: a HeartRateRecord
   * contributes one raw sample per instantaneous bpm sample; StepsRecord
   * and SleepSessionRecord contribute their aggregate at the record start
   * time (interval aggregates — the record interval stays in the native
   * metadata).
   */
  #toRawSamples(record: HCRecord, binding: HCMetricBinding): readonly RawDeviceSample[] {
    const sourceMetadata: Record<string, string> = {
      "hc.recordId": record.recordId,
      "hc.recordType": record.recordType,
    };
    if (record.recordType === "HeartRateRecord") {
      return record.samples.map((sample) => ({
        metricId: binding.metricId,
        timestamp: sample.time,
        value: sample.beatsPerMinute,
        unit: binding.nativeUnit,
        nativeId: `${record.recordId}:${sample.time.toISOString()}`,
        sourceMetadata: { ...sourceMetadata, "hc.startTime": record.startTime.toISOString() },
      }));
    }
    if (record.recordType === "StepsRecord") {
      return [
        {
          metricId: binding.metricId,
          timestamp: record.startTime,
          value: record.count,
          unit: binding.nativeUnit,
          nativeId: record.recordId,
          sourceMetadata: {
            ...sourceMetadata,
            "hc.endTime": record.endTime.toISOString(),
          },
        },
      ];
    }
    return [
      {
        metricId: binding.metricId,
        timestamp: record.startTime,
        value: record.minutes,
        unit: binding.nativeUnit,
        nativeId: record.recordId,
        sourceMetadata: { ...sourceMetadata, "hc.endTime": record.endTime.toISOString() },
      },
    ];
  }
}
