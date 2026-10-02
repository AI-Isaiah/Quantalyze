import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { render, screen, within } from "@testing-library/react";
import React from "react";

/**
 * Phase A1 contract test — single-source-of-truth for percentage rendering.
 *
 * The canonical helper lives at `src/lib/utils.ts#formatPercent`. Three
 * components used to ship local re-implementations (HoldingsTable,
 * HoldingDetail, OutcomesWidget) which made MTD render "12.34%" in some
 * places and "+12.34%" in others.
 *
 * This test fails if any TS/TSX file outside `src/lib/utils.ts` declares
 * a local `formatPercent` (function or const). New callers must import
 * from `@/lib/utils` and pass `{ signed: false }` for unsigned-domain
 * values like weights. The signed-vs-unsigned policy lives in one place.
 *
 * The test deliberately does NOT scan for inline `(x * 100).toFixed(N)%`
 * patterns — those appear in Recharts tickFormatters and tooltip
 * formatters where the API requires a function, not a string. A future
 * pass can migrate those once a `tickFormatPercent`-style helper exists.
 */

// HoldingsTable calls useRouter() (banner dismiss → router.refresh()). Mock
// next/navigation so the call-site render below mounts without a real router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

const SRC_ROOT = path.resolve(__dirname, "..");
const ALLOWED_DECLARATION_PATHS = new Set([
  path.join(SRC_ROOT, "lib", "utils.ts"),
]);

// Match `function formatPercent(`, `const formatPercent =`, and
// `const formatPercent:` declarations. Captures `formatPercentSigned` /
// `formatPercentile` etc. via the boundary check.
const DECLARATION_RE =
  /^\s*(?:export\s+)?(?:function\s+formatPercent\s*\(|const\s+formatPercent\s*[:=])/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield full;
    }
  }
}

