/**
 * A34 — HealthKit seam (Lane C packet M4-C).
 *
 * `HealthKitAdapter` implements the A32 `DeviceSourceAdapter` contract
 * over a `HealthKitNativeModule` interface: authorization status, sample
 * fetch by type + range, and anchored object metadata (the HK UUID is the
 * anchor). The HKQuantity/HKCategory sample shapes are MIRRORED in
 * TypeScript; the adapter normalizes fetched samples into domain-shaped
 * observation drafts using the source-declared unit conversions.
 *
 * Mobile reality (packet): HealthKit needs iOS native modules. THIS packet
 * ships the TypeScript seam — the `HealthKitNativeModule` interface is the
 * contract for the real native binding (deployment/mobile-integration
 * milestone, handoff recorded) — plus a SYNTHETIC native double that
 * returns deterministic samples (heart rate in "count/min", step count in
 * "count", sleep as asleep-category intervals whose durations the adapter
 * derives in seconds).
 *
 * Authorization gate (packet rule): a fetch for which the native module
 * reports anything other than `sharingAuthorized` resolves to a TYPED
 * EMPTY result — never a throw, never partial data. Fetching never
 * auto-requests authorization; the UX flow calls
 * {@link HealthKitAdapter.requestAuthorization} explicitly.
 *
 * Sleep modeling (HealthKit reality): sleep analysis arrives as
 * HKCategorySample intervals. Only ASLEEP category values contribute
 * sleep minutes; non-asleep intervals (e.g. InBed) are excluded from the
 * metric's sample set and REPORTED in the fetch log (excludedCount) so the
 * exclusion is auditable — never silently dropped.
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
// HealthKit native surface, mirrored in TypeScript.
// ---------------------------------------------------------------------------

/** HKQuantityTypeIdentifiers this seam covers (typed subset). */
export const HK_QUANTITY_TYPE_IDS = [
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierStepCount",
] as const;

/** HKCategoryTypeIdentifiers this seam covers (typed subset). */
export const HK_CATEGORY_TYPE_IDS = ["HKCategoryTypeIdentifierSleepAnalysis"] as const;

/** Every HK sample type identifier this seam covers. */
export const HK_SAMPLE_TYPE_IDS = [...HK_QUANTITY_TYPE_IDS, ...HK_CATEGORY_TYPE_IDS] as const;

export type HKSampleTypeIdentifier = (typeof HK_SAMPLE_TYPE_IDS)[number];

/**
 * HealthKit authorization statuses (HKAuthorizationStatus mirrored):
 * `notDetermined` (never asked), `sharingDenied` (person said no),
 * `sharingAuthorized` (person granted).
 */
export type HKAuthorizationStatus = "notDetermined" | "sharingDenied" | "sharingAuthorized";

/** HKSourceRevision mirrored (anchored source metadata for samples). */
export interface HKSourceRevision {
  readonly sourceName: string;
  readonly sourceBundleId: string;
  readonly operatingSystemVersion?: string;
}

/** HKQuantitySample mirrored: a quantity value with a native HKUnit string. */
export interface HKQuantitySample {
  readonly uuid: string;
  readonly sampleType: (typeof HK_QUANTITY_TYPE_IDS)[number];
  readonly quantityValue: number;
  /** Native HKUnit string (e.g. "count/min" for heart rate, "count" for steps). */
  readonly unit: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sourceRevision?: HKSourceRevision;
}

/**
 * HKCategorySample mirrored: sleep-analysis style intervals. The value is
 * the category value string (e.g.
 * "HKCategoryValueSleepAnalysisAsleep"); the "quantity" of sleep is the
 * INTERVAL (endDate - startDate).
 */
export interface HKCategorySample {
  readonly uuid: string;
  readonly sampleType: (typeof HK_CATEGORY_TYPE_IDS)[number];
  readonly categoryValue: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sourceRevision?: HKSourceRevision;
}

/** Any HK sample this seam understands. */
export type HKSample = HKQuantitySample | HKCategorySample;

