/**
 * A31 — Attempt recorder: records `MeasurementAttempt`s against
 * `MeasurementTask`s, applying the completion-quality-state model and the
 * method fallback chain.
 *
 * Completion quality states (the packet's domain vocabulary, mirrored
 * exactly): `complete | partial | low-quality`. Classification consumes
 * the frozen domain quality vocabulary: the attempt's domain
 * `QualityScore` in [0, 1] is evaluated against the method's domain
 * `QualityRange` (typical quality) by an injectable
 * `QualityClassificationPolicy`:
 *   - default `TypicalRangeQualityPolicy`: `complete` when the score is
 *     at or above the method's typical MINIMUM (the method delivered what
 *     it typically delivers); `partial` when below the minimum but at or
 *     above `partialFloorFraction * min` (default fraction 0.5 —
 *     recorded assumption: captured something usable, below typical);
 *     otherwise `low-quality`.
 *
 * Task completion rule (packet): a task completes when an
 * ACCEPTABLE-quality attempt lands; acceptable means exactly
 * `complete`. `partial` and `low-quality` attempts are recorded (data is
 * never discarded) but leave the task OPEN for retry/fallback.
 *
 * Fallback (packet): when the preferred method (first of the task's
 * compiled method order) is unavailable — a CapabilityIndex miss — the
 * NEXT LEGAL method serves the SAME task, and the attempt records the
 * method ACTUALLY used (`methodId`) plus the preferred method that
 * missed (`preferredMethodId`), so the fallback path stays auditable.
 *
 * AI boundary future-proofing (architecture §8): attempts carry an
 * optional `evidenceId` (source-evidence link) and the domain quality
 * score is the confidence seam — AI extraction attempts can later land
 * with source evidence + confidence + model provenance without schema
 * changes (model provenance rides the provenance record).
 *
 * All expected rejections are typed results; the domain guards
 * (`assertObservationConformsToMetric`, `assertObservationUsesMethod`)
 * are invoked and their `DomainInvariantError`s converted at this
 * boundary. Store ports are async (db adapter handoff recorded).
 */
