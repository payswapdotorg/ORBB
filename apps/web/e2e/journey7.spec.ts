import { expect, test } from "@playwright/test";

/**
 * Golden journey #7 (M6 EXIT, Lane B, REQUIRED): "User misses task →
 * reminder → fallback provider offered → authorized restriction applied
 * only if configured."
 *
 * The journey exercises the REAL Today surface (the B4 frozen contract
 * plus the M6-EXIT chain additions), driven by the SYNTH fixtures:
 *
 *   1. TODAY — the surface mounts with the seeded missed body-weight
 *      task (window closed yesterday 09:00; the scheduler has not
 *      re-run — the two-visit pattern the capture journey uses is not
 *      needed: the fixture task's missed state is the honest starting
 *      world of the journey);
 *   2. REMINDER — the missed card carries the reminder badge line
 *      (rung REMIND_WITH_FALLBACK_OFFER — the @orbb/notifications
 *      ladder mirror — delivered, with the B8 escalation-grace fire
 *      instant "sent yesterday at 10:00"); the due tasks carry their
 *      rung-REMIND reminders with the honest quiet-hours deferral
 *      ("deferred to 07:00" — deferred, never dropped);
 *   3. FALLBACK PROVIDER OFFERED — an explicit user action ("View
 *      options") opens the offer panel: the acceptable-methods/fallback
 *      vocabulary from the task + the reminder's fallback-offer payload
 *      (enforcementAuthority: "none" — the offer is DATA, never an
 *      order), with the provider path (SYNTH-Clinic-A · SYNTH-CHW-2)
 *      and the routing action into the existing capture flow;
 *   4. AUTHORIZATION STATE — the restriction-posture surface shows the
 *      observe-only DEFAULT ("No restrictions are configured — nothing
 *      happens when you miss a measurement." + the no-enforcement /
 *      no-policy decision record), and the explicitly-labeled SYNTH
 *      configured-policy fixture variant (behind its disclosure) shows
 *      the policy summary with every frozen field plus the
 *      restriction-authorized decision (bounded token — authorized only
 *      under an explicit policy + authorization grant).
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */

const ONBOARDING_DRAFT_KEY = "orbb.onboarding.draft.v1";

/**
 * The tolerant first-run prefix: the Overview gate renders a
 * hydration-safe "checking" state first (the decision is client-side
 * after mount — localStorage is unreadable during SSR), so the prefix
 * WAITS for either outcome before branching (never a bare isVisible
 * race). Fresh contexts complete the five-step journey quickly; a
 * resumed-complete draft goes straight to Today (a no-op prefix).
 */
