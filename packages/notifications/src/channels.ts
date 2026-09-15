/**
 * Delivery channel abstraction (B8) — the provider-portability seam.
 *
 * THE CONTRACT (the M4-C/M5-C seam pattern; provider portability through
 * interfaces, no provider SDKs):
 *   - `NotificationChannel` is a typed port with per-channel CAPABILITY
 *     FLAGS (`canRemind`, `canCarryFallbackOffer`). Rung requirements are
 *     engine-side: rung 1 needs `canRemind`; rung 2 (the fallback offer)
 *     needs `canRemind` + `canCarryFallbackOffer`. A channel that cannot
 *     satisfy a rung's requirements is SKIPPED WITH AN ACCOUNTED REASON —
 *     never a silent drop.
 *   - Delivery is FAIL-CLOSED: `send` returns a typed
 *     {@link ChannelSendResult}; an undeliverable delivery is a RECORDED
 *     outcome with a reason; a channel that THROWS is converted by the
 *     engine into a recorded `channel-transport-error` outcome. Never a
 *     silent drop, never a thrown crash into the engine, never an effect
 *     on the engine result shape.
 *   - Channels see ONLY the PHI-free payload plus the opaque
 *     `recipientRef` pseudonym (see `recipients.ts`) — never a person id.
 *
 * DOUBLES (the only implementations in this packet — no network, no SDK):
 *   - `InMemoryChannel` — the test/impl default. Records every delivery
 *     and result; deterministic fault injection for fail-closed proofs.
 *   - `SyntheticWebPushChannel` / `SyntheticEmailChannel` — SEAM-ONLY
 *     SYNTH doubles that shape the provider contract (web-push
 *     subscription endpoints that can EXPIRE — the real 410-Gone
 *     semantics — and email address tokens) without any network call.
 *     Real VAPID/SMTP-SES adapters arrive behind the SAME interface in a
 *     later integration packet (handoff recorded in README.md).
 */
import type { Clock } from "@orbb/testkit";
import { sha256Hex } from "./canonical.js";
import type { ReminderPayload } from "./payload.js";
import type { ReminderId } from "./ids.js";
import type { NotificationChannelId, ReminderRung } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// Capability flags + rung requirements.
// ---------------------------------------------------------------------------

/** Per-channel capability flags (the vocabulary is frozen: two flags). */
export interface ChannelCapabilities {
  /** The channel can carry rung-1 `REMIND` nudges. */
  readonly canRemind: boolean;
  /** The channel can carry the rung-2 fallback-offer vocabulary payload. */
  readonly canCarryFallbackOffer: boolean;
}

/** Capability flag names (used in accounted skip reasons). */
export type ChannelCapabilityName = keyof ChannelCapabilities;

/** The capability requirements per ladder rung (frozen, engine-side). */
export const RUNG_CAPABILITY_REQUIREMENTS: Readonly<
  Record<ReminderRung, readonly ChannelCapabilityName[]>
> = {
  REMIND: ["canRemind"],
  REMIND_WITH_FALLBACK_OFFER: ["canRemind", "canCarryFallbackOffer"],
};

// ---------------------------------------------------------------------------
// Fail-closed delivery result model.
// ---------------------------------------------------------------------------

/**
 * Why a delivery was undeliverable. PHID-safe by construction: reason
 * KINDS only, never received values.
 */
export type ChannelFailureReason =
  /** The recipient directory has no recipient reference for the person. */
  | { readonly kind: "unknown-recipient" }
  /** The channel's endpoint directory has no endpoint for the recipient ref. */
  | { readonly kind: "unknown-recipient-endpoint" }
  /** The recipient's endpoint exists but is expired (e.g., web-push 410 Gone). */
  | { readonly kind: "recipient-endpoint-expired" }
  /** The channel is not currently registered/resolvable (dispatch-time). */
  | { readonly kind: "channel-disabled" }
  /** The channel rejected the payload as undeliverable (provider policy). */
  | { readonly kind: "payload-rejected" }
  /** The channel threw or its transport failed — converted, never crashed. */
  | { readonly kind: "channel-transport-error" };

/** The fail-closed result of one send operation. */
export type ChannelSendResult =
  | {
      readonly status: "sent";
      readonly deliveredAt: Date;
      /** Opaque SYNTH-marked provider receipt (present on success). */
      readonly providerReceipt?: string;
    }
  | {
      readonly status: "undeliverable";
      readonly reason: ChannelFailureReason;
    };

// ---------------------------------------------------------------------------
// The channel port + the channel-visible delivery request.
// ---------------------------------------------------------------------------

/**
 * The channel-visible delivery request: the PHI-free payload plus the
 * opaque recipient pseudonym and reminder identity. Structurally incapable
 * of carrying a person id (no such field exists on this type).
 */
export interface OutboundDelivery {
  readonly reminderId: ReminderId;
  readonly recipientRef: string;
  readonly channel: NotificationChannelId;
  readonly payload: ReminderPayload;
}

