import { expect, test } from "@playwright/test";

/**
 * Golden journey #1 head (M6-A, Lane B): onboarding -> intent creation ->
 * plan review approve — asserting visible feedback + focus behavior at
 * every stage.
 *
 * 1. ONBOARDING (B1): the Overview surface runs the first-run journey —
 *    welcome, persona (the existing emphasis model — the header role radio
 *    syncs), metric interests, source summary (manual registered, seams
 *    display-only), completion persisted to localStorage with focus moved
 *    to each step heading and polite step announcements.
 * 2. INTENT CREATION (B2): the guided composer on /intents — goal (metric,
 *    direction, target), constraints (cadence + method preference) with
 *    EvidencePack coverage badges, submit to the /api/intents stub ->
 *    candidate plan received.
 * 3. PLAN REVIEW (B3): explainability audit trail, burden summary, safety
 *    PASS badge, approve-with-edits (reviewer note) through /api/plans ->
 *    the plan lands in the published store; the state change is announced
 *    politely.
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 *
 * Interaction note (the library contract, same as the M4-B capture
 * journey): RadioGroup/Checkbox native inputs are visually clipped — the
 * visible option label text is the click target; checked state is then
 * asserted on the native input via role queries.
 */

const ONBOARDING_DRAFT_KEY = "orbb.onboarding.draft.v1";

