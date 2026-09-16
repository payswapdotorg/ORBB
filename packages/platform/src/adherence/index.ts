/**
 * Adherence enforcement capability seam barrel (B10, Lane C packet
 * M6-B).
 *
 *   - `capabilities.ts` — the `AdherenceCapabilityAdapter` contract,
 *     the detection-state vocabulary, the structural mirror of the
 *     `@orbb/adherence` `RestrictionDecision` token, and the strict
 *     `isRestrictionDecision` forgery guard.
 *   - `ios-focus.ts` — `IosFocusAdapter` over the
 *     `IosFocusNativeModule` seam (Screen Time / app shield) + the
 *     synthetic native double.
 *   - `android-usage.ts` — `AndroidUsageAccessAdapter` over the
 *     `AndroidUsageAccessNativeModule` seam (usage access / app timers)
 *     + the synthetic native double.
 *
 * The `@orbb/adherence` policy engine drives these seams; real native
 * bindings and the Expo config-plugin surface arrive in the
 * deployment/mobile-integration milestone (handoff recorded).
 */
export {
  ADHERENCE_CAPABILITY_IDS,
  ADHERENCE_STATES,
  CAPABILITY_DETECTION_STATES,
  capabilityErr,
  capabilityOk,
  isRestrictionDecision,
  RESTRICTION_DECISION_KIND,
  type AdherenceCapabilityAdapter,
  type AdherenceCapabilityId,
  type AdherenceState,
  type CapabilityDetection,
  type CapabilityDetectionState,
  type CapabilityInvocationError,
  type CapabilityInvocationRecord,
  type CapabilityReleaseRecord,
  type CapabilityReleaseReference,
  type CapabilityResult,
  type CapabilityRestrictionRequest,
  type RestrictionDecision,
} from "./capabilities.js";

export {
  IosFocusAdapter,
  SyntheticIosFocusNativeModule,
  type IosAppShieldSpec,
  type IosFocusAdapterDeps,
  type IosFocusAuthorizationStatus,
  type IosFocusCapabilityStatus,
  type IosFocusNativeModule,
  type SyntheticIosFocusOptions,
  type SyntheticShieldCall,
} from "./ios-focus.js";

export {
  AndroidUsageAccessAdapter,
  SyntheticAndroidUsageAccessNativeModule,
  type AndroidAppTimerSpec,
  type AndroidUsageAccessAdapterDeps,
  type AndroidUsageAccessNativeModule,
  type AndroidUsageAccessStatus,
  type SyntheticAndroidUsageAccessOptions,
  type SyntheticTimerCall,
} from "./android-usage.js";
