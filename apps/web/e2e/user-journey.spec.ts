import { expect, test } from "@playwright/test";

/**
 * M3-B user-mode journeys (web shell): the DataBox journey deepened onto
 * the `@orbb/ui` design system.
 *
 * Covers, per the packet:
 * 1. the evidence journey — sortable table columns, per-row disclosure
 *    metadata, the timeline view toggle, and the aria-live announcements
 *    of surface/view + role-emphasis changes;
 * 2. the consent-sheet open/confirm/revoke flow (visible feedback + focus
 *    behavior: focus moves into the modal, is trapped, and returns to the
 *    trigger on close);
 * 3. the measurement form fill/submit flow (guard semantics, validation
 *    errors, submission to the route-handler stub, synthetic echo).
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
  await expect(page.getByText("Provenance actor")).toBeVisible();

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

test("measurement journey: record a measurement — validation, guard, submit, echo", async ({
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

  // Task card context: metric, due-window badge, reason.
  await expect(page.getByText("Due by 09:00")).toBeVisible();
  await expect(
    page.getByText(/Supports your synthetic monitoring plan/),
  ).toBeVisible();

  const valueInput = page.getByLabel(/measured value/i);
  const saveButton = page.getByRole("button", { name: "Save measurement" });

  // 1. Empty submission → value error (field wiring: aria-invalid).
  await saveButton.click();
  await expect(page.getByText("Enter a value before saving.")).toBeVisible();
  await expect(valueInput).toHaveAttribute("aria-invalid", "true");

  // 2. Library guard semantics: out-of-range commits clamp on blur.
  await valueInput.fill("250");
  await valueInput.blur();
  await expect(valueInput).toHaveValue("220");
  await valueInput.fill("10");
  await valueInput.blur();
  await expect(valueInput).toHaveValue("30");

  // 3. Valid value but no method → method error (polite live region).
  await valueInput.fill("72");
  await saveButton.click();
  await expect(
    page.getByText("Choose a capture method before saving."),
  ).toBeVisible();

  // 4. Pick the least-burden method (the radiogroup row is the click target
  //    — the native radio it wraps is visually clipped by the library) and
  //    submit to the route-handler stub.
  await page.getByText("Manual pulse check", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /manual pulse check/i }),
  ).toBeChecked();
  await saveButton.click();

  // The stub route validates and returns a synthetic echo.
  await expect(page.getByText(/Measurement saved: 72 beats\/min via Manual pulse check/)).toBeVisible();
  await expect(page.getByText(/SYNTH-OBS-\d{4}/)).toBeVisible();
  await expect(
    page.getByText(/Synthetic — nothing real was stored\./),
  ).toBeVisible();
});
