/**
 * Phase 50 / Plan 50-01 / UI-02 — Table base primitive RED contract.
 *
 * RED (Wave 0): `src/components/ui/Table.tsx` does NOT exist yet — this spec
 * fails on the import until Wave-1 Plan 03 builds the semantic <table> wrapper.
 * The contract precedes the implementation by design (BP-03).
 *
 * Behaviour contract (50-UI-SPEC.md §Table base + 50-RESEARCH.md Pattern 3):
 *   1. Header cells render with scope="col" — reachable via
 *      getByRole("columnheader").
 *   2. The table carries an accessible name (caption or aria-label) so a
 *      page with >1 table keeps distinct landmark names (the ResponsiveTable
 *      unique-aria-label contract this base must NOT regress) —
 *      getByRole("table", { name }) resolves it.
 *
 * RTL render/region pattern borrowed from CardShell.test.tsx; the semantic
 * <th scope> markup mirrors admin/usage/page.tsx.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "./Table";

function renderBasicTable() {
  return render(
    <Table aria-label="Strategy returns">
      <TableHead>
        <TableRow>
          <TableHeaderCell scope="col">Strategy</TableHeaderCell>
          <TableHeaderCell scope="col">Return %</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>Alpha</TableCell>
          <TableCell>12.3</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("<Table> (semantic base primitive)", () => {
  it("renders header cells with scope=col (reachable as columnheader)", () => {
    renderBasicTable();
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    headers.forEach((th) => expect(th.getAttribute("scope")).toBe("col"));
  });

  it("exposes the table by its accessible name (aria-label landmark contract)", () => {
    renderBasicTable();
    expect(
      screen.getByRole("table", { name: "Strategy returns" }),
    ).toBeInTheDocument();
  });

  it("renders the body cells as table data", () => {
    renderBasicTable();
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
  });
});
