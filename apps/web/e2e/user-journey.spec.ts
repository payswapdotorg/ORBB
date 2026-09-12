import { expect, test } from "@playwright/test";

/**
 * User-mode journeys (web shell): the DataBox journey (M3-B) plus the
 * manual measurement capture journey (M4-B).
 *
 * Covers, per the packets:
 * 1. the evidence journey — sortable table columns, per-row disclosure
 *    metadata, the timeline view toggle, and the aria-live announcements
 *    of surface/view + role-emphasis changes;
 * 2. the consent-sheet open/confirm/revoke flow (visible feedback + focus
 *    behavior: focus moves into the modal, is trapped, and returns to the
 *    trigger on close);
 * 3. the MANUAL CAPTURE journey — the full M4-B flow: pick metric (seeded
 *    synthetic catalog) -> pick method (manual-only) -> enter values +
 *    context -> review with quality self-assessment -> submit to the
 *    in-memory-store route -> visible success with provenance actor +
 *    method + recorded quality -> the capture history with
 *    method/quality/provenance badges in both list and timeline views.
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */

test("evidence journey: sortable table, disclosure metadata, timeline view, emphasis announcements", async ({
  page,
}) => {
  await page.goto("/databox");

  // The evidence table mounts with a caption and 8 synthetic rows.
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(
    page.getByText("Synthetic evidence captured into your DataBox — no real records."),
  ).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(9); // header + 8 body rows

  // Sortable captured column cycles none → ascending → descending.
  const capturedHeader = page.getByRole("columnheader", { name: /captured/i });
  await expect(capturedHeader).toHaveAttribute("aria-sort", "none");
  await capturedHeader.getByRole("button", { name: /captured/i }).click();
  await expect(capturedHeader).toHaveAttribute("aria-sort", "ascending");
  await capturedHeader.getByRole("button", { name: /captured/i }).click();
  await expect(capturedHeader).toHaveAttribute("aria-sort", "descending");

  // Sorting by media type works too (the pure library sort transition).
  const mediaHeader = page.getByRole("columnheader", { name: /media type/i });
  await mediaHeader.getByRole("button", { name: /media type/i }).click();
  await expect(mediaHeader).toHaveAttribute("aria-sort", "ascending");

  // Per-row disclosure reveals the evidence metadata details.
  const metadataToggle = page.getByRole("button", {
    name: "Metadata: SYNTH-EV-0001",
  });
  await expect(metadataToggle).toHaveAttribute("aria-expanded", "false");
  await metadataToggle.click();
  await expect(metadataToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Checksum prefix")).toBeVisible();
  await expect(page.getByText("sha256-SYNTH-7c4a8d09")).toBeVisible();
  await expect(page.getByText("Retention class")).toBeVisible();
  await expect(page.getByText("SYNTH-RT-2Y")).toBeVisible();
  await expect(page.getByText("Provenance actor", { exact: true })).toBeVisible();

  // Switch to the timeline view: the table leaves the DOM, day-grouped
  // timeline entries render, and the view change is announced politely.
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(table).toHaveCount(0);
  await expect(page.getByText("Showing the evidence timeline.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Evidence list", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await expect(page.getByText("Resting heart rate 62 beats/min")).toBeVisible();
  await expect(page.getByText("Validated", { exact: true }).first()).toBeVisible();

  // Switching back re-mounts the list view (announced politely).
  await page.getByRole("button", { name: "Evidence list", exact: true }).click();
  await expect(table).toBeVisible();
  await expect(page.getByText("Showing the evidence list.")).toBeVisible();

  // Role/emphasis integration: switching to Clinician emphasizes the
  // DataBox surface (existing emphasis model) and fires the polite
  // announcement; the nav emphasis changes with it.
  await page.getByRole("radio", { name: "Clinician" }).check();
  await expect(
    page.getByText("DataBox is emphasized for the Clinician role."),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).locator('[data-emphasized="true"]'),
  ).toHaveCount(3);
});

test("consent journey: share with clinician — open, confirm, revoke with focus behavior", async ({
  page,
}) => {
  await page.goto("/databox");

  // The share starts pending.
  await expect(page.getByText(/Not shared with SYNTH-Clinic-A yet\./)).toBeVisible();

  // Open the consent sheet from the trigger; the modal takes focus.
  const trigger = page.getByRole("button", { name: "Share with clinician" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Share with clinician" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  // Purpose, scope and expiry render with the i18n-overridden labels.
  await expect(dialog.getByText("Why this is requested")).toBeVisible();
  await expect(
    dialog.getByText(/SYNTH-Clinic-A requested read access/),
  ).toBeVisible();
  await expect(dialog.getByText("Exactly what is shared")).toBeVisible();
  await expect(
    dialog.getByText("Resting heart rate observations (read-only)"),
  ).toBeVisible();
  await expect(dialog.getByText("Sharing ends")).toBeVisible();
  await expect(dialog.getByText("Dec 31, 2026")).toBeVisible();

  // Focus trap: Tab from the last focusable (confirm) wraps to the first
  // (close button) — the sheet's own WAI-ARIA dialog behavior.
  await dialog.getByRole("button", { name: "Grant access" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close request" })).toBeFocused();

  // Confirm: the sheet closes, focus returns to the trigger (now relabeled
  // "Review share"), and the grant becomes active with visible feedback.
  await dialog.getByRole("button", { name: "Grant access" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review share" })).toBeFocused();
  await expect(
    page.getByText("Shared with SYNTH-Clinic-A until Dec 31, 2026."),
  ).toBeVisible();
  await expect(page.getByText("Active share")).toBeVisible();
  await expect(
    page.getByText(/Share confirmed: SYNTH-Clinic-A can read the scoped data/),
  ).toBeVisible();

  // Escape dismisses without deciding: re-open, then Escape closes and
  // returns focus without changing the grant.
  await page.getByRole("button", { name: "Review share" }).click();
  await expect(page.getByRole("dialog", { name: "Share with clinician" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Share with clinician" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review share" })).toBeFocused();
  await expect(
    page.getByText("Shared with SYNTH-Clinic-A until Dec 31, 2026."),
  ).toBeVisible();

  // Revoke through the sheet: access ends with visible feedback.
  await page.getByRole("button", { name: "Review share" }).click();
  await page
    .getByRole("dialog", { name: "Share with clinician" })
    .getByRole("button", { name: "Revoke access" })
    .click();
  await expect(page.getByRole("dialog", { name: "Share with clinician" })).toHaveCount(0);
  await expect(
    page.getByText(/Access for SYNTH-Clinic-A was revoked\./),
  ).toBeVisible();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share again" })).toBeVisible();
});

test("capture journey: record a manual measurement — metric, method, values, review, submit, history with badges", async ({
  page,
}) => {
  await page.goto("/measurements");

  // Summary card mounts the charts as named images (accessible summaries).
  await expect(
    page.getByRole("heading", { level: 1, name: "Measurements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Measurement summary" }),
  ).toBeVisible();
  const sparkline = page.getByRole("img", {
    name: /resting heart rate across the last 10 synthetic readings/i,
  });
  await expect(sparkline).toBeVisible();
  const barChart = page.getByRole("img", {
    name: /synthetic measurement counts by day of week/i,
  });
  await expect(barChart).toBeVisible();
  await expect(page.getByText(/20 synthetic captures this week\./)).toBeVisible();

  // The capture flow starts at step 1: the metric picker over the seeded
  // synthetic catalog.
  await expect(
    page.getByRole("heading", { level: 2, name: "Record a measurement" }),
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 3 — choose what you measured")).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: /what did you measure\?/i }),
  ).toBeVisible();

  // 1. Continuing without a metric choice is blocked with a field error.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Choose what you measured to continue."),
  ).toBeVisible();

  // 2. Pick the compound metric (blood pressure panel) and continue.
  // The native radio is visually clipped (library contract), so the
  // visible option label is the click target.
  await page
    .getByRole("radiogroup", { name: /what did you measure\?/i })
    .getByText("Blood pressure", { exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: /blood pressure/i }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 3 — method, values, and context")).toBeVisible();

  // The method picker shows the single enabled manual option plus the
  // disabled future device/app routes (least-burden landscape, not choosable).
  const manualMethod = page.getByRole("radio", {
    name: /manual entry — home bp cuff reading/i,
  });
  await expect(manualMethod).toBeEnabled();
  await expect(
    page.getByRole("radio", { name: /automatic cuff sync/i }),
  ).toBeDisabled();

  // 3. Step-2 validation: no method and no values yet -> both errors.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Choose a capture method to continue."),
  ).toBeVisible();
  await expect(
    page.getByText("Enter a value before continuing."),
  ).toHaveCount(2);

  // 4. Library guard semantics: out-of-range commits clamp on blur.
  const systolic = page.getByLabel(/systolic \(blood pressure systolic\)/i);
  await systolic.fill("350");
  await systolic.blur();
  await expect(systolic).toHaveValue("300");

  // 5. Fill the compound values, pick the manual method, check the
  //    default capture time (now, editable), add notes, continue.
  await systolic.fill("118");
  await page.getByLabel(/diastolic \(blood pressure diastolic\)/i).fill("76");
  await page.getByText("Manual entry — home BP cuff reading", { exact: true }).click();
  await expect(manualMethod).toBeChecked();
  const timeInput = page.getByLabel(/capture time/i);
  await expect(timeInput).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  await page.getByLabel(/notes \(optional\)/i).fill("Morning reading");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 3 of 3 — review and save")).toBeVisible();

  // 6. The review step summarizes values, the method actually used, and
  //    carries the quality self-assessment control.
  await expect(page.getByRole("heading", { level: 3, name: "Review" })).toBeVisible();
  await expect(
    page.getByText(/Systolic: 118 mmHg · Diastolic: 76 mmHg/),
  ).toBeVisible();
  await expect(
    page.getByText(
      /per-observation methods: SYNTH-method-bpsys-manual, SYNTH-method-bpdia-manual/,
    ),
  ).toBeVisible();

  // 7. Submitting without a self-assessment is blocked (quality is a
  //    first-class, explicit decision — never defaulted).
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(
    page.getByText("Choose a quality self-assessment before saving."),
  ).toBeVisible();

  // 8. Self-assess as PARTIAL and submit — the submission lands recorded
  //    as partial, never silently upgraded.
  await page
    .getByRole("radiogroup", { name: /quality self-assessment/i })
    .getByText("Partial", { exact: true })
    .click();
  await expect(page.getByRole("radio", { name: /^partial/i })).toBeChecked();
  await page.getByRole("button", { name: "Save measurement" }).click();

  // 9. Success feedback lists the new observations with the provenance
  //    actor (the person — self-tracking) and the method actually used.
  //    Scoped to the recorded region so history rows never collide.
  const recorded = page.locator('[data-capture-recorded="true"]');
  await expect(recorded.getByText("Measurement saved.", { exact: true })).toBeVisible();
  await expect(
    recorded.getByText(/Blood pressure 118\/76 mmHg — via Manual entry/),
  ).toBeVisible();
  await expect(
    recorded.getByText(
      /method actually used: SYNTH-method-bpsys-manual · provenance actor: prsn_SYNTH-person-0001/i,
    ),
  ).toBeVisible();
  await expect(recorded.getByText("Partial", { exact: true })).toBeVisible();
  await expect(recorded.getByText(/saved as-is — never silently upgraded/i)).toBeVisible();
  await expect(recorded.getByText(/SYNTH-CAP-\d{6}/)).toBeVisible();

  // 10. The capture history (same store, read through the route) shows the
  //     new observation with method/quality/provenance badges.
  await expect(
    page.getByRole("heading", { level: 2, name: "Recent manual observations" }),
  ).toBeVisible();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByText("Blood pressure 118/76 mmHg")).toBeVisible();
  await expect(table.getByText("Manual", { exact: true })).toBeVisible();
  await expect(table.getByText("You (self-tracking)", { exact: true })).toBeVisible();
  await expect(table.getByText(/Today, \d{2}:\d{2}/)).toBeVisible();

  // The per-row disclosure reveals the provenance drawer.
  const detailsToggle = page.getByRole("button", { name: /Details: SYNTH-CAP-/ });
  await detailsToggle.click();
  await expect(page.getByText("Provenance actor", { exact: true })).toBeVisible();
  await expect(
    page.getByText("You (SYNTH-Person-1, self-tracking)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Method actually used", { exact: true })).toBeVisible();
  await expect(page.getByText("SYNTH-method-bpsys-manual", { exact: true })).toBeVisible();
  await expect(page.getByText(/self-assessed; never upgraded/)).toBeVisible();

  // 11. Record a second capture with a LOW QUALITY self-assessment — the
  //     history badges must reflect the recorded state, not upgrade it.
  await page.getByRole("button", { name: "Record another measurement" }).click();
  await expect(page.getByText("Step 1 of 3 — choose what you measured")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: /what did you measure\?/i })
    .getByText("Heart rate", { exact: true })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Manual pulse check", { exact: true }).click();
  await page.getByLabel(/heart rate \(heart rate\)/i).fill("64");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("radiogroup", { name: /quality self-assessment/i })
    .getByText("Low quality", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save measurement" }).click();

  await expect(recorded.getByText("Measurement saved.", { exact: true })).toBeVisible();
  await expect(
    recorded.getByText(/Heart rate 64 beats\/min — via Manual pulse check/),
  ).toBeVisible();
  await expect(recorded.getByText("Low quality", { exact: true })).toBeVisible();
  await expect(
    recorded.getByText(
      /method actually used: SYNTH-method-hr-manual · provenance actor: prsn_SYNTH-person-0001/i,
    ),
  ).toBeVisible();

  // Both captures are in the history; the recorded qualities differ (never
  // upgraded).
  await expect(table.getByText("Blood pressure 118/76 mmHg")).toBeVisible();
  await expect(table.getByText("Heart rate 64 beats/min")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(3); // header + 2 captures
  await expect(table.getByText("Partial", { exact: true })).toBeVisible();
  await expect(table.getByText("Low quality", { exact: true })).toBeVisible();

  // 12. The timeline view groups the same records by day with polite
  //     announcements (the DataBox view-toggle pattern).
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(table).toHaveCount(0);
  await expect(page.getByText("Showing the capture history timeline.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "History list" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Timeline" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await expect(page.getByText(/quality: Partial · recorded by you/i)).toBeVisible();
  await expect(page.getByText(/quality: Low quality · recorded by you/i)).toBeVisible();

  // Back to the list view.
  await page.getByRole("button", { name: "History list" }).click();
  await expect(table).toBeVisible();
  await expect(page.getByText("Showing the capture history list.")).toBeVisible();
});
