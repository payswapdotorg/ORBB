import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * M6 EXIT HARNESS (Lane B packet M6-EXIT) — the executable proof of the
 * Milestone 6 exit criterion (docs/IMPLEMENTATION_PLAN.md, M6):
 *
 *   "golden user journey #1, #2, #4, #7 passes on web and supported
 *    mobile paths."
 *
 * A SINGLE RUN of this spec proves the milestone's journey set:
 *
 *   1. FOUR JOURNEY CHECKPOINTS (below) — each of the four exit
 *      journeys driven at its critical chain, beginning at a rendered
 *      screen and ending at a rendered result (the repo's own journey
 *      rule: "Every feature must have at least one complete user journey
 *      beginning at a rendered screen and ending at a rendered screen;
 *      API-only tests are insufficient"):
 *        - #1 (intent -> plan -> today -> provenance): the intent-driven
 *          Today board + the provenance seam;
 *        - #2 (device import -> reconciliation -> provenance): the
 *          registered-source landscape + the import/reconciliation
 *          affordance;
 *        - #4 (share -> audit -> revoke): the seeded sharing world +
 *          the composer's no-default-open gate;
 *        - #7 (missed -> reminder -> fallback offer -> authorized
 *          restriction only if configured): the FULL new chain on its
 *          stable fixtures + the wire contracts of both chain routes.
 *
 *   2. CROSS-CUTTING INVARIANTS (the final test) — grep-level, on the
 *      real files of the working tree:
 *        - WEB COMPLETE: the four journeys' dedicated Playwright specs
 *          exist and carry their golden-journey proofs (their deep,
 *          mutating runs are the per-journey evidence; the battery's
 *          `pnpm exec playwright test --project=chromium` runs them
 *          together with this harness in one green suite);
 *        - MOBILE PATHS EXIST: the supported mobile legs — the Maestro
 *          flows (journey #1: onboarding/intent/today/capture; #4:
 *          sharing/consent-settings; #7: journey7) and the pure mobile
 *          models the flows assert against. RECORDED BOUNDARY: journey
 *          #2's device import/reconciliation is the WEB Measurements
 *          surface at this milestone (no mobile device-import leg
 *          exists in apps/mobile/maestro/flows — see its README);
 *        - ZERO PHI: every fixture file of the four journeys' worlds is
 *          scanned — domain-prefixed ids must be SYNTH-marked, and no
 *          email/phone/SSN/PHI-field patterns or unmarked clinician
 *          names may appear (the agent-protocol test-data rules).
 *
 * COLLISION-FREEDOM (the recorded design decision): the dev server's
 * fixture stores are PROCESS-LOCAL MODULE STATE shared by every
 * parallel Playwright worker, and the board a page renders is the
 * snapshot its `/api/today` fetch returned (other workers' later
 * completions do not live-update it). The mutating actions therefore
 * belong to the DEDICATED journey specs only — journey #1 completes the
 * blood-pressure task, journey #7 completes the heart-rate task and
 * owns the missed-weight assertions, journey #2's spec performs the
 * one-per-window device import, journey #4's spec creates and revokes
 * the Sam Ortega share. THIS harness drives READ-ONLY checkpoints plus
 * tolerant disjunctions (an open due task carries its reminder OR is
 * completed — the ladder mirrors task state either way), so the full
 * battery stays green in ANY scheduling order and this harness is
 * deterministic whether it runs alone or inside the suite.
 *
 * All data is synthetic (SYNTH) — no real medical data, no real
 * credentials, no network mocks of real APIs.
 */

// ---------------------------------------------------------------------------
// Repo paths (resolved from THIS spec's location — never from cwd).
// ---------------------------------------------------------------------------

const E2E_DIR = dirname(fileURLToPath(import.meta.url)); // apps/web/e2e
const APPS_WEB_DIR = dirname(E2E_DIR); // apps/web
const REPO_ROOT_DIR = dirname(dirname(APPS_WEB_DIR)); // the monorepo root

/** Reads a file under the repo root, failing loudly when absent. */
function readRepoFile(relativePath: string): string {
  const absolute = join(REPO_ROOT_DIR, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`M6 exit harness: expected file is missing: ${relativePath}`);
  }
  return readFileSync(absolute, "utf8");
}

