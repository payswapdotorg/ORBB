/**
 * `InMemoryChannel` — the test/impl default `NotificationChannel` double.
 *
 * Records every send request verbatim (defensive copies both ways) and
 * returns deterministic outcomes. Scriptable for fail-closed proofs:
 * `behavior: "fail"` returns a typed failure, `behavior: "throw"`
 * simulates a contract-violating channel so tests can prove the engine
 * survives and records `channel-errored`. Capabilities are configurable
 * so capability-gating proofs need no extra doubles.
 */
import type { Clock } from "@orbb/testkit";
import { DeterministicClock } from "@orbb/testkit";
import {
  ALL_CHANNEL_CAPABILITIES,
  type ChannelCapabilities,
  type ChannelDeliveryOutcome,
  type ChannelFailureReason,
  type ChannelSendRequest,
  type NotificationChannel,
} from "./channels.js";
import { cloneReminderPayload } from "./reminder.js";

/** Scripted behavior of the double. */
export type InMemoryChannelBehavior = "deliver" | "fail" | "throw";

/** Options for constructing an {@link InMemoryChannel}. */
export interface InMemoryChannelOptions {
  /** Registry id. Default `"in-memory"`. */
  readonly id?: string;
  /** Capability flags. Default: carries every rung. */
  readonly capabilities?: ChannelCapabilities;
  /** Scripted behavior. Default `"deliver"`. */
  readonly behavior?: InMemoryChannelBehavior;
  /** Typed failure reason used when `behavior` is `"fail"`. Default `provider-error`. */
  readonly failureReason?: ChannelFailureReason;
  /** Clock used for `deliveredAt` stamps. Default: a fresh epoch-0 `DeterministicClock`. */
  readonly clock?: Clock;
}

/** One recorded send (request + the outcome the double returned). */
export interface RecordedChannelSend {
  readonly request: ChannelSendRequest;
  readonly outcome: ChannelDeliveryOutcome;
}

function cloneRequest(request: ChannelSendRequest): ChannelSendRequest {
  return {
    reminderId: request.reminderId,
    recipient: request.recipient,
    payload: cloneReminderPayload(request.payload),
    sendAt: new Date(request.sendAt.getTime()),
  };
}

function cloneOutcome(outcome: ChannelDeliveryOutcome): ChannelDeliveryOutcome {
  if (outcome.status === "delivered") {
    return { status: "delivered", deliveredAt: new Date(outcome.deliveredAt.getTime()) };
  }
  return { status: outcome.status, reason: { kind: outcome.reason.kind } };
}

/** In-memory `NotificationChannel` double (defensive copies in and out). */
export class InMemoryChannel implements NotificationChannel {
  readonly id: string;
  readonly capabilities: ChannelCapabilities;
  readonly #behavior: InMemoryChannelBehavior;
  readonly #failureReason: ChannelFailureReason;
  readonly #clock: Clock;
  readonly #recorded: RecordedChannelSend[] = [];

  constructor(options?: InMemoryChannelOptions) {
    this.id = options?.id ?? "in-memory";
    this.capabilities = options?.capabilities ?? ALL_CHANNEL_CAPABILITIES;
    this.#behavior = options?.behavior ?? "deliver";
    this.#failureReason = options?.failureReason ?? { kind: "provider-error" };
    this.#clock = options?.clock ?? new DeterministicClock();
  }

  /** Every send this double has seen, in order (defensive copies). */
  get sent(): readonly RecordedChannelSend[] {
    return this.#recorded.map(({ request, outcome }) => ({
      request: cloneRequest(request),
      outcome: cloneOutcome(outcome),
    }));
  }

  /** Number of sends recorded so far. */
  get sendCount(): number {
    return this.#recorded.length;
  }

  /** Clears the recorded sends (test reset). */
  reset(): void {
    this.#recorded.length = 0;
  }

  async send(request: ChannelSendRequest): Promise<ChannelDeliveryOutcome> {
    if (this.#behavior === "throw") {
      throw new Error("InMemoryChannel scripted throw (SYNTH — contract-violating channel).");
    }
    const outcome: ChannelDeliveryOutcome =
      this.#behavior === "fail"
        ? { status: "failed", reason: { kind: this.#failureReason.kind } }
        : { status: "delivered", deliveredAt: this.#clock.now() };
    this.#recorded.push({ request: cloneRequest(request), outcome: cloneOutcome(outcome) });
    return cloneOutcome(outcome);
  }
}
