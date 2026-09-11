"use client";

import type { ReactNode } from "react";
import { Button } from "../Button";
import { color, spacing, typography } from "../../tokens";
import { toggleColumnSort } from "./sort";
import type { ColumnSort } from "./sort";

export interface TableColumn {
  /** Stable column identifier (keys into `TableRow.cells`). */
  id: string;
  /** Header cell content. */
  header: ReactNode;
  /** Cell text alignment. Defaults to `left`. */
  align?: "left" | "center" | "right";
  /** Renders the header as a sort affordance (`aria-sort` + button). */
  sortable?: boolean;
  /** Preferred column width (CSS value). */
  width?: string | number;
}

export interface TableRow {
  /** Stable row identifier (used as the React key). */
  id: string;
  /** Cell content keyed by column id; missing keys render empty cells. */
  cells: Readonly<Record<string, ReactNode>>;
}

export interface TableProps {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  /** Table caption (rendered as the `<caption>` element). */
  caption?: ReactNode;
  /** Active sort state (controlled; sorting the data itself is the caller's job). */
  sort?: ColumnSort | null;
  /** Called with the next sort state when a sortable header is activated. */
  onSortChange?: (next: ColumnSort) => void;
}

/**
 * Table primitive (M1-B): semantic table markup (`table`/`caption`/`thead`/
 * `tbody`/`th[scope]`) with an opt-in sortable-column affordance.
 *
 * The component is presentational with respect to data order: it renders
 * whatever `rows` it is given and reports sort intent through
 * `onSortChange`, with all state transitions computed by the pure
 * {@link toggleColumnSort} function (`table/sort.ts`). Pair with the
 * `useColumnSort` hook for unmanaged state.
 *
 * Accessibility:
 * - real table semantics with `scope="col"` headers and a `<caption>`;
 * - sortable headers expose `aria-sort` and a real button (keyboard
 *   activation, 44px touch target via the `Button` primitive);
 * - the sort direction indicator glyph is `aria-hidden` — screen readers
 *   receive the state through `aria-sort`.
 */
export function Table({
  columns,
  rows,
  caption,
  sort = null,
  onSortChange,
}: TableProps) {
  const alignment = (align: TableColumn["align"]): "left" | "center" | "right" =>
    align === "center" ? "center" : align === "right" ? "right" : "left";

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: typography.family.sans,
          fontSize: `${typography.size.sm}px`,
          color: color.fgPrimary,
        }}
      >
        {caption !== undefined ? (
          <caption
            style={{
              captionSide: "top",
              textAlign: "left",
              padding: `${spacing[2]}px 0`,
              color: color.fgMuted,
              fontSize: `${typography.size.xs}px`,
              lineHeight: typography.lineHeight.normal,
            }}
          >
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const isSortedColumn = sort !== null && sort.columnId === column.id;
              const ariaSort =
                column.sortable === true
                  ? isSortedColumn
                    ? sort?.direction === "desc"
                      ? "descending"
                      : "ascending"
                    : "none"
                  : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  style={{
                    textAlign: alignment(column.align),
                    width: column.width,
                    padding: `${spacing[2]}px ${spacing[3]}px`,
                    borderBottom: `1px solid ${color.borderStrong}`,
                    color: color.fgPrimary,
                    fontSize: `${typography.size.xs}px`,
                    fontWeight: typography.weight.semibold,
                    lineHeight: typography.lineHeight.normal,
                    whiteSpace: "nowrap",
                  }}
                >
                  {column.sortable === true ? (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        onSortChange?.(toggleColumnSort(sort, column.id));
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: `${spacing[1]}px` }}>
                        {column.header}
                        {isSortedColumn ? (
                          <span aria-hidden="true" style={{ color: color.accent }}>
                            {sort?.direction === "desc" ? "↓" : "↑"}
                          </span>
                        ) : null}
                      </span>
                    </Button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  style={{
                    textAlign: alignment(column.align),
                    padding: `${spacing[3]}px`,
                    borderBottom: `1px solid ${color.borderSubtle}`,
                    color: color.fgPrimary,
                    lineHeight: typography.lineHeight.normal,
                    verticalAlign: "top",
                  }}
                >
                  {row.cells[column.id] ?? null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
