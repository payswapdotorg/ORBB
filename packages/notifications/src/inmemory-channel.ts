/**
 * B8 — `InMemoryChannel`: the test/implementation-default delivery double.
 *
 * Records every send (with defensive payload copies), always delivers
 * unless explicitly programmed otherwise, and supports the two failure
 * modes the fail-closed proofs need: a classified undelivered result, or a
 * raw throw (which the ENGINE must convert into a recorded `channel-error`
 * outcome — never a crash). Time comes exclusively from the injected
 * `Clock` (the testkit `DeterministicClock` in tests); there is no
 * wall-clock access anywhere in this package.
 */
import type { PersonId } from "@orbb/domain";
import type { Clock } from "@orbb/testkit";
import type {
  ChannelCapabilityFlags,
  ChannelKind,
  DeliveryResult,
  DeliveryFailureReason,
  NotificationChannel,
  ChannelSendRequest,
} from "./channels.js";
import { cloneReminderPayload, type ReminderPayload, type ReminderRung } from "./payloads.js";
import type { ReminderId } from "./identity.js";

/** Programmable failure modes of the double. */
export type InMemoryChannelFailureMode =
  | { readonly kind: "none" }
  | { readonly kind: "fail"; readonly reason: DeliveryFailureReason; readonly detail?: string }
  | { readonly kind: "throw" };

/** One recorded send attempt observed by the double. */
export interface InMemorySentRecord {
  readonly reminderId: ReminderId;
  readonly personId: PersonId;
  readonly rung: ReminderRung;
  readonly payload: ReminderPayload;
  readonly sentAt: Date;
  readonly delivery: DeliveryResult;
}

/** Options for constructing an {@link InMemoryChannel}. */
export interface InMemoryChannelOptions {
  /** Channel id; default `"inapp-memory"`. */
  readonly id?: string;
  /** Channel kind; default `"inapp"`. */
  readonly kind?: ChannelKind;
  /** Capability overrides (both default to `true`). */
  readonly capabilities?: Partial<ChannelCapabilityFlags>;
  /** Injectable time source (required — no wall clock). */
  readonly clock: Clock;
}

/** The reference in-memory `NotificationChannel` double. */
export class InMemoryChannel implements NotificationChannel {
  readonly id: string;
  readonly kind: ChannelKind;
  readonly capabilities: ChannelCapabilityFlags;
  readonly #clock: Clock;
  readonly #sent: InMemorySentRecord[] = [];
  #failureMode: InMemoryChannelFailureMode = { kind: "none" };

  constructor(options: InMemoryChannelOptions) {
    this.id = options.id ?? "inapp-memory";
    this.kind = options.kind ?? "inapp";
    this.capabilities = {
      supportsRemind: options.capabilities?.supportsRemind ?? true,
      supportsFallbackOffer: options.capabilities?.supportsFallbackOffer ?? true,
    };
    this.#clock = options.clock;
  }

  /** Sets the programmable failure mode consumed by subsequent sends. */
  setFailureMode(mode: InMemoryChannelFailureMode): void {
    this.#failureMode = mode;
  }

  /** Number of send attempts observed so far. */
  get sentCount(): number {
    return this.#sent.length;
  }

  /** All observed sends, defensively copied. */
  getSent(): readonly InMemorySentRecord[] {
    return this.#sent.map(cloneSentRecord);
  }

  async sendReminder(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send("REMIND", request);
  }

  async sendFallbackOffer(request: ChannelSendRequest): Promise<DeliveryResult> {
    return this.#send("REMIND_WITH_FALLBACK_OFFER", request);
  }

  async #send(rung: ReminderRung, request: ChannelSendRequest): Promise<DeliveryResult> {
    const mode = this.#failureMode;
    if (mode.kind === "throw") {
      // The engine must convert this into a recorded channel-error outcome.
      throw new Error("SYNTH in-memory channel failure (programmed throw).");
    }
    const sentAt = this.#clock.now();
    let delivery: DeliveryResult;
    if (mode.kind === "fail") {
      delivery = {
        status: "undelivered",
        reason: mode.reason,
        ...(mode.detail !== undefined ? { detail: mode.detail } : {}),
      };
    } else {
      delivery = {
        status: "delivered",
        deliveredAt: new Date(sentAt.getTime()),
        providerReceipt: `synth:${this.id}:delivered`,
      };
    }
    this.#sent.push({
      reminderId: request.reminderId,
      personId: request.personId,
      rung,
      payload: cloneReminderPayload(request.payload),
      sentAt: new Date(sentAt.getTime()),
      delivery,
    });
    return delivery;
  }
}

/** Guards against a rogue caller mutating returned records. */
function cloneSentRecord(record: InMemorySentRecord): InMemorySentRecord {
  return {
    reminderId: record.reminderId,
    personId: record.personId,
    rung: record.rung,
    payload: cloneReminderPayload(record.payload),
    sentAt: new Date(record.sentAt.getTime()),
    delivery: cloneDelivery(record.delivery),
  };
}

function cloneDelivery(delivery: DeliveryResult): DeliveryResult {
  if (delivery.status === "delivered") {
    return {
      status: "delivered",
      deliveredAt: new Date(delivery.deliveredAt.getTime()),
      ...(delivery.providerReceipt !== undefined
        ? { providerReceipt: delivery.providerReceipt }
        : {}),
    };
  }
  return {
    status: "undelivered",
    reason: delivery.reason,
    ...(delivery.detail !== undefined ? { detail: delivery.detail } : {}),
  };
}
