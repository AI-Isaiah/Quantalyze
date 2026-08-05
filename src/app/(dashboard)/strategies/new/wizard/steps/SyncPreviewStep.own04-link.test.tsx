/** @vitest-environment jsdom */
/**
 * Phase 148 Plan 05 — OWN-04: the wizard preview links to the REAL factsheet.
 *
 * THIRD sibling file. `SyncPreviewStep.render.test.tsx` (the 874-line SC-4
 * neutrality pin) and `SyncPreviewStep.composite.render.test.tsx` stay
 * FROZEN/untouched — this file adds the OWN-04-only pins, exactly as the
 * composite sibling's own header prescribes.
 *
 * What is pinned (ROADMAP SC3):
 *   1. BOTH terminal-success branches — single-key AND composite — render the
 *      SAME element with the SAME copy. One local component, so the copy
 *      cannot drift between the two sites (148-UI-SPEC:118).
 *   2. New tab, safely: `target="_blank"` + `rel="noopener noreferrer"`
 *      (reverse-tabnabbing / referrer leakage, threat T-148-06b).
 *   3. PERSISTENT underline (`underline underline-offset-4`), not the
 *      hover-only in-wizard precedent — WCAG 1.4.1, DESIGN.md 2026-06-28.
 *   4. STRUCTURAL ABSENCE pre-success. `kicking_off` / `waiting_for_complete` /
 *      `gate_failed` render NO link node and NO disabled/greyed variant. The
 *      standing UAT direction bans disabled controls, so "absent" — not
 *      "present but inert" — is the specification.
 *
 * ⚠️ Oracle independence: every expected value below (href, rel, target,
 * class tokens, testid, copy) is a LITERAL typed into this file. Nothing is
 * imported from SyncPreviewStep.tsx, so a mutation of the component cannot
 * move the oracle with it.
 *
 * Mock idioms (mutable client factory, column-string discrimination,
 * fake-timer act-flush) are cloned from the two frozen siblings verbatim.
 *
 * RED evidence (2026-08-05, before the link existed — plan 148-05 task 1):
 *   Tests  5 failed | 3 passed (8)
 *   TestingLibraryElementError: Unable to find an element by:
 *     [data-testid="wizard-view-full-factsheet"]
 * All FIVE presence tests red; the three greens are the structural-absence
 * cases, which are green BY DESIGN both before and after the implementation
 * (nothing rendered a link pre-success then, and nothing may render one now).
 * That asymmetry is the point: only the presence half can distinguish the two
 * states, so only it is allowed to move.
 */
import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// --- Literals (the oracle). Never import these from the component. ---------
const LINK_TESTID = "wizard-view-full-factsheet";
const LINK_TEXT = "View full factsheet →";
const LINK_CAPTION = "Visible only to you until the strategy is published.";
const SINGLE_KEY_HREF = "/factsheet/strat-1/v2";
const COMPOSITE_HREF = "/factsheet/composite-strat-1/v2";
const REL = "noopener noreferrer";
const TARGET = "_blank";

// Mutable module-level client factory (mirrors both frozen siblings).
let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

const resetClientFactory = () => {
  currentClientFactory = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  });
};

// ---------------------------------------------------------------------------
// Single-key driver — cloned from SyncPreviewStep.render.test.tsx:761-900
// (the [P72] ledger-backed Deribit pass mock). `pollStatus` is parameterised so
// the same harness drives BOTH the terminal success and the mid-poll
// `waiting_for_complete` state.
// ---------------------------------------------------------------------------
function installDeribitPassMock(csvCount: number, pollStatus = "complete") {
  const thenable = (data: unknown, count: number) => ({
    eq: () => thenable(data, count),
    neq: () => thenable(data, count),
    order: () => thenable(data, count),
    limit: () => thenable(data, count),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (
      resolve: (v: { data: unknown; count: number; error: null }) => void,
    ) => resolve({ data, count, error: null }),
  });

  const client = {
    from: (table: string) => ({
      select: (cols: string) => {
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: "complete",
                    computed_at: "2000-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
            }),
          };
        }
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: pollStatus,
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        if (table === "csv_daily_returns") return thenable(null, csvCount);
        if (table === "trades") {
          return cols === "id" ? thenable(null, 0) : thenable([], 0);
        }
        if (table === "api_keys") return thenable({ exchange: "deribit" }, 0);
        return thenable(
          {
            cagr: 0.12,
            sharpe: 1.1,
            sortino: 1.4,
            max_drawdown: -0.08,
            volatility: 0.2,
            cumulative_return: 0.3,
            sparkline_returns: [0.01, -0.02, 0.03],
            computed_at: "2026-07-01T00:00:00.000Z",
            series_completeness: "ledger_complete",
          },
          0,
        );
      },
    }),
  };
  currentClientFactory = () => client;
}

