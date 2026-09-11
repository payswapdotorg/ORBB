import { expect, test } from "@playwright/test";

/**
 * M0-B synthetic smoke journey (web shell).
 *
 * Exercises the user-mode surface the tech lead will build on:
 *   load `/` → 8 architecture nav items render → switch role to Clinician →
 *   nav emphasis changes → navigate to the DataBox journey → real surface
 *   mounts (M3-B: evidence table + sharing card on @orbb/ui).
 *
 * The shell is static: no network mocks of real APIs, no real data, no real
 * credentials — only synthetic placeholder strings and SYNTH fixtures.
 */
const NAV_LABELS = [
  "Overview",
  "Intents",
  "Measurements",
  "DataBox",
  "Care",
  "Research",
  "Marketplace",
  "Settings",
] as const;

test("web shell renders, role emphasis switches, and the DataBox journey loads", async ({
  page,
}) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();

  // 1. All eight architecture nav items render.
  for (const label of NAV_LABELS) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link")).toHaveCount(8);

  // Accessibility foundations are present and working.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeAttached();
  await expect(page.locator("#orbb-design-tokens")).toBeAttached();

  // The token package is actually consumed (CSS custom properties injected).
  const canvasToken = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue("--orbb-color-canvas"),
  );
  expect(canvasToken.trim().length).toBeGreaterThan(0);

  // 2. Default role is Person: 4 emphasized items, Care not emphasized.
  await expect(nav.locator('[data-emphasized="true"]')).toHaveCount(4);
  await expect(nav.getByRole("link", { name: "Care", exact: true })).toHaveAttribute(
    "data-emphasized",
    "false",
  );

  // 3. Switch role to Clinician — emphasis changes.
  await page.getByRole("radio", { name: "Clinician" }).check();
  await expect(nav.locator('[data-emphasized="true"]')).toHaveCount(3);
  await expect(nav.getByRole("link", { name: "Care", exact: true })).toHaveAttribute(
    "data-emphasized",
    "true",
  );
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "data-emphasized",
    "false",
  );
  await expect(
    page.getByRole("radio", { name: "Clinician" }),
  ).toBeChecked();

  // 4. Navigate to the DataBox journey and assert the real mounted surface
  //    (M3-B: the M0 placeholder was replaced by the design-system journey).
  await nav.getByRole("link", { name: "DataBox", exact: true }).click();
  await expect(page).toHaveURL(/\/databox$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "DataBox" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sharing" }),
  ).toBeVisible();
  await expect(page.getByText(/synthetic \(SYNTH\)/i)).toBeVisible();
});