test("golden journey #1: onboarding -> create intent -> review candidate plan -> approve with edits", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // ---------------------------------------------------------------
  // 1. ONBOARDING — the first-run journey on the Overview surface.
  // ---------------------------------------------------------------
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  // Step 1: welcome. The step position is announced politely.
  await expect(
    page.getByText("Onboarding — step 1 of 5: welcome"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();

  // Step 2: persona — focus moves to the step heading (focus behavior).
  await expect(
    page.getByText("Onboarding — step 2 of 5: choose how you will use ORBB"),
  ).toBeVisible();
  await expect(
    page.locator('[data-onboarding-step-heading="2"]'),
  ).toBeFocused();

  // Persona selection drives the EXISTING emphasis model: the header's
  // Clinician radio becomes the checked role (the visible option label is
  // the click target — the native radio is clipped per the library
  // contract).
  await page
    .getByRole("radiogroup", { name: /persona/i })
    .getByText("Clinician — care and measurement focus")
    .click();
  await expect(
    page.getByRole("radio", { name: "Clinician", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: metric interests (optional, multi-select).
  await expect(
    page.getByText("Onboarding — step 3 of 5: pick metrics you care about"),
  ).toBeVisible();
  await page.getByText("Blood pressure", { exact: true }).click();
  await page.getByText("Sleep duration", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /blood pressure/i }),
  ).toBeChecked();
  await expect(page.getByText("2 metrics selected.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: source registration summary — display only.
  await expect(
    page.getByText("Onboarding — step 4 of 5: review your measurement sources"),
  ).toBeVisible();
  await expect(page.getByText("Registered · active")).toBeVisible();
  await expect(page.getByText("Not connected yet").first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5: done — completion persists to local storage (terminal state).
  await expect(
    page.getByText("Onboarding — step 5 of 5: finish setup"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();

  // The Overview placeholder returns once the first run completes.
  await expect(page.getByText("Coming in M6+")).toBeVisible();
  const draft = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    ONBOARDING_DRAFT_KEY,
  );
  expect(draft).not.toBeNull();
  expect(JSON.parse(draft as string).completedAt).toBeTruthy();
  expect(JSON.parse(draft as string).role).toBe("clinician");

  // Reload: the completed first-run state is respected (no journey).
  await page.reload();
  await expect(page.getByText("Coming in M6+")).toBeVisible();
  await expect(page.getByText("Onboarding — step 1 of 5: welcome")).toHaveCount(0);

  // ---------------------------------------------------------------
  // 2. INTENT CREATION — the guided composer on the Intents surface.
  // ---------------------------------------------------------------
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Intents", exact: true })
    .click();
  await expect(page).toHaveURL(/\/intents$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Intents" }),
  ).toBeVisible();

  // Step 1: goal — metric, direction, target. Field validation blocks
  // continuation without choices.
  await expect(page.getByText("Step 1 of 3 — choose your goal")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose a metric to continue.")).toBeVisible();

  const goalGroup = page.getByRole("radiogroup", {
    name: /which metric is this intent about\?/i,
  });
  await goalGroup.getByText("Blood Pressure Systolic", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /blood pressure systolic/i }),
  ).toBeChecked();

  const directionGroup = page.getByRole("radiogroup", {
    name: /which direction should the metric move\?/i,
  });
  await directionGroup.getByText("Lower", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Lower", exact: true })).toBeChecked();

  await page.getByLabel(/target \(blood pressure systolic\)/i).fill("120");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: constraints — cadence window + method preference, with the
  // EvidencePack summary's coverage badges per metric/method.
  await expect(
    page.getByText("Step 2 of 3 — constraints and evidence"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Your evidence pack" }),
  ).toBeVisible();
  await expect(page.getByText("12 obs · MEASURED").first()).toBeVisible();
  await expect(page.getByText("actor: person").first()).toBeVisible();
  await expect(page.getByText("actor: device").first()).toBeVisible();

  await page
    .getByRole("radiogroup", { name: /how often should the plan measure\?/i })
    .getByText("Daily", { exact: true })
    .click();
  await expect(page.getByRole("radio", { name: "Daily" })).toBeChecked();
  await page
    .getByRole("radiogroup", { name: /method preference/i })
    .getByText("Any available method", { exact: true })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: review — the objective summary and the idempotency key.
  await expect(page.getByText("Step 3 of 3 — review and submit")).toBeVisible();
  await expect(page.getByText(/SYNTH-DRAFT-/)).toBeVisible();
  await page.getByRole("button", { name: "Submit intent" }).click();

  // ---------------------------------------------------------------
  // 3. PLAN REVIEW — the candidate plan received from the stub.
  // ---------------------------------------------------------------
  await expect(
    page.getByRole("heading", { level: 2, name: "Review the candidate plan" }),
  ).toBeVisible();

  // Explainability audit trail (the M5 shape): pack identity, contributing
  // entries with coverage windows, the method, and the totals.
  await expect(
    page.getByText("Pack v1 — evpk_SYNTH-pack-0001"),
  ).toBeVisible();
  await expect(
    page.getByText("12 observations via SYNTH-method-bpsys-manual"),
  ).toBeVisible();
  await expect(page.getByText(/Window .* · actor class person/)).toBeVisible();
  await expect(
    page.getByText(/Manual entry — home BP cuff reading · Systolic \(SYNTH-method-bpsys-manual\)/),
  ).toBeVisible();
  await expect(page.getByText("12 backing observations")).toBeVisible();

  // Burden summary + safety badge (PASS for a daily vital-signs cadence).
  await expect(page.getByText("Burden summary")).toBeVisible();
  await expect(page.getByText(/3 units\/day/)).toBeVisible();
  const safety = page.locator('[data-plan-safety="PASS"]');
  await expect(safety.getByText("PASS", { exact: true })).toBeVisible();

  // Dropped-by-the-matcher audit: the device seam (display-only) drops
  // with the typed no-source reason.
  await expect(page.getByText("Dropped by the matcher")).toBeVisible();
  await expect(page.getByText(/Automatic cuff sync — no-source/)).toBeVisible();

  // Approve with edits: open the edit panel, add a reviewer note, approve.
  await page
    .getByRole("button", { name: /adjust the plan before approving/i })
    .click();
  await page
    .getByLabel(/reviewer note \(optional\)/i)
    .fill("approved with a tighter window");
  await page.getByRole("button", { name: "Approve with edits" }).click();

  // The state change is announced politely (aria-live) and the outcome
  // summary renders the published plan.
  await expect(
    page.getByText(/Candidate plan approved — published to your plan store/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Plan published" }),
  ).toBeVisible();
  await expect(page.getByText(/approved with a tighter window/)).toBeVisible();
  await expect(page.getByText(/rvar_SYNTH-\d+ · draft → published/)).toBeVisible();

  // The published plan lands in the plan store view (read through the
  // route; written only by the review stub's domain transition).
  const plansTable = page.locator("table");
  await expect(plansTable).toBeVisible();
  await expect(
    plansTable.getByText("plan_SYNTH-bp-systolic-bpsys-manual-1x-day"),
  ).toBeVisible();
  await expect(plansTable.getByText("published", { exact: true })).toBeVisible();

  // A second intent can be composed (the workspace resets cleanly).
  await page.getByRole("button", { name: "Create another intent" }).click();
  await expect(page.getByText("Step 1 of 3 — choose your goal")).toBeVisible();
});

test("golden journey #1 variant: weekly cadence escalates, rejection is terminal", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Straight to the composer (onboarding is independent of this surface).
  await page.goto("/intents");

  await page
    .getByRole("radiogroup", { name: /which metric is this intent about\?/i })
    .getByText("Blood Pressure Systolic", { exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: /which direction should the metric move\?/i })
    .getByText("Lower", { exact: true })
    .click();
  await page.getByLabel(/target \(blood pressure systolic\)/i).fill("120");
  await page.getByRole("button", { name: "Continue" }).click();

  // Weekly cadence for a vital-signs metric: the safety mirror ESCALATEs
  // (cadence below the domain floor) with the reason code on review.
  await page
    .getByRole("radiogroup", { name: /how often should the plan measure\?/i })
    .getByText("Weekly", { exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: /method preference/i })
    .getByText("Any available method", { exact: true })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Submit intent" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Review the candidate plan" }),
  ).toBeVisible();
  const escalated = page.locator('[data-plan-safety="ESCALATE"]');
  await expect(escalated.getByText("ESCALATE", { exact: true })).toBeVisible();
  await expect(
    escalated.getByText("Reason code: cadence-below-floor"),
  ).toBeVisible();
  await expect(
    escalated.getByText(/An ESCALATE verdict requires human review/),
  ).toBeVisible();

  // Human review clears the escalation through the reject path here: the
  // reason is required, and the rejection is terminal + announced.
  await page.getByRole("button", { name: "Reject plan" }).click();
  await page.getByRole("button", { name: "Confirm rejection" }).click();
  await expect(page.getByText("A rejection reason is required.")).toBeVisible();
  await page
    .getByLabel(/why are you rejecting this plan\?/i)
    .fill("weekly is too sparse for my mornings");
  await page.getByRole("button", { name: "Confirm rejection" }).click();

  await expect(
    page.getByText(/Candidate plan rejected — the review entry is closed/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Plan rejected" }),
  ).toBeVisible();

  // The plan store never publishes THIS plan (rejection is terminal). The
  // store is process-global across parallel e2e workers, so the assertion
  // is scoped to this journey's unique plan id (weekly cadence slug).
  const plansTable = page.locator("table");
  await expect(
    plansTable.getByText("plan_SYNTH-bp-systolic-bpsys-manual-1x-week"),
  ).toHaveCount(0);
  await expect(
    page.getByText(/The plan store holds only plans published through review approval/),
  ).toBeVisible();
});
