/**
 * Canonical SMART-boundary id grammar + injectable id/clock defaults.
 *
 * Prefixes follow the `<prefix>_<body>` grammar precedent used across
 * @orbb packages (`sess_`, `otp_`, `audit_`, …): bodies are 16–128
 * characters of `[A-Za-z0-9_-]`. `SmartRandomIdFactory` / `systemClock`
 * are the production defaults for the `IdFactory` / `Clock` seams (both
 * defined by @orbb/testkit); tests inject `DeterministicIdFactory` /
 * `DeterministicClock` instead — the same seam pattern as @orbb/auth.
 *
 * SYNTH namespace: every host the boundary treats as obviously synthetic
 * lives under the reserved `.test` TLD (RFC 6761), specifically the
 * `synth.test` suffix. Real production issuers are ordinary https hosts;
 * the boundary records `synth: true` on launch contexts issued from the
 * SYNTH namespace so downstream audit trails can tell them apart.
 */
import { randomBytes } from "node:crypto";
import type { Clock, IdFactory } from "@orbb/testkit";
import { SmartInvariantError } from "./errors.js";

/** Opaque SMART launch-token record ids issued through the `IdFactory` seam. */
export const SMART_TOKEN_ID_PREFIX = "smarttok";

/** Opaque SMART boundary audit-record ids issued through the `IdFactory` seam. */
export const SMART_AUDIT_ID_PREFIX = "smartaud";

/** Prefix for launch handles minted by the SYNTH doubles (EHR-side stand-ins). */
export const SYNTH_LAUNCH_HANDLE_PREFIX = "synthlaunch";

/** Reserved SYNTH issuer host (the root of the synthetic EHR namespace). */
export const SYNTH_ISS_HOST = "synth.test";

/** Reserved SYNTH issuer host suffix (any host under it). */
export const SYNTH_ISS_HOST_SUFFIX = ".synth.test";

/** Valid prefix segment for the id factory: 1–32 URL-safe characters. */
const ID_PREFIX_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Is `host` inside the SYNTH namespace (reserved `.test` TLD)? */
export function isSynthIssHost(host: string): boolean {
  return host === SYNTH_ISS_HOST || host.endsWith(SYNTH_ISS_HOST_SUFFIX);
}

/** 24 random bytes -> 32 base64url characters (no padding): a valid id body. */
function randomIdBody(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Production `IdFactory` for the SMART boundary: crypto-random bodies
 * under caller-supplied prefixes. Mirrors @orbb/auth's `RandomIdFactory`
 * (kept local for the same decoupling reason as `crypto.ts`).
 */
export class SmartRandomIdFactory implements IdFactory {
  next(prefix: string): string {
    if (!ID_PREFIX_PATTERN.test(prefix)) {
      throw new SmartInvariantError(
        "SmartRandomIdFactory prefix must be 1-32 characters of [A-Za-z0-9_-].",
      );
    }
    return `${prefix}_${randomIdBody()}`;
  }
}

/** Production `Clock`: wall-clock time. Tests inject a deterministic clock. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};
