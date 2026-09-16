// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  getConsentSettings,
  listConsentAudit,
  resetConsentSettingsStore,
  setAccessDefault,
  setNotificationChannel,
  setQuietHours,
  setSourceConsent,
} from "./store";

/**
 * Consent-settings store tests (M6-C B9): deny-by-default sources, the
 * never-silent audit trail, and the safest-option defaults.
 */
beforeEach(() => {
  resetConsentSettingsStore();
});

describe("defaults (safest option)", () => {
  it("starts with device sources OFF (deny-by-default) and manual ON", () => {
    const s = getConsentSettings();
    const healthkit = s.sources.find((x) => x.sourceId === "source-synth-healthkit");
    const manual = s.sources.find((x) => x.sourceId === "source-synth-manual");
    expect(healthkit?.enabled).toBe(false);
    expect(manual?.enabled).toBe(true);
  });

  it("starts with quiet hours ON and access default ask-every-time", () => {
    const s = getConsentSettings();
    expect(s.notifications.quietHours.enabled).toBe(true);
    expect(s.accessDefault).toBe("ask-every-time");
  });
});

describe("changes record to the audit trail (never silent)", () => {
  it("source toggles record", () => {
    expect(setSourceConsent("source-synth-healthkit", true)).toBe(true);
    const audit = listConsentAudit();
    expect(audit[0]?.summary).toContain("Apple Health (SYNTH HealthKit seam): enabled");
    expect(setSourceConsent("source-synth-nothing", true)).toBe(false);
  });

  it("channel + quiet-hours toggles record", () => {
    setNotificationChannel("channel-email", true);
    expect(listConsentAudit()[0]?.summary).toContain("Email (SYNTH seam): enabled");
    setQuietHours(false);
    expect(listConsentAudit()[0]?.summary).toContain("Quiet hours: disabled");
  });

  it("access-default changes record", () => {
    setAccessDefault("always-deny");
    expect(getConsentSettings().accessDefault).toBe("always-deny");
    expect(listConsentAudit()[0]?.summary).toContain("always denied");
  });

  it("audit records are newest-first with deterministic ids", () => {
    setSourceConsent("source-synth-healthkit", true);
    setSourceConsent("source-synth-healthkit", false);
    const audit = listConsentAudit();
    expect(audit[0]?.summary).toContain("disabled");
    expect(audit[1]?.summary).toContain("enabled");
    expect(audit[0]?.id).toBe("cst_SYNTH-0002");
  });
});
