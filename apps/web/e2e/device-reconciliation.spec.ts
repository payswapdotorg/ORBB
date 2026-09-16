import { expect, test } from "@playwright/test";

/**
 * Golden user journey #2 (M6-B B5, Lane B): import a device observation
 * (the SYNTH device-adapter fixture) -> duplicate sources reconciled ->
 * inspect provenance per source.
 *
 * The journey drives the Measurements surface's device-sources card:
 *   1. the registered sources render (the SYNTH-Device-A wearable and the
 *      manual source — the session's registered-source landscape);
 *   2. IMPORT — the wearable's latest resting-heart-rate sample imports as
 *      an IMPORTED observation (unit normalization at the M4-C seam:
 *      1.03 beats/s -> 62 beats/min; raw sample retained as evidence);
 *   3. RECONCILE — the import and the seeded manual pulse check (64
 *      beats/min, earlier today) are duplicate sources for the same
 *      metric/window: they reconcile into ONE canonical view (the M4
 *      mirror — quality ranking 0.92 over 0.7, DISCORDANT verdict under
 *      the exact-equality policy) with PER-SOURCE provenance records for
 *      both originals (the loser is superseded with provenance intact —
 *      nothing is discarded);
 *   4. INSPECT PROVENANCE PER SOURCE — each source's full §Provenance UX
 *      chain opens on the same surface; the superseded manual original
 *      keeps its actor/method/quality, and the winning import carries its
 *      device actor, the unit-normalization transformation, and the
 *      retained raw evidence;
 *   5. HONESTY — a second import into the same window does NOT
 *      re-reconcile (one reconciliation per window; the note says so).
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */
test("golden journey #2: import device observation -> duplicate sources reconciled -> inspect provenance per source", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/measurements");

  // ---------------------------------------------------------------
  // 1. The registered-source landscape on the Measurements surface.
  // ---------------------------------------------------------------
  await expect(
    page.getByRole("heading", { level: 2, name: "Device sources" }),
  ).toBeVisible();
  await expect(
    page.getByText("SYNTH-Device-A (registered wearable)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/src_SYNTH-source-device-a · heart rate \(resting\)/),
  ).toBeVisible();
  await expect(
    page.getByText(/src_SYNTH-source-manual · the M4-B manual capture journey/),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // 2. IMPORT — the wearable's latest sample (the device-adapter fixture).
  // ---------------------------------------------------------------
  await page.getByRole("button", { name: "Import latest sample" }).click();

  // The honest reconciliation report renders verbatim.
  await expect(
    page.getByText(/Duplicate sources reconciled: the wearable import/),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // 3. RECONCILE — the canonical view with per-source provenance.
  // ---------------------------------------------------------------
  const reconciled = page.locator('[data-reconciled-view]');
  await expect(
    reconciled.getByRole("heading", { level: 2, name: "Reconciled — one canonical value" }),
  ).toBeVisible();
  await expect(reconciled.getByText("Heart Rate 62 beats/min")).toBeVisible();
  await expect(reconciled.getByText("Discordant sources")).toBeVisible();
  await expect(
    reconciled.getByText(/the higher-quality source became canonical and the divergence is flagged/),
  ).toBeVisible();

  // Per-source provenance rows: BOTH originals with explicit roles (text
  // labels — never color alone).
  const canonicalRow = reconciled.locator('[data-source-role="canonical-source"]');
  const supersededRow = reconciled.locator('[data-source-role="superseded-source"]');
  await expect(canonicalRow.getByText("Canonical source (won the ranking)")).toBeVisible();
  await expect(
    canonicalRow.getByText(/Wearable sync — resting pulse · Imported \(IMPORTED\) · quality 0.92/),
  ).toBeVisible();
  await expect(canonicalRow.getByText(/obs_SYNTH-import-hr-/)).toBeVisible();
  await expect(supersededRow.getByText("Superseded source (kept with provenance)")).toBeVisible();
  await expect(
    supersededRow.getByText(/Manual pulse check · Measured \(MEASURED\) · quality 0.7/),
  ).toBeVisible();
  await expect(
    supersededRow.getByText("obs_SYNTH-seed-hr-manual-0001"),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // 4. INSPECT PROVENANCE PER SOURCE — the superseded manual original.
  // ---------------------------------------------------------------
  await page
    .getByRole("button", { name: /Inspect provenance of Manual entry \(this device\)/ })
    .click();
  const manualDetail = page.locator('[data-observation-detail]');
  await expect(
    manualDetail.getByRole("heading", { level: 2, name: "Provenance detail" }),
  ).toBeVisible();
  await expect(manualDetail.getByText("Heart Rate 64 beats/min")).toBeVisible();
  await expect(
    manualDetail.getByText("You (SYNTH-Person-1, self-tracking)", { exact: true }).first(),
  ).toBeVisible();
  await expect(manualDetail.getByText("Manual pulse check")).toBeVisible();
  // The superseded state is explicit (badge + validation label), with the
  // reconciliation context.
  await expect(manualDetail.getByText("Superseded").first()).toBeVisible();
  await expect(
    manualDetail.getByText(/Reconciliation: superseded-source · verdict discordant/),
  ).toBeVisible();
  // The manual typed entry honestly states its evidence situation.
  await expect(
    manualDetail.getByText(/No raw evidence object — the values were typed directly/),
  ).toBeVisible();

  // ---------------------------------------------------------------
  //    Inspect the winning import's provenance (device-adapter chain).
  // ---------------------------------------------------------------
  await page
    .getByRole("button", { name: /Inspect provenance of SYNTH-Device-A/ })
    .click();
  await expect(manualDetail.getByText("Heart Rate 62 beats/min")).toBeVisible();
  await expect(
    manualDetail.getByText("SYNTH-Device-A (automatic sync)", { exact: true }),
  ).toBeVisible();
  await expect(manualDetail.getByText("Imported — IMPORTED")).toBeVisible();
  // The unit-normalization transformation at the M4-C seam.
  await expect(manualDetail.getByText("Unit normalization")).toBeVisible();
  await expect(
    manualDetail.getByText(/Raw wearable sample 1.03 beats\/s/),
  ).toBeVisible();
  // The retained raw evidence record (honestly labeled session-retained).
  await expect(
    manualDetail.getByText(/SYNTH-EV-IMPORT-0001 — Resting heart rate raw sample batch/),
  ).toBeVisible();
  await expect(manualDetail.getByText(/validated — the winning source/i)).toBeVisible();

  // ---------------------------------------------------------------
  // 5. HONESTY — a second import does not re-reconcile the window.
  // ---------------------------------------------------------------
  await page.getByRole("button", { name: "Import latest sample" }).click();
  await expect(
    page.getByText(/Already reconciled for today's window/),
  ).toBeVisible();
});