/**
 * The delivery channel port. Implementations MUST be fail-closed: return
 * typed results, record reasons, and reserve throwing for programming
 * errors (the engine converts any throw into a recorded
 * `channel-transport-error` outcome — the engine itself never crashes on
 * a channel).
 */
export interface NotificationChannel {
  /** Lane-local channel identifier (registry key). */
  readonly id: NotificationChannelId;
  /** This channel's capability flags. */
  readonly capabilities: ChannelCapabilities;
  /** Sends one delivery; resolves with the fail-closed result. */
  send(delivery: OutboundDelivery): Promise<ChannelSendResult>;
}

// ---------------------------------------------------------------------------
// Channel registry.
// ---------------------------------------------------------------------------

/** Resolves channel implementations by id (the injected channel set). */
export interface ChannelRegistry {
  resolve(channelId: NotificationChannelId): NotificationChannel | undefined;
  list(): readonly NotificationChannel[];
}

/**
 * In-memory {@link ChannelRegistry} (the test/impl double). Registration
 * order defines `list()` order; duplicate ids are a construction-time
 * programming error (`NotificationEngineError` — invalid-request).
 */
export class InMemoryChannelRegistry implements ChannelRegistry {
  readonly #channels = new Map<NotificationChannelId, NotificationChannel>();

  constructor(channels: readonly NotificationChannel[] = []) {
    for (const channel of channels) {
      if (this.#channels.has(channel.id)) {
        throw new Error(
          "InMemoryChannelRegistry: duplicate channel id at construction (programming error).",
        );
      }
      this.#channels.set(channel.id, channel);
    }
  }

  resolve(channelId: NotificationChannelId): NotificationChannel | undefined {
    return this.#channels.get(channelId);
  }

  list(): readonly NotificationChannel[] {
    return [...this.#channels.values()];
  }
}

// ---------------------------------------------------------------------------
// InMemoryChannel — the test/impl default double.
// ---------------------------------------------------------------------------

/** Deterministic fault injection for fail-closed proofs. */
export type ChannelFaultInjection =
  | { readonly mode: "none" }
  | { readonly mode: "throw" }
  | { readonly mode: "undeliverable"; readonly reason: ChannelFailureReason };

/** Constructor deps for {@link InMemoryChannel} (all injectable). */
export interface InMemoryChannelDeps {
  readonly id: NotificationChannelId;
  readonly clock: Clock;
  /** Defaults to full capabilities ({@link FULL_CHANNEL_CAPABILITIES}). */
  readonly capabilities?: ChannelCapabilities;
  /** Defaults to `{ mode: "none" }` (always succeed). */
  readonly fault?: ChannelFaultInjection;
}

/** Full capability flags: both rungs deliverable. */
export const FULL_CHANNEL_CAPABILITIES: ChannelCapabilities = {
  canRemind: true,
  canCarryFallbackOffer: true,
};

/** One recorded delivery attempt the double observed (for assertions). */
export interface RecordedChannelDelivery {
  readonly delivery: OutboundDelivery;
  readonly result: ChannelSendResult;
  readonly receivedAt: Date;
}

/**
 * The in-memory channel double: records every delivery and its result in
 * order, with deterministic fault injection. Pure over (deliveries,
 * injected clock state) — no I/O, no network, nothing dropped silently.
 */
export class InMemoryChannel implements NotificationChannel {
  readonly id: NotificationChannelId;
  readonly capabilities: ChannelCapabilities;
  readonly #clock: Clock;
  readonly #fault: ChannelFaultInjection;
  readonly #recorded: RecordedChannelDelivery[] = [];

  constructor(deps: InMemoryChannelDeps) {
    this.id = deps.id;
    this.capabilities = deps.capabilities ?? FULL_CHANNEL_CAPABILITIES;
    this.#clock = deps.clock;
    this.#fault = deps.fault ?? { mode: "none" };
  }

  /** Every delivery observed so far, in order (defensive copies). */
  get recorded(): readonly RecordedChannelDelivery[] {
    return this.#recorded.map((entry) => ({
      delivery: entry.delivery,
      result: entry.result,
      receivedAt: new Date(entry.receivedAt.getTime()),
    }));
  }

  async send(delivery: OutboundDelivery): Promise<ChannelSendResult> {
    const receivedAt = this.#clock.now();
    const result = this.#deliver(delivery, receivedAt);
    this.#recorded.push({ delivery, result, receivedAt });
    return result;
  }

  #deliver(delivery: OutboundDelivery, now: Date): ChannelSendResult {
    switch (this.#fault.mode) {
      case "none":
        return {
          status: "sent",
          deliveredAt: now,
          providerReceipt: synthReceipt("SYNTH-inmem-provider-v1", delivery),
        };
      case "throw":
        // The engine converts this into a recorded channel-transport-error.
        throw new Error("SYNTH in-memory channel transport failure (fault injection)");
      case "undeliverable":
        return { status: "undeliverable", reason: this.#fault.reason };
    }
  }
}

