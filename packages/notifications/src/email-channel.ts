/**
 * B8 — `EmailChannel`: SEAM-ONLY SYNTH double (the M4-C/M5-C pattern).
 *
 * Shapes the transactional-email provider contract without any network
 * call and without an email SDK:
 *
 *   - `EmailAddressProvider` is the provider port a real adapter
 *     (Resend/Postmark/SES over the person's verified contact record)
 *     will implement. The ENGINE never sees email addresses — resolution
 *     happens inside the provider adapter, by person id. The SYNTH
 *     provider resolves obviously-synthetic address tokens
 *     (`…@notifications.local`) per the agent-protocol test-data rule.
 *   - Fail-closed: an address lookup miss resolves to a TYPED
 *     `undelivered` outcome with reason `no-delivery-address` — never a
 *     throw, never a silent drop, and the address itself never surfaces in
 *     any engine output (delivery results carry only the SYNTH receipt).
 *
 * Capability model (recorded): email is a persistent, action-capable
 * channel — both rung flags are `true`.
 */
import type { PersonId } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import type {
  ChannelSendRequest,
  DeliveryResult,
  NotificationChannel,
} from "./channels.js";

/** Stable id of the SYNTH email channel double. */
export const SYNTH_EMAIL_CHANNEL_ID = "email";

/**
 * The email address-resolution port (the real adapter queries the person's
 * verified contact record). Returns the address token, or `undefined` when
 * no verified address exists.
 */
export interface EmailAddressProvider {
  resolveAddress(personId: PersonId): Promise<{ readonly addressToken: string } | undefined>;
}

/** Deterministic SYNTH receipt for the email double. */
const SYNTH_EMAIL_RECEIPT = "synth:email:delivered";

/** Seam-only SYNTH email channel double — no network, no SDK. */
export class EmailChannel implements NotificationChannel {
  readonly id = SYNTH_EMAIL_CHANNEL_ID;
  readonly kind = "email" as const;
  readonly capabilities = { supportsRemind: true, supportsFallbackOffer: true };
  readonly #addresses: EmailAddressProvider;
  readonly #clock: Clock;

  constructor(deps: { readonly addressProvider: EmailAddressProvider; readonly clock: Clock }) {
    this.#addresses = deps.addressProvider;
    this.#clock = deps.clock;
  }

  async sendReminder(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send(request);
  }

  async sendFallbackOffer(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send(request);
  }

  async #send(request: ChannelSendRequest): Promise<DeliveryResult> {
    const address = await this.#addresses.resolveAddress(request.personId);
    if (address === undefined) {
      return {
        status: "undelivered",
        reason: "no-delivery-address",
        detail: "synth-email-no-address",
      };
    }
    return {
      status: "delivered",
      deliveredAt: new Date(this.#clock.now().getTime()),
      providerReceipt: SYNTH_EMAIL_RECEIPT,
    };
  }
}
