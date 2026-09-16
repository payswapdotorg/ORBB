/**
 * Consent-settings model (M6-C B9, Lane B) — types + store.
 *
 * The settings surface aggregates the person's consent posture:
 *   - ACTIVE SHARES (from the B7 sharing store — read-only aggregation,
 *     changes happen in the Sharing section);
 *   - MEASUREMENT-SOURCE CONSENTS (the M4-C registered-source
 *     vocabulary — each source on/off, default OFF: deny-by-default
 *     mirrors the domain access evaluation);
 *   - NOTIFICATION PREFERENCES (mirroring the @orbb/notifications
 *     preference-profile SHAPE: channels + quiet hours — display + edit);
 *   - DATA-BOX ACCESS DEFAULTS (the posture for new share requests —
 *     default: ask every time).
 *
 * Every change is recorded with a local audit trail (typed store, SYNTH
 * fixtures) — settings changes never silently mutate.
 */

export interface SourceConsentState {
  readonly sourceId: string;
  readonly label: string;
  readonly enabled: boolean;
}

export interface NotificationPreferencesState {
  readonly channels: { readonly id: string; readonly label: string; readonly enabled: boolean }[];
  readonly quietHours: { readonly enabled: boolean; readonly start: string; readonly end: string };
}

export const ACCESS_DEFAULT_OPTIONS = ["ask-every-time", "always-deny"] as const;
export type AccessDefault = (typeof ACCESS_DEFAULT_OPTIONS)[number];

export interface ConsentSettingsState {
  readonly sources: readonly SourceConsentState[];
  readonly notifications: NotificationPreferencesState;
  readonly accessDefault: AccessDefault;
}

export interface ConsentSettingsAuditRecord {
  readonly id: string;
  readonly atIso: string;
  readonly summary: string;
}

interface Store {
  state: ConsentSettingsState;
  audit: ConsentSettingsAuditRecord[];
  counter: number;
}

const STATE: Store = {
  state: {
    sources: [
      { sourceId: "source-synth-healthkit", label: "Apple Health (SYNTH HealthKit seam)", enabled: false },
      { sourceId: "source-synth-healthconnect", label: "Health Connect (SYNTH seam)", enabled: false },
      { sourceId: "source-synth-manual", label: "Manual entry", enabled: true },
    ],
    notifications: {
      channels: [
        { id: "channel-inapp", label: "In-app reminders", enabled: true },
        { id: "channel-webpush", label: "Web push (SYNTH seam)", enabled: false },
        { id: "channel-email", label: "Email (SYNTH seam)", enabled: false },
      ],
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    },
    accessDefault: "ask-every-time",
  },
  audit: [],
  counter: 0,
};

function record(summary: string): void {
  STATE.counter += 1;
  STATE.audit.unshift({
    id: `cst_SYNTH-${String(STATE.counter).padStart(4, "0")}`,
    atIso: "2026-09-16T10:00:00.000Z",
    summary,
  });
}

export function getConsentSettings(): ConsentSettingsState {
  return STATE.state;
}

export function listConsentAudit(): readonly ConsentSettingsAuditRecord[] {
  return [...STATE.audit];
}

export function setSourceConsent(sourceId: string, enabled: boolean): boolean {
  const source = STATE.state.sources.find((s) => s.sourceId === sourceId);
  if (!source) return false;
  STATE.state = {
    ...STATE.state,
    sources: STATE.state.sources.map((s) =>
      s.sourceId === sourceId ? { ...s, enabled } : s,
    ),
  };
  record(`${source.label}: ${enabled ? "enabled" : "disabled"}`);
  return true;
}

export function setNotificationChannel(channelId: string, enabled: boolean): boolean {
  const channel = STATE.state.notifications.channels.find((c) => c.id === channelId);
  if (!channel) return false;
  STATE.state = {
    ...STATE.state,
    notifications: {
      ...STATE.state.notifications,
      channels: STATE.state.notifications.channels.map((c) =>
        c.id === channelId ? { ...c, enabled } : c,
      ),
    },
  };
  record(`${channel.label}: ${enabled ? "enabled" : "disabled"}`);
  return true;
}

export function setQuietHours(enabled: boolean): boolean {
  STATE.state = {
    ...STATE.state,
    notifications: { ...STATE.state.notifications, quietHours: { ...STATE.state.notifications.quietHours, enabled } },
  };
  record(`Quiet hours: ${enabled ? "enabled (22:00–07:00)" : "disabled"}`);
  return true;
}

export function setAccessDefault(next: AccessDefault): void {
  STATE.state = { ...STATE.state, accessDefault: next };
  record(`New share requests: ${next === "ask-every-time" ? "ask every time" : "always denied"}`);
}

export function resetConsentSettingsStore(): void {
  STATE.counter = 0;
  STATE.audit.length = 0;
  STATE.state = {
    sources: [
      { sourceId: "source-synth-healthkit", label: "Apple Health (SYNTH HealthKit seam)", enabled: false },
      { sourceId: "source-synth-healthconnect", label: "Health Connect (SYNTH seam)", enabled: false },
      { sourceId: "source-synth-manual", label: "Manual entry", enabled: true },
    ],
    notifications: {
      channels: [
        { id: "channel-inapp", label: "In-app reminders", enabled: true },
        { id: "channel-webpush", label: "Web push (SYNTH seam)", enabled: false },
        { id: "channel-email", label: "Email (SYNTH seam)", enabled: false },
      ],
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    },
    accessDefault: "ask-every-time",
  };
}