// ---------------------------------------------------------------------------
// SYNTH provider doubles (seam-only — they shape the provider contract).
// ---------------------------------------------------------------------------

/**
 * The recipient-endpoint directory seam the SYNTH provider doubles
 * consume: resolves an opaque recipient ref to that channel's endpoint
 * token, with REAL provider lifecycle semantics (endpoints expire —
 * web-push subscriptions return 410 Gone and must be re-subscribed).
 */
export interface RecipientEndpointDirectory {
  resolve(recipientRef: string): RecipientEndpoint | undefined;
}

/** One channel endpoint: an opaque token plus its lifecycle status. */
export interface RecipientEndpoint {
  /** Opaque endpoint token (SYNTH-marked in tests; a real push subscription / address pseudonym in production). */
  readonly token: string;
  /** `expired` endpoints are undeliverable (`recipient-endpoint-expired`). */
  readonly status: "active" | "expired";
}

/**
 * In-memory {@link RecipientEndpointDirectory} (the test double for the
 * provider-side address book).
 */
export class InMemoryRecipientEndpointDirectory implements RecipientEndpointDirectory {
  readonly #endpoints = new Map<string, RecipientEndpoint>();

  /** Registers (or replaces) the endpoint for a recipient ref. */
  register(recipientRef: string, endpoint: RecipientEndpoint): void {
    this.#endpoints.set(recipientRef, endpoint);
  }

  resolve(recipientRef: string): RecipientEndpoint | undefined {
    return this.#endpoints.get(recipientRef);
  }
}

/** Constructor deps for the SYNTH provider doubles (all injectable). */
export interface SyntheticProviderChannelDeps {
  readonly clock: Clock;
  /** The provider-side endpoint directory (recipient ref -> endpoint). */
  readonly endpoints: RecipientEndpointDirectory;
}

/**
 * SYNTH web-push provider double (`SYNTH-webpush-provider-v1`): resolves
 * the recipient's push endpoint through the injected directory and issues
 * a deterministic SYNTH receipt. Full capabilities (web push carries rich
 * payloads). NO network, NO SDK, NO VAPID — the real adapter arrives
 * behind the same `NotificationChannel` interface.
 */
export class SyntheticWebPushChannel implements NotificationChannel {
  readonly id: NotificationChannelId = "webpush-synth";
  readonly capabilities: ChannelCapabilities = FULL_CHANNEL_CAPABILITIES;
  readonly #clock: Clock;
  readonly #endpoints: RecipientEndpointDirectory;

  constructor(deps: SyntheticProviderChannelDeps) {
    this.#clock = deps.clock;
    this.#endpoints = deps.endpoints;
  }

  async send(delivery: OutboundDelivery): Promise<ChannelSendResult> {
    const endpoint = this.#endpoints.resolve(delivery.recipientRef);
    if (endpoint === undefined) {
      return { status: "undeliverable", reason: { kind: "unknown-recipient-endpoint" } };
    }
    if (endpoint.status === "expired") {
      return { status: "undeliverable", reason: { kind: "recipient-endpoint-expired" } };
    }
    return {
      status: "sent",
      deliveredAt: this.#clock.now(),
      providerReceipt: synthReceipt("SYNTH-webpush-provider-v1", delivery),
    };
  }
}

/**
 * SYNTH email provider double (`SYNTH-email-provider-v1`): the same
 * fail-closed contract through the email-address-token seam. Full
 * capabilities (email carries rich payloads). NO network, NO SMTP/SES.
 */
export class SyntheticEmailChannel implements NotificationChannel {
  readonly id: NotificationChannelId = "email-synth";
  readonly capabilities: ChannelCapabilities = FULL_CHANNEL_CAPABILITIES;
  readonly #clock: Clock;
  readonly #endpoints: RecipientEndpointDirectory;

  constructor(deps: SyntheticProviderChannelDeps) {
    this.#clock = deps.clock;
    this.#endpoints = deps.endpoints;
  }

  async send(delivery: OutboundDelivery): Promise<ChannelSendResult> {
    const endpoint = this.#endpoints.resolve(delivery.recipientRef);
    if (endpoint === undefined) {
      return { status: "undeliverable", reason: { kind: "unknown-recipient-endpoint" } };
    }
    if (endpoint.status === "expired") {
      return { status: "undeliverable", reason: { kind: "recipient-endpoint-expired" } };
    }
    return {
      status: "sent",
      deliveredAt: this.#clock.now(),
      providerReceipt: synthReceipt("SYNTH-email-provider-v1", delivery),
    };
  }
}

/**
 * Deterministic SYNTH provider receipt: a fixed provider marker plus a
 * stable hash over (provider id, reminder id, recipient ref). Same
 * delivery => same receipt, always (determinism proofs over channel
 * records). The receipt embeds NO payload content — only identity hashes.
 */
function synthReceipt(providerId: string, delivery: OutboundDelivery): string {
  return `${providerId}-${sha256Hex(`${providerId}|${delivery.reminderId}|${delivery.recipientRef}`).slice(0, 16)}`;
}