const singleKeyProps = {
  strategyId: "strat-1",
  apiKeyId: "key-1",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

// ---------------------------------------------------------------------------
// Composite driver — cloned from SyncPreviewStep.composite.render.test.tsx:54-298.
// ---------------------------------------------------------------------------
interface MemberRow {
  api_key_id: string;
  window_start: string;
  window_end: string | null;
  seq: number;
  api_keys: { exchange: string | null; label: string | null } | null;
}

const DEFAULT_MEMBERS: MemberRow[] = [
  {
    api_key_id: "11111111-1111-4111-8111-111111111111",
    window_start: "2025-01-01",
    window_end: "2025-01-06",
    seq: 1,
    api_keys: { exchange: "deribit", label: "Key A" },
  },
  {
    api_key_id: "22222222-2222-4222-8222-222222222222",
    window_start: "2025-01-08",
    window_end: "2025-01-13",
    seq: 2,
    api_keys: { exchange: "deribit", label: "Key B" },
  },
];

const DEFAULT_SERIES = [
  { date: "2025-01-01", daily_return: 0.01 },
  { date: "2025-01-02", daily_return: -0.02 },
  { date: "2025-01-03", daily_return: 0.015 },
  { date: "2025-01-04", daily_return: 0.005 },
  { date: "2025-01-05", daily_return: -0.01 },
  { date: "2025-01-08", daily_return: 0.02 },
  { date: "2025-01-09", daily_return: -0.005 },
  { date: "2025-01-10", daily_return: 0.03 },
  { date: "2025-01-11", daily_return: -0.015 },
  { date: "2025-01-12", daily_return: 0.01 },
];

const DEFAULT_DQ = {
  per_key: [
    { seq: 1, first_day: "2025-01-01", last_day: "2025-01-05", n_days: 5 },
    { seq: 2, first_day: "2025-01-08", last_day: "2025-01-12", n_days: 5 },
  ],
  gap_spans: [{ start: "2025-01-06", end: "2025-01-07" }],
  gap_day_count: 2,
  overlap_days: [],
  composite: true,
};

function compositeAnalyticsRow(): Record<string, unknown> {
  return {
    cagr: 0.15,
    sharpe: 1.2,
    sortino: 1.5,
    max_drawdown: -0.09,
    volatility: 0.22,
    cumulative_return: 0.34,
    sparkline_returns: [0.01, -0.02, 0.03, 0.01],
    metrics_json_by_basis: { cash_settlement: {} },
    data_quality_flags: DEFAULT_DQ,
    computed_at: "2026-07-01T00:00:00.000Z",
    // Required — an unstamped row routes to GATE_SERIES_PROVENANCE_UNVERIFIED
    // and never reaches the passed render (see the composite sibling's note).
    series_completeness: "composite_stitched",
  };
}

function installCompositeSupabaseMock(pollStatus = "complete_with_warnings") {
  const result = (data: unknown, count = 0) => ({
    eq: () => result(data, count),
    neq: () => result(data, count),
    order: () => result(data, count),
    limit: () => result(data, count),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (
      resolve: (v: { data: unknown; count: number; error: null }) => void,
    ) => resolve({ data, count, error: null }),
  });

  const client = {
    from: (table: string) => ({
      select: (cols: string, selectOpts?: { head?: boolean }) => {
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: "complete",
                    computed_at: "2000-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
            }),
          };
        }
        if (cols === "data_quality_flags") {
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: pollStatus,
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        if (table === "strategy_keys" && selectOpts?.head) {
          return result(null, 2);
        }
        if (table === "strategy_keys" && cols.includes("api_keys(")) {
          return result(DEFAULT_MEMBERS, 0);
        }
        if (table === "csv_daily_returns" && cols === "date, daily_return") {
          return result(DEFAULT_SERIES, 0);
        }
        if (
          table === "strategies" &&
          cols.includes("returns_denominator_config")
        ) {
          return result({ returns_denominator_config: null }, 0);
        }
        if (table === "strategy_analytics" && cols.includes("sparkline_returns")) {
          return result(compositeAnalyticsRow(), 0);
        }
        return result(null, 0);
      },
    }),
  };

  currentClientFactory = () => client;
}