describe("formatPercent single-source contract", () => {
  it("no source file outside src/lib/utils.ts declares a local formatPercent", () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of walk(SRC_ROOT)) {
      if (ALLOWED_DECLARATION_PATHS.has(file)) continue;

      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (DECLARATION_RE.test(line)) {
          violations.push({
            file: path.relative(SRC_ROOT, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `  src/${v.file}:${v.line}\n    ${v.text}\n    → import { formatPercent } from "@/lib/utils" instead`,
        )
        .join("\n\n");
      expect.fail(
        `Local formatPercent declaration(s) found. Use the canonical helper from @/lib/utils so MTD/weight/dd render the same way everywhere.\n\n${report}\n`,
      );
    }
  });
});

// =============================================================================
// H-1208 — call-site signed-flag contract (rendered, not AST)
// =============================================================================
//
// The AST scan above catches local re-declarations of formatPercent but is
// BLIND to call-site flag drift: if a contributor strips `{ signed: false }`
// from a Weight cell, every weight would silently render "+18.50%" instead of
// "18.50%". These tests render HoldingsTable + HoldingDetail with a known row
// and pin the rendered output so that flag drift FAILS in CI.
//
// Domains:
//   - Weight  → unsigned   (no leading "+"): formatPercent(w, 2, {signed:false})
//   - MTD     → signed      (gains show "+"): formatPercent(mtd, 2)
//   - Max DD  → signed/negative (always "-" for a drawdown): formatPercent(dd, 2)

import { HoldingsTable } from "@/app/(dashboard)/allocations/components/HoldingsTable";
import { HoldingDetail } from "@/app/(dashboard)/allocations/components/HoldingDetail";
import type { DesignHoldingRow } from "@/app/(dashboard)/allocations/lib/holdings-adapter";
import type { StrategyRow } from "@/app/(dashboard)/allocations/lib/strategies-row-adapter";

function makeFormatRow(
  overrides: Partial<DesignHoldingRow> = {},
): DesignHoldingRow {
  return {
    id: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    strategy: "Fmt Strategy",
    manager: "TST-001",
    tag: "trend",
    alloc: 100_000,
    weight: 0.185,
    mtd: 0.0217,
    sharpe: 1.84,
    dd: -0.091,
    age: 90,
    status: "ok",
    bridgeCandidate: false,
    ...overrides,
  };
}

/** Fixture for the SECOND Weight cell — HoldingsTable's strategy-rows table. */
function makeStrategyFormatRow(
  overrides: Partial<StrategyRow> & { id: string },
): StrategyRow {
  return {
    strategy: "Fmt Strategy",
    manager: "TST-001",
    capitalOwnership: "own_capital",
    weight: 0.185,
    allocation: 100_000,
    mtd: null,
    sharpe: 1.84,
    maxDd: -0.091,
    age: 90,
    ...overrides,
  };
}

describe("formatPercent call-site signed-flag contract (H-1208)", () => {
  it("HoldingsTable Weight cell is unsigned ('18.50%', no leading +); MTD is '+2.17%'; Max DD is '-9.10%'", () => {
    const row = makeFormatRow();
    render(React.createElement(HoldingsTable, { rows: [row] }));

    // Weight: unsigned domain. MUST NOT carry a leading '+'.
    expect(screen.getByText("18.50%")).toBeInTheDocument();
    expect(screen.queryByText("+18.50%")).not.toBeInTheDocument();

    // MTD: signed domain, positive value → leading '+'.
    expect(screen.getByText("+2.17%")).toBeInTheDocument();

    // Max DD: negative value renders the natural '-' sign.
    expect(screen.getByText("-9.10%")).toBeInTheDocument();
  });

  it("HoldingDetail Metrics tab: Weight is '18.50%' (unsigned), MTD '+2.17%', Max DD '-9.10%'", () => {
    const row = makeFormatRow();
    const { container } = render(
      React.createElement(HoldingDetail, { row }),
    );
    const scope = within(container);

    // Weight unsigned — no '+' prefix.
    expect(scope.getByText("18.50%")).toBeInTheDocument();
    expect(scope.queryByText("+18.50%")).not.toBeInTheDocument();

    // MTD signed positive.
    expect(scope.getByText("+2.17%")).toBeInTheDocument();

    // Max DD negative.
    expect(scope.getByText("-9.10%")).toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 150 / OWN-03 — HoldingsTable has TWO Weight cells, in two different
  // tables, and they DISAGREED until this phase.
  //
  // The design-holdings cell (asserted above) passed `{ signed: false }`; the
  // STRATEGY-ROWS cell called `formatPercent(row.weight)` with default options,
  // so the same domain rendered "+24.00%" in one table and "24.00%" in the
  // other. The signed one was the non-conforming sibling — a weight is a SHARE,
  // not a gain, so it never carries a sign prefix. Fixed in 150-07 and pinned
  // here, in the same file as its sibling, so the pair cannot drift apart again
  // (the AST scan above is blind to call-site flag drift; only a rendered
  // assertion catches it).
  //
  // The strategy-rows Weight value is RENDER-DERIVED (D-12-B): allocation ÷ Σ
  // allocation across the allocated own-capital rows. The fixture below is
  // 120,000 of a 500,000 allocated book — the approved mock's `24.00%`.
  it("HoldingsTable strategy-rows Weight cell is unsigned ('24.00%', no leading +)", () => {
    render(
      React.createElement(HoldingsTable, {
        strategyRows: [
          makeStrategyFormatRow({
            id: "black-swan",
            strategy: "Black Swan",
            allocation: 120_000,
            weight: 120_000 / 500_000,
            mtd: 0.0217,
          }),
          makeStrategyFormatRow({
            id: "arctic-fox",
            strategy: "Arctic Fox",
            allocation: 380_000,
            weight: 380_000 / 500_000,
          }),
        ],
      }),
    );

    // Weight: unsigned domain in BOTH tables. MUST NOT carry a leading '+'.
    expect(screen.getByText("24.00%")).toBeInTheDocument();
    expect(screen.queryByText("+24.00%")).not.toBeInTheDocument();
    expect(screen.getByText("76.00%")).toBeInTheDocument();
    expect(screen.queryByText("+76.00%")).not.toBeInTheDocument();

    // MTD stays SIGNED in this table too — the fix is scoped to the weight
    // domain, not applied blanket-wise across the row.
    expect(screen.getByText("+2.17%")).toBeInTheDocument();
  });
});
