// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Table } from "./Table";
import { useColumnSort } from "./sort";

afterEach(cleanup);

const columns = [
  { id: "name", header: "Name" },
  { id: "count", header: "Count", sortable: true, align: "right" as const },
] as const;

const rows = [
  { id: "row-1", cells: { name: "Synthetic alpha", count: "12" } },
  { id: "row-2", cells: { name: "Synthetic beta", count: "7" } },
  { id: "row-3", cells: { name: "Synthetic gamma" } },
] as const;

describe("Table", () => {
  it("renders semantic table markup with scoped headers and a caption", () => {
    render(<Table columns={columns} rows={rows} caption="Synthetic inventory" />);
    const table = screen.getByRole("table");
    expect(table).toBeInstanceOf(HTMLTableElement);
    expect(screen.getByText("Synthetic inventory").tagName).toBe("CAPTION");
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(columns.length);
    for (const header of headers) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    const bodyRows = screen.getAllByRole("row").filter((row) => row.querySelector("td"));
    expect(bodyRows).toHaveLength(rows.length);
  });

  it("renders cell content keyed by column id and empty cells for gaps", () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText("Synthetic alpha")).toBeTruthy();
    expect(screen.getByText("Synthetic gamma")).toBeTruthy();
    const gammaRow = screen.getByText("Synthetic gamma").closest("tr");
    expect(gammaRow?.querySelectorAll("td")).toHaveLength(2);
    const countCell = gammaRow?.querySelectorAll("td")[1];
    expect(countCell?.textContent).toBe("");
  });

  it("exposes aria-sort on the sorted column and none on other sortable columns", () => {
    const { rerender } = render(
      <Table
        columns={columns}
        rows={rows}
        sort={{ columnId: "count", direction: "desc" }}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: /Count/ }).getAttribute("aria-sort"),
    ).toBe("descending");

    rerender(
      <Table
        columns={columns}
        rows={rows}
        sort={{ columnId: "count", direction: "asc" }}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: /Count/ }).getAttribute("aria-sort"),
    ).toBe("ascending");

    rerender(<Table columns={columns} rows={rows} sort={null} />);
    expect(
      screen.getByRole("columnheader", { name: /Count/ }).getAttribute("aria-sort"),
    ).toBe("none");
  });

  it("omits aria-sort on columns that are not sortable", () => {
    render(<Table columns={columns} rows={rows} />);
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    expect(nameHeader.getAttribute("aria-sort")).toBeNull();
    expect(nameHeader.querySelector("button")).toBeNull();
  });

  it("reports the next sort state through onSortChange", () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <Table columns={columns} rows={rows} onSortChange={onSortChange} />,
    );
    const sortButton = screen.getByRole("button", { name: /Count/ });
    fireEvent.click(sortButton);
    expect(onSortChange).toHaveBeenCalledWith({
      columnId: "count",
      direction: "asc",
    });

    rerender(
      <Table
        columns={columns}
        rows={rows}
        onSortChange={onSortChange}
        sort={{ columnId: "count", direction: "asc" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Count/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({
      columnId: "count",
      direction: "desc",
    });
  });

  it("sort affordances are real buttons with 44px touch targets", () => {
    render(<Table columns={columns} rows={rows} />);
    const sortButton = screen.getByRole("button", { name: /Count/ });
    expect(sortButton).toBeInstanceOf(HTMLButtonElement);
    expect(Number.parseInt(sortButton.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});

describe("useColumnSort", () => {
  it("manages sort state through the pure transition", () => {
    const { result } = renderHook(() => useColumnSort());
    expect(result.current[0]).toBeNull();

    act(() => {
      result.current[1]("count");
    });
    expect(result.current[0]).toEqual({ columnId: "count", direction: "asc" });

    act(() => {
      result.current[1]("count");
    });
    expect(result.current[0]).toEqual({ columnId: "count", direction: "desc" });

    act(() => {
      result.current[1]("name");
    });
    expect(result.current[0]).toEqual({ columnId: "name", direction: "asc" });
  });

  it("accepts an initial sort state", () => {
    const { result } = renderHook(() =>
      useColumnSort({ columnId: "count", direction: "desc" }),
    );
    expect(result.current[0]).toEqual({ columnId: "count", direction: "desc" });
  });
});
