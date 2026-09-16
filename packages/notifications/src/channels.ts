/**
 * Delivery channel abstraction (B8) — the adapter seam of the
 * notification engine.
 *
 * `NotificationChannel` is the ONLY way a reminder leaves the engine:
 * typed send requests, per-channel capability flags, and a FAIL-CLOSED
 * delivery result model:
 *
 *   - `delivered`    — the channel accepted the reminder.
 *   - `undeliverable`— a pre-flight determination that it cannot be
 *                      delivered (no recipient reference, unsupported
 *                      shape, expired recipient). Recorded with a typed
 *                      reason, NEVER a silent drop.
 *   - `failed`       — the channel attempted delivery and the provider
 *                      failed. Recorded with a typed reason.
 *
 * A channel that THROWS violates the contract; the engine still
 * fail-closes (catches, records `channel-errored`, keeps its typed
 * result) — a buggy channel can never crash the engine.
 *
 * Provider portability (the M4-C/M5-C seam pattern): channels are
 * interfaces over provider ports; NO provider SDK is imported anywhere.
 * The shipped doubles are `InMemoryChannel` (test/impl default) and the
 * seam-only SYNTH `WebPushChannel`/`EmailChannel` in `synth-channels.ts`
 * — they shape the provider contract without any network call.
 */
import type { ReminderId } from "./ids.js";
import type { ChannelRecipient } from "./preferences.js";
import type { ReminderPayload } from "./reminder.js";

/**
 * Opaque channel registry key. Assigned by the wiring layer; unique
 * within a registry (the engine validates).
 */
export type ChannelId = string;

// ---------------------------------------------------------------------------
// Failure reasons (typed, PHID-safe: bare kinds, no free text).
// ---------------------------------------------------------------------------

/**
 * Every failure reason kind a channel or the engine can record. Human-
 * readable diagnostics are the channel adapter's OWN observability
 * concern (through `@orbb/observability` redaction) — they never enter
 * engine records or payloads.
 */
export const CHANNEL_FAILURE_REASON_KINDS = [
  /** The profile carries no recipient reference for the channel. */
  "no-recipient",
  /** The channel cannot carry the requested payload shape. */
  "not-supported",
  /** The recipient reference is no longer valid (e.g. expired subscription). */
  "recipient-expired",
  /** The provider considered the request invalid or refused it. */
  "provider-rejected",
  /** The provider attempted delivery and failed. */
  "provider-error",
  /** The channel threw instead of returning a typed outcome (engine-caught). */
  "channel-errored",
] as const;

export type ChannelFailureReasonKind = (typeof CHANNEL_FAILURE_REASON_KINDS)[number];

/** A typed, PHID-safe failure reason: a bare kind, never a value echo. */
export interface ChannelFailureReason {
  readonly kind: ChannelFailureReasonKind;
}

// ---------------------------------------------------------------------------
// Capabilities.
// ---------------------------------------------------------------------------

/**
 * Per-channel capability flags. `deliversReminders` gates the plain
 * `REMIND` rung; `deliversFallbackOffers` gates the
 * `REMIND_WITH_FALLBACK_OFFER` rung (a minimal channel that cannot
 * render the fallback vocabulary is skipped for that rung — with an
 * accounted reason, never silently).
 */
export interface ChannelCapabilities {
  readonly deliversReminders: boolean;
  readonly deliversFallbackOffers: boolean;
}

/** Capability set of a channel that carries every reminder rung. */
export const ALL_CHANNEL_CAPABILITIES: ChannelCapabilities = {
  deliversReminders: true,
  deliversFallbackOffers: true,
};

/** Can this channel carry this rung's payload shape? */
export function isRungCarriedByChannel(
  rung: "REMIND" | "REMIND_WITH_FALLBACK_OFFER",
  capabilities: ChannelCapabilities,
): boolean {
  return rung === "REMIND"
    ? capabilities.deliversReminders
    : capabilities.deliversFallbackOffers;
}

// ---------------------------------------------------------------------------
// Send request and fail-closed outcome.
// ---------------------------------------------------------------------------

/** A typed send request: identity, routing reference, payload, send time. */
export interface ChannelSendRequest {
  readonly reminderId: ReminderId;
  /** Opaque recipient reference — resolved to a real address inside the provider seam. */
  readonly recipient: ChannelRecipient;
  readonly payload: ReminderPayload;
  readonly sendAt: Date;
}

export type ChannelDeliveryStatus = "delivered" | "undeliverable" | "failed";

/**
 * Fail-closed delivery outcome. `reason` is present exactly when the
 * status is not `delivered`; `deliveredAt` exactly when it is.
 */
export type ChannelDeliveryOutcome =
  | { readonly status: "delivered"; readonly deliveredAt: Date }
  | { readonly status: "undeliverable"; readonly reason: ChannelFailureReason }
  | { readonly status: "failed"; readonly reason: ChannelFailureReason };

/**
 * The delivery channel contract. Implementations MUST return typed
 * outcomes for every expected failure and MUST NOT include person-
 * identifying content in reasons (bare kinds only).
 */
export interface NotificationChannel {
  readonly id: ChannelId;
  readonly capabilities: ChannelCapabilities;
  send(request: ChannelSendRequest): Promise<ChannelDeliveryOutcome>;
}

// ---------------------------------------------------------------------------
// Registry validation (structural, PHID-safe).
// ---------------------------------------------------------------------------

/** Structural registry violations (offending values are never echoed). */
export type ChannelRegistryViolation =
  | { readonly kind: "invalid-channel"; readonly channelIndex: number }
  | { readonly kind: "duplicate-channel-id"; readonly channelIndex: number };

/**
 * Validates a channel registry: every channel has a non-empty id, well-
 * formed capability flags, and a `send` function; ids are unique.
 * Returns the first violation, or `undefined` when the registry is valid.
 */
export function validateChannelRegistry(
  channels: readonly NotificationChannel[],
): ChannelRegistryViolation | undefined {
  const seenIds = new Set<string>();
  for (const [index, channel] of channels.entries()) {
    if (
      typeof channel !== "object" ||
      channel === null ||
      typeof channel.id !== "string" ||
      channel.id.length === 0 ||
      typeof channel.capabilities !== "object" ||
      channel.capabilities === null ||
      typeof channel.capabilities.deliversReminders !== "boolean" ||
      typeof channel.capabilities.deliversFallbackOffers !== "boolean" ||
      typeof channel.send !== "function"
    ) {
      return { kind: "invalid-channel", channelIndex: index };
    }
    if (seenIds.has(channel.id)) {
      return { kind: "duplicate-channel-id", channelIndex: index };
    }
    seenIds.add(channel.id);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Provider report shape (shared by the SYNTH seam doubles).
// ---------------------------------------------------------------------------

/**
 * A provider port's delivery report (no timestamp — the channel adapter
 * stamps `deliveredAt` from ITS injected clock, keeping providers pure).
 */
export type ProviderDeliveryReport =
  | { readonly status: "delivered" }
  | { readonly status: "undeliverable" | "failed"; readonly reason: ChannelFailureReason };
