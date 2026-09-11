import { defineConfig } from "drizzle-kit";

/**
 * @orbb/db drizzle-kit configuration (A14).
 *
 * `drizzle-kit generate` needs NO database connection — it diffs the
 * schema in `src/schema.ts` against `migrations/meta/*_snapshot.json`
 * and emits additive SQL migrations (expand/contract discipline: this
 * packet is expand-only). `drizzle-kit push`/`migrate` (which DO need a
 * live connection) are never run by this package's scripts; migrations
 * are applied by the runtime migrator (see `src/testing.ts` and the
 * DATABASE_URL-gated integration tests).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
