/**
 * @orbb/testkit — deterministic test toolkit for ORBB.
 *
 * Public surface:
 *   - `Clock` / `DeterministicClock` — injectable deterministic time.
 *   - `IdFactory` / `DeterministicIdFactory` — monotonic, seeded, obviously
 *     synthetic identifiers.
 *   - `SyntheticFixtures` + `synthetic*()` builders — synthetic people,
 *     devices, observations (evidenceLabel + provenance), and consent
 *     grants, all tagged `synthetic: true`.
 *   - `TestReset` / `InMemoryTestReset` — per-suite deterministic reset
 *     (clock to epoch, counters to zero, stores cleared).
 */
export * from "./clock.js";
export * from "./ids.js";
export * from "./fixtures.js";
export * from "./reset.js";