/**
 * The native module contract for the REAL HealthKit binding (handoff to
 * the deployment/mobile-integration milestone): authorization status per
 * sample type, an explicit authorization request, and an anchored sample
 * fetch by type + range (half-open [startsAt, endsAt) on startDate).
 */
export interface HealthKitNativeModule {
  authorizationStatusFor(sampleType: HKSampleTypeIdentifier): Promise<HKAuthorizationStatus>;
  requestAuthorization(sampleTypes: readonly HKSampleTypeIdentifier[]): Promise<boolean>;
  fetchSamples(input: {
    readonly sampleType: HKSampleTypeIdentifier;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }): Promise<readonly HKSample[]>;
}

// ---------------------------------------------------------------------------
// Metric bindings: the adapter's typed native metric surface.
// ---------------------------------------------------------------------------

/**
 * One bound metric: which HK sample type serves it, the method it maps to
 * (the app-import method vocabulary is engine-owned — these ids align
 * with the Lane A seed), the native unit the adapter reports raw samples
 * in, and the domain evidence label + quality the drafts carry until the
 * engine's quality policy takes over (recorded assumption: adapters stamp
 * the app-import method's typical quality midpoint).
 */
export interface HKMetricBinding {
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodId: string;
  readonly sampleType: HKSampleTypeIdentifier;
  /** Native unit the adapter reports raw samples in ("s" for derived sleep durations). */
  readonly nativeUnit: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
}

/**
 * The seeded HealthKit metric surface (ids/units align with the Lane A
 * engine seed; concept codes are SYNTH-marked per the test-data rules):
 *   - heart rate — HKQuantityTypeIdentifierHeartRate — native "count/min"
 *   - step count — HKQuantityTypeIdentifierStepCount — native "count"
 *   - sleep minutes — HKCategoryTypeIdentifierSleepAnalysis — native "s"
 *     (the adapter derives asleep-interval durations in seconds; the
 *     source-declared conversion "s" -> "min" × 1/60 normalizes them).
 */
export const HEALTHKIT_METRIC_BINDINGS: readonly HKMetricBinding[] = [
  {
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    methodId: "SYNTH-method-hr-app",
    sampleType: "HKQuantityTypeIdentifierHeartRate",
    nativeUnit: "count/min",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.9),
  },
  {
    metricId: "SYNTH-metric-step-count",
    conceptCode: "SYNTH-41950-7",
    methodId: "SYNTH-method-steps-app",
    sampleType: "HKQuantityTypeIdentifierStepCount",
    nativeUnit: "count",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.85),
  },
  {
    metricId: "SYNTH-metric-sleep-minutes",
    conceptCode: "SYNTH-94641-0",
    methodId: "SYNTH-method-sleep-app",
    sampleType: "HKCategoryTypeIdentifierSleepAnalysis",
    nativeUnit: "s",
    evidenceLabel: "IMPORTED",
    quality: parseQualityScore(0.82),
  },
];

/** Category values that count as sleep minutes (InBed is not sleep). */
export const HK_SLEEP_ASLEEP_CATEGORY_VALUES = [
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepLight",
  "HKCategoryValueSleepAnalysisAsleepRem",
] as const;

// ---------------------------------------------------------------------------
// Synthetic native double (deterministic; SYNTH- marked ids only).
// ---------------------------------------------------------------------------

/** Options for the synthetic native double. */
export interface SyntheticHealthKitOptions {
  /** Deterministic sample script (SYNTH- ids only). Default: empty. */
  readonly samples?: readonly HKSample[];
  /** Initial authorization status for every sample type. Default: "notDetermined". */
  readonly authorizationStatus?: HKAuthorizationStatus;
  /** Does requestAuthorization model a grant? Default: true. */
  readonly grantOnRequest?: boolean;
}

/**
 * Synthetic `HealthKitNativeModule` double for tests: serves the exact
 * seeded samples whose startDate falls in the requested half-open window,
 * ordered by startDate then uuid. Deterministic; never throws.
 */
export class SyntheticHealthKitNativeModule implements HealthKitNativeModule {
  readonly #samples: readonly HKSample[];
  #status: HKAuthorizationStatus;
  readonly #grantOnRequest: boolean;