async function completeOnboardingIfVisible(page: import("@playwright/test").Page): Promise<void> {
  const onboardingStep1 = page.getByText("Onboarding — step 1 of 5: welcome");
  await expect(
    onboardingStep1.or(page.getByRole("heading", { level: 1, name: "Today" })),
  ).toBeVisible();
  if (await onboardingStep1.isVisible()) {
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

test("golden journey #7: missed task -> reminder -> fallback offer -> observe-only default -> configured variant", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // ---------------------------------------------------------------
  // 1. TODAY — the surface with the seeded missed task.
  // ---------------------------------------------------------------
  await page.goto("/");
  await completeOnboardingIfVisible(page);
  await expect(page.getByText("What matters today")).toBeVisible();

  // The missed task card: the B4 frozen contract, missed state.
  const weightCard = page.locator('[data-task-id="task_SYNTH-today-wt-000003"]');
  await expect(weightCard).toBeVisible();
  await expect(weightCard.getByText("Body Weight", { exact: true })).toBeVisible();
  await expect(weightCard.getByText("Window missed", { exact: true })).toBeVisible();
  await expect(
    weightCard.getByText(/Window missed — was due yesterday at 09:00/),
  ).toBeVisible();

  // ---------------------------------------------------------------
  // 2. REMINDER — the missed card's reminder line (ladder mirror).
  // ---------------------------------------------------------------
  await expect(
    weightCard.getByText("Reminder sent — fallback options offered"),
  ).toBeVisible();
  await expect(
    weightCard.getByText("Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00"),
  ).toBeVisible();
  await expect(
    weightCard.locator("[data-reminder-rung='REMIND_WITH_FALLBACK_OFFER']"),
  ).toBeVisible();

  // The due tasks' rung-1 reminders with the honest quiet-hours
  // deferral (defer, never drop). PARALLEL-SUITE OWNERSHIP (recorded):
  // the blood-pressure task is COMPLETED by the parallel journey-#1
  // spec against the same shared in-memory board, so its assertion is
  // the disjunction — the quiet-hours-deferred reminder line while
  // open, the completed state after (the ladder mirrors task state
  // either way). The heart-rate task is THIS journey's own fixture
  // (completed below, in this test, AFTER the reminder proof), so it
  // carries the full rung-1 deferral proof deterministically.
  const bpCard = page.locator('[data-task-id="task_SYNTH-today-bp-000001"]');
  await expect(
    bpCard
      .getByText(/Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00/)
      .or(
        page.locator(
          '[data-task-id="task_SYNTH-today-bp-000001"][data-task-state="completed"]',
        ),
      ),
  ).toBeVisible();

  const hrCard = page.locator('[data-task-id="task_SYNTH-today-hr-000002"]');
  await expect(hrCard.getByText("Reminder scheduled")).toBeVisible();
  await expect(
    hrCard.getByText(/Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00/),
  ).toBeVisible();
  await expect(
    hrCard.getByText(/deferred to 07:00 \(the reminder is deferred, never dropped\)/),
  ).toBeVisible();

  // The completed sleep task never reminds (silence, never punishment).
  const sleepCard = page.locator('[data-task-id="task_SYNTH-today-sleep-000004"]');
  await expect(sleepCard.getByText(/Rung REMIND/)).toHaveCount(0);

  // ---------------------------------------------------------------
  // 3. FALLBACK PROVIDER OFFERED — the explicit user action.
  // ---------------------------------------------------------------
  const optionsToggle = weightCard.getByRole("button", {
    name: "View fallback options for Body Weight",
  });
  await expect(optionsToggle).toHaveAttribute("aria-expanded", "false");
  await optionsToggle.click();
  await expect(optionsToggle).toHaveAttribute("aria-expanded", "true");

  // The OFFER framing: the method vocabulary as DATA, never an order.
  await expect(
    weightCard.getByText("Fallback options — offered, never ordered."),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Manual entry — scale reading \(preferred, SYNTH-method-manual-body-weight\)/),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Enforcement authority: none — a reminder never orders a provider and never applies a restriction./),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Provider path: SYNTH-Clinic-A · SYNTH-CHW-2/),
  ).toBeVisible();

  // The offer routes to the EXISTING capture flow (the real action).
  await weightCard
    .getByRole("button", { name: /Capture Body Weight now — Manual entry — scale reading/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Complete your measurement" }),
  ).toBeVisible();
  await expect(page.getByText("Step 2 of 3 — method, values, and context")).toBeVisible();
  // Close without completing — the journey's focus is the chain, not the
  // capture (which journey #1 already proves end-to-end).
  await page.getByRole("button", { name: "Close without completing" }).click();

  // ---------------------------------------------------------------
  // 4. AUTHORIZATION STATE — the restriction-posture surface.
  // ---------------------------------------------------------------
  // The observe-only DEFAULT is the loudest truth.
  await expect(
    page.getByText(
      "No restrictions are configured — nothing happens when you miss a measurement.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Restriction posture: observe-only (the default)"),
  ).toBeVisible();
  await expect(
    page.getByText(/Decision: no-enforcement — Observe-only — nothing restrictive happens/),
  ).toBeVisible();
  await expect(page.getByText("reason: no-policy")).toBeVisible();
  await expect(
    page.getByText(/audit steps: policy-resolution \(absent:policy\)/),
  ).toBeVisible();

  // The SYNTH configured-policy fixture variant behind its disclosure.
  const variantToggle = page.getByRole("button", {
    name: "View the configured-policy fixture variant (SYNTH)",
  });
  await expect(variantToggle).toHaveAttribute("aria-expanded", "false");
  await variantToggle.click();
  await expect(variantToggle).toHaveAttribute("aria-expanded", "true");

  // The policy summary with every frozen B10 field.
  await expect(
    page.getByText("Restriction posture: configured policy (SYNTH fixture variant)"),
  ).toBeVisible();
  await expect(
    page.getByText(/SYNTH fixture variant — demonstrates the vocabulary only/),
  ).toBeVisible();
  await expect(page.getByText("SYNTH-policy-evening-focus-0001").first()).toBeVisible();
  await expect(
    page.getByText(/ios-focus — iOS Focus \(SYNTH OS seam\)/),
  ).toBeVisible();
  await expect(
    page.getByText(/triggerOn: missed \(the only legal trigger — recovery is never punished\)/),
  ).toBeVisible();
  await expect(
    page.getByText(/permissions: adherence:restrict:ios-focus · pinned grant: grant_SYNTH-adherence-demo-0001/),
  ).toBeVisible();
  await expect(
    page.getByText(/2 hours \(bounded — restrictions are at most 24 hours\)/),
  ).toBeVisible();

  // The authorization decision vocabulary: restriction-authorized only
  // under the explicit policy + authorization grant.
  await expect(
    page.getByText(/Decision: restriction-authorized — Restriction authorized — under an explicit, authorized, configured policy only/),
  ).toBeVisible();
  await expect(
    page.getByText(/decisionId: SYNTH-DECISION-evening-focus-wt-0001/),
  ).toBeVisible();
  await expect(
    page.getByText(/authorization: adherence:restrict:ios-focus — verified at/),
  ).toBeVisible();
  await expect(
    page.getByText(/audit steps: policy-resolution .* -> trigger-evaluation .* -> scope-check .* -> authorization-gate \(authorized\) -> capability-detection .* -> restriction-authorized/),
  ).toBeVisible();

  // Non-gamification (binding): no streak/penalty vocabulary anywhere.
  for (const barred of [/streak/i, /penalt/i, /points/i]) {
    await expect(page.getByText(barred)).toHaveCount(0);
  }

  // Completing a task silences its reminder (the B8 rule, honestly
  // re-read): the due heart-rate task completes through the capture flow
  // and its reminder line disappears.
  await expect(hrCard.getByText("Reminder scheduled")).toBeVisible();
  await hrCard
    .getByRole("button", { name: /Complete Heart Rate now — Wearable sync/ })
    .click();
  await expect(page.getByText("Step 2 of 3 — method, values, and context")).toBeVisible();
  await page.getByText("Manual pulse check", { exact: true }).click();
  await page.getByLabel(/heart rate \(heart rate\)/i).fill("61");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 3 of 3 — review and save")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: /quality self-assessment/i })
    .getByText("Complete", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(
    page.getByText(/Measurement saved and task completed: Heart Rate/),
  ).toBeVisible();
  await expect(
    page.locator('[data-task-id="task_SYNTH-today-hr-000002"]', {
      hasText: "Reminder scheduled",
    }),
  ).toHaveCount(0);
});

