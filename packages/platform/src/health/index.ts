/**
 * Device-source health seam barrel (A32 + A34 + A35 + the M4 exit
 * harness scaffolding, Lane C packet M4-C).
 *
 *   - A32 `MeasurementSourceRegistry` + `DeviceSourceAdapter` +
 *     observation drafts with provenance (`sources.ts`, `units.ts`).
 *   - A34 `HealthKitAdapter` over the `HealthKitNativeModule` seam
 *     (`healthkit.ts`).
 *   - A35 `HealthConnectAdapter` over the `HealthConnectNativeModule`
 *     seam (`healthconnect.ts`).
 *   - Manual capture-session contract + synthetic double (`capture.ts`).
 *   - Reconciliation double matching the Lane A `ReconciliationService`
 *     contract (`reconciliation.ts`).
 *
 * The measurement ENGINE (Lane A) implements/consumes these seams;
 * real native bindings implement the NativeModule interfaces
 * (deployment/mobile-integration milestone). All handoffs are recorded
 * in the packet report.
 */
export { ok, err, type HealthResult } from "./result.js";

export {
  applyUnitConversion,
  conversionTableFor,
  InMemoryUnitConversionTable,
  validateUnitConversionSpec,
  type AppliedUnitConversion,
  type NormalizedQuantity,
  type UnitConversionSpec,
  type UnitConversionSpecError,
  type UnitConversionTable,
  type UnitConversionTableError,
} from "./units.js";

export {
  applyDraftValidation,
  AUTHORIZATION_STATUSES,
  InMemoryMeasurementSourceRegistry,
  isMeasurementSourceKind,
  isSourceDirection,
  materializeDraft,
  MEASUREMENT_SOURCE_KINDS,
  normalizeSamplesForBinding,
  SOURCE_DIRECTIONS,
  StructuralDraftValidator,
  type AuthorizationStatus,
  type DeviceSourceAdapter,
  type DraftIdSource,
  type DraftProvenance,
  type DraftRejectionReason,
  type DraftValidationOutcome,
  type DraftValidationVerdict,
  type MaterializeDraftDeps,
  type MaterializedObservation,
  type MeasurementSourceKind,
  type MeasurementSourceRegistry,
  type MeasurementWindow,
  type NormalizationError,
  type NormalizeSamplesInput,
  type ObservationDraft,
  type ObservationDraftValidator,
  type RawDeviceSample,
  type RegisteredMeasurementSource,
  type ResolvedSourceCapability,
  type SampleFetchError,
  type SampleFetchRequest,
  type SampleFetchResult,
  type SourceCapability,
  type SourceDirection,
  type SourceRegistrationError,
  type SourceResolutionDenyReason,
  type UnitConversionProvenance,
} from "./sources.js";

export {
  HEALTHKIT_METRIC_BINDINGS,
  HealthKitAdapter,
  HK_CATEGORY_TYPE_IDS,
  HK_QUANTITY_TYPE_IDS,
  HK_SAMPLE_TYPE_IDS,
  HK_SLEEP_ASLEEP_CATEGORY_VALUES,
  SyntheticHealthKitNativeModule,
  type HealthKitAdapterDeps,
  type HealthKitNativeModule,
  type HKAuthorizationStatus,
  type HKCategorySample,
  type HKMetricBinding,
  type HKQuantitySample,
  type HKSample,
  type HKSampleTypeIdentifier,
  type HKSourceRevision,
  type SyntheticHealthKitOptions,
} from "./healthkit.js";

export {
  HEALTH_CONNECT_METRIC_BINDINGS,
  HEALTH_CONNECT_PERMISSIONS,
  HealthConnectAdapter,
  HC_RECORD_TYPES,
  SyntheticHealthConnectNativeModule,
  type HealthConnectAdapterDeps,
  type HealthConnectNativeModule,
  type HealthConnectPermission,
  type HCMetricBinding,
  type HCHeartRateRecord,
  type HCHeartRateSample,
  type HCRecord,
  type HCRecordType,
  type HCSleepSessionRecord,
  type HCStepsRecord,
  type SyntheticHealthConnectOptions,
} from "./healthconnect.js";

export {
  MANUAL_CAPTURE_METRIC_SUPPORT,
  SyntheticManualCaptureSession,
  type ManualCaptureError,
  type ManualCaptureField,
  type ManualCaptureInput,
  type ManualCaptureMetricSupport,
  type ManualCaptureSession,
  type SyntheticManualCaptureSessionOptions,
} from "./capture.js";

export {
  InMemoryObservationArchive,
  RECONCILIATION_VERDICTS,
  ReconciliationServiceDouble,
  type CanonicalObservationView,
  type ObservationArchive,
  type ReconcileInput,
  type ReconcileOutcome,
  type ReconciliationDoubleDeps,
  type ReconciliationError,
  type ReconciliationPolicy,
  type ReconciliationServiceContract,
  type ReconciliationVerdict,
  type ReconciliationWindow,
  type SourceProvenanceRecord,
  type SourceRole,
  type SourcedObservation,
} from "./reconciliation.js";
