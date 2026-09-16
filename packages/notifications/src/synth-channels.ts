/**
 * Seam-only SYNTH channel doubles: `WebPushChannel` and `EmailChannel`
 * (the M4-C/M5-C seam pattern — HealthKit/HealthConnect precedent).
 *
 * Each channel implements the B8 `NotificationChannel` contract over a
 * PROVIDER PORT interface (`WebPushProvider` / `EmailProvider`) that
 * mirrors the real provider surface in TypeScript WITHOUT importing any
 * provider SDK and WITHOUT any network call. The real native/HTTP
 * bindings land in a later integration packet (handoff recorded in the
 * README); wiring one in is implementing the port, nothing else changes.
 *
 * Recipient handling: the engine passes an opaque recipient REFERENCE
 * (`ChannelRecipient`); the provider binding resolves it to a real
 * subscription/_address INSIDE the provider seam. The engine never sees
 * a raw address (PHI discipline).
 *
 * Copy discipline: the SYNTH renderers fill only fixed, non-authoritative
 * template slots with payload ids and caller-vetted labels — the engine
 * and the doubles never generate clinical, punitive, or gamified
 * language, and never include person-identifying free text. Real copy
 * and i18n belong to the app layer.
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
  type ProviderDeliveryReport,
} from "./channels.js";
import type { ReminderPayload } from "./reminder.js";

// ---------------------------------------------------------------------------
// Shared wiring for seam channels.
// ---------------------------------------------------------------------------

/** Scripted behavior of a SYNTH provider double. */
export type SynthProviderBehavior = "deliver" | "fail" | "throw";

/** Options shared by the SYNTH providers. */
export interface SynthProviderOptions {
  readonly behavior?: SynthProviderBehavior;
  readonly failureReason?: ChannelFailureReason;
}

function reportFor(
  behavior: SynthProviderBehavior,
  failureReason: ChannelFailureReason,
): ProviderDeliveryReport {
  if (behavior === "deliver") {
    return { status: "delivered" };
  }
  return { status: "failed", reason: { kind: failureReason.kind } };
}

function outcomeFromReport(
  report: ProviderDeliveryReport,
  clock: Clock,
): ChannelDeliveryOutcome {
  if (report.status === "delivered") {
    return { status: "delivered", deliveredAt: clock.now() };
  }
  return { status: report.status, reason: { kind: report.reason.kind } };
}

/** Options for constructing a seam channel. */
export interface SeamChannelOptions {
  readonly id?: string;
  readonly capabilities?: ChannelCapabilities;
  readonly clock?: Clock;
}

// ---------------------------------------------------------------------------
// Web push seam.
// ---------------------------------------------------------------------------

/**
 * A web-push notification as the provider port sees it. `tag` carries the
 * reminder id so the OS collapses duplicates (realistic provider shape);
 * `data` carries the PHID-safe payload for deep-link rendering in the app.
 */
export interface WebPushNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly data: ReminderPayload;
}

/**
 * The web-push provider port: the contract a real Web Push binding
 * (VAPID over the Push API, or a platform bridge) implements. Structural
 * only — no SDK types.
 */
export interface WebPushProvider {
  deliver(
    subscriptionRef: string,
    notification: WebPushNotification,
  ): Promise<ProviderDeliveryReport>;
}

/** One recorded SYNTH web-push delivery. */
export interface RecordedWebPushDelivery {
  readonly subscriptionRef: string;
  readonly notification: WebPushNotification;
  readonly report: ProviderDeliveryReport;
}

/**
 * SYNTHETIC web-push provider double: records deliveries, returns
 * deterministic reports, never touches the network.
 */
export class SyntheticWebPushProvider implements WebPushProvider {
  readonly #behavior: SynthProviderBehavior;
  readonly #failureReason: ChannelFailureReason;
  readonly #recorded: RecordedWebPushDelivery[] = [];

  constructor(options?: SynthProviderOptions) {
    this.#behavior = options?.behavior ?? "deliver";
    this.#failureReason = options?.failureReason ?? { kind: "provider-error" };
  }

  /** Every delivery this double has seen, in order. */
  get deliveries(): readonly RecordedWebPushDelivery[] {
    return this.#recorded.map((entry) => ({ ...entry }));
  }

  get deliveryCount(): number {
    return this.#recorded.length;
  }

  async deliver(
    subscriptionRef: string,
    notification: WebPushNotification,
  ): Promise<ProviderDeliveryReport> {
    if (this.#behavior === "throw") {
      throw new Error("SyntheticWebPushProvider scripted throw (SYNTH).");
    }
    const report = reportFor(this.#behavior, this.#failureReason);
    this.#recorded.push({ subscriptionRef, notification, report });
    return report;
  }
}

/** Options for constructing a {@link WebPushChannel}. */
export interface WebPushChannelOptions extends SeamChannelOptions {
  readonly provider?: WebPushProvider;
}

/**
 * Renders the PHID-safe web-push notification for a send request. Pure;
 * copy slots are fixed non-authoritative templates over ids/labels.
 */
export function renderWebPushNotification(request: ChannelSendRequest): WebPushNotification {
  const metricText = request.payload.metricLabel ?? request.payload.metricId;
  return {
    title: "Measurement reminder",
    body:
      request.payload.kind === "remind"
        ? metricText
        : `${metricText} — alternative capture paths available`,
    tag: request.reminderId,
    data: request.payload,
  };
}

/**
 * Seam-only SYNTH `NotificationChannel` over a `WebPushProvider` port.
 * Default provider: `SyntheticWebPushProvider` (no network).
 */
export class WebPushChannel implements NotificationChannel {
  readonly id: string;
  readonly capabilities: ChannelCapabilities;
  readonly #provider: WebPushProvider;
  readonly #clock: Clock;

