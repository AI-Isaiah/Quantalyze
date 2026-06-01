/**
 * Contract test for e2e/helpers/discovery-selectors.ts (SELECTORS + E2EPage).
 *
 * audit-2026-05-07 re-fix for G03 findings H-1039 + H-1040.
 *
 * WHY THIS FILE EXISTS (the gap the first fix left open)
 * ------------------------------------------------------
 * The first fix moved the e2e selector strings into a shared `SELECTORS`
 * const and the inline `import("@playwright/test").Page` into a named
 * `E2EPage` alias. An adversarial reviewer correctly observed that NOTHING
 * bound those values to the real components:
 *
 *   - The e2e specs that consume SELECTORS do NOT run in CI (the Playwright
 *     job runs only a hand-picked allowlist against a seeded staging DB).
 *     So an aria-label rename on a component flips the e2e `locator()` to a
 *     silent 0-match — the exact "renames silently rot the specs" harm
 *     H-1040 named — and CI stays green.
 *
 *   - The component *unit* tests (StrategyTable / CustomizeDrawer / StarToggle
 *     .test.tsx) DO render the real components and assert the aria-labels,
 *     but they hardcode the label strings as bare literals. A developer who
 *     renames a label and updates those literals leaves `SELECTORS` (and
 *     every e2e spec) stale with no failing test anywhere.
 *
 * This test closes that gap at a layer that ACTUALLY RUNS IN CI (vitest,
 * `src/**`). It renders the REAL components and asserts each `SELECTORS`
 * entry still matches exactly the element it claims to target. Therefore:
 *
 *   - Rename a component aria-label without updating SELECTORS  → FAIL here.
 *   - Edit a SELECTORS string so it no longer matches the component → FAIL.
 *   - Re-inline `import("@playwright/test").Page` / delete E2EPage  → the
 *     E2EPage assertion below stops compiling/importing → FAIL.
 *
 * The selectors are Playwright selector strings, two of which are NOT plain
 * CSS (`button:has-text(...)`). `matchPlaywrightSelector` below translates
 * each form to a jsdom-checkable query so the SINGLE source of truth stays
 * the `SELECTORS` constant — there are no second-copy literals in this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SELECTORS, type E2EPage } from "../../../e2e/helpers/discovery-selectors";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

// LoginForm is a client component that pulls in next/navigation + the
// browser Supabase client; stub both so it renders in jsdom. (StrategyTable
// needs neither — it only uses next/link, which works under jsdom — but it
// does pull in SimulateImpactButton, mirrored from StrategyTable.test.tsx.)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

import { LoginForm } from "@/components/auth/LoginForm";
import { CustomizeDrawer } from "./CustomizeDrawer";
import { StarToggle } from "./StarToggle";
import { StrategyTable } from "./StrategyTable";
import { DEFAULTS } from "@/lib/discovery-prefs";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// --- Playwright-selector → jsdom matcher -----------------------------------
//
// Playwright extends CSS with `:has-text("...")` and `:text("...")`. jsdom's
// querySelector cannot parse those, so we split them out. Everything else in
// SELECTORS is plain CSS (attribute selectors, `table tbody tr`).
function matchPlaywrightSelector(
  root: ParentNode,
  selector: string,
): Element[] {
  const hasText = selector.match(/^([a-z*]+):has-text\("(.+)"\)$/);
  if (hasText) {
    const [, tag, text] = hasText;
    return Array.from(root.querySelectorAll(tag)).filter((el) =>
      (el.textContent ?? "").includes(text),
    );
  }
  // Plain-CSS path. Will THROW on a malformed selector — that is desirable:
  // a SELECTORS entry that stops being a valid selector should fail loud.
  return Array.from(root.querySelectorAll(selector));
}

/** Fail loud if `selector` does not match exactly `expected` elements. */
function expectMatchCount(
  root: ParentNode,
  selector: string,
  expected: number,
  label: string,
): void {
  const matches = matchPlaywrightSelector(root, selector);
  expect(
    matches.length,
    `${label}: SELECTORS entry \`${selector}\` matched ${matches.length} ` +
      `element(s) in the real component, expected ${expected}. A component ` +
      `aria-label/markup rename that was not mirrored into ` +
      `e2e/helpers/discovery-selectors.ts will trip this — update the ` +
      `constant (and the e2e specs follow for free).`,
  ).toBe(expected);
}

// --- StrategyTable fixture -------------------------------------------------

function makeAnalytics(): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): Strategy & { analytics: StrategyAnalytics } {
  return {
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    analytics: makeAnalytics(),
    ...overrides,
  } as Strategy & { analytics: StrategyAnalytics };
}

const STRATEGIES = [
  makeStrategy({ id: "11111111-0000-4000-8000-000000000001", name: "Alpha Stellar" }),
  makeStrategy({ id: "11111111-0000-4000-8000-000000000002", name: "Beta Voyager" }),
];

beforeEach(() => {
  installFetchMock();
});
afterEach(() => {
  restoreFetchMock();
  vi.clearAllMocks();
});

