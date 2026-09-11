"use client";

import { useState } from "react";

/** Sort direction for a table column. */
export type SortDirection = "asc" | "desc";

/** Which column is sorted, and in which direction. */
export interface ColumnSort {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/**
 * Pure sort-state transition for a sortable column (M1-B).
 *
 * Cycling rule: unsorted → ascending → descending → ascending (a column
 * stays "armed" once sorted; only a different column resets it to
 * ascending). The function is pure and side-effect free so it can be unit
 * tested and shared by any table implementation.
 *
 * @param current the active sort state (`null` when the table is unsorted)
 * @param columnId the column whose sort affordance was activated
 * @returns the next sort state
 */
export function toggleColumnSort(
  current: ColumnSort | null,
  columnId: string,
): ColumnSort {
  if (current === null || current.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  return {
    columnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

/**
 * Convenience hook wrapping {@link toggleColumnSort} in local state — the
 * "sortable column hook as a pure function" from the design-system list:
 * all transition logic lives in the pure function, this hook only owns
 * state.
 *
 * @param initial initial sort state (defaults to unsorted)
 * @returns `[sort, sortBy]` — the current state and a column-activation
 * callback suitable for `Table`'s `onSortChange`.
 */
export function useColumnSort(
  initial: ColumnSort | null = null,
): readonly [ColumnSort | null, (columnId: string) => void] {
  const [sort, setSort] = useState<ColumnSort | null>(initial);

  const sortBy = (columnId: string): void => {
    setSort((current) => toggleColumnSort(current, columnId));
  };

  return [sort, sortBy] as const;
}