import type {
  EvidenceId,
  MeasurementMethod,
  Observation,
  ObservationId,
  PersonId,
  ProvenanceId,
  QualityScore,
  TaskId,
} from "@orbb/domain";
import { DomainInvariantError, assertObservationConformsToMetric, assertObservationUsesMethod, isIdOf, isQualityScore } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { err, ok, type EngineResult } from "./result.js";
import type { CapabilityDenyReason, CapabilityIndex } from "./capabilities.js";
import type { MetricCatalog } from "./catalog.js";
import type { MeasurementMethodRegistry } from "./methods.js";
import type { MeasurementTask, MeasurementTaskStore } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Lane-local attempt identifier (contracts-style branded id, databox
// precedent: domain has no canonical AttemptId kind; handoff recorded).
// ---------------------------------------------------------------------------

declare const attemptIdBrand: unique symbol;

/** Branded canonical measurement-attempt id: `mta_<body>`. */
export type AttemptId = string & { readonly [attemptIdBrand]: "AttemptId" };

/** Prefix of every measurement-attempt id. */
export const ATTEMPT_ID_PREFIX = "mta";

const ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a canonical measurement-attempt id? */
export function isAttemptId(value: unknown): value is AttemptId {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${ATTEMPT_ID_PREFIX}_`)) {
    return false;
  }
  return ID_BODY_PATTERN.test(value.slice(ATTEMPT_ID_PREFIX.length + 1));
}

// ---------------------------------------------------------------------------
// Completion quality states (domain vocabulary mirrored exactly).
// ---------------------------------------------------------------------------

export const COMPLETION_QUALITY_STATES = ["complete", "partial", "low-quality"] as const;

export type CompletionQuality = (typeof COMPLETION_QUALITY_STATES)[number];

export function isCompletionQuality(value: unknown): value is CompletionQuality {
  return (
    typeof value === "string" &&
    (COMPLETION_QUALITY_STATES as readonly string[]).includes(value)
  );
}

/**
 * Classifies an attempt's quality against the method that produced it.
 * Pure and deterministic.
 */
export interface QualityClassificationPolicy {
  classify(quality: QualityScore, method: MeasurementMethod): CompletionQuality;
}

/** Options for the default {@link TypicalRangeQualityPolicy}. */
export interface TypicalRangeQualityPolicyOptions {
  /**
   * Fraction of the method's typical minimum at which a below-typical
   * attempt still counts as `partial` (below that fraction it is
   * `low-quality`). Default 0.5. Recorded assumption.
   */
  readonly partialFloorFraction?: number;
}

/**
 * Default policy: `complete` at/above the method's typical minimum;
 * `partial` at/above `partialFloorFraction * min`; `low-quality` below.
 */
export class TypicalRangeQualityPolicy implements QualityClassificationPolicy {
  readonly #partialFloorFraction: number;

  constructor(options?: TypicalRangeQualityPolicyOptions) {
    const fraction = options?.partialFloorFraction ?? 0.5;
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new RangeError(
        "TypicalRangeQualityPolicy partialFloorFraction must be a finite fraction in [0, 1].",
      );
    }
    this.#partialFloorFraction = fraction;
  }

  classify(quality: QualityScore, method: MeasurementMethod): CompletionQuality {
    const min = method.typicalQuality.min;
    if (quality >= min) {
      return "complete";
    }
    if (quality >= this.#partialFloorFraction * min) {
      return "partial";
    }
    return "low-quality";
  }
}

// ---------------------------------------------------------------------------
// MeasurementAttempt record.
// ---------------------------------------------------------------------------

/** One recorded attempt to fulfill a measurement task. */
export interface MeasurementAttempt {
  readonly id: AttemptId;
  readonly taskId: TaskId;
  readonly personId: PersonId;
  readonly metricId: string;
  /** The observation this attempt produced/linked. */
  readonly observationId: ObservationId;
  /** The method ACTUALLY used (the fallback method when the preferred one missed). */
  readonly methodId: string;
  /** The preferred method that was unavailable — present exactly on fallback attempts. */
  readonly preferredMethodId?: string;
  /** Domain quality score of the observation (confidence seam for §8 AI extraction). */
  readonly quality: QualityScore;
  readonly completionState: CompletionQuality;
  readonly recordedAt: Date;
  /** Optional source-evidence link (§8 AI extraction retains source evidence). */
  readonly evidenceId?: EvidenceId;
  /** Provenance of the attempt act itself. */
  readonly provenanceId: ProvenanceId;
}

/** Persistence port for attempts (append-only; async — db adapter handoff recorded). */
export interface MeasurementAttemptStore {
  append(attempt: MeasurementAttempt): Promise<void>;
  findByTask(taskId: TaskId): Promise<readonly MeasurementAttempt[]>;
  findById(attemptId: AttemptId): Promise<MeasurementAttempt | undefined>;
}

/** In-memory reference `MeasurementAttemptStore` (defensive copies in and out). */
export class InMemoryMeasurementAttemptStore implements MeasurementAttemptStore {
  readonly #attempts = new Map<string, MeasurementAttempt>();

  async append(attempt: MeasurementAttempt): Promise<void> {
    this.#attempts.set(attempt.id, cloneAttempt(attempt));
  }

  async findByTask(taskId: TaskId): Promise<readonly MeasurementAttempt[]> {
    const owned: MeasurementAttempt[] = [];
    for (const attempt of this.#attempts.values()) {
      if (attempt.taskId === taskId) {
        owned.push(cloneAttempt(attempt));
      }
    }
    return owned;
  }

  async findById(attemptId: AttemptId): Promise<MeasurementAttempt | undefined> {
    const attempt = this.#attempts.get(attemptId);
    return attempt === undefined ? undefined : cloneAttempt(attempt);
  }
}

// ---------------------------------------------------------------------------
// Recorder service.
// ---------------------------------------------------------------------------

/** Record-attempt input. */
export interface RecordAttemptInput {
  readonly taskId: TaskId;
  /** The observation produced by the capture path for this attempt. */
  readonly observation: Observation;
  /**
   * Quality override; defaults to `observation.quality` when present.
   * Rejected when neither is present (`missing-quality`).
   */
  readonly quality?: QualityScore;
  /**
   * Method actually used. Omitted => auto-resolve: the task's preferred
   * method if usable, else the next legal method (fallback).
   */
  readonly methodId?: string;
  /** Optional source-evidence link (§8). */
  readonly evidenceId?: EvidenceId;
  /** Provenance id for the attempt act (required — every capture is provenance-carrying). */
  readonly provenanceId: ProvenanceId;
}

/** Successful record outcome. */
export interface RecordAttemptOutcome {
  readonly attempt: MeasurementAttempt;
  /** Task state AFTER recording (completed iff acceptable quality landed). */
  readonly task: MeasurementTask;
  readonly taskCompleted: boolean;
  /** The method actually used. */
  readonly methodUsed: MeasurementMethod;
  /** Preferred method id that was unavailable — present exactly on fallback. */
  readonly fellBackFrom?: string;
}

/** Typed record rejections (PHID-safe, values never echoed). */
export type RecordAttemptError =
  | { readonly kind: "task-not-found" }
  | { readonly kind: "task-not-open" }
  | { readonly kind: "unknown-metric" }
  | { readonly kind: "observation-person-mismatch" }
  | { readonly kind: "observation-nonconforming" }
  | { readonly kind: "observation-method-mismatch" }
  | { readonly kind: "unknown-method" }
  | { readonly kind: "method-not-usable" }
  | { readonly kind: "no-capable-method"; readonly reason: CapabilityDenyReason }
  | { readonly kind: "missing-quality" }
  | { readonly kind: "invalid-quality" }
  | { readonly kind: "invalid-input" };

/** Constructor deps (all injectable). */
export interface AttemptRecorderDeps {
  readonly catalog: MetricCatalog;
  readonly methods: MeasurementMethodRegistry;
  readonly capabilities: CapabilityIndex;
  readonly tasks: MeasurementTaskStore;
  readonly attempts: MeasurementAttemptStore;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Defaults to `TypicalRangeQualityPolicy` (partialFloorFraction 0.5). */
  readonly policy?: QualityClassificationPolicy;
}

/** Records measurement attempts and applies task completion/fallback/quality rules. */
export class AttemptRecorder {
  readonly #catalog: MetricCatalog;
  readonly #methods: MeasurementMethodRegistry;
  readonly #capabilities: CapabilityIndex;
  readonly #tasks: MeasurementTaskStore;
  readonly #attempts: MeasurementAttemptStore;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #policy: QualityClassificationPolicy;

  constructor(deps: AttemptRecorderDeps) {
    this.#catalog = deps.catalog;
    this.#methods = deps.methods;
    this.#capabilities = deps.capabilities;
    this.#tasks = deps.tasks;
    this.#attempts = deps.attempts;
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#policy = deps.policy ?? new TypicalRangeQualityPolicy();
  }

  async record(
    input: RecordAttemptInput,
  ): Promise<EngineResult<RecordAttemptOutcome, RecordAttemptError>> {
    const task = await this.#tasks.findById(input.taskId);
    if (task === undefined) {
      return err({ kind: "task-not-found" });
    }
    if (task.state !== "open") {
      return err({ kind: "task-not-open" });
    }
    if (!isIdOf("provenance", input.provenanceId)) {
      return err({ kind: "invalid-input" });
    }
    if (input.methodId !== undefined && typeof input.methodId !== "string") {
      return err({ kind: "invalid-input" });
    }
    if (input.evidenceId !== undefined && !isIdOf("evidence", input.evidenceId)) {
      return err({ kind: "invalid-input" });
    }

    const metric = this.#catalog.resolveActive(task.metricId);
    if (metric === undefined) {
      return err({ kind: "unknown-metric" });
    }
    if (input.observation.personId !== task.personId) {
      return err({ kind: "observation-person-mismatch" });
    }
    try {
      assertObservationConformsToMetric(input.observation, metric);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "observation-nonconforming" });
      }
      throw error;
    }

    const quality = input.quality ?? input.observation.quality;
    if (quality === undefined) {
      return err({ kind: "missing-quality" });
    }
    if (!isQualityScore(quality)) {
      return err({ kind: "invalid-quality" });
    }

    // Method resolution: explicit, or auto with the fallback chain.
    const resolution = this.#resolveMethod(input.methodId, task);
    if (!resolution.ok) {
      return err(resolution.error);
    }
    const { method, fellBackFrom } = resolution.value;

    try {
      assertObservationUsesMethod(input.observation, method);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "observation-method-mismatch" });
      }
      throw error;
    }

    const completionState = this.#policy.classify(quality, method);
    const attemptId = this.#ids.next(ATTEMPT_ID_PREFIX) as AttemptId;
    const attempt: MeasurementAttempt = {
      id: attemptId,
      taskId: task.id,
      personId: task.personId,
      metricId: task.metricId,
      observationId: input.observation.id,
      methodId: method.id,
      ...(fellBackFrom !== undefined ? { preferredMethodId: fellBackFrom } : {}),
      quality,
      completionState,
      recordedAt: this.#clock.now(),
      ...(input.evidenceId !== undefined ? { evidenceId: input.evidenceId } : {}),
      provenanceId: input.provenanceId,
    };
    await this.#attempts.append(attempt);

    const acceptable = completionState === "complete";
    const taskAfter: MeasurementTask = acceptable
      ? await this.#tasks.upsert({ ...task, state: "completed" })
      : task;
    return ok({
      attempt,
      task: taskAfter,
      taskCompleted: acceptable,
      methodUsed: method,
      ...(fellBackFrom !== undefined ? { fellBackFrom } : {}),
    });
  }

  /**
   * Resolves the method actually used. Explicit method: must be registered
   * AND usable by the person (deny-by-default). Auto: the task's preferred
   * method if usable; on a CapabilityIndex miss for the preferred method,
   * the next legal method (task method order, then capability order)
   * serves the same task and the miss is reported for audit.
   */
  #resolveMethod(
    explicitMethodId: string | undefined,
    task: MeasurementTask,
  ): EngineResult<{ method: MeasurementMethod; fellBackFrom?: string }, RecordAttemptError> {
    const resolution = this.#capabilities.resolve({
      personId: task.personId,
      metricId: task.metricId,
    });
    if (!resolution.ok) {
      // Deny-by-default: no usable methods at all — report WHY.
      return err({ kind: "no-capable-method", reason: resolution.error });
    }
    const usable = resolution.value;

    if (explicitMethodId !== undefined) {
      const method = this.#methods.find(explicitMethodId);
      if (method === undefined) {
        return err({ kind: "unknown-method" });
      }
      const usableIds = new Set(usable.map((capability) => capability.method.id));
      if (!usableIds.has(explicitMethodId)) {
        return err({ kind: "method-not-usable" });
      }
      return ok({ method });
    }

    const preferred = task.methodOrder[0];
    if (preferred !== undefined) {
      const preferredCapability = usable.find(
        (capability) => capability.method.id === preferred,
      );
      if (preferredCapability !== undefined) {
        return ok({ method: preferredCapability.method });
      }
      // Preferred method missed (CapabilityIndex miss) — walk the task's
      // method order, then the remaining capability order.
      for (const methodId of task.methodOrder) {
        const candidate = usable.find((capability) => capability.method.id === methodId);
        if (candidate !== undefined) {
          return ok({ method: candidate.method, fellBackFrom: preferred });
        }
      }
      const first = usable[0];
      if (first !== undefined) {
        return ok({ method: first.method, fellBackFrom: preferred });
      }
      return err({
        kind: "no-capable-method",
        reason: { kind: "no-capable-source" },
      });
    }

    // No compiled method order: capability order is the preference.
    const first = usable[0];
    if (first === undefined) {
      return err({
        kind: "no-capable-method",
        reason: { kind: "no-capable-source" },
      });
    }
    return ok({ method: first.method });
  }
}

function cloneAttempt(attempt: MeasurementAttempt): MeasurementAttempt {
  return {
    ...attempt,
    recordedAt: new Date(attempt.recordedAt.getTime()),
  };
}
