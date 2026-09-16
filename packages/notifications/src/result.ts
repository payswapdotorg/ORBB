/**
 * @orbb/notifications result alias — the shared engine-result shape.
 *
 * The engine re-uses `EngineResult`/`ok`/`err` from `@orbb/measurement`
 * (single monorepo result discipline, zero duplication); this alias gives
 * consumers a self-describing notifications-flavored name for it.
 */
import type { EngineResult } from "@orbb/measurement";

/** {@link import("@orbb/measurement").EngineResult}, aliased for this package's contract. */
export type NotificationResult<T, E> = EngineResult<T, E>;