test("golden journey #7 honest-failure leg: the posture surface never breaks the task board", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Route-level abort of BOTH chain reads: the board must still render.
  await page.route("**/api/today/reminders", (route) => route.abort());
  await page.route("**/api/today/adherence", (route) => route.abort());

  await page.goto("/");
  await completeOnboardingIfVisible(page);

  // The task board is unaffected; the degrade is announced politely.
  await expect(page.getByText("What matters today")).toBeVisible();
  await expect(
    page.locator('[data-task-id="task_SYNTH-today-wt-000003"]'),
  ).toBeVisible();
  await expect(
    page.getByText(/Reminder state could not be loaded — the task list is unaffected/),
  ).toBeVisible();
  await expect(
    page.getByText(/restriction-posture summary could not be loaded/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "What you are working toward" }),
  ).toBeVisible();
});

test("golden journey #7 onboarding persistence check (the two-visit pattern)", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // The missed-task fixture world is present across two visits: the
  // first completes onboarding (if needed), the second re-reads the
  // chain — the deterministic fixtures survive navigation.
  await page.goto("/");
  await completeOnboardingIfVisible(page);
  await expect(
    page.getByText("Reminder sent — fallback options offered"),
  ).toBeVisible();

  // Second visit: reload and re-read.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(
    page.getByText("Reminder sent — fallback options offered"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No restrictions are configured — nothing happens when you miss a measurement.",
    ),
  ).toBeVisible();
  const draft = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    ONBOARDING_DRAFT_KEY,
  );
  expect(draft).not.toBeNull();
});
