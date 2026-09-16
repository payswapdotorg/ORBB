/**
 * B10 — Android usage-access (app timer) seam, Lane C packet M6-B.
 *
 * `AndroidUsageAccessAdapter` implements the
 * {@link import("./capabilities.js").AdherenceCapabilityAdapter} contract
 * over an `AndroidUsageAccessNativeModule` interface: usage-stats
 * capability status, the usage-access settings flow, and app timer
 * restrictions (the "app timers" surface that restricts app usage until
 * an instant).
 *
 * Mobile reality (mirrors the M4-C packet discipline): usage access and
 * app restrictions need Android intents / device policy. THIS packet
 * ships the TypeScript seam — `AndroidUsageAccessNativeModule` is the
 * contract for the real native binding (deployment/mobile-integration
 * milestone, handoff recorded) — plus a SYNTHETIC native double with
 * deterministic behavior and a recorded call log. The Expo
 * config-plugin surface (manifest queries for app usage visibility) is
 * OUT OF SCOPE here and is recorded as a handoff to the
 * mobile-integration milestone.
 *
 * RECORDED ASSUMPTION (detection mapping, Android reality):
 *   - API level without usage stats            -> `unavailable`
 *   - usage access not granted (settings app-op) -> `needs-permission`
 *   - usage access granted but the restriction policy surface requires
 *     a device/profile owner this app does not hold -> `needs-config`
 *   - otherwise                                   -> `available`
 *
 * Authorization gate (packet rule): invoking never auto-launches the
 * settings intent; the UX flow calls
 * {@link AndroidUsageAccessAdapter.requestUsageAccess} explicitly.
 */
import type { Logger } from "@orbb/observability";
import {
  capabilityErr,
  capabilityOk,
  isRestrictionDecision,
  type AdherenceCapabilityAdapter,
  type CapabilityDetection,
  type CapabilityInvocationError,
  type CapabilityInvocationRecord,
  type CapabilityReleaseRecord,
  type CapabilityReleaseReference,
  type CapabilityResult,
  type CapabilityRestrictionRequest,
} from "./capabilities.js";

// ---------------------------------------------------------------------------
// Android usage-access native surface, mirrored in TypeScript.
// ---------------------------------------------------------------------------

/** Usage-access capability status as the native module reports it. */
export interface AndroidUsageAccessStatus {
  /** Is the UsageStatsManager surface present on this OS version? */
  readonly usageStatsSupported: boolean;
  /** Has the person granted usage access (PACKAGE_USAGE_STATS app-op)? */
  readonly usageAccessGranted: boolean;
  /** Can this app apply restriction policy (device/profile owner)? */
  readonly restrictionPolicyAvailable: boolean;
}

/** An app timer restriction: restrict `appPackages` until `until`. */
export interface AndroidAppTimerSpec {
  readonly appPackages: readonly string[];
  readonly until: Date;
}

/**
 * The native module contract for the REAL Android binding (handoff to
 * the deployment/mobile-integration milestone): status, the explicit
 * usage-access settings flow, and timer apply/clear.
 */
