/**
 * B10 — iOS focus (Screen Time / app shield) seam, Lane C packet M6-B.
 *
 * `IosFocusAdapter` implements the
 * {@link import("./capabilities.js").AdherenceCapabilityAdapter} contract
 * over an `IosFocusNativeModule` interface: Screen Time capability
 * status, explicit focus authorization, and an app shield (the Screen
 * Time "shield" surface that covers apps until an instant).
 *
 * Mobile reality (mirrors the M4-C packet discipline): FamilyControls /
 * Screen Time need iOS native modules. THIS packet ships the TypeScript
 * seam — `IosFocusNativeModule` is the contract for the real native
 * binding (deployment/mobile-integration milestone, handoff recorded) —
 * plus a SYNTHETIC native double with deterministic behavior and a
 * recorded call log. The Expo config-plugin surface (Info.plist usage
 * descriptions, FamilyControls entitlement) is OUT OF SCOPE here and is
 * recorded as a handoff to the mobile-integration milestone.
 *
 * Authorization gate (packet rule): invoking never auto-requests
 * authorization; the UX flow calls {@link IosFocusAdapter.requestAuthorization}
 * explicitly. An invocation whose decision token is invalid, whose
 * capability mismatches, whose expiry has passed, or whose capability
 * detects as anything other than `available` resolves to a TYPED
 * rejection — never a throw, never a partial restriction.
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
// iOS focus native surface, mirrored in TypeScript.
// ---------------------------------------------------------------------------

/**
 * FamilyControls-style authorization statuses:
 * `notDetermined` (never asked), `denied` (person said no),
 * `authorized` (person granted).
 */
export type IosFocusAuthorizationStatus = "notDetermined" | "denied" | "authorized";

/** Screen Time capability status as the native module reports it. */
export interface IosFocusCapabilityStatus {
  /** Is the Screen Time API surface present on this OS version? */
  readonly screenTimeSupported: boolean;
  /** Is the OS-level Screen Time feature enabled in Settings? */
  readonly screenTimeEnabled: boolean;
  readonly authorizationStatus: IosFocusAuthorizationStatus;
}

/** An app shield: cover `appBundleIds` until `until`. */
export interface IosAppShieldSpec {
  readonly appBundleIds: readonly string[];
  readonly until: Date;
}

/**
 * The native module contract for the REAL iOS binding (handoff to the
 * deployment/mobile-integration milestone): capability status, the
 * explicit authorization flow, and shield apply/remove.
 */
export interface IosFocusNativeModule {
  getCapabilityStatus(): Promise<IosFocusCapabilityStatus>;
  requestAuthorization(): Promise<boolean>;
  applyAppShield(spec: IosAppShieldSpec): Promise<void>;
  removeAppShield(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Synthetic native double (deterministic; recorded call log).
// ---------------------------------------------------------------------------

/** Options for the synthetic native double. */
export interface SyntheticIosFocusOptions {
  /** Initial capability status. Default: supported + enabled + notDetermined. */
  readonly status?: IosFocusCapabilityStatus;
  /** Does requestAuthorization model a grant? Default: true. */
  readonly grantOnRequest?: boolean;
}

/** One recorded shield application (for test assertions). */
export interface SyntheticShieldCall {
  readonly appBundleIds: readonly string[];
  readonly untilMs: number;
}

/**
 * Synthetic `IosFocusNativeModule` double for tests: deterministic,
 * never throws, records every shield apply/remove. A native `applyAppShield`
 * failure can be scripted with {@link SyntheticIosFocusNativeModule.failNextApply}
 * to exercise the typed `native-error` path.
 */
export class SyntheticIosFocusNativeModule implements IosFocusNativeModule {
  readonly #initialStatus: IosFocusCapabilityStatus;
  #status: IosFocusCapabilityStatus;
  readonly #grantOnRequest: boolean;
  readonly #shieldCalls: SyntheticShieldCall[] = [];
  #removeCalls = 0;
  #failNextApply = false;

  constructor(options?: SyntheticIosFocusOptions) {
    this.#initialStatus = options?.status ?? {
      screenTimeSupported: true,
      screenTimeEnabled: true,
      authorizationStatus: "notDetermined",
    };
    this.#status = this.#initialStatus;
    this.#grantOnRequest = options?.grantOnRequest ?? true;
  }

  /** Recorded shield applications, in call order (defensive copies). */
  get shieldCalls(): readonly SyntheticShieldCall[] {
    return this.#shieldCalls.map((call) => ({
      appBundleIds: [...call.appBundleIds],
      untilMs: call.untilMs,
    }));
  }

  /** How many times removeAppShield was called. */
  get removeCalls(): number {
    return this.#removeCalls;
  }

  /** Scripts the next applyAppShield to reject (models a native error). */
  failNextApply(): void {
    this.#failNextApply = true;
  }

  async getCapabilityStatus(): Promise<IosFocusCapabilityStatus> {
    return { ...this.#status };
  }

  async requestAuthorization(): Promise<boolean> {
    if (this.#grantOnRequest) {
      this.#status = { ...this.#status, authorizationStatus: "authorized" };
      return true;
    }
    this.#status = { ...this.#status, authorizationStatus: "denied" };
    return false;
  }

  async applyAppShield(spec: IosAppShieldSpec): Promise<void> {
    if (this.#failNextApply) {
      this.#failNextApply = false;
      throw new Error("SYNTHETIC native applyAppShield failure");
    }
    this.#shieldCalls.push({
      appBundleIds: [...spec.appBundleIds],
      untilMs: spec.until.getTime(),
    });
  }

  async removeAppShield(): Promise<void> {
    this.#removeCalls += 1;
  }
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link IosFocusAdapter} (all injectable). */
export interface IosFocusAdapterDeps {
  readonly native: IosFocusNativeModule;
  readonly logger: Logger;
  readonly nowMs?: () => number;
}