const compositeProps = {
  strategyId: "composite-strat-1",
  // A REAL first-member UUID, not null — composite-ness comes from the server
  // kickoff flag, never from `apiKeyId === null` (composite sibling, Pitfall 1).
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

async function flushToTerminal() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

// ===========================================================================
// SC3-a — the link is PRESENT, correct, and identical at BOTH success sites.
// ===========================================================================
describe("[148-05 / OWN-04] SyncPreviewStep — 'View full factsheet' link at both success sites", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    singleKeyProps.onComplete = vi.fn();
    singleKeyProps.onTryAnotherKey = vi.fn();
    compositeProps.onComplete = vi.fn();
    compositeProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetClientFactory();
  });

  it("single-key passed: renders an anchor to /factsheet/{strategyId}/v2 in a new tab", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    installDeribitPassMock(30);

    render(<SyncPreviewStep {...singleKeyProps} />);
    await flushToTerminal();

    // Precondition: we really are on the single-key terminal-success branch.
    expect(
      screen.getByRole("heading", { name: /your verified factsheet is ready/i }),
    ).toBeInTheDocument();

    const link = screen.getByTestId(LINK_TESTID);
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", SINGLE_KEY_HREF);
    expect(link).toHaveAttribute("target", TARGET);
    // T-148-06b — reverse tabnabbing + referrer leakage. `noopener` alone (the
    // ConnectKeyStep precedent) is NOT sufficient; UI-SPEC:126 pins both.
    expect(link).toHaveAttribute("rel", REL);
  });

  it("single-key passed: accessible name, persistent underline, and the visibility caption", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    installDeribitPassMock(30);

    render(<SyncPreviewStep {...singleKeyProps} />);
    await flushToTerminal();

    const byRole = screen.getByRole("link", { name: /view full factsheet/i });
    expect(byRole).toBe(screen.getByTestId(LINK_TESTID));
    expect(byRole).toHaveTextContent(LINK_TEXT);

    // WCAG 1.4.1 — the link must be distinguishable from surrounding prose
    // WITHOUT hover. `hover:underline` (the WizardChrome precedent) fails this;
    // UI-SPEC:122 and DESIGN.md's 2026-06-28 decision both mandate persistent.
    const cls = byRole.className;
    expect(cls).toContain("underline");
    expect(cls).toContain("underline-offset-4");
    expect(cls).not.toContain("hover:underline");
    expect(cls).toContain("text-accent");

    // The caption states the consequence, not just the state.
    expect(screen.getByText(LINK_CAPTION)).toBeInTheDocument();
  });

  it("single-key passed: the link precedes the primary CTA in DOM order (subordinate affordance)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    installDeribitPassMock(30);

    render(<SyncPreviewStep {...singleKeyProps} />);
    await flushToTerminal();

    const link = screen.getByTestId(LINK_TESTID);
    const cta = screen.getByTestId("wizard-use-this-key");
    // UI-SPEC:120 — the link sits ABOVE the CTA row, never inside it: it is a
    // preview affordance subordinate to the step's primary action.
    expect(
      link.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cta.contains(link)).toBe(false);
  });

  it("composite passed: renders the SAME element with the same copy and its own strategyId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          status: "syncing",
          composite: true,
        }),
        { status: 200 },
      ),
    );
    installCompositeSupabaseMock();

    render(<SyncPreviewStep {...compositeProps} />);
    await flushToTerminal();

    // Precondition: the composite terminal-success branch, not the single-key one.
    expect(
      screen.getByRole("heading", {
        name: /your verified composite factsheet is ready/i,
      }),
    ).toBeInTheDocument();

    const link = screen.getByTestId(LINK_TESTID);
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", COMPOSITE_HREF);
    expect(link).toHaveAttribute("target", TARGET);
    expect(link).toHaveAttribute("rel", REL);
    // Same copy — this is the assertion that reddens if a second, drifted
    // copy of the markup is pasted at the composite site instead of reusing
    // the one component (148-UI-SPEC:118).
    expect(link).toHaveTextContent(LINK_TEXT);
    expect(screen.getByText(LINK_CAPTION)).toBeInTheDocument();
  });

  it("composite passed: exactly ONE link node exists (no duplicate paste)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          status: "syncing",
          composite: true,
        }),
        { status: 200 },
      ),
    );
    installCompositeSupabaseMock();

    render(<SyncPreviewStep {...compositeProps} />);
    await flushToTerminal();

    expect(screen.getAllByTestId(LINK_TESTID)).toHaveLength(1);
    expect(
      screen.getAllByRole("link", { name: /view full factsheet/i }),
    ).toHaveLength(1);
  });
});

