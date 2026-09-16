/**
 * B8 — Delivery channel abstraction (fail-closed).
 *
 * RECORDED DESIGN DECISIONS:
 *
 * - `NotificationChannel` exposes TYPED send operations — one per ladder
 *   rung (`sendReminder`, `sendFallbackOffer`) — so providers explicitly
 *   implement (or explicitly decline, via capability flags) each payload
 *   variant. This is the M4-C/M5-C adapter-seam pattern: provider
 *   portability through interfaces, NO provider SDKs, no network in this
 *   package. The seam-only `WebPushChannel` / `EmailChannel` SYNTH doubles
 *   (see their modules) shape the real provider contracts.
 *
 * - FAIL-CLOSED delivery results: an undeliverable send is a RECORDED
 *   outcome (`status: "undelivered"` with a typed reason from a closed
 *   vocabulary) — never a silent drop, never a thrown crash into the
 *   engine. The engine additionally converts any thrown channel exception
 *   and any malformed channel return value into `channel-error` outcomes,
 *   so a rogue provider cannot crash dispatch (see `ReminderEngine`).
 *
 * - Capability flags gate rung fan-out: a channel that does not declare
 *   `supportsRemind` / `supportsFallbackOffer` for a rung is SKIPPED with
 *   an accounted reason in the computed schedule (fail-closed accounting,
 *   never silent). A missing/undefined flag is falsy — deny-by-default.
 *
 * - The ROUTING plane and the PAYLOAD plane are separate: the send request
 *   carries the person id (the channel must address its own delivery
 *   target — subscriptions/addresses are resolved INSIDE the provider
 *   adapter, never inside the engine), while the payload itself stays
 *   person-free and PHI-free (see `payloads.ts`).
 */
import type { PersonId } from "@orbb/domain";
import { NotificationEngineError } from "./errors.js";
import type { ReminderId } from "./identity.js";
import type { ReminderPayload, ReminderRung } from "./payloads.js";

/** Delivery channel kinds (provider families). */
export const CHANNEL_KINDS = ["inapp", "push", "email"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Type guard: is `value` a canonical channel kind? */
export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}

/**
 * Closed vocabulary of typed delivery-failure reasons (PHID-safe — no
 * provider detail beyond the classified reason; providers must not place
 * PHI in `detail`).
 */
export const DELIVERY_FAILURE_REASONS = [
  "channel-error",
  "provider-rejected",
  "no-delivery-address",
  "rate-limited",
] as const;

export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

/** Type guard: is `value` a canonical delivery-failure reason? */
export function isDeliveryFailureReason(value: unknown): value is DeliveryFailureReason {
  return (
    typeof value === "string" && (DELIVERY_FAILURE_REASONS as readonly string[]).includes(value)
  );
}

/** Per-rung capability flags (deny-by-default when absent). */
export interface ChannelCapabilityFlags {
  /** Can the channel carry REMIND-rung payloads? */
  readonly supportsRemind: boolean;
  /** Can the channel carry REMIND_WITH_FALLBACK_OFFER payloads? */
  readonly supportsFallbackOffer: boolean;
}

/** Routing-envelope + payload handed to a channel for one send. */
export interface ChannelSendRequest {
  readonly reminderId: ReminderId;
  /** Routing plane only — payloads themselves are person-free. */
  readonly personId: PersonId;
  readonly payload: ReminderPayload;
}

/** A successful delivery. */
export interface DeliveredResult {
  readonly status: "delivered";
  readonly deliveredAt: Date;
  /** Opaque, PHID-safe provider receipt token (SYNTH-marked in doubles). */
  readonly providerReceipt?: string;
}

/** A recorded, classified delivery failure — never a silent drop. */
export interface UndeliveredResult {
  readonly status: "undelivered";
  readonly reason: DeliveryFailureReason;
  /** Optional human-safe context string (must never carry PHI). */
  readonly detail?: string;
}

/** Fail-closed delivery outcome: delivered, or undelivered WITH a reason. */
export type DeliveryResult = DeliveredResult | UndeliveredResult;

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Type guard: is `value` a well-formed {@link DeliveryResult}? */
export function isDeliveryResult(value: unknown): value is DeliveryResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<DeliveryResult>;
  if (candidate.status === "delivered") {
    if (!isTimestamp(candidate.deliveredAt)) {
      return false;
    }
    return candidate.providerReceipt === undefined || typeof candidate.providerReceipt === "string";
  }
  if (candidate.status === "undelivered") {
    if (!isDeliveryFailureReason(candidate.reason)) {
      return false;
    }
    return candidate.detail === undefined || typeof candidate.detail === "string";
  }
  return false;
}

/**
 * The delivery-channel port. Implementations MUST NOT throw for expected
 * delivery failures — they return `undelivered` results (the engine still
 * defends against throws). Implementations resolve their own delivery
 * addresses; they never receive them from the engine.
 */
export interface NotificationChannel {
  /** Stable channel identifier (referenced by preferences). */
  readonly id: string;
  readonly kind: ChannelKind;
  readonly capabilities: ChannelCapabilityFlags;
  /** Typed send operation for the REMIND rung. */
  sendReminder(request: ChannelSendRequest): Promise<DeliveryResult>;
  /** Typed send operation for the REMIND_WITH_FALLBACK_OFFER rung. */
  sendFallbackOffer(request: ChannelSendRequest): Promise<DeliveryResult>;
}

/**
 * The channel registry input: the set of channels available to a dispatch.
 * `InMemoryChannelRegistry` is the reference double; production wiring
 * (OS push services, email provider) registers real adapters here.
 */
export interface ChannelRegistry {
  all(): readonly NotificationChannel[];
  get(channelId: string): NotificationChannel | undefined;
}

/** In-memory reference {@link ChannelRegistry} (insertion-ordered). */
export class InMemoryChannelRegistry implements ChannelRegistry {
  readonly #channels: readonly NotificationChannel[];
  readonly #byId: Map<string, NotificationChannel> = new Map();

  constructor(channels: readonly NotificationChannel[]) {
    for (const channel of channels) {
      if (
        typeof channel !== "object" ||
        channel === null ||
        typeof channel.id !== "string" ||
        channel.id.length === 0
      ) {
        throw new NotificationEngineError(
          "invalid-request",
          "Channel registry entries must carry a non-empty string id.",
        );
      }
      if (this.#byId.has(channel.id)) {
        throw new NotificationEngineError(
          "invariant-violation",
          "Channel registry contains a duplicate channel id.",
        );
      }
      this.#byId.set(channel.id, channel);
    }
    this.#channels = [...channels];
  }

  all(): readonly NotificationChannel[] {
    return this.#channels;
  }

  get(channelId: string): NotificationChannel | undefined {
    return this.#byId.get(channelId);
  }
}

/** Dispatches a send to the typed operation for a rung (pure helper). */
export function sendForRung(
  channel: NotificationChannel,
  rung: ReminderRung,
  request: ChannelSendRequest,
): Promise<DeliveryResult> {
  return rung === "REMIND_WITH_FALLBACK_OFFER"
    ? channel.sendFallbackOffer(request)
    : channel.sendReminder(request);
}