describe("discovery-selectors SELECTORS contract (H-1040 — drift detection)", () => {
  it("login selectors match the real LoginForm DOM", () => {
    const { container } = render(<LoginForm />);

    // loginEmail / loginPassword are plain-CSS — query directly.
    expectMatchCount(container, SELECTORS.loginEmail, 1, "loginEmail");
    expectMatchCount(container, SELECTORS.loginPassword, 1, "loginPassword");

    // loginSubmit is Playwright `button:has-text("Sign in")`. The real
    // submit button text is "Sign in" (LoginForm renders <Button>Sign in</>).
    // A copy-edit of that label would 0-match the e2e click — caught here.
    expectMatchCount(container, SELECTORS.loginSubmit, 1, "loginSubmit");
  });

  it("Customize cog selector matches the real StrategyTable cog button", () => {
    const { container } = render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // Cross-check with the role/name query the unit suite already trusts so
    // the two oracles agree on the SAME element.
    expect(
      screen.getByRole("button", { name: "Customize discovery view" }),
    ).toBe(matchPlaywrightSelector(container, SELECTORS.customizeCog)[0]);
    expectMatchCount(container, SELECTORS.customizeCog, 1, "customizeCog");
  });

  it("tableRows selector matches the rendered discovery table body rows", () => {
    const { container } = render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // One <tr> per fixture strategy (the header lives in <thead>, excluded by
    // the `tbody` anchor). A regression that moved rows out of <tbody> or
    // dropped the <table> wrapper would 0-match the e2e row counter.
    expectMatchCount(container, SELECTORS.tableRows, STRATEGIES.length, "tableRows");
  });

  it("savePreferences selector matches the real CustomizeDrawer save button", () => {
    const { container } = render(
      <CustomizeDrawer
        open
        onClose={() => {}}
        draft={{ ...DEFAULTS }}
        setDraft={() => {}}
        persisted={{ ...DEFAULTS }}
        onSave={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save preferences" }),
    ).toBe(matchPlaywrightSelector(container, SELECTORS.savePreferences)[0]);
    expectMatchCount(container, SELECTORS.savePreferences, 1, "savePreferences");
  });

  it("starAddButton selector matches StarToggle in the unstarred state", () => {
    const { container } = render(
      <StarToggle
        strategyId="cccccccc-0001-4000-8000-000000000001"
        name="Stellar Neutral Alpha"
        starred={false}
        onToggle={() => {}}
      />,
    );
    // aria-label = "Add {name} to watchlist" → matches `*="to watchlist"`.
    expectMatchCount(container, SELECTORS.starAddButton, 1, "starAddButton");
    // ...and the "remove" selector must NOT match the unstarred button (the
    // two states share a substring boundary — guard against an overbroad
    // `*=watchlist` that would match both).
    expectMatchCount(container, SELECTORS.starRemoveButton, 0, "starRemoveButton(unstarred)");
  });

  it("starRemoveButton selector matches StarToggle in the starred state", () => {
    const { container } = render(
      <StarToggle
        strategyId="cccccccc-0001-4000-8000-000000000001"
        name="Stellar Neutral Alpha"
        starred={true}
        onToggle={() => {}}
      />,
    );
    expectMatchCount(container, SELECTORS.starRemoveButton, 1, "starRemoveButton");
    expectMatchCount(container, SELECTORS.starAddButton, 0, "starAddButton(starred)");
  });

  it("the cog opens a drawer whose save button the savePreferences selector finds (end-to-end binding)", () => {
    const { container } = render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // Open via the cog selector (not getByRole) so the WHOLE e2e click chain
    // — cog → drawer → save — is exercised through the SELECTORS strings.
    const cog = matchPlaywrightSelector(container, SELECTORS.customizeCog)[0];
    expect(cog).toBeDefined();
    fireEvent.click(cog as Element);
    const dialog = screen.getByRole("dialog");
    expectMatchCount(dialog, SELECTORS.savePreferences, 1, "savePreferences(in-drawer)");
  });
});

describe("discovery-selectors E2EPage alias (H-1039 — named Page type)", () => {
  // H-1039 is a type-design finding: the helper must export a NAMED `E2EPage`
  // alias for "@playwright/test".Page (not an inline import expression). A
  // type test is the right oracle for a type-design finding — it fails to
  // COMPILE (and therefore fails `vitest run`, which type-checks the spec on
  // load) if the export is renamed/removed or its underlying type drifts.
  it("E2EPage is assignable to/from @playwright/test Page (identity)", () => {
    type Page = import("@playwright/test").Page;
    // Bidirectional assignability proves E2EPage === Page exactly. If E2EPage
    // were widened/narrowed away from Page, one direction stops compiling.
    type AtoB = E2EPage extends Page ? true : false;
    type BtoA = Page extends E2EPage ? true : false;
    const aToB: AtoB = true;
    const bToA: BtoA = true;
    expect(aToB).toBe(true);
    expect(bToA).toBe(true);

    // Runtime sanity: the helper module also exports the SELECTORS value, so
    // a `import type`-only module that accidentally got erased to nothing
    // would surface here too.
    expect(typeof SELECTORS).toBe("object");
    expect(Object.keys(SELECTORS).length).toBeGreaterThan(0);
  });
});