export interface AndroidUsageAccessNativeModule {
  getStatus(): Promise<AndroidUsageAccessStatus>;
  requestUsageAccess(): Promise<boolean>;
  setAppTimerRestriction(spec: AndroidAppTimerSpec): Promise<void>;
  clearAppTimerRestrictions(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Synthetic native double (deterministic; recorded call log).
// ---------------------------------------------------------------------------

/** Options for the synthetic native double. */
export interface SyntheticAndroidUsageAccessOptions {
  /** Initial status. Default: supported + granted + policy available. */
  readonly status?: AndroidUsageAccessStatus;
  /** Does requestUsageAccess model a grant? Default: true. */
  readonly grantOnRequest?: boolean;
}

/** One recorded timer application (for test assertions). */
export interface SyntheticTimerCall {
  readonly appPackages: readonly string[];
  readonly untilMs: number;
}

/**
 * Synthetic `AndroidUsageAccessNativeModule` double for tests:
 * deterministic, never throws, records every timer apply/clear. A
 * native `setAppTimerRestriction` failure can be scripted with
 * {@link SyntheticAndroidUsageAccessNativeModule.failNextApply} to
 * exercise the typed `native-error` path.
 */
export class SyntheticAndroidUsageAccessNativeModule
  implements AndroidUsageAccessNativeModule
{
  readonly #initialStatus: AndroidUsageAccessStatus;
  #status: AndroidUsageAccessStatus;
  readonly #grantOnRequest: boolean;
  readonly #timerCalls: SyntheticTimerCall[] = [];
  #clearCalls = 0;
  #failNextApply = false;

  constructor(options?: SyntheticAndroidUsageAccessOptions) {
    this.#initialStatus = options?.status ?? {
      usageStatsSupported: true,
      usageAccessGranted: true,
      restrictionPolicyAvailable: true,
    };
    this.#status = this.#initialStatus;
    this.#grantOnRequest = options?.grantOnRequest ?? true;
  }

  /** Recorded timer applications, in call order (defensive copies). */
  get timerCalls(): readonly SyntheticTimerCall[] {
    return this.#timerCalls.map((call) => ({
      appPackages: [...call.appPackages],
      untilMs: call.untilMs,
    }));
  }

  /** How many times clearAppTimerRestrictions was called. */
  get clearCalls(): number {
    return this.#clearCalls;
  }

  /** Scripts the next setAppTimerRestriction to reject. */
  failNextApply(): void {
    this.#failNextApply = true;
  }

  async getStatus(): Promise<AndroidUsageAccessStatus> {
    return { ...this.#status };
  }

  async requestUsageAccess(): Promise<boolean> {
    if (this.#grantOnRequest) {
      this.#status = { ...this.#status, usageAccessGranted: true };
      return true;
    }
    this.#status = { ...this.#status, usageAccessGranted: false };
    return false;
  }

  async setAppTimerRestriction(spec: AndroidAppTimerSpec): Promise<void> {
    if (this.#failNextApply) {
      this.#failNextApply = false;
      throw new Error("SYNTHETIC native setAppTimerRestriction failure");
    }
    this.#timerCalls.push({
      appPackages: [...spec.appPackages],
      untilMs: spec.until.getTime(),
    });
  }

  async clearAppTimerRestrictions(): Promise<void> {
    this.#clearCalls += 1;
  }
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link AndroidUsageAccessAdapter} (all injectable). */
export interface AndroidUsageAccessAdapterDeps {
  readonly native: AndroidUsageAccessNativeModule;
  readonly logger: Logger;
  readonly nowMs?: () => number;
}

/**
 * `AndroidUsageAccessAdapter` — the `AdherenceCapabilityAdapter` over
 * Android usage access / app timers. Dumb surface: acts ONLY under a
 * valid, unexpired
 * {@link import("./capabilities.js").RestrictionDecision} for the
 * `android-usage-access` capability, re-checking detection as defense
 * in depth.
 */
export class AndroidUsageAccessAdapter implements AdherenceCapabilityAdapter {
  readonly capability = "android-usage-access" as const;
  readonly #native: AndroidUsageAccessNativeModule;
  readonly #logger: Logger;
  readonly #nowMs: () => number;

  constructor(deps: AndroidUsageAccessAdapterDeps) {
    this.#native = deps.native;
    this.#logger = deps.logger;
    this.#nowMs = deps.nowMs ?? Date.now;
  }

  async detect(): Promise<CapabilityDetection> {
    const status = await this.#native.getStatus();
    if (!status.usageStatsSupported) {
      return { state: "unavailable", reason: "usage-stats-unsupported" };
    }
    if (!status.usageAccessGranted) {
      return { state: "needs-permission", reason: "usage-access-not-granted" };
    }
    if (!status.restrictionPolicyAvailable) {
      return { state: "needs-config", reason: "restriction-policy-unavailable" };
    }
    return { state: "available" };
  }

