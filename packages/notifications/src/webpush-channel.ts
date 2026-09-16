/**
 * B8 — `WebPushChannel`: SEAM-ONLY SYNTH double (the M4-C/M5-C pattern).
 *
 * This double shapes the Web Push provider contract for a later
 * integration packet WITHOUT any network call and WITHOUT a push SDK:
 *
 *   - `WebPushSubscriptionProvider` is the provider port a real adapter
 *     (web-push library over VAPID keys, Cloudflare-proxied endpoint
 *     tokens) will implement. The ENGINE never sees endpoint tokens —
 *     address resolution happens inside the provider adapter, by person id
 *     (the routing plane / payload plane separation in `channels.ts`).
 *   - Fail-closed: a subscription lookup miss resolves to a TYPED
 *     `undelivered` outcome with reason `no-delivery-address` — never a
 *     throw, never a silent drop.
 *   - The provider receipt is a deterministic SYNTH token; no provider
 *     round-trip exists in this package.
 *
 * Capability model (recorded): web push payloads can carry both rungs
 * (action-capable data payloads), so both flags are `true`. Channels that
 * cannot carry a rung declare so and the engine skips them with an
 * accounted reason.
 */
import type { PersonId } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import type {
  ChannelSendRequest,
  DeliveryResult,
  NotificationChannel,
} from "./channels.js";

/** Stable id of the SYNTH web-push channel double. */
export const SYNTH_WEB_PUSH_CHANNEL_ID = "webpush";

/**
 * The Web Push subscription-resolution port (the real adapter queries the
 * subscription store by person id). Returns the endpoint token bundle, or
 * `undefined` when the person has no active subscription.
 */
export interface WebPushSubscriptionProvider {
  resolveSubscription(
    personId: PersonId,
  ): Promise<{ readonly endpointToken: string } | undefined>;
}

/** Deterministic SYNTH receipt for the web-push double. */
const SYNTH_WEB_PUSH_RECEIPT = "synth:webpush:delivered";

/** Seam-only SYNTH Web Push channel double — no network, no SDK. */
export class WebPushChannel implements NotificationChannel {
  readonly id = SYNTH_WEB_PUSH_CHANNEL_ID;
  readonly kind = "push" as const;
  readonly capabilities = { supportsRemind: true, supportsFallbackOffer: true };
  readonly #subscriptions: WebPushSubscriptionProvider;
  readonly #clock: Clock;

  constructor(deps: { readonly subscriptionProvider: WebPushSubscriptionProvider; readonly clock: Clock }) {
    this.#subscriptions = deps.subscriptionProvider;
    this.#clock = deps.clock;
  }

  async sendReminder(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send(request);
  }

  async sendFallbackOffer(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send(request);
  }

  async #send(request: ChannelSendRequest): Promise<DeliveryResult> {
    const subscription = await this.#subscriptions.resolveSubscription(request.personId);
    if (subscription === undefined) {
      return {
        status: "undelivered",
        reason: "no-delivery-address",
        detail: "synth-webpush-no-subscription",
      };
    }
    return {
      status: "delivered",
      deliveredAt: new Date(this.#clock.now().getTime()),
      providerReceipt: SYNTH_WEB_PUSH_RECEIPT,
    };
  }
}
