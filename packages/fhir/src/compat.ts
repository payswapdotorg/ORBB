/**
 * Compile-time compatibility locks — the local structural input types are
 * asserted assignable FROM the real frozen domain/measurement types.
 *
 * This module imports TYPES ONLY from @orbb/domain and @orbb/measurement
 * (erased at compile time — the built package has zero workspace runtime
 * dependencies) and instantiates `Assignable` aliases that FAIL TO BUILD
 * if the kernel shapes ever drift from the local mirrors. The aliases are
 * exported so lint recognizes them as intentional public proof constants;
 * they are type-only and NOT re-exported from index.ts, so the runtime
 * API surface is unchanged.
 */
import type {
  AccessGrant,
  HealthIntent,
  Observation,
  Provenance,
} from "@orbb/domain";
import type { MeasurementAttempt, MeasurementTask } from "@orbb/measurement";
import type {
  ConsentGrantInput,
  HealthIntentInput,
  MeasurementAttemptInput,
  MeasurementTaskInput,
  ObservationInput,
  ProvenanceRecordInput,
} from "./inputs.js";

/** Compiles iff `Source` is assignable to `Target` (drift lock). */
export type Assignable<Source extends Target, Target> = Source extends Target ? true : false;

export type DomainObservationMaps = Assignable<Observation, ObservationInput>;
export type DomainHealthIntentMaps = Assignable<HealthIntent, HealthIntentInput>;
export type DomainAccessGrantMaps = Assignable<AccessGrant, ConsentGrantInput>;
export type DomainProvenanceMaps = Assignable<Provenance, ProvenanceRecordInput>;
export type MeasurementTaskMaps = Assignable<MeasurementTask, MeasurementTaskInput>;
export type MeasurementAttemptMaps = Assignable<MeasurementAttempt, MeasurementAttemptInput>;