  constructor(options?: WebPushChannelOptions) {
    this.id = options?.id ?? "web-push";
    this.capabilities = options?.capabilities ?? ALL_CHANNEL_CAPABILITIES;
    this.#provider = options?.provider ?? new SyntheticWebPushProvider();
    this.#clock = options?.clock ?? new DeterministicClock();
  }

  /** The injected provider (the SYNTH double unless wired otherwise). */
  get provider(): WebPushProvider {
    return this.#provider;
  }

  async send(request: ChannelSendRequest): Promise<ChannelDeliveryOutcome> {
    const notification = renderWebPushNotification(request);
    // A throwing provider propagates; the ENGINE fail-closes (records
    // `channel-errored`). The channel itself stays a pure adapter.
    const report = await this.#provider.deliver(request.recipient, notification);
    return outcomeFromReport(report, this.#clock);
  }
}

// ---------------------------------------------------------------------------
// Email seam.
// ---------------------------------------------------------------------------

/**
 * An email message as the provider port sees it: a non-authoritative
 * subject, a deterministic plain-text body over ids/labels only, and the
 * structured payload for app-layer rendering.
 */
export interface EmailMessage {
  readonly subject: string;
  readonly bodyText: string;
  readonly data: ReminderPayload;
}

/**
 * The email provider port: the contract a real email binding (provider
 * API or relay) implements. Structural only — no SDK types.
 */
export interface EmailProvider {
  deliver(addressRef: string, message: EmailMessage): Promise<ProviderDeliveryReport>;
}

/** One recorded SYNTH email delivery. */
export interface RecordedEmailDelivery {
  readonly addressRef: string;
  readonly message: EmailMessage;
  readonly report: ProviderDeliveryReport;
}

/** SYNTHETIC email provider double: records deliveries, deterministic reports. */
export class SyntheticEmailProvider implements EmailProvider {
  readonly #behavior: SynthProviderBehavior;
  readonly #failureReason: ChannelFailureReason;
  readonly #recorded: RecordedEmailDelivery[] = [];

  constructor(options?: SynthProviderOptions) {
    this.#behavior = options?.behavior ?? "deliver";
    this.#failureReason = options?.failureReason ?? { kind: "provider-error" };
  }

  /** Every delivery this double has seen, in order. */
  get deliveries(): readonly RecordedEmailDelivery[] {
    return this.#recorded.map((entry) => ({ ...entry }));
  }

  get deliveryCount(): number {
    return this.#recorded.length;
  }

  async deliver(addressRef: string, message: EmailMessage): Promise<ProviderDeliveryReport> {
    if (this.#behavior === "throw") {
      throw new Error("SyntheticEmailProvider scripted throw (SYNTH).");
    }
    const report = reportFor(this.#behavior, this.#failureReason);
    this.#recorded.push({ addressRef, message, report });
    return report;
  }
}

/** Options for constructing an {@link EmailChannel}. */
export interface EmailChannelOptions extends SeamChannelOptions {
  readonly provider?: EmailProvider;
}

/**
 * Renders the PHID-safe email message for a send request. Pure;
 * deterministic lines over ids/labels — no free text generation.
 */
export function renderEmailMessage(request: ChannelSendRequest): EmailMessage {
  const payload = request.payload;
  const metricText = payload.metricLabel ?? payload.metricId;
  const lines = [
    `Metric: ${metricText}`,
    `Window: ${payload.windowOpensAt.toISOString()} - ${payload.windowClosesAt.toISOString()}`,
  ];
  if (payload.kind === "remind-with-fallback-offer") {
    const preferred =
      payload.preferredMethodLabel ?? payload.preferredMethodId ?? "unspecified";
    lines.push(`Preferred capture path: ${preferred}`);
    const fallbacks = payload.fallbackMethods
      .map((offer) => offer.label ?? offer.methodId)
      .join(", ");
    lines.push(`Alternative capture paths offered: ${fallbacks}`);
  }
  return {
    subject: "Measurement reminder",
    bodyText: lines.join("\n"),
    data: payload,
  };
}

/**
 * Seam-only SYNTH `NotificationChannel` over an `EmailProvider` port.
 * Default provider: `SyntheticEmailProvider` (no network).
 */
export class EmailChannel implements NotificationChannel {
  readonly id: string;
  readonly capabilities: ChannelCapabilities;
  readonly #provider: EmailProvider;
  readonly #clock: Clock;

  constructor(options?: EmailChannelOptions) {
    this.id = options?.id ?? "email";
    this.capabilities = options?.capabilities ?? ALL_CHANNEL_CAPABILITIES;
    this.#provider = options?.provider ?? new SyntheticEmailProvider();
    this.#clock = options?.clock ?? new DeterministicClock();
  }

  /** The injected provider (the SYNTH double unless wired otherwise). */
  get provider(): EmailProvider {
    return this.#provider;
  }

  async send(request: ChannelSendRequest): Promise<ChannelDeliveryOutcome> {
    const message = renderEmailMessage(request);
    const report = await this.#provider.deliver(request.recipient, message);
    return outcomeFromReport(report, this.#clock);
  }
}