  /** Explicit UX flow (never auto-launched by an invocation). */
  async requestUsageAccess(): Promise<boolean> {
    const granted = await this.#native.requestUsageAccess();
    this.#logger.info("Android usage-access request completed", {
      event: "adherence.android-usage-access.authorization.request",
      isAuthorized: granted,
    });
    return granted;
  }

  async invokeRestriction(
    request: CapabilityRestrictionRequest,
  ): Promise<CapabilityResult<CapabilityInvocationRecord, CapabilityInvocationError>> {
    if (!isRestrictionDecision(request?.decision)) {
      this.#logger.warn("Android usage-access restriction refused: invalid decision token", {
        event: "adherence.android-usage-access.restriction.refused",
        rejectKind: "decision-invalid",
      });
      return capabilityErr({ kind: "decision-invalid", detail: "decision" });
    }
    const decision = request.decision;
    if (decision.capability !== this.capability) {
      this.#logger.warn("Android usage-access restriction refused: capability mismatch", {
        event: "adherence.android-usage-access.restriction.refused",
        rejectKind: "capability-mismatch",
      });
      return capabilityErr({
        kind: "capability-mismatch",
        expected: this.capability,
        received: decision.capability,
      });
    }
    if (decision.expiresAtMs <= this.#nowMs()) {
      this.#logger.warn("Android usage-access restriction refused: decision expired", {
        event: "adherence.android-usage-access.restriction.refused",
        rejectKind: "decision-expired",
      });
      return capabilityErr({ kind: "decision-expired" });
    }
    const detection = await this.detect();
    if (detection.state !== "available") {
      this.#logger.warn("Android usage-access restriction refused: capability not available", {
        event: "adherence.android-usage-access.restriction.refused",
        rejectKind: "capability-unavailable",
        detectionState: detection.state,
      });
      return capabilityErr({ kind: "capability-unavailable", detection });
    }
    if (
      !Array.isArray(request.target?.appIds) ||
      request.target.appIds.length === 0 ||
      request.target.appIds.some((appId) => typeof appId !== "string" || appId.length === 0)
    ) {
      return capabilityErr({ kind: "invalid-target", detail: "target.appIds" });
    }
    const appPackages = [...request.target.appIds];
    const until = new Date(decision.expiresAtMs);
    try {
      await this.#native.setAppTimerRestriction({ appPackages, until });
    } catch {
      this.#logger.error("Android usage-access native timer failed", {
        event: "adherence.android-usage-access.restriction.native-error",
        decisionId: decision.decisionId,
        policyId: decision.policyId,
      });
      return capabilityErr({ kind: "native-error" });
    }
    const record: CapabilityInvocationRecord = {
      decisionId: decision.decisionId,
      policyId: decision.policyId,
      capability: this.capability,
      appIds: appPackages,
      appliedAtMs: this.#nowMs(),
      expiresAtMs: decision.expiresAtMs,
    };
    this.#logger.info("Android usage-access restriction applied under authorized decision", {
      event: "adherence.android-usage-access.restriction.applied",
      decisionId: decision.decisionId,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      appCount: appPackages.length,
      expiresAtMs: decision.expiresAtMs,
    });
    return capabilityOk(record);
  }

  async releaseRestriction(
    reference: CapabilityReleaseReference,
  ): Promise<CapabilityResult<CapabilityReleaseRecord, CapabilityInvocationError>> {
    if (typeof reference?.decisionId !== "string" || reference.decisionId.length === 0) {
      return capabilityErr({ kind: "decision-invalid", detail: "decisionId" });
    }
    try {
      await this.#native.clearAppTimerRestrictions();
    } catch {
      this.#logger.error("Android usage-access native clear failed", {
        event: "adherence.android-usage-access.release.native-error",
        decisionId: reference.decisionId,
      });
      return capabilityErr({ kind: "native-error" });
    }
    const record: CapabilityReleaseRecord = {
      decisionId: reference.decisionId,
      releasedAtMs: this.#nowMs(),
    };
    this.#logger.info("Android usage-access restriction released", {
      event: "adherence.android-usage-access.restriction.released",
      decisionId: reference.decisionId,
    });
    return capabilityOk(record);
  }
}