/** The tolerant first-run prefix (fresh contexts complete onboarding). */
async function completeOnboardingIfVisible(page: import("@playwright/test").Page): Promise<void> {
  // The Overview gate renders a hydration-safe "checking" state first;
  // wait for EITHER outcome before branching (never a bare isVisible
  // race). Resumed-complete drafts go straight to Today.
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

// ---------------------------------------------------------------------------
// Journey #1 — the intent-driven Today board + the provenance seam.
// ---------------------------------------------------------------------------

test("M6 exit — journey #1 checkpoint: the intent-driven Today board and the provenance seam", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // TODAY renders (the onboarding gate resolves per context).
  await page.goto("/");
  await completeOnboardingIfVisible(page);

  // The intent focus answers "what am I trying to accomplish".
  await expect(
    page.getByRole("heading", { level: 2, name: "What you are working toward" }),
  ).toBeVisible();
  await expect(page.getByText("What matters today")).toBeVisible();

  // The board is COMPLETE: all four seeded task cards render.
  for (const taskId of [
    "task_SYNTH-today-bp-000001",
    "task_SYNTH-today-hr-000002",
    "task_SYNTH-today-wt-000003",
    "task_SYNTH-today-sleep-000004",
  ]) {
    await expect(page.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
  }

  // The frozen §Measurement task UX contract (state-independent fields
  // on the blood-pressure card — the dedicated journey #1 spec owns the
  // completion transition).
  const bpCard = page.locator('[data-task-id="task_SYNTH-today-bp-000001"]');
  await expect(bpCard.getByText("Blood Pressure Systolic", { exact: true })).toBeVisible();
  await expect(
    bpCard.getByText(/Automatic cuff sync · automatic — ~0 min · not connected yet/),
  ).toBeVisible();
  await expect(
    bpCard.getByText(/Manual entry — home BP cuff reading · ~2 min · available/),
  ).toBeVisible();
  await expect(bpCard.getByText("Estimated effort")).toBeVisible();
  await expect(bpCard.getByText("Privacy impact")).toBeVisible();
  await expect(bpCard.getByText("Clinic/CHW fallback")).toBeVisible();

  // Conservative per-intent progress (never gamified): the sleep intent
  // is seeded completed — a stable progress fact.
  await expect(
    page
      .locator('[data-intent-progress="intent_SYNTH-today-sleep-000004"]')
      .getByText("1 completed — nothing due right now."),
  ).toBeVisible();

  // The completed state is text-carried (WCAG 1.4.1 — never color alone).
  const sleepCard = page.locator('[data-task-id="task_SYNTH-today-sleep-000004"]');
  await expect(sleepCard).toHaveAttribute("data-task-state", "completed");
  await expect(sleepCard.getByText("Completed", { exact: true })).toBeVisible();

  // SEE PROVENANCE (the journey #1 tail): the seeded observation's full
  // §Provenance UX chain through the Measurements deep link — the SAME
  // affordance the completed-task link uses (stable fixture; concurrent
  // captures add rows but never remove the seed).
  await page.goto("/measurements?observation=obs_SYNTH-seed-hr-manual-0001");
  const detail = page.locator("[data-observation-detail]");
  await expect(
    detail.getByRole("heading", { level: 2, name: "Provenance detail" }),
  ).toBeVisible();
  await expect(detail.getByText("Heart Rate 64 beats/min")).toBeVisible();
  await expect(
    detail.getByText("You (SYNTH-Person-1, self-tracking)", { exact: true }).first(),
  ).toBeVisible();
  await expect(detail.getByText("Manual pulse check")).toBeVisible();
  await expect(detail.getByText("Captured by", { exact: true })).toBeVisible();
  await expect(detail.getByText("Method", { exact: true })).toBeVisible();
  await expect(detail.getByText("Quality", { exact: true })).toBeVisible();
  await expect(detail.getByText("Validation", { exact: true })).toBeVisible();
  await expect(detail.getByText("Measured — MEASURED")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Journey #2 — the registered-source landscape + the import affordance.
// ---------------------------------------------------------------------------

test("M6 exit — journey #2 checkpoint: the registered-source landscape and the reconciliation entry", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/measurements");

  // The registered-source landscape (the journey's entry card).
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

  // The IMPORT affordance exists and states its consequence honestly
  // (duplicate sources reconcile into one canonical value with
  // per-source provenance — the card's own summary).
  await expect(page.getByRole("button", { name: "Import latest sample" })).toBeVisible();
  await expect(
    page.getByText(/duplicate\s+sources reconcile into one canonical value with per-source\s+provenance/),
  ).toBeVisible();

  // The unit-normalization honesty line (the M4-C seam, stated on the
  // source row before any import happens).
  await expect(
    page.getByText(/1\.03 beats\/s → 62 beats\/min after unit normalization/),
  ).toBeVisible();

  // COLLISION-FREEDOM (recorded): the import CLICK belongs to the
  // dedicated journey #2 spec — the reconciliation is one-per-window in
  // the shared in-memory store, so a second importer would see "Already
  // reconciled" and break the dedicated spec's deterministic proof.
  // This checkpoint therefore proves the entry landscape + affordance;
  // the dedicated spec (asserted by the invariants test below, run
  // green in the battery) proves the import -> reconciliation ->
  // per-source provenance chain end-to-end.
});

// ---------------------------------------------------------------------------
// Journey #4 — the seeded sharing world + the composer's gate.
// ---------------------------------------------------------------------------

test("M6 exit — journey #4 checkpoint: the seeded sharing world, the audit log, and the composer gate", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/databox");

  // The Sharing section mounts with the seeded world (stable fixtures —
  // the dedicated journey #4 spec owns the create/revoke mutations).
  const sharing = page.getByTestId("sharing-workspace");
  await expect(sharing).toBeVisible();
  await expect(sharing.getByText("Your data shares")).toBeVisible();

  // The seeded ACTIVE share renders with its recipient.
  const rivera = sharing.getByTestId("share-contract-shr_SYNTH-0001");
  await expect(rivera).toBeVisible();
  await expect(rivera.getByText("Dr. Ana Rivera (SYNTH clinician)")).toBeVisible();
  await expect(rivera.getByText("Active", { exact: true })).toBeVisible();

  // The seeded REVOKED share keeps its distinct, honest revoked state
  // (revoked contracts remain listed — the audit trail is never lost).
  const cardiology = sharing.getByTestId("share-contract-shr_SYNTH-0002");
  await expect(cardiology).toBeVisible();
  await expect(cardiology.getByText(/^Revoked on /)).toBeVisible();

  // The never-silent audit log: the seeded viewed event AND the seeded
  // revocation event (the "user sees audit log" + "revoke access"
  // vocabulary, proven on stable fixtures).
  const history = sharing.getByTestId("access-history");
  await expect(history).toBeVisible();
  await expect(
    history.getByText("Dr. Ana Rivera (SYNTH clinician) · Heart rate + Blood pressure"),
  ).toBeVisible();
  await expect(history.getByText("Access revoked").first()).toBeVisible();

  // The composer opens with NO default recipient (deny-by-default — the
  // step consequence is stated, and Next is disabled until a recipient
  // is chosen).
  await sharing.getByRole("button", { name: "Start creating a data share" }).click();
  const composer = page.getByTestId("share-composer");
  await expect(composer.getByText("Who receives access?", { exact: true })).toBeVisible();
  await expect(
    composer.getByText("Access is given to exactly this recipient — no one else, ever."),
  ).toBeVisible();
  await expect(composer.getByRole("button", { name: "Next step" })).toBeDisabled();

  // Cancel without creating — this harness never mutates the sharing
  // store (collision-freedom; the dedicated spec drives the full
  // create -> access -> audit -> revoke chain).
  await composer.getByRole("button", { name: "Cancel share" }).click();
  await expect(composer).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Journey #7 — the missed -> reminder -> fallback offer -> posture chain.
// ---------------------------------------------------------------------------

test("M6 exit — journey #7 checkpoint: missed task -> reminder -> fallback offer -> authorization posture", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/");
  await completeOnboardingIfVisible(page);

  // The MISSED task (the stable fixture — no spec completes it): the
  // window badge + the reminder badge line (the @orbb/notifications
  // ladder mirror, rung 2, delivered).
  const weightCard = page.locator('[data-task-id="task_SYNTH-today-wt-000003"]');
  await expect(weightCard.getByText("Window missed", { exact: true })).toBeVisible();
  await expect(
    weightCard.getByText(/Window missed — was due yesterday at 09:00/),
  ).toBeVisible();
  await expect(
    weightCard.getByText("Reminder sent — fallback options offered"),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Rung REMIND_WITH_FALLBACK_OFFER · sent yesterday at 10:00/),
  ).toBeVisible();
  await expect(
    weightCard.locator("[data-reminder-rung='REMIND_WITH_FALLBACK_OFFER']"),
  ).toBeVisible();

  // THE LADDER MIRRORS TASK STATE (the B8 rule, proven as a disjunction
  // so ANY suite scheduling order stays green): each due task EITHER
  // carries its quiet-hours-deferred rung-REMIND reminder (open) OR is
  // completed (and completing silences the ladder). The page's board is
  // the snapshot its fetch returned — the disjunction is stable. NOTE
  // the completed branch matches the CARD ITSELF (the data-task-state
  // attribute lives on the card's own <li>, not a descendant).
  for (const taskId of ["task_SYNTH-today-bp-000001", "task_SYNTH-today-hr-000002"]) {
    const card = page.locator(`[data-task-id="${taskId}"]`);
    await expect(card).toBeVisible();
    await expect(
      card
        .getByText(/Rung REMIND · quiet hours 22:00–07:00 — deferred to 07:00/)
        .or(page.locator(`[data-task-id="${taskId}"][data-task-state="completed"]`)),
    ).toBeVisible();
  }

  // The COMPLETED task never reminds (silence, never punishment).
  await expect(
    page.locator('[data-task-id="task_SYNTH-today-sleep-000004"]').getByText(/Rung REMIND/),
  ).toHaveCount(0);

  // THE FALLBACK OFFER — an explicit user action opens it, and it is
  // DATA, never an order.
  const optionsToggle = weightCard.getByRole("button", {
    name: "View fallback options for Body Weight",
  });
  await expect(optionsToggle).toHaveAttribute("aria-expanded", "false");
  await optionsToggle.click();
  await expect(optionsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    weightCard.getByText("Fallback options — offered, never ordered."),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Enforcement authority: none — a reminder never orders a provider and never applies a restriction./),
  ).toBeVisible();
  await expect(
    weightCard.getByText(/Provider path: SYNTH-Clinic-A · SYNTH-CHW-2/),
  ).toBeVisible();

  // THE AUTHORIZATION STATE — the observe-only DEFAULT is the loudest
  // truth (nothing happens when you miss a measurement).
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

  // The configured-policy SYNTH fixture variant behind its explicit
  // disclosure: restriction-authorized ONLY under an explicit policy +
  // authorization grant, with the bounded token.
  const variantToggle = page.getByRole("button", {
    name: "View the configured-policy fixture variant (SYNTH)",
  });
  await variantToggle.click();
  await expect(
    page.getByText(/Decision: restriction-authorized — Restriction authorized — under an explicit, authorized, configured policy only/),
  ).toBeVisible();
  await expect(
    page.getByText(/2 hours \(bounded — restrictions are at most 24 hours\)/),
  ).toBeVisible();

  // THE WIRE CONTRACTS (read-only): both chain routes answer honestly.
  const remindersResponse = await page.request.get("/api/today/reminders");
  expect(remindersResponse.ok()).toBeTruthy();
  const remindersBody = (await remindersResponse.json()) as {
    synthetic: boolean;
    quietHoursLabel: string;
    reminders: ReadonlyArray<{
      taskId: string;
      rung: string;
      deliveryState: string;
      fallbackOffer?: { enforcementAuthority: string };
    }>;
  };
  expect(remindersBody.synthetic).toBe(true);
  expect(remindersBody.quietHoursLabel).toBe("22:00–07:00");
  const weightReminder = remindersBody.reminders.find(
    (reminder) => reminder.taskId === "task_SYNTH-today-wt-000003",
  );
  expect(weightReminder).toBeDefined();
  expect(weightReminder?.rung).toBe("REMIND_WITH_FALLBACK_OFFER");
  expect(weightReminder?.deliveryState).toBe("delivered");
  expect(weightReminder?.fallbackOffer?.enforcementAuthority).toBe("none");

  const adherenceResponse = await page.request.get("/api/today/adherence");
  expect(adherenceResponse.ok()).toBeTruthy();
  const adherenceBody = (await adherenceResponse.json()) as {
    synthetic: boolean;
    posture: { variant: string; decision: { kind: string } };
    fixtureVariant: { variant: string; decision: { kind: string } };
  };
  expect(adherenceBody.synthetic).toBe(true);
  expect(adherenceBody.posture.variant).toBe("observe-only");
  expect(adherenceBody.posture.decision.kind).toBe("no-enforcement");
  expect(adherenceBody.fixtureVariant.variant).toBe("configured-policy");
  expect(adherenceBody.fixtureVariant.decision.kind).toBe("restriction-authorized");

  // NON-GAMIFICATION (the binding rule): no streak/penalty/points
  // vocabulary anywhere on the surface.
  for (const barred of [/streak/i, /penalt/i, /points/i]) {
    await expect(page.getByText(barred)).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------
// The cross-cutting invariants (grep-level, on the working tree).
// ---------------------------------------------------------------------------

test("M6 exit — cross-cutting invariants: web journeys complete, mobile paths exist, fixtures carry zero PHI", () => {
  // ---------------------------------------------------------------
  // INVARIANT 1 — WEB COMPLETE: the four journeys' dedicated specs
  // exist and carry their golden-journey proofs.
  // ---------------------------------------------------------------
  const webJourneySpecs: ReadonlyArray<{
    readonly file: string;
    readonly markers: readonly string[];
  }> = [
    {
      file: "apps/web/e2e/intent-journey.spec.ts",
      markers: ["golden journey #1", "see provenance on the result", "progress updated"],
    },
    {
      file: "apps/web/e2e/device-reconciliation.spec.ts",
      markers: ["golden journey #2", "reconcile into ONE canonical view", "per-source provenance"],
    },
    {
      file: "apps/web/e2e/sharing-journey.spec.ts",
      markers: ["golden journey #4", "revoke-with-confirm", "audit log"],
    },
    {
      file: "apps/web/e2e/journey7.spec.ts",
      markers: ["golden journey #7", "REMIND_WITH_FALLBACK_OFFER", "observe-only"],
    },
  ];
  for (const spec of webJourneySpecs) {
    const text = readRepoFile(spec.file);
    for (const marker of spec.markers) {
      if (!text.includes(marker)) {
        throw new Error(
          `M6 exit harness: ${spec.file} is missing its journey marker: ${marker}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // INVARIANT 2 — MOBILE PATHS EXIST: the supported mobile legs (the
  // Maestro flows + the pure models they assert against). Journey #2's
  // device import is the web Measurements surface at this milestone
  // (recorded boundary — no mobile device-import flow exists).
  // ---------------------------------------------------------------
  const mobilePaths: ReadonlyArray<{
    readonly file: string;
    readonly markers: readonly string[];
  }> = [
    // Journey #1's mobile leg: onboarding -> intent -> today -> capture.
    {
      file: "apps/mobile/maestro/flows/onboarding.yaml",
      markers: ["onboarding journey"],
    },
    {
      file: "apps/mobile/maestro/flows/intent.yaml",
      markers: ["golden journey", "intent creation"],
    },
    {
      file: "apps/mobile/maestro/flows/today.yaml",
      markers: ["Today/task-flow journey", "What matters today"],
    },
    {
      file: "apps/mobile/maestro/flows/capture.yaml",
      markers: ["manual capture journey", "quality self-assessment"],
    },
    // Journey #4's mobile leg: sharing + the consent posture.
    {
      file: "apps/mobile/maestro/flows/sharing.yaml",
      markers: ["sharing journey", "revoke"],
    },
    {
      file: "apps/mobile/maestro/flows/consent-settings.yaml",
      markers: ["consent-settings journey"],
    },
    // Journey #7's mobile leg (the M6-EXIT addition).
    {
      file: "apps/mobile/maestro/flows/journey7.yaml",
      markers: ["journey 7", "REMIND_WITH_FALLBACK_OFFER", "No restrictions are configured"],
    },
    // The pure mobile models the journey-#7 leg renders from.
    {
      file: "apps/mobile/src/lib/reminders/model.ts",
      markers: ["REMIND_WITH_FALLBACK_OFFER"],
    },
    {
      file: "apps/mobile/src/lib/adherence/model.ts",
      markers: ["restriction-authorized", "observe-only"],
    },
    {
      file: "apps/mobile/src/lib/today/model.ts",
      markers: ["task"],
    },
  ];
  for (const path of mobilePaths) {
    const text = readRepoFile(path.file);
    for (const marker of path.markers) {
      if (!text.includes(marker)) {
        throw new Error(
          `M6 exit harness: mobile path ${path.file} is missing its marker: ${marker}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // INVARIANT 3 — ZERO PHI (grep-level on the fixture files of the
  // four journeys' worlds; the agent-protocol test-data rules).
  // ---------------------------------------------------------------
  const fixtureFiles: readonly string[] = [
    // The journey-#7 chain (this packet's fixtures).
    "apps/web/src/lib/today/catalog.ts",
    "apps/web/src/lib/today/store.ts",
    "apps/web/src/lib/reminders/catalog.ts",
    "apps/web/src/lib/reminders/store.ts",
    "apps/web/src/lib/reminders/profile.ts",
    "apps/web/src/lib/adherence/catalog.ts",
    "apps/web/src/lib/adherence/store.ts",
    // Journey #4's world.
    "apps/web/src/lib/sharing/fixtures.ts",
    "apps/web/src/lib/sharing/catalog.ts",
    // Journeys #1/#2's capture + observation vocabulary.
    "apps/web/src/lib/capture/catalog.ts",
    "apps/web/src/lib/observations/catalog.ts",
    // The mobile journey-#7 models.
    "apps/mobile/src/lib/reminders/model.ts",
    "apps/mobile/src/lib/adherence/model.ts",
    "apps/mobile/src/lib/today/model.ts",
  ];

  /** Every domain-prefixed id must be SYNTH-marked. */
  const domainIdPattern = /\b(?:prsn|src|plan|task|remd|grant|shr|obs)_[A-Za-z0-9_-]+/g;
  /** Email-shaped strings (package specifiers like @orbb/ui cannot match). */
  const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  /** Phone-shaped strings (require the leading country-code +). */
  const phonePattern = /\+\d{1,3}[-\s]?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{0,4}\b/;
  /** SSN-shaped strings. */
  const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
  /** PHI field names that must never appear in fixtures. */
  const phiFieldPattern = /dateOfBirth|birthDate|homeAddress|streetAddress|socialSecurity|\bmrn\b/i;
  /** Clinician-style naming must be SYNTH-marked on its own line. */
  const clinicianLinePattern = /\bDr\.?\s+[A-Z]/;

  for (const file of fixtureFiles) {
    const text = readRepoFile(file);

    for (const match of text.match(domainIdPattern) ?? []) {
      if (!match.includes("SYNTH")) {
        throw new Error(
          `M6 exit harness: non-SYNTH domain id in ${file}: ${match} (zero-PHI rule)`,
        );
      }
    }
    for (const [name, pattern] of [
      ["an email-shaped string", emailPattern],
      ["a phone-shaped string", phonePattern],
      ["an SSN-shaped string", ssnPattern],
      ["a PHI field name", phiFieldPattern],
    ] as const) {
      if (pattern.test(text)) {
        throw new Error(`M6 exit harness: ${name} in ${file} (zero-PHI rule)`);
      }
    }
    for (const line of text.split("\n")) {
      if (clinicianLinePattern.test(line) && !line.includes("SYNTH")) {
        throw new Error(
          `M6 exit harness: unmarked clinician name in ${file}: ${line.trim()}`,
        );
      }
    }
  }
});
