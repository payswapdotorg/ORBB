import { expect, test } from "@playwright/test";

/**
 * Golden journey #2 (M6-B B5/B6, Lane B): import a device observation
 * (SYNTH device-adapter fixture) -> duplicate sources reconciled ->
 * inspect provenance per source.
 *
 * 1. The DATABOX surface (B6): timeline + collections default
 *    presentation with search and the four filters (time, concept,
 *    source, confidence/quality); advanced inspection discloses metadata,
 *    provenance and model versions per entry.
 * 2. The IMPORT: the SYNTH device adapter (SYNTH-BP-Monitor-1) imports a
 *    second blood-pressure source for this morning's window; the store
 *    reconciles the two sources into ONE canonical view with per-source
 *    provenance (verdict discordant — flagged, never hidden; the manual
 *    original superseded with provenance intact).
 * 3. The PROVENANCE DETAIL (B5): the canonical observation's full
 *    §Provenance UX chain on /measurements, with per-source provenance
 *    for BOTH originals and per-source inspection; the ESTIMATED
 *    teaching case (a thermometer-photo estimate is a different state
 *    than a measurement — explicit labels, never color alone).
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */

test("golden journey #2: import device observation -> reconciled -> per-source provenance", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // ---------------------------------------------------------------
  // 1. The DataBox default presentation (timeline + collections,
  //    search + the four filters).
  // ---------------------------------------------------------------
  await page.goto("/databox");
  await expect(
    page.getByRole("heading", { level: 1, name: "DataBox" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Your data" })).toBeVisible();

  // The four seeded observations, day-grouped.
  await expect(page.getByText("Showing 4 of 4 observations.", { exact: true })).toBeVisible();
  await expect(page.getByText("Today — Sep 10")).toBeVisible();
  await expect(page.getByText("Yesterday — Sep 9")).toBeVisible();
  await expect(page.getByText("Sep 8", { exact: true })).toBeVisible();

  // Search + the four filters (§DataBox UX).
  await expect(page.getByLabel(/Search your DataBox/)).toBeVisible();
  await expect(page.getByLabel(/^Time$/)).toBeVisible();
  await expect(page.getByLabel(/Concept \(metric\)/)).toBeVisible();
  await expect(page.getByLabel(/^Source$/)).toBeVisible();
  await expect(page.getByLabel(/Confidence \/ quality/)).toBeVisible();

  // Collections as real concept filters.
  await expect(
    page.getByRole("button", { name: /Blood Pressure Systolic \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Heart Rate \(1\)/ }).click();
  await expect(page.getByText("Showing 1 of 4 observations.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Heart Rate: 62 beats\/min/)).toBeVisible();
  await page.getByRole("button", { name: /Heart Rate \(1\)/ }).click();

  // The time filter narrows to the reference day.
  await page.getByLabel(/^Time$/).selectOption("today");
  await expect(page.getByText("Showing 2 of 4 observations.", { exact: true })).toBeVisible();
  await page.getByLabel(/^Time$/).selectOption("all");

  // The quality filter (confidence) narrows to the partial estimate.
  await page.getByLabel(/Confidence \/ quality/).selectOption("partial");
  await expect(page.getByText("Showing 1 of 4 observations.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Body Temperature: 36.8 °C/)).toBeVisible();
  await page.getByLabel(/Confidence \/ quality/).selectOption("all");

  // Advanced inspection on the ESTIMATED entry: model versions (the AI
  // boundary — estimates name their model).
  await page
    .getByRole("button", { name: /Body Temperature: 36.8 °C/ })
    .click();
  await expect(page.getByText("Model version", { exact: true })).toBeVisible();
  await expect(page.getByText("SYNTH-thermo-estimator v0.3", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/SYNTH-EV-0003 — Thermometer reading photo \(image\)/),
  ).toBeVisible();
  await expect(
    page.getByText(/View full provenance \(obs_SYNTH-obs-temp-photo-0003\) on the Measurements surface/),
  ).toBeVisible();

  // The honest data-controls entries: share/revoke anchor to the existing
  // consent section; export + access history are FORTHCOMING, never faked.
  await expect(
    page.getByRole("link", { name: "Share with clinician" }),
  ).toHaveAttribute("href", "#sharing");
  await expect(page.getByText("forthcoming").first()).toBeVisible();

  // ---------------------------------------------------------------
  // 2. The import: the SYNTH device adapter delivers a second BP
  //    source for the morning window -> reconciliation.
  // ---------------------------------------------------------------
  await page.getByRole("button", { name: "Import device observation" }).click();

  await expect(page.getByText("Showing 6 of 6 observations.", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /Device observation imported: 120 mmHg via Automatic cuff sync\. Two sources reconciled — verdict discordant\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import device observation" }),
  ).toHaveCount(0);

  // Isolate the canonical view by searching its observation id (two
  // entries read "120 mmHg": the canonical view and its device source).
  await page.getByLabel(/Search your DataBox/).fill("obs_SYNTH-obs-bp-canonical-0006");
  await expect(page.getByText("Showing 1 of 6 observations.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /Blood Pressure Systolic: 120 mmHg/ })
    .click();

  // The reconciled inspection: verdict + per-source provenance.
  await expect(page.getByText("Reconciled view — verdict:")).toBeVisible();
  await expect(page.getByText("discordant", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /Canonical: Automatic cuff sync · IMPORTED · quality 0\.95 · 120 mmHg \(obs_SYNTH-obs-bp-device-0005\)/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Superseded: Manual entry — home BP cuff reading · MEASURED · quality 0\.9 · 118 mmHg \(obs_SYNTH-obs-bp-manual-0001\)/,
    ),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // 3. The full provenance chain on the Measurements surface (B5),
  //    deep-linked from the DataBox.
  // ---------------------------------------------------------------
  await page
    .getByRole("link", {
      name: /View full provenance \(obs_SYNTH-obs-bp-canonical-0006\) on the Measurements surface/,
    })
    .click();
  await expect(page).toHaveURL(/\/measurements\?observation=/);
  await expect(
    page.getByRole("heading", { level: 3, name: "Observation provenance" }),
  ).toBeVisible();
  await expect(
    page.getByText("Blood Pressure Systolic: 120 mmHg"),
  ).toBeVisible();

  // The teaching block + the chain + the reconciled panel.
  await expect(page.getByText("This value is DERIVED.")).toBeVisible();
  await expect(page.getByText(/Captured by/)).toBeVisible();
  await expect(
    page.getByText(/ORBB reconciliation \(two sources, one current value\)/),
  ).toBeVisible();
  await expect(
    page.getByText(/Two sources: Automatic cuff sync and Manual entry — home BP cuff reading/),
  ).toBeVisible();
  await expect(page.getByText(/Unit normalization/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Two sources, one current value" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Window Today, 07:00–09:00 · reconciled Today, 08:20/),
  ).toBeVisible();
  await expect(
    page.getByText(/prov_SYNTH-prov-reconciliation-0001/),
  ).toBeVisible();

  // Per-source provenance rows with roles (text carriers, never color
  // alone), each inspectable.
  await expect(page.getByText("Canonical source", { exact: true })).toBeVisible();
  await expect(page.getByText("Superseded", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/120 mmHg · captured Today, 08:02/),
  ).toBeVisible();
  await expect(
    page.getByText(/118 mmHg · captured Today, 07:42/),
  ).toBeVisible();

  // Inspect the superseded manual source through the per-source link:
  // its own chain renders (nothing discarded).
  await page
    .getByRole("button", { name: /Inspect this source \(Manual entry\)/ })
    .click();
  await expect(
    page.getByText("Blood Pressure Systolic: 118 mmHg"),
  ).toBeVisible();
  await expect(
    page
      .getByText("Superseded — replaced by the canonical view, provenance kept")
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText(/SYNTH-EV-0002 — Manual blood pressure log page \(document\)/),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // The ESTIMATED teaching case, deep-linked the same way: a
  // thermometer-photo estimate is a different STATE than a measurement.
  // (Longer first-wait: the full page load hydrates the app in dev mode
  // before the observation fetch resolves.)
  // ---------------------------------------------------------------
  await page.goto("/measurements?observation=obs_SYNTH-obs-temp-photo-0003");
  await expect(
    page.getByRole("heading", { level: 3, name: "Observation provenance" }),
  ).toBeVisible({ timeout: 20_000 });
  // Regex matcher (deterministic with the ° glyph; the plain-string
  // matcher is flaky on it under StrictMode double-renders in dev).
  await expect(
    page.getByText(/Body Temperature: 36\.8 °C/),
  ).toBeVisible();
  await expect(page.getByText("This value is ESTIMATED.")).toBeVisible();
  await expect(
    page.getByText(
      /Estimated — derived from an image or a recollection, not measured directly\. It carries uncertainty\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Estimated from an image — the true reading may differ. This is NOT a direct measurement.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Estimate model: SYNTH-thermo-estimator v0.3", { exact: true }),
  ).toBeVisible();

  // The observation detail is ALSO reachable from the capture history:
  // record a quick manual capture, open its full provenance from the
  // history disclosure.
  await page.goto("/measurements");
  await expect(
    page.getByRole("heading", { level: 2, name: "Record a measurement" }),
  ).toBeVisible();
  await page
    .getByRole("radiogroup", { name: /what did you measure\?/i })
    .getByText("Heart rate", { exact: true })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Manual pulse check", { exact: true }).click();
  await page.getByLabel(/heart rate \(heart rate\)/i).fill("58");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("radiogroup", { name: /quality self-assessment/i })
    .getByText("Complete", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(
    page.locator('[data-capture-recorded="true"]').getByText("Measurement saved."),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Details: SYNTH-CAP-/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Full provenance: obs_SYNTH-obs-\d+/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 3, name: "Observation provenance" }),
  ).toBeVisible();
  await expect(page.getByText("This value is MEASURED.")).toBeVisible();
  await expect(
    page.getByText(/No evidence record yet — the DataBox evidence wiring/),
  ).toBeVisible();
});
