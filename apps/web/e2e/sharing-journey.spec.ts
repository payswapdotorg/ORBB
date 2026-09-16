import { expect, test } from "@playwright/test";

/**
 * Golden journey #4 (M6-C B7, REQUIRED): "Create a scoped data share →
 * recipient accesses authorized subset → user sees audit log → revoke
 * access."
 *
 * The journey exercises the REAL components (the sharing workspace on
 * the DataBox surface): the step-wise contract composer (six steps, each
 * stating its consequence), the contract rendered in the active-shares
 * list, a recipient access event appearing in the access-history audit,
 * and the revoke-with-confirm flow ending in the distinct revoked state
 * + the audit showing the revocation.
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */
test("golden journey #4: create a scoped share, see the audit log, revoke with confirm", async ({
  page,
}) => {
  await page.goto("/databox");

  // The Sharing section mounts on the DataBox surface with the seeded
  // world: one active share (Dr. Rivera) + one revoked (Cardiology
  // Service) + their audit events.
  const sharing = page.getByTestId("sharing-workspace");
  await expect(sharing).toBeVisible();
  await expect(sharing.getByText("Your data shares")).toBeVisible();
  await expect(sharing.getByTestId("share-contract-shr_SYNTH-0001").getByText("Dr. Ana Rivera (SYNTH clinician)")).toBeVisible();

  // The seeded audit log shows the clinician's viewed event.
  const history = sharing.getByTestId("access-history");
  await expect(history).toBeVisible();
  await expect(history.getByText("Dr. Ana Rivera (SYNTH clinician) · Heart rate + Blood pressure")).toBeVisible();

  // -- Step 1: open the composer -------------------------------------------
  await sharing.getByRole("button", { name: "Start creating a data share" }).click();
  const composer = page.getByTestId("share-composer");
  await expect(composer).toBeVisible();
  await expect(composer.getByText("Who receives access?", { exact: true })).toBeVisible();

  // Step consequence lines are present and plain-language (frozen rule).
  await expect(
    composer.getByText("Access is given to exactly this recipient — no one else, ever."),
  ).toBeVisible();

  // Next is disabled until a recipient is chosen (no default-open).
  const nextButton = composer.getByRole("button", { name: "Next step" });
  await expect(nextButton).toBeDisabled();

  // -- Step 2: recipient + purpose -----------------------------------------
  await composer.getByRole("radio", { name: /Sam Ortega/ }).check();
  await nextButton.click();
  await expect(composer.getByText("For what purpose?", { exact: true })).toBeVisible();
  await composer.getByRole("radio", { name: "Ongoing care monitoring" }).check();
  await nextButton.click();

  // -- Step 3: exact data scope (at least one concept; no select-all) ------
  await expect(composer.getByText("Which exact data?", { exact: true })).toBeVisible();
  await expect(nextButton).toBeDisabled(); // empty scope blocks advance
  await composer.locator('label', { hasText: 'Heart rate' }).first().click();
  await nextButton.click();

  // -- Step 4: terms (safest defaults shown) --------------------------------
  await expect(composer.getByText("Derived data & re-sharing", { exact: true })).toBeVisible();
  await expect(composer.getByText("No (safest)")).toBeVisible();
  await nextButton.click();

  // -- Step 5: expiry --------------------------------------------------------
  await expect(composer.getByText("When does access end?", { exact: true })).toBeVisible();
  await nextButton.click();

  // -- Step 6: the full contract review + confirm ---------------------------
  await expect(composer.getByText("Review the contract", { exact: true })).toBeVisible();
  const review = page.getByTestId("share-contract-review");
  await expect(review.getByText("Sam Ortega (SYNTH care partner)")).toBeVisible();
  await expect(review.getByText("Heart rate")).toBeVisible();
  await expect(review.getByText("Derived data: not allowed")).toBeVisible();
  await composer.getByRole("button", { name: "Confirm share" }).click();

  // The new contract renders in the active-shares list.
  await expect(sharing.getByTestId("sharing-notice")).toBeVisible();
  const samContract = sharing.getByTestId("share-contract-shr_SYNTH-0003");
  await expect(samContract).toBeVisible();
  await expect(samContract.getByText("Sam Ortega (SYNTH care partner)")).toBeVisible();
  await expect(samContract.getByText("Active")).toBeVisible();

  // -- The recipient accesses the authorized subset (fixture event) --------
  // The composer's confirm records the first `viewed` event; the audit
  // log shows it (newest first).
  await expect(history.getByText("Sam Ortega (SYNTH care partner)").first()).toBeVisible();

  // -- Step 7: revoke with confirm ------------------------------------------
  await samContract.getByRole("button", { name: "Revoke share with Sam Ortega (SYNTH care partner)" }).click();
  const confirmBox = page.getByTestId("revoke-confirm-shr_SYNTH-0003");
  await expect(confirmBox).toBeVisible();
  await expect(
    confirmBox.getByText("immediately stop being able to view or export", { exact: false }),
  ).toBeVisible();

  // Keep-active cancels first (the confirm step is real, not a rubber stamp).
  await confirmBox.getByRole("button", { name: "Keep share active" }).click();
  await expect(samContract.getByText("Active")).toBeVisible();

  // Now revoke for real.
  await samContract.getByRole("button", { name: "Revoke share with Sam Ortega (SYNTH care partner)" }).click();
  await page.getByTestId("revoke-confirm-shr_SYNTH-0003").getByRole("button", { name: "Confirm revoke share with Sam Ortega (SYNTH care partner)" }).click();

  // The distinct revoked state (honest: "Revoked on …").
  await expect(samContract.getByText(/^Revoked on /)).toBeVisible();
  await expect(sharing.getByTestId("sharing-notice").getByText(/Access revoked for Sam Ortega/)).toBeVisible();

  // The audit log shows the revocation event.
  await expect(history.getByText("Access revoked").first()).toBeVisible();
});

test("golden journey #4 variant: the consent-settings surface aggregates the posture (B9)", async ({
  page,
}) => {
  await page.goto("/settings/consent");

  const settings = page.getByTestId("consent-settings");
  await expect(settings).toBeVisible();

  // The active-shares aggregation (from the B7 store).
  await expect(settings.getByText("Active shares")).toBeVisible();

  // Measurement sources default OFF (deny-by-default) except manual entry.
  const sources = settings.getByText("Measurement sources");
  await expect(sources).toBeVisible();
  await expect(settings.getByText("Apple Health (SYNTH HealthKit seam)", { exact: true })).toBeVisible();

  // A change records to the never-silent audit trail.
  await settings.getByText("Enable Apple Health (SYNTH HealthKit seam)").click();
  const audit = page.getByTestId("consent-audit");
  await expect(audit).toBeVisible();
  await expect(audit.getByText("Apple Health (SYNTH HealthKit seam): enabled")).toBeVisible();

  // Notification preferences mirror the B8 shape (channels + quiet hours).
  await expect(settings.getByText("Quiet hours (22:00–07:00)", { exact: true })).toBeVisible();
});