// ===========================================================================
// SC3-b — STRUCTURAL ABSENCE before success. No node, and no disabled variant.
// ===========================================================================
describe("[148-05 / OWN-04] SyncPreviewStep — the link is structurally absent before success", () => {
  beforeEach(() => {
    singleKeyProps.onComplete = vi.fn();
    singleKeyProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetClientFactory();
  });

  /**
   * The no-disabled-buttons UAT direction, asserted directly: neither a testid
   * node NOR any link/button carrying the copy may exist. A greyed-out or
   * `aria-disabled` variant would satisfy "not enabled" but violate the
   * direction — these three queries make that shape fail.
   */
  function expectNoLinkAnywhere() {
    expect(screen.queryByTestId(LINK_TESTID)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /view full factsheet/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /view full factsheet/i }),
    ).toBeNull();
    expect(screen.queryByText(LINK_CAPTION)).not.toBeInTheDocument();
  }

  it("kicking_off: no link node", async () => {
    // Sync POST left pending → the step stays in kicking_off (frozen sibling's
    // "renders the computing/kicking-off state on first paint" idiom).
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    render(<SyncPreviewStep {...singleKeyProps} />);

    expect(
      screen.getByRole("heading", {
        name: /computing your verified factsheet/i,
      }),
    ).toBeInTheDocument();
    expectNoLinkAnywhere();
  });

  it("waiting_for_complete: no link node while analytics are still computing", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    // Poll never reaches a terminal status → the step stays in the waiting arm.
    installDeribitPassMock(30, "computing");

    render(<SyncPreviewStep {...singleKeyProps} />);
    await flushToTerminal();

    // Still on the pre-success spinner branch, not the preview.
    expect(
      screen.queryByRole("heading", {
        name: /your verified factsheet is ready/i,
      }),
    ).toBeNull();
    expectNoLinkAnywhere();
  });

  it("gate_failed: no link node on the terminal failure branch", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), {
        status: 500,
      }),
    );

    render(<SyncPreviewStep {...singleKeyProps} />);

    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        "SYNC_FAILED",
      ),
    );
    // The failure branch is NOT a dead end — but its exit is "Back to
    // strategies", never a factsheet link to a strategy that has no analytics.
    expect(screen.getByTestId("wizard-back-to-strategies")).toBeInTheDocument();
    expectNoLinkAnywhere();
    errSpy.mockRestore();
  });
});
