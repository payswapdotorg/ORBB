/**
 * @orbb/db — persistence boundary package (M0).
 *
 * Future responsibility (architecture §2, §4): owns the Drizzle schema,
 * migrations, and repositories over the structured health ledger, plus
 * the transactional outbox tables. Every domain mutation will run inside
 * a transaction that writes domain state and an outbox event together.
 *
 * M0 contract handoff: this package re-exports nothing yet. When
 * persistence lands, it will consume `@orbb/domain` and
 * `@orbb/contracts` types (OutboxRecord in particular) and must never
 * leak provider SDK types (Neon/Drizzle) upward.
 */
export {};
