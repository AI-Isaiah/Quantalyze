/** @vitest-environment jsdom */
/**
 * Phase 194.1 plan 08 (census B6; 194 D-04 as superseded by D-15) - the strategy wizard's
 * factsheet preview judges its CAGR, Sharpe, Sortino and Volatility tiles on the draft's
 * TOTAL record, on both the single-key and the composite arm.
 *
 * WHY IT MATTERS: a manager whose key carries 40 days of history used to see a Sharpe in the
 * preview and the same Sharpe on the review screen, while the published factsheet withholds
 * it. The preview has to say what the factsheet will say, before the manager submits.
 *
 * The expected sentences are typed by hand here, never imported from the module that builds
 * them, so a reworded sentence in `figure-gate.ts` fails this file instead of following it.
 * Record dates come from `endAfter(days)`: the series start plus `days - 1`, because the
 * span counts the first and the last day both (194 D-20).
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep, type SyncPreviewSnapshot } from "./SyncPreviewStep";

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

const SERIES_START = "2025-01-01";

/** The last day of a record covering `days` days, first and last both counted. */
function endAfter(days: number): string {
  const d = new Date(`${SERIES_START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

/** The four aliased record scalars `strategy_analytics` returns. */
function recordAliases(days: number, observations: number | null = days) {
  return {
    series_start: SERIES_START,
    series_end: endAfter(days),
    headline_since: null,
    record_observations: observations,
  };
}

const STORED = {
  cagr: 0.5,
  sharpe: 2.1,
  sortino: 3.0,
  max_drawdown: -0.1,
  volatility: 30,
  cumulative_return: 0.2,
};

const baseProps = {
  strategyId: "strat-1",
  apiKeyId: "key-1",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

const thenable = (
  data: unknown,
  count: number,
  error: { message: string } | null = null,
) => ({
  eq: () => thenable(data, count, error),
  neq: () => thenable(data, count, error),
  order: () => thenable(data, count, error),
  limit: () => thenable(data, count, error),
  maybeSingle: () => Promise.resolve({ data, error }),
  then: (
    resolve: (v: { data: unknown; count: number; error: unknown }) => void,
  ) => resolve({ data, count, error }),
});

interface SingleKeyOpts {
  aliases: ReturnType<typeof recordAliases>;
  /** What the `strategies` read answers. */
  strategies: { data: unknown; error: { message: string } | null };
}

/** A verified ledger-backed single-key pass: 0 trades, 30 csv rows, complete analytics. */
function installSingleKeyPass(o: SingleKeyOpts) {
  currentClientFactory = () => ({
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
                  data: { computation_status: "complete", computation_error: null },
                  error: null,
                }),
            }),
          };
        }
        if (table === "strategies") {
          return thenable(o.strategies.data, 0, o.strategies.error);
        }
        if (table === "csv_daily_returns") return thenable(null, 30);
        if (table === "trades") {
          return cols === "id" ? thenable(null, 0) : thenable([], 0);
        }
        if (table === "api_keys") return thenable({ exchange: "deribit" }, 0);
        // The heavy analytics row.
        return thenable(
          {
            ...STORED,
            sparkline_returns: [0.01, -0.02, 0.03],
            computed_at: "2026-07-01T00:00:00.000Z",
            series_completeness: "ledger_complete",
            ...o.aliases,
          },
          0,
        );
      },
    }),
  });
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

/** The printed value under a tile label (the tile is the label's parent). */
function tile(label: string): string {
  const el = screen.getByText(label).parentElement;
  return el?.querySelectorAll("p")[1]?.textContent ?? "";
}

const WITHHELD_40 =
  "Annualized figures appear once the record reaches 90 days. This record covers 40 days.";

describe("[194.1 B6] SyncPreviewStep - single-key preview is judged on the total record", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a crypto draft covering 40 days prints a dash on the four annualised tiles and one withheld note", async () => {
    installSingleKeyPass({
      aliases: recordAliases(40),
      strategies: { data: { asset_class: "crypto" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    expect(tile("CAGR")).toBe("—");
    expect(tile("Sharpe")).toBe("—");
    expect(tile("Sortino")).toBe("—");
    expect(tile("Volatility")).toBe("—");
    // Never gated: drawdown and cumulative keep their stored values.
    expect(tile("Max DD")).toBe("-10.0%");
    expect(tile("Cumulative")).toBe("+20.0%");
    expect(screen.getAllByTestId("factsheet-preview-figure-note")).toHaveLength(1);
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      WITHHELD_40,
    );
  });

  it("a crypto draft covering 200 days prints every stored value and the one short-track note", async () => {
    installSingleKeyPass({
      aliases: recordAliases(200),
      strategies: { data: { asset_class: "crypto" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    expect(tile("CAGR")).toBe("+50.0%");
    expect(tile("Sharpe")).toBe("2.10");
    expect(tile("Sortino")).toBe("3.00");
    expect(tile("Volatility")).toBe("3000.0%");
    expect(tile("Max DD")).toBe("-10.0%");
    expect(tile("Cumulative")).toBe("+20.0%");
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 200 days of record, under one year.",
    );
  });

  it("a crypto draft covering 400 days prints every stored value and no note", async () => {
    installSingleKeyPass({
      aliases: recordAliases(400),
      strategies: { data: { asset_class: "crypto" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    expect(tile("CAGR")).toBe("+50.0%");
    expect(tile("Sharpe")).toBe("2.10");
    expect(screen.queryByTestId("factsheet-preview-figure-note")).toBeNull();
  });

  it("a snapshot handed to onComplete carries the same note the preview showed", async () => {
    installSingleKeyPass({
      aliases: recordAliases(40),
      strategies: { data: { asset_class: "crypto" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    // The submit summary reuses `snapshot.metrics`; it can only show the same verdict if the
    // note rides the snapshot. WizardClient receives it through this button.
    const button = screen.getByTestId("wizard-use-this-key");
    await act(async () => {
      button.click();
    });
    const snapshot = baseProps.onComplete.mock.calls[0][0] as SyncPreviewSnapshot;
    expect(snapshot.figureNote).toBe(WITHHELD_40);
    expect(snapshot.metrics.find((m) => m.label === "Sharpe")?.value).toBe("—");
  });
});

describe("[194.1 B6] SyncPreviewStep - non-crypto drafts and an unknown asset class", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a traditional draft with 59 stored observations is withheld on the trading-day count, however long its span", async () => {
    installSingleKeyPass({
      // 84 days of span would clear a crypto record's 90-day bar only at 90, and would be
      // "short" for a traditional one; the stored count of 59 is what decides here.
      aliases: recordAliases(84, 59),
      strategies: { data: { asset_class: "traditional" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    expect(tile("Sharpe")).toBe("—");
    expect(tile("CAGR")).toBe("—");
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      "Annualized figures appear once the record reaches 60 trading days. This record has 59 trading days.",
    );
  });

  it("a traditional draft with 60 observations over 84 days prints its stored values and the short-track note", async () => {
    installSingleKeyPass({
      aliases: recordAliases(84, 60),
      strategies: { data: { asset_class: "traditional" }, error: null },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();

    expect(tile("Sharpe")).toBe("2.10");
    expect(tile("CAGR")).toBe("+50.0%");
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 84 days of record, under one year.",
    );
  });

  it("a failed asset class read never renders a preview: it takes the heavy-fetch path, not a crypto default", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installSingleKeyPass({
      // A 40-day record WOULD be withheld as crypto and shown as short-or-full under any
      // other basis; the point is that no basis is guessed, so nothing is rendered.
      aliases: recordAliases(40),
      strategies: { data: null, error: { message: "permission denied for table strategies" } },
    });
    render(<SyncPreviewStep {...baseProps} />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(
      (errSpy.mock.calls as unknown[][]).some(
        (call) =>
          String(call[0]).includes("[wizard:SyncPreviewStep] terminal fetch error:") &&
          String((call[1] as Error | undefined)?.message).includes(
            "strategy asset class read failed: permission denied for table strategies",
          ),
      ),
    ).toBe(true);
    expect(
      screen.queryByRole("heading", { name: /your verified factsheet is ready/i }),
    ).toBeNull();
    expect(screen.queryByTestId("factsheet-preview-figure-note")).toBeNull();
    // Three consecutive heavy faults escalate to the recoverable envelope.
    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "SYNC_FAILED",
    );
  });
});

// ---------------------------------------------------------------------------
// Composite arm
// ---------------------------------------------------------------------------

const MEMBERS = [
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

const COMPOSITE_SERIES = [
  { date: "2025-01-01", daily_return: 0.01 },
  { date: "2025-01-02", daily_return: -0.02 },
  { date: "2025-01-03", daily_return: 0.015 },
  { date: "2025-01-04", daily_return: 0.005 },
  { date: "2025-01-05", daily_return: -0.01 },
  { date: "2025-01-08", daily_return: 0.02 },
  { date: "2025-01-09", daily_return: -0.005 },
  { date: "2025-01-10", daily_return: 0.03 },
];

/** The id-keyset series drain the composite arm runs, answered as one page. */
function seriesPage() {
  const rows = COMPOSITE_SERIES.map((r, i) => ({ id: i + 1, ...r }));
  let afterId: number | null = null;
  const self = {
    eq: () => self,
    gt: (_c: string, v: number) => {
      afterId = v;
      return self;
    },
    order: () => self,
    limit: () => self,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({
        data: rows.filter((r) => afterId === null || r.id > afterId),
        error: null,
      }),
  };
  return self;
}

function installCompositePass(days: number, assetClass: string) {
  currentClientFactory = () => ({
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
                    computation_status: "complete_with_warnings",
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        if (table === "strategy_keys") return thenable(MEMBERS, 0);
        if (table === "csv_daily_returns") return seriesPage();
        if (table === "strategies") {
          return thenable(
            { returns_denominator_config: null, asset_class: assetClass },
            0,
          );
        }
        if (table === "strategy_analytics" && cols.includes("sparkline_returns")) {
          return thenable(
            {
              ...STORED,
              sparkline_returns: [0.01, -0.02, 0.03, 0.01],
              metrics_json_by_basis: { cash_settlement: {} },
              data_quality_flags: {
                per_key: [
                  { seq: 1, first_day: "2025-01-01", last_day: "2025-01-05", n_days: 5 },
                  { seq: 2, first_day: "2025-01-08", last_day: "2025-01-10", n_days: 3 },
                ],
              },
              computed_at: "2026-07-01T00:00:00.000Z",
              series_completeness: "composite_stitched",
              ...recordAliases(days),
            },
            0,
          );
        }
        return thenable(null, 0);
      },
    }),
  });
}

describe("[194.1 B6] SyncPreviewStep - composite preview is judged on the total record", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, accepted: true, status: "syncing", composite: true }),
        { status: 200 },
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a crypto composite covering 40 days prints a dash on the four annualised tiles and the withheld note", async () => {
    installCompositePass(40, "crypto");
    render(<SyncPreviewStep {...baseProps} apiKeyId={MEMBERS[0].api_key_id} strategyId="comp-1" />);
    await settle();

    expect(tile("CAGR")).toBe("—");
    expect(tile("Sharpe")).toBe("—");
    expect(tile("Sortino")).toBe("—");
    expect(tile("Volatility")).toBe("—");
    expect(tile("Max DD")).toBe("-10.0%");
    expect(tile("Cumulative")).toBe("+20.0%");
    expect(screen.getAllByTestId("factsheet-preview-figure-note")).toHaveLength(1);
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      WITHHELD_40,
    );
  });

  it("a crypto composite covering 200 days prints its stored values and the short-track note", async () => {
    installCompositePass(200, "crypto");
    render(<SyncPreviewStep {...baseProps} apiKeyId={MEMBERS[0].api_key_id} strategyId="comp-1" />);
    await settle();

    expect(tile("CAGR")).toBe("+50.0%");
    expect(tile("Sharpe")).toBe("2.10");
    expect(screen.getByTestId("factsheet-preview-figure-note").textContent).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 200 days of record, under one year.",
    );
  });
});