  constructor(options?: SyntheticHealthKitOptions) {
    this.#samples = options?.samples ?? [];
    this.#status = options?.authorizationStatus ?? "notDetermined";
    this.#grantOnRequest = options?.grantOnRequest ?? true;
  }

  async authorizationStatusFor(): Promise<HKAuthorizationStatus> {
    return this.#status;
  }

  async requestAuthorization(): Promise<boolean> {
    if (this.#grantOnRequest) {
      this.#status = "sharingAuthorized";
      return true;
    }
    this.#status = "sharingDenied";
    return false;
  }

  async fetchSamples(input: {
    readonly sampleType: HKSampleTypeIdentifier;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }): Promise<readonly HKSample[]> {
    const matches = this.#samples.filter((sample) => {
      if (sample.sampleType !== input.sampleType) {
        return false;
      }
      const start = sample.startDate.getTime();
      return start >= input.startsAt.getTime() && start < input.endsAt.getTime();
    });
    const ordered = [...matches].sort((a, b) => {
      const delta = a.startDate.getTime() - b.startDate.getTime();
      if (delta !== 0) {
        return delta;
      }
      return a.uuid < b.uuid ? -1 : 1;
    });
    return ordered;
  }
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link HealthKitAdapter} (all injectable). */
export interface HealthKitAdapterDeps {
  readonly native: HealthKitNativeModule;
  readonly registry: MeasurementSourceRegistry;
  readonly logger: Logger;
  readonly bindings?: readonly HKMetricBinding[];
  readonly nowMs?: () => number;
}

/** `HealthKitAdapter` — the A32 DeviceSourceAdapter over HealthKit. */
export class HealthKitAdapter implements DeviceSourceAdapter {
  readonly sourceId: SourceId;
  readonly #native: HealthKitNativeModule;
  readonly #registry: MeasurementSourceRegistry;
  readonly #logger: Logger;
  readonly #bindings: readonly HKMetricBinding[];
  readonly #nowMs: () => number;

  constructor(sourceId: SourceId, deps: HealthKitAdapterDeps) {
    this.sourceId = sourceId;
    this.#native = deps.native;
    this.#registry = deps.registry;
    this.#logger = deps.logger;
    this.#bindings = deps.bindings ?? HEALTHKIT_METRIC_BINDINGS;
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
    const status = await this.#native.authorizationStatusFor(binding.sampleType);
    switch (status) {
      case "sharingAuthorized":
        return "authorized";
      case "sharingDenied":
        return "denied";
      case "notDetermined":
        return "not-determined";
    }
  }

