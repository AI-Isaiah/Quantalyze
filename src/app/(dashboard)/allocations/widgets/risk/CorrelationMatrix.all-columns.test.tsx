import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CorrelationMatrix } from "./CorrelationMatrix";
import type { TimeframeKey } from "../../lib/types";

/**
 * TABLE-01 / SC#2 — fail-loud all-columns render guard for CorrelationMatrix.
 *
 * The reshape onto `ResponsiveTable` (Plan 46-02) makes the N×N matrix SCROLL
 * horizontally, never drop a strategy. This guard structurally pins the
 * symmetric N×N contract so a future column/row drop fails CI LOUDLY (CLAUDE.md
 * Rule 12) instead of silently hiding a strategy from a mobile user.
 *
 * It asserts the matrix is square and complete:
 *   - header `<th>` count (the named column headers) === N
 *   - row-label `<td>` count === N
 *   - therefore header count === row-label count === N
 *   - every strategy name appears as BOTH a column header AND a row label
 *   - `data-testid="corr-cell"` count === N × N (every intersection rendered)
 *   - `data-testid="correlation-matrix"` root present
 *
 * Label ellipsis (the `truncate` + `title={n}` long-name treatment) is NOT a
 * drop — the guard polices PRESENCE (the name is still a header/row-label DOM
 * node, reachable), never ellipsis.
 *
 * Falsifiability (proven manually at write time, recorded in 46-02-SUMMARY):
 *   - Dropping a row from the rendered matrix (e.g. `matrix.map` skipping the
 *     last row) makes row-label count < N → the equality assertion goes RED.
 *   - Dropping a column header (`names.map` skipping the last name) makes header
 *     count < N → RED.
 *   Both restored to green.
 *
 * Uses the precomputed `analytics.correlation_matrix` path (the same path the
 * boundary test exercises) with N = 3 distinct strategies.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

// N = 3 distinct strategies with a full symmetric precomputed matrix.
const NAMES = ["Alpha", "Beta", "Gamma"] as const;
const N = NAMES.length;

const PRECOMPUTED = {
  strategies: [
    { strategy_id: "a", alias: "Alpha" },
    { strategy_id: "b", alias: "Beta" },
    { strategy_id: "c", alias: "Gamma" },
  ],
  analytics: {
    correlation_matrix: {
      a: { a: 1, b: 0.5, c: -0.2 },
      b: { a: 0.5, b: 1, c: 0.3 },
      c: { a: -0.2, b: 0.3, c: 1 },
    },
  },
};

describe("CorrelationMatrix — all-columns guard (TABLE-01 / SC#2)", () => {
  it("renders a complete symmetric N×N matrix — header count === row-label count === N", () => {
    render(<CorrelationMatrix data={PRECOMPUTED} {...base} />);

    // The honest-data root is present (not the error card, not the empty branch).
    expect(screen.queryByRole("alert")).toBeNull();
    const root = screen.getByTestId("correlation-matrix");
    expect(root).toBeInTheDocument();

    const table = within(root).getByRole("table");

    // Column headers: the first <th> is the empty corner cell; the remaining
    // are the N named strategy headers. Anchor on the named set, not the corner.
    const headerCells = within(table).getAllByRole("columnheader");
    const namedHeaders = headerCells.filter(
      (th) => (th.textContent ?? "").trim().length > 0,
    );
    expect(namedHeaders).toHaveLength(N);

    // Row labels: each <tr> in the body leads with a row-label <td> carrying the
    // strategy name. There are N data rows, so N row labels.
    const bodyRows = within(table).getAllByRole("row").filter((tr) => {
      // a data row has a corr-cell descendant; the header row does not.
      return within(tr).queryAllByTestId("corr-cell").length > 0;
    });
    expect(bodyRows).toHaveLength(N);

    // The symmetric contract: header count === row-label count === N.
    expect(namedHeaders).toHaveLength(bodyRows.length);

    // Every strategy name appears BOTH as a column header AND as a row label.
    for (const nm of NAMES) {
      // present as a header (ellipsis OK — presence, not exact glyph)
      expect(
        namedHeaders.some((th) => (th.textContent ?? "").includes(nm)),
      ).toBe(true);
      // present as a row label: the leading <td title={name}> of some data row
      const labelled = bodyRows.some((tr) => {
        const firstCell = tr.querySelector("td");
        return firstCell?.getAttribute("title") === nm;
      });
      expect(labelled).toBe(true);
    }

    // Every (i, j) intersection cell rendered — N × N corr-cells. A dropped
    // row or column moves this below N² → RED.
    const cells = within(table).getAllByTestId("corr-cell");
    expect(cells).toHaveLength(N * N);
  });
});