/**
 * `IosFocusAdapter` — the `AdherenceCapabilityAdapter` over iOS Screen
 * Time focus/shield. Dumb surface: acts ONLY under a valid, unexpired
 * {@link import("./capabilities.js").RestrictionDecision} for the
 * `ios-focus` capability, re-checking detection as defense in depth.
 */
export class IosFocusAdapter implements AdherenceCapabilityAdapter {
  readonly capability = "ios-focus" as const;
  readonly #native: IosFocusNativeModule;
  readonly #logger: Logger;
  readonly #nowMs: () => number;

  constructor(deps: IosFocusAdapterDeps) {
    this.#native = deps.native;
    this.#logger = deps.logger;
    this.#nowMs = deps.nowMs ?? Date.now;
  }

  async detect(): Promise<CapabilityDetection> {
    const status = await this.#native.getCapabilityStatus();
    if (!status.screenTimeSupported) {
      return { state: "unavailable", reason: "screen-time-unsupported" };
    }
    if (status.authorizationStatus === "notDetermined") {
      return { state: "needs-permission", reason: "focus-authorization-not-determined" };
    }
    if (status.authorizationStatus === "denied") {
      return { state: "needs-permission", reason: "focus-authorization-denied" };
    }
    if (!status.screenTimeEnabled) {
      return { state: "needs-config", reason: "screen-time-disabled" };
    }
    return { state: "available" };
  }

  /** Explicit UX flow (never auto-requested by an invocation). */
  async requestAuthorization(): Promise<boolean> {
    const granted = await this.#native.requestAuthorization();
    this.#logger.info("iOS focus authorization request completed", {
      event: "adherence.ios-focus.authorization.request",
      isAuthorized: granted,
    });
    return granted;
  }

  async invokeRestriction(
    request: CapabilityRestrictionRequest,
  ): Promise<CapabilityResult<CapabilityInvocationRecord, CapabilityInvocationError>> {
    if (!isRestrictionDecision(request?.decision)) {
      this.#logger.warn("iOS focus restriction refused: invalid decision token", {
        event: "adherence.ios-focus.restriction.refused",
        rejectKind: "decision-invalid",
      });
      return capabilityErr({ kind: "decision-invalid", detail: "decision" });
    }
    const decision = request.decision;
    if (decision.capability !== this.capability) {
      this.#logger.warn("iOS focus restriction refused: capability mismatch", {
        event: "adherence.ios-focus.restriction.refused",
        rejectKind: "capability-mismatch",
      });
      return capabilityErr({
        kind: "capability-mismatch",
        expected: this.capability,
        received: decision.capability,
      });
    }
    if (decision.expiresAtMs <= this.#nowMs()) {
      this.#logger.warn("iOS focus restriction refused: decision expired", {
        event: "adherence.ios-focus.restriction.refused",
        rejectKind: "decision-expired",
      });
      return capabilityErr({ kind: "decision-expired" });
    }
    const detection = await this.detect();
    if (detection.state !== "available") {
      this.#logger.warn("iOS focus restriction refused: capability not available", {
        event: "adherence.ios-focus.restriction.refused",
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
    const appBundleIds = [...request.target.appIds];
    const until = new Date(decision.expiresAtMs);
    try {
      await this.#native.applyAppShield({ appBundleIds, until });
    } catch {
      this.#logger.error("iOS focus native shield failed", {
        event: "adherence.ios-focus.restriction.native-error",
        decisionId: decision.decisionId,
        policyId: decision.policyId,
      });
      return capabilityErr({ kind: "native-error" });
    }
    const record: CapabilityInvocationRecord = {
      decisionId: decision.decisionId,
      policyId: decision.policyId,
      capability: this.capability,
      appIds: appBundleIds,
      appliedAtMs: this.#nowMs(),
      expiresAtMs: decision.expiresAtMs,
    };
    this.#logger.info("iOS focus restriction applied under authorized decision", {
      event: "adherence.ios-focus.restriction.applied",
      decisionId: decision.decisionId,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      appCount: appBundleIds.length,
      expiresAtMs: decision.expiresAtMs,
    });
    return capabilityOk(record);
  }

  async releaseRestriction(
    reference: CapabilityReleaseReference,
  ): Promise<CapabilityResult<CapabilityReleaseRecord, CapabilityInvocationError>> {
    if (
      typeof reference?.decisionId !== "string" ||
      reference.decisionId.length === 0
    ) {
      return capabilityErr({ kind: "decision-invalid", detail: "decisionId" });
    }
    try {
      await this.#native.removeAppShield();
    } catch {
      this.#logger.error("iOS focus native shield removal failed", {
        event: "adherence.ios-focus.release.native-error",
        decisionId: reference.decisionId,
      });
      return capabilityErr({ kind: "native-error" });
    }
    const record: CapabilityReleaseRecord = {
      decisionId: reference.decisionId,
      releasedAtMs: this.#nowMs(),
    };
    this.#logger.info("iOS focus restriction released", {
      event: "adherence.ios-focus.restriction.released",
      decisionId: reference.decisionId,
    });
    return capabilityOk(record);
  }
}