  async requestAuthorization(): Promise<boolean> {
    const sampleTypes = this.#bindings.map((binding) => binding.sampleType);
    const granted = await this.#native.requestAuthorization(sampleTypes);
    this.#logger.info("HealthKit authorization request completed", {
      event: "healthkit.authorization.request",
      isAuthorized: granted,
    });
    return granted;
  }

  async fetchSamples(
    request: SampleFetchRequest,
  ): Promise<HealthResult<SampleFetchResult, SampleFetchError>> {
    const source = this.#registry.find(request.sourceId);
    if (source === undefined) {
      this.#logger.warn("HealthKit fetch denied: source not registered", {
        event: "healthkit.fetch.denied",
      });
      return err({ kind: "source-not-registered" });
    }
    if (!source.active) {
      this.#logger.warn("HealthKit fetch denied: source inactive", {
        event: "healthkit.fetch.denied",
      });
      return err({ kind: "source-inactive" });
    }
    const resolution = this.#registry.resolve({
      personId: request.personId,
      metricId: request.metricId,
    });
    if (!resolution.ok) {
      this.#logger.warn("HealthKit fetch denied by the source registry", {
        event: "healthkit.fetch.denied",
        denyKind: resolution.error.kind,
      });
      return err({ kind: "capability-denied", reason: resolution.error });
    }
    const binding = this.#bindingFor(request.metricId);
    if (binding === undefined) {
      this.#logger.warn("HealthKit fetch denied: metric outside the native surface", {
        event: "healthkit.fetch.denied",
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
    const status = await this.#native.authorizationStatusFor(binding.sampleType);
    if (status !== "sharingAuthorized") {
      // Packet rule: unauthorized -> typed EMPTY, never a throw.
      this.#logger.warn("HealthKit fetch returned no samples: not authorized", {
        event: "healthkit.fetch.unauthorized",
        personId: request.personId,
        metricId: request.metricId,
        sourceId: request.sourceId,
      });
      return ok({ authorized: false, samples: [] });
    }
    let native: readonly HKSample[];
    try {
      native = await this.#native.fetchSamples({
        sampleType: binding.sampleType,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      });
    } catch {
      this.#logger.error("HealthKit native fetch failed", {
        event: "healthkit.fetch.native-error",
        personId: request.personId,
        metricId: request.metricId,
        sourceId: request.sourceId,
      });
      return err({ kind: "native-error" });
    }
    const samples: RawDeviceSample[] = [];
    let excludedCount = 0;
    for (const sample of native) {
      const mapped = this.#toRawSample(sample, binding);
      if (mapped === undefined) {
        excludedCount += 1;
        continue;
      }
      samples.push(mapped);
    }
    this.#logger.info("HealthKit fetch completed", {
      event: "healthkit.fetch.completed",
      personId: request.personId,
      metricId: request.metricId,
      sourceId: request.sourceId,
      sampleCount: samples.length,
      excludedCount,
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
      this.#logger.info("HealthKit normalization completed", {
        event: "healthkit.normalize.completed",
        personId: input.personId,
        sourceId: input.sourceId,
        sampleCount: result.value.length,
      });
    } else {
      this.#logger.warn("HealthKit normalization rejected the sample batch", {
        event: "healthkit.normalize.rejected",
        personId: input.personId,
        sourceId: input.sourceId,
        rejectKind: result.error.kind,
        sampleCount: input.samples.length,
      });
    }
    return result;
  }

  #bindingFor(metricId: string): HKMetricBinding | undefined {
    return this.#bindings.find((binding) => binding.metricId === metricId);
  }

  /**
   * Maps one HK sample to a raw device sample for the bound metric.
   * Non-asleep sleep-analysis intervals return `undefined` — they are not
   * sleep-minute samples (HealthKit models them as separate category
   * intervals); their exclusion is counted and logged by the caller.
   */
  #toRawSample(sample: HKSample, binding: HKMetricBinding): RawDeviceSample | undefined {
    const sourceMetadata: Record<string, string> = {};
    if (sample.sourceRevision !== undefined) {
      sourceMetadata["hk.sourceName"] = sample.sourceRevision.sourceName;
      sourceMetadata["hk.sourceBundleId"] = sample.sourceRevision.sourceBundleId;
      if (sample.sourceRevision.operatingSystemVersion !== undefined) {
        sourceMetadata["hk.operatingSystemVersion"] = sample.sourceRevision.operatingSystemVersion;
      }
    }
    if (isHKCategorySample(sample)) {
      if (!isSleepAsleepCategoryValue(sample.categoryValue)) {
        return undefined;
      }
      const seconds = (sample.endDate.getTime() - sample.startDate.getTime()) / 1_000;
      return {
        metricId: binding.metricId,
        timestamp: sample.startDate,
        value: seconds,
        unit: binding.nativeUnit,
        nativeId: sample.uuid,
        sourceMetadata: { ...sourceMetadata, "hk.categoryValue": sample.categoryValue },
      };
    }
    return {
      metricId: binding.metricId,
      timestamp: sample.startDate,
      value: sample.quantityValue,
      unit: sample.unit,
      nativeId: sample.uuid,
      sourceMetadata,
    };
  }
}

function isHKCategorySample(sample: HKSample): sample is HKCategorySample {
  return sample.sampleType === "HKCategoryTypeIdentifierSleepAnalysis";
}

function isSleepAsleepCategoryValue(value: string): boolean {
  return (HK_SLEEP_ASLEEP_CATEGORY_VALUES as readonly string[]).includes(value);
}
