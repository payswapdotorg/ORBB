"use client";

/**
 * Consent-settings workspace (M6-C B9, Lane B): the dedicated settings
 * surface aggregating the person's consent posture. Every control
 * states its consequence in plain language; defaults are the SAFEST
 * option; changes record to the local audit trail (never silent).
 */

import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Heading, Text } from "@orbb/ui";
import {
  getConsentSettings,
  listConsentAudit,
  setAccessDefault,
  setNotificationChannel,
  setQuietHours,
  setSourceConsent,
  type ConsentSettingsAuditRecord,
  type ConsentSettingsState,
} from "@/lib/consent-settings/store";
import { listActiveShares } from "@/lib/sharing/store";
import { seedSharingFixtures } from "@/lib/sharing/fixtures";
import { resetSharingStore } from "@/lib/sharing/store";

let SEEDED = false;

export function ConsentSettingsWorkspace() {
  const [state, setState] = useState<ConsentSettingsState | null>(null);
  const [audit, setAudit] = useState<readonly ConsentSettingsAuditRecord[]>([]);
  const [activeShareCount, setActiveShareCount] = useState(0);

  useEffect(() => {
    if (!SEEDED) {
      resetSharingStore(seedSharingFixtures);
      SEEDED = true;
    }
    setState(getConsentSettings());
    setAudit(listConsentAudit());
    setActiveShareCount(listActiveShares().length);
  }, []);

  if (!state) return null;

  const refresh = () => {
    setState(getConsentSettings());
    setAudit(listConsentAudit());
  };

  return (
    <div data-testid="consent-settings" className="space-y-4">
      <Card>
        <Heading level={1}>Consent settings</Heading>
        <Text variant="muted">
          Your consent posture: what you share, which sources may record, how you are reminded —
          and what happens by default.
        </Text>
        <p aria-live="polite" className="sr-only">
          Consent settings loaded.
        </p>
      </Card>

      <Card>
        <Heading level={2}>Active shares</Heading>
        <Text variant="muted">
          You have {activeShareCount} active share{activeShareCount === 1 ? "" : "s"}. Review and
          revoke them in the DataBox Sharing section — changes happen there, never silently here.
        </Text>
      </Card>

      <Card>
        <Heading level={2}>Measurement sources</Heading>
        <Text variant="muted">
          Each source may record measurements only when you enable it. New sources start OFF —
          nothing records by default.
        </Text>
        <ul className="mt-3 space-y-2">
          {state.sources.map((source) => (
            <li key={source.sourceId} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>
                <Text>{source.label}</Text>
                <Text variant="muted">
                  {source.enabled ? "May record measurements" : "May not record — deny by default"}
                </Text>
              </span>
              <Checkbox
                label={source.enabled ? `Disable ${source.label}` : `Enable ${source.label}`}
                checked={source.enabled}
                onChange={() => {
                  setSourceConsent(source.sourceId, !source.enabled);
                  refresh();
                }}
                aria-label={`${source.label} ${source.enabled ? "disable" : "enable"}`}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Heading level={2}>Notifications</Heading>
        <Text variant="muted">
          Reminders nudge — they never punish. Quiet hours defer reminders to the window edge,
          never drop them.
        </Text>
        <ul className="mt-3 space-y-2">
          {state.notifications.channels.map((channel) => (
            <li key={channel.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>
                <Text>{channel.label}</Text>
                <Text variant="muted">
                  {channel.enabled ? "Reminders delivered" : "Reminders not delivered"}
                </Text>
              </span>
              <Checkbox
                label={channel.enabled ? `Disable ${channel.label}` : `Enable ${channel.label}`}
                checked={channel.enabled}
                onChange={() => {
                  setNotificationChannel(channel.id, !channel.enabled);
                  refresh();
                }}
                aria-label={`${channel.label} ${channel.enabled ? "disable" : "enable"}`}
              />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <span>
            <Text>Quiet hours (22:00–07:00)</Text>
            <Text variant="muted">
              {state.notifications.quietHours.enabled
                ? "Reminders inside the window are deferred to 07:00"
                : "Reminders may arrive at any hour"}
            </Text>
          </span>
          <Checkbox
            label={state.notifications.quietHours.enabled ? "Turn quiet hours off" : "Turn quiet hours on"}
            checked={state.notifications.quietHours.enabled}
            onChange={() => {
              setQuietHours(!state.notifications.quietHours.enabled);
              refresh();
            }}
            aria-label="Toggle quiet hours"
          />
        </div>
      </Card>

      <Card>
        <Heading level={2}>New share requests</Heading>
        <Text variant="muted">
          What happens when someone requests access to your data.
        </Text>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={state.accessDefault === "ask-every-time" ? "primary" : "secondary"}
            onClick={() => {
              setAccessDefault("ask-every-time");
              refresh();
            }}
            aria-label="Ask every time a share is requested"
          >
            Ask every time (safest)
          </Button>
          <Button
            variant={state.accessDefault === "always-deny" ? "primary" : "secondary"}
            onClick={() => {
              setAccessDefault("always-deny");
              refresh();
            }}
            aria-label="Always deny new share requests"
          >
            Always deny
          </Button>
        </div>
      </Card>

      <Card>
        <Heading level={2}>Change history</Heading>
        <Text variant="muted">
          Every consent change is recorded — settings never change silently.
        </Text>
        {audit.length === 0 ? (
          <Text variant="muted">
            No changes yet in this session.
          </Text>
        ) : (
          <ol className="mt-3 space-y-2" data-testid="consent-audit">
            {audit.map((record) => (
              <li key={record.id} className="rounded-md border border-border p-2">
                <Text variant="small">{record.summary}</Text>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
