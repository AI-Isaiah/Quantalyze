/**
 * Regression test for audit-2026-05-07 finding C-0189 + red-team c9 closure
 * (2026-05-17).
 *
 * The tearsheet route lives in PUBLIC_ROUTES (src/proxy.ts) so cap-intro
 * partners can open it without a login redirect. The original C-0189 fix
 * gated institutional disclosure on `isAuthenticated` only — which left a
 * second bypass open: ANY logged-in-but-never-attested user (new accounts,
 * strategy managers viewing their own work, link recipients who haven't
 * signed the attestation) saw full institutional identity. The
 * /discovery/* layout walls off institutional disclosure behind BOTH login
 * AND a row in `investor_attestations`; this route must enforce the same
 * predicate.
 *
 * Post-fix (red-team closure), an unauthenticated OR authenticated-but-
 * unattested viewer of the tearsheet sees the redacted "exploratory" panel
 * (codename + "identity disclosed on accepted intro" blurb) regardless of
 * the strategy's actual disclosure tier. An authenticated AND attested
 * viewer still sees full institutional identity.
 *
 * These tests assert five branches:
 *   - anonymous (no user) → redacted
 *   - authenticated + attested → full institutional identity present
 *   - authenticated + UNATTESTED → redacted (red-team C-9 closure)
 *   - auth lookup throws → redacted (fail-closed default; specialist S1)
 *   - auth lookup returns `error != null` → redacted (specialist S1)
 *
 * A regression that drops the attestation lookup (or reverts to a pure
 * `isAuthenticated` gate, or removes the `effectiveDisclosureTier`
 * indirection) would surface the bio fields to unattested traffic and the
 * `queryByText(/test bio body/i)` assertion in the unattested test would
 * flip from null → non-null, failing the test.
 */
import { describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

// server-only throws in jsdom; transitively imported via @/lib/queries.
vi.mock("server-only", () => ({}));

// next/link is a Server Component that requires the App Router context;
// stub to a plain anchor so RTL render() doesn't blow up.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

// Mock heavy chart + UI deps that pull in client-only code paths.
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => React.createElement("div", { "data-testid": "sparkline" }),
}));
vi.mock("@/components/strategy/FreshnessBadge", () => ({
  FreshnessBadge: () => React.createElement("span"),
}));
vi.mock("@/components/strategy/PercentileRankBadge", () => ({
  PercentileRankBadge: () => React.createElement("span"),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));

// vi.mock is hoisted to the top of the file. Keep the fixture inside the
// factory so the hoisted call doesn't reference a const that hasn't been
// initialized yet.
vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn().mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "institutional",
      user_id: "u-1",
      strategy_types: ["Momentum"],
      markets: ["BTC"],
      start_date: "2024-01-01",
      leverage_range: "1x-2x",
      benchmark: "BTC",
      aum: 100_000,
      discovery_categories: { slug: "momentum" },
    },
    analytics: {
      cagr: 0.25,
      sharpe: 1.5,
      sortino: 2.0,
      max_drawdown: -0.1,
      volatility: 0.2,
      calmar: 2.5,
      six_month_return: 0.1,
      cumulative_return: 0.3,
      computed_at: "2024-06-01T00:00:00Z",
      computation_status: "complete",
      sparkline_returns: [0.01, 0.02, -0.01, 0.03],
      monthly_returns: { "2024": { Jan: 0.05, Feb: 0.03 } },
      metrics_json: {
        figure_defs_version: 2,
        var_1d_95: -0.02,
        cvar: -0.03,
        best_day: 0.04,
        worst_day: -0.02,
      },
    },
    manager: {
      display_name: "Jane Doe",
      company: "Doe Capital",
      bio: "Test bio body that proves the institutional bio leaked.",
      years_trading: 12,
      aum_range: "$10M-$50M",
      linkedin: "https://linkedin.com/in/jane-doe-test",
    },
    disclosureTier: "institutional",
  }),
  // Return null → percentile section is skipped (it requires 5+ strategies).
  getPercentiles: vi.fn().mockResolvedValue(null),
}));

// Mock the supabase server client; tests will swap the resolved value of
// getUser() per case via vi.mocked(createClient).
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// 194 D-06: the AUM gate asks `getUserRolesResult` whether the viewer is an
// allocator. Each case sets the answer; the default is "no roles".
vi.mock("@/lib/auth", () => ({
  getUserRolesResult: vi.fn(),
}));

// Phase 167.1.2.2.2 (plan 11): the page also makes a service-role read of the
// trade-fetch facts (the api-key exchange and the gap record). None of the
// cases in this file are about it, so it answers "no row" and, being the quiet
// path, adds no console.error (T6/T7 count the page's log lines exactly).
// `page.trade-fetch.test.tsx` owns that read. It answers a row with nothing to
// claim (no key, no stamp, no gaps): since SFH-M2 a NULL row is an unreadable
// state that prints the "unavailable" line and reports to Sentry, which is not
// what these cases are about.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => ({
    data: { api_keys: null, strategy_analytics: { trades_fetched_at: null, series_provenance: null } },
    error: null,
  });
  return { createAdminClient: () => ({ from: () => builder }) };
});

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getFactsheetDetail } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
import { VAR_METHOD_LINE, shortTrackNote } from "@/lib/figure-gate";
import { RECORD_SPAN_SELECT } from "@/lib/record-span-read";

type GetUserResult = {
  data: { user: { id: string; email?: string } | null };
  error: { message: string } | null;
};

type AttestationResult = {
  data: { attested_at: string | null } | null;
  error: { message: string } | null;
};

/**
 * Stub Supabase. `getUserResult` controls the auth.getUser() response.
 * `attestationResult` controls the chained `.from("investor_attestations")
 * .select().eq().maybeSingle()` call. If omitted, defaults to "no row" so
 * an authenticated-but-unattested case is the default (the safest sentinel
 * for a fail-closed gate).
 */
/**
 * What the tear sheet's returns-unit read (164.6.6.2-07) gets back from
 * `strategies -> strategy_analytics ( data_quality_flags )`. `"throw"` makes the
 * query itself throw. The default is a USD strategy: an embed with no flags.
 */
type UnitRead =
  | { data: { strategy_analytics: unknown } | null; error: { message: string } | null }
  | "throw";
const USD_UNIT_READ: UnitRead = {
  data: { strategy_analytics: { data_quality_flags: {} } },
  error: null,
};

/**
 * 194 plan 07: what the record-span read (`readRecordSpan`) gets back. The default is
 * a two-year, 500-observation record, which clears D-15 and is over one year, so a
 * case that is not about the gate sees every annualised figure and no caption.
 * `"throw"` makes the query throw.
 */
type SpanRead =
  | { data: { strategy_analytics: unknown } | null; error: { message: string } | null }
  | "throw";
function spanOf(fields: {
  start?: string | null;
  end?: string | null;
  headlineSince?: string | null;
  observations?: number | null;
}): SpanRead {
  return {
    data: {
      strategy_analytics: {
        series_start: fields.start === undefined ? "2024-01-01" : fields.start,
        series_end: fields.end === undefined ? "2026-01-01" : fields.end,
        headline_since: fields.headlineSince ?? null,
        record_observations: fields.observations === undefined ? 500 : fields.observations,
      },
    },
    error: null,
  };
}
const LONG_SPAN: SpanRead = spanOf({});

/** Every filter the unit read applied, so the published gate is observable. */
const unitReadFilters: Array<[string, unknown]> = [];
let unitReadSelect: string | null = null;
/** The same two observables for the record-span read. */
const spanReadFilters: Array<[string, unknown]> = [];
let spanReadSelect: string | null = null;

/**
 * Stub Supabase. `getUserResult` controls the auth.getUser() response.
 * `attestationResult` controls the chained `.from("investor_attestations")
 * .select().eq().maybeSingle()` call. If omitted, defaults to "no row" so
 * an authenticated-but-unattested case is the default (the safest sentinel
 * for a fail-closed gate). `unitRead` controls the one-strategy
 * `.from("strategies")` read of the returns unit.
 */
function stubAuth(
  getUserResult: GetUserResult,
  attestationResult: AttestationResult = { data: null, error: null },
  unitRead: UnitRead = USD_UNIT_READ,
  spanRead: SpanRead = LONG_SPAN,
) {
  unitReadFilters.length = 0;
  unitReadSelect = null;
  spanReadFilters.length = 0;
  spanReadSelect = null;
  const from = vi.fn((table: string) => {
    if (table === "investor_attestations") {
      const maybeSingle = vi.fn().mockResolvedValue(attestationResult);
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      return { select: vi.fn().mockReturnValue({ eq }) };
    }
    // One builder per `.from("strategies")` call: the page makes two reads of this
    // table on the request client (the unit flags and the record span), told apart
    // by their select string.
    let isSpan = false;
    const builder = {
      select: (cols: string) => {
        isSpan = cols.includes("record_observations");
        if (isSpan) spanReadSelect = cols;
        else unitReadSelect = cols;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        (isSpan ? spanReadFilters : unitReadFilters).push([col, val]);
        return builder;
      },
      maybeSingle: async () => {
        const read = isSpan ? spanRead : unitRead;
        if (read === "throw") throw new Error(isSpan ? "span read exploded" : "unit read exploded");
        return read;
      },
    };
    return builder;
  });
  vi.mocked(createClient).mockResolvedValueOnce({
    auth: { getUser: vi.fn().mockResolvedValue(getUserResult) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

async function renderPage() {
  const page = await TearSheetPage({
    params: Promise.resolve({ id: "s-1" }),
  });
  return render(page as React.ReactElement);
}

describe("TearSheet page — C-0189 disclosure-tier redaction", () => {
  it("anonymous viewer: institutional bio / LinkedIn / AUM are NOT rendered", async () => {
    // No session: getUser() resolves to { user: null }, putting the page
    // into the redacted anonymous lane.
    stubAuth({ data: { user: null }, error: null });
    await renderPage();

    // The redacted block renders this exact blurb when disclosureTier
    // downgrades to "exploratory" (see ManagerIdentityPanel.tsx).
    expect(
      screen.getByText(/Pseudonymous strategy/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Exploratory/i)).toBeInTheDocument();

    // None of the institutional identity fields should leak. The bio text
    // is the load-bearing assertion — its presence proves the bypass.
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/Jane Doe/)).toBeNull();
    expect(screen.queryByText(/Doe Capital/)).toBeNull();
    expect(screen.queryByText(/12\+ years trading/)).toBeNull();
    expect(screen.queryByText(/\$10M-\$50M AUM/)).toBeNull();
    expect(
      screen.queryByText(/LinkedIn profile/i),
    ).toBeNull();
  });

  it("authenticated + attested viewer: institutional identity IS rendered", async () => {
    // Sanity check that the redaction is targeted, not a blanket drop.
    // Without this, a regression that hides institutional identity from
    // everyone (over-correction) would slip past. Both predicates must be
    // satisfied: logged in AND row in investor_attestations.
    stubAuth(
      {
        data: {
          user: { id: "alloc-1", email: "allocator@example.com" },
        },
        error: null,
      },
      { data: { attested_at: "2026-04-08T12:00:00Z" }, error: null },
    );
    await renderPage();

    // Institutional panel shows full identity for attested callers.
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Test bio body/i)).toBeInTheDocument();
    expect(screen.getByText(/12\+ years trading/)).toBeInTheDocument();
    expect(screen.getByText(/\$10M-\$50M AUM/)).toBeInTheDocument();
    expect(screen.getByText(/LinkedIn profile/i)).toBeInTheDocument();
    // And the redacted "Pseudonymous strategy" blurb is NOT shown.
    expect(screen.queryByText(/Pseudonymous strategy/i)).toBeNull();
  });

  it("authenticated + UNATTESTED viewer: redacted (red-team C-9 closure)", async () => {
    // Red-team finding (2026-05-17, conf 9): the original C-0189 fix gated
    // disclosure on `isAuthenticated` only. A logged-in user who had never
    // attested (brand-new account, strategy manager viewing their own
    // console, link recipient who skipped /discovery) still saw full
    // institutional identity. This regression test pins the second-half of
    // the closure: attestation row missing → redacted, even when logged in.
    stubAuth(
      {
        data: { user: { id: "newbie-1", email: "newbie@example.com" } },
        error: null,
      },
      { data: null, error: null }, // maybeSingle() returns null when no row exists
    );
    await renderPage();

    expect(screen.getByText(/Pseudonymous strategy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/Jane Doe/)).toBeNull();
    expect(screen.queryByText(/Doe Capital/)).toBeNull();
    expect(screen.queryByText(/12\+ years trading/)).toBeNull();
    expect(screen.queryByText(/\$10M-\$50M AUM/)).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
  });

  it("authenticated + attestation lookup errors: redacted (fail-closed)", async () => {
    // Companion to the unattested branch — if the attestations table read
    // returns `error != null` (RLS denial, transient DB blip), the gate
    // must redact, not leak. Mirrors the /discovery/layout.tsx fail-closed
    // policy.
    stubAuth(
      {
        data: { user: { id: "u-2", email: "u2@example.com" } },
        error: null,
      },
      { data: null, error: { message: "permission denied" } },
    );
    await renderPage();
    expect(screen.getByText(/Pseudonymous strategy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
  });

  it("createClient throws: falls back to redacted lane", async () => {
    // Specialist-review S1 (security c8): a Supabase outage that surfaces
    // as a thrown error or unexpected response shape must NOT open the
    // institutional disclosure. The page wraps the attestation lookup in a
    // try/catch that defaults isAttested=false on throw. Without that, a
    // regression that swapped the try/catch for a bare `await
    // supabase.auth.getUser()` could crash to the error boundary OR
    // (worse, if the shape changed) silently fall through.
    vi.mocked(createClient).mockImplementationOnce(async () => {
      throw new Error("supabase outage");
    });
    // Silence the console.error this branch logs.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderPage();
      expect(screen.getByText(/Pseudonymous strategy/i)).toBeInTheDocument();
      expect(screen.queryByText(/Test bio body/i)).toBeNull();
      expect(screen.queryByText(/Jane Doe/)).toBeNull();
      expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("auth getUser() returns error (no throw): falls back to redacted", async () => {
    // Companion to the throw branch — the Supabase getUser() contract is
    // {data, error} where error != null indicates a validation failure
    // (e.g. expired JWT). The page must NOT treat that as "attested".
    vi.mocked(createClient).mockResolvedValueOnce({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } }),
      },
      from: vi.fn(), // never reached, but typed-shape complete
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    await renderPage();
    expect(screen.getByText(/Pseudonymous strategy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
  });
});

describe("TearSheet page - returns unit (164.6.6.2-07, D-09, D-21)", () => {
  const ANON = { data: { user: null }, error: null } as const;
  /** The strategy's own manager (`strategy.user_id` is "u-1"): sees the AUM row without a roles lookup. */
  const OWNER = { data: { user: { id: "u-1" } }, error: null } as const;
  const btcRead: UnitRead = {
    data: { strategy_analytics: { data_quality_flags: { native_unit: "BTC" } } },
    error: null,
  };

  /** The `dd` that follows a given `dt` label. */
  function termValue(label: string): string {
    const dt = screen.getByText(label, { selector: "dt" });
    return dt.nextElementSibling?.textContent ?? "";
  }

  it("T1 - a BTC strategy: one chip after the types/markets line, BTC labels, AUM is a dash", async () => {
    stubAuth(OWNER, undefined, btcRead);
    const { container } = await renderPage();

    const chips = container.querySelectorAll('[data-returns-unit="BTC"]');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Returns in BTC");
    const typesLine = screen.getByText(/Momentum · BTC/);
    // The chip follows the types/markets line in document order.
    expect(
      typesLine.compareDocumentPosition(chips[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByText("CAGR in BTC")).toBeInTheDocument();
    expect(screen.getByText("Cumulative in BTC")).toBeInTheDocument();
    expect(screen.getByText("Equity Curve in BTC")).toBeInTheDocument();
    expect(screen.queryByText("CAGR")).toBeNull();

    // strategy.aum is a declared USD figure (D-21): never shown beside a BTC unit.
    const min = termValue("AUM");
    expect(min).toBe("—");
    expect(min).not.toContain("$");
    // The rank section is untouched (B6): the other hero labels keep their names.
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("T2 - a USD strategy is exactly as before: no chip, bare labels, a dollar AUM for its own manager", async () => {
    stubAuth(OWNER);
    const { container } = await renderPage();

    expect(container.querySelector("[data-returns-unit]")).toBeNull();
    expect(screen.getByText("CAGR")).toBeInTheDocument();
    expect(screen.getByText("Cumulative")).toBeInTheDocument();
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
    expect(screen.queryByText(/ in BTC/)).toBeNull();
    expect(termValue("AUM")).toBe("$100,000");
  });

  it("T3 - the unit read is one strategy id, published-only, and selects only the flags", async () => {
    stubAuth(ANON, undefined, btcRead);
    await renderPage();

    expect(unitReadFilters).toContainEqual(["id", "s-1"]);
    expect(unitReadFilters).toContainEqual(["status", "published"]);
    expect(unitReadSelect).toBe("strategy_analytics ( data_quality_flags )");
  });

  it("T4 - a malformed unit renders the USD tear sheet and never the text", async () => {
    stubAuth(ANON, undefined, {
      data: { strategy_analytics: { data_quality_flags: { native_unit: "b!tc<i>" } } },
      error: null,
    });
    const { container } = await renderPage();
    expect(container.querySelector("[data-returns-unit]")).toBeNull();
    expect(screen.queryByText(/b!tc/)).toBeNull();
    expect(screen.getByText("CAGR")).toBeInTheDocument();
  });

  it("T5 - an array embed is read like an object embed", async () => {
    stubAuth(ANON, undefined, {
      data: { strategy_analytics: [{ data_quality_flags: { native_unit: "BTC" } }] },
      error: null,
    });
    const { container } = await renderPage();
    expect(container.querySelectorAll('[data-returns-unit="BTC"]')).toHaveLength(1);
  });

  const NOTE = "Return unit could not be confirmed; figures withheld. Reload to try again.";

  /**
   * SFH-2: the unit is UNDETERMINED. The page must not present return figures
   * as if they were USD - they are withheld, and AUM (a declared USD amount) is a
   * dash, never a `$`. With no request client there is no viewer, so no AUM row.
   */
  function expectWithheld(container: HTMLElement, opts: { aumRow: boolean } = { aumRow: true }) {
    expect(container.querySelector("[data-returns-unit]")).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    for (const label of ["CAGR", "Max DD", "Volatility", "6 Month", "Cumulative"]) {
      const el = screen.getByText(label);
      expect(el.nextElementSibling?.textContent).toBe("\u2014");
    }
    expect(screen.queryByText("Equity Curve")).toBeNull();
    expect(screen.queryByText("Monthly Returns")).toBeNull();
    if (!opts.aumRow) {
      expect(screen.queryByText("AUM", { selector: "dt" })).toBeNull();
      return;
    }
    const min = termValue("AUM");
    expect(min).toBe("\u2014");
    expect(min).not.toContain("$");
  }

  it("T6 - a unit read that returns an error withholds the figures, logs one line, and never throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stubAuth(OWNER, undefined, { data: null, error: { message: "statement timeout" } });
      const { container } = await renderPage();
      expectWithheld(container);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] returns unit read failed", {
        message: "statement timeout",
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("T7 - a unit read that throws withholds the figures, logs one line, and never throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stubAuth(OWNER, undefined, "throw");
      const { container } = await renderPage();
      expectWithheld(container);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] returns unit read failed", {
        message: "unit read exploded",
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("T8 - no request client (createClient threw) withholds the figures too", async () => {
    vi.mocked(createClient).mockImplementationOnce(async () => {
      throw new Error("supabase outage");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = await renderPage();
      expectWithheld(container, { aumRow: false });
      expect(errSpy).toHaveBeenCalledWith(
        "[tearsheet] attestation lookup failed:",
        expect.any(Error),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("T9 - a determined unit (USD or BTC) never shows the withheld note", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.getByText("CAGR").nextElementSibling?.textContent).not.toBe("\u2014");
    cleanup();
    stubAuth(ANON, undefined, btcRead);
    await renderPage();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.getByText("CAGR in BTC").nextElementSibling?.textContent).not.toBe("\u2014");
  });
});

// ---------------------------------------------------------------------------
// Phase 170.6 plan 02 (D-03, D-04): the tear sheet's monthly cells take their tone from the
// value ROUNDED to the 1 dp they print at, and the Max DD hero is red only when the rounded
// drawdown is below zero. Hand-typed expectations.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Phase 194 plan 07 (D-06, D-07, T-194-12): the Allocation Terms row `AUM` is
// rendered ONLY for a signed-in allocator or the strategy's own manager. Every
// other viewer, and every lookup failure, gets no row in the DOM (no placeholder).
// The lockup row and the old fallback word are gone.
// ---------------------------------------------------------------------------
describe("TearSheet page - AUM row visibility (194 D-06, D-07)", () => {
  const aumLabel = () => screen.queryByText("AUM", { selector: "dt" });
  const user = (id: string) => ({ data: { user: { id } }, error: null }) as const;

  it("anonymous viewer: no AUM row, no lookup, no placeholder", async () => {
    stubAuth({ data: { user: null }, error: null });
    await renderPage();
    expect(aumLabel()).toBeNull();
    expect(screen.queryByText("$100,000")).toBeNull();
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("attested viewer without the allocator role (analyst): no AUM row", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["analyst"] });
    stubAuth(user("u-9"), { data: { attested_at: "2024-01-01T00:00:00Z" }, error: null });
    await renderPage();
    expect(aumLabel()).toBeNull();
    expect(screen.queryByText("$100,000")).toBeNull();
  });

  it("a different manager (quant_manager, not the owner): no AUM row", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["quant_manager"] });
    stubAuth(user("u-2"));
    await renderPage();
    expect(aumLabel()).toBeNull();
  });

  it("an admin who is neither an allocator nor the owner: no AUM row (D-12)", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["admin"] });
    stubAuth(user("u-3"));
    await renderPage();
    expect(aumLabel()).toBeNull();
  });

  it("the strategy's own manager: AUM row with the declared amount, no roles lookup", async () => {
    stubAuth(user("u-1"));
    await renderPage();
    expect(aumLabel()).not.toBeNull();
    expect(screen.getByText("AUM", { selector: "dt" }).nextElementSibling?.textContent).toBe(
      "$100,000",
    );
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("an allocator: AUM row with the declared amount", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["allocator"] });
    stubAuth(user("u-4"));
    await renderPage();
    expect(screen.getByText("AUM", { selector: "dt" }).nextElementSibling?.textContent).toBe(
      "$100,000",
    );
  });

  it("a roles lookup that returns ok: false removes the row and logs [tearsheet]", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getUserRolesResult).mockResolvedValueOnce({
        ok: false,
        error: { code: "XX000", message: "boom" },
      });
      stubAuth(user("u-4"));
      await renderPage();
      expect(aumLabel()).toBeNull();
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] aum gate failed:", expect.anything());
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a roles lookup that throws removes the row and logs [tearsheet]", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getUserRolesResult).mockRejectedValueOnce(new Error("roles exploded"));
      stubAuth(user("u-4"));
      await renderPage();
      expect(aumLabel()).toBeNull();
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] aum gate failed:", expect.any(Error));
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a null AUM prints the dash, never the retired fallback word", async () => {
    const base = (await vi.mocked(getFactsheetDetail)("s-1"))!;
    vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
      ...base,
      strategy: { ...base.strategy, aum: null },
    });
    stubAuth(user("u-1"));
    await renderPage();
    expect(screen.getByText("AUM", { selector: "dt" }).nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByText("Negotiable")).toBeNull();
  });

  it("the lockup row and the old Minimum Allocation label are gone for every viewer (D-07)", async () => {
    stubAuth(user("u-1"));
    await renderPage();
    expect(screen.queryByText("Lockup")).toBeNull();
    expect(screen.queryByText("Minimum Allocation")).toBeNull();
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 194 plan 07 (D-02, D-04 as superseded by D-15): VaR/CVaR carry their
// historical labels only from a row stamped figure_defs_version >= 2, one method line
// sits under the Detail grid, and the five annualised figures follow the TOTAL record
// through the shared gate. Hand-typed day counts: 2025-11-01 to 2025-12-31 is 60 days,
// 2025-01-01 to 2025-07-20 is 200, 2024-01-01 to 2025-02-04 is 400, 2025-01-01 to
// 2025-03-26 is 84 and to 2025-03-31 is 89.
// ---------------------------------------------------------------------------
describe("TearSheet page - historical VaR/CVaR and the annualised gate (194 D-02, D-15)", () => {
  const ANON = { data: { user: null }, error: null } as const;
  const DASH = "—";

  /** The value cell that follows a metric label (hero or detail). */
  const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
  const ANNUALIZED = ["CAGR", "Sharpe", "Sortino", "Volatility", "Calmar"] as const;
  const gateNote = () => screen.queryByTestId("tearsheet-figure-gate-note");

  /** Render once with a strategy asset class and a stored span for the record. */
  async function renderWith(opts: { assetClass: "crypto" | "traditional"; span: SpanRead }) {
    const base = (await vi.mocked(getFactsheetDetail)("s-1"))!;
    vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
      ...base,
      strategy: { ...base.strategy, asset_class: opts.assetClass },
    });
    stubAuth(ANON, undefined, undefined, opts.span);
    return renderPage();
  }

  function expectAllAnnualizedDashed() {
    for (const label of ANNUALIZED) expect(valueOf(label), label).toBe(DASH);
  }
  function expectNoAnnualizedDash() {
    for (const label of ANNUALIZED) expect(valueOf(label), label).not.toBe(DASH);
  }

  it("marker 2: VaR 95% and CVaR 95% print the stored values", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(valueOf("VaR 95%")).toBe("-2.00%");
    expect(valueOf("CVaR 95%")).toBe("-3.00%");
  });

  it("marker absent: both print a dash, never a pre-recompute value under the historical label", async () => {
    const base = (await vi.mocked(getFactsheetDetail)("s-1"))!;
    const { figure_defs_version: _drop, ...legacyMetrics } = base.analytics.metrics_json as Record<
      string,
      number
    >;
    void _drop;
    vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
      ...base,
      analytics: { ...base.analytics, metrics_json: legacyMetrics },
    });
    stubAuth(ANON);
    await renderPage();
    expect(valueOf("VaR 95%")).toBe(DASH);
    expect(valueOf("CVaR 95%")).toBe(DASH);
    // Best Day / Worst Day are not method-dependent and keep printing.
    expect(valueOf("Best Day")).not.toBe(DASH);
  });

  it("the old VaR labels are gone", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(screen.queryByText("VaR (95%)")).toBeNull();
    expect(screen.queryByText("CVaR")).toBeNull();
  });

  it("the VaR method line appears exactly once, below the Detail grid", async () => {
    stubAuth(ANON);
    await renderPage();
    const lines = screen.getAllByTestId("tearsheet-var-method-line");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(VAR_METHOD_LINE);
    expect(
      screen.getByText("Worst Day").compareDocumentPosition(lines[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("crypto 60-day record: the five annualised figures are dashes and one caption says why", async () => {
    await renderWith({
      assetClass: "crypto",
      span: spanOf({ start: "2025-11-01", end: "2025-12-30", observations: null }),
    });
    expectAllAnnualizedDashed();
    expect(gateNote()?.textContent).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 60 days.",
    );
    // Not annualised: still printed.
    expect(valueOf("Max DD")).not.toBe(DASH);
    expect(valueOf("6 Month")).not.toBe(DASH);
  });

  it("crypto 200-day record: figures print with one short-track caption", async () => {
    await renderWith({
      assetClass: "crypto",
      span: spanOf({ start: "2025-01-01", end: "2025-07-19", observations: null }),
    });
    expectNoAnnualizedDash();
    expect(screen.getAllByTestId("tearsheet-figure-gate-note")).toHaveLength(1);
    expect(gateNote()?.textContent).toBe(shortTrackNote("record", 200));
    expect(gateNote()?.textContent).toContain("200 days of record");
  });

  it("crypto 400-day record: figures print and no caption", async () => {
    await renderWith({
      assetClass: "crypto",
      span: spanOf({ start: "2024-01-01", end: "2025-02-04", observations: null }),
    });
    expectNoAnnualizedDash();
    expect(gateNote()).toBeNull();
  });

  it("non-crypto record with 59 observations: dashes, and the caption names 60 trading days", async () => {
    await renderWith({ assetClass: "traditional", span: spanOf({ observations: 59 }) });
    expectAllAnnualizedDashed();
    expect(gateNote()?.textContent).toBe(
      "Annualized figures appear once the record reaches 60 trading days. This record has 59 trading days.",
    );
  });

  it("non-crypto record with 60 observations over 84 days: figures print with the 84-day short-track caption", async () => {
    await renderWith({
      assetClass: "traditional",
      span: spanOf({ start: "2025-01-01", end: "2025-03-25", observations: 60 }),
    });
    expectNoAnnualizedDash();
    expect(gateNote()?.textContent).toBe(shortTrackNote("record", 84));
  });

  it("non-crypto record with no stored count and 89 days: dashes (interim fallback, A-194-D15-02)", async () => {
    await renderWith({
      assetClass: "traditional",
      span: spanOf({ start: "2025-01-01", end: "2025-03-30", observations: null }),
    });
    expectAllAnnualizedDashed();
    expect(gateNote()?.textContent).toContain("89 days");
  });

  it("a span read error fails closed: dashes, one [tearsheet] log line with the id, one unavailable caption", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stubAuth(ANON, undefined, undefined, { data: null, error: { message: "statement timeout" } });
      await renderPage();
      expectAllAnnualizedDashed();
      expect(gateNote()?.textContent).toBe(
        "Annualized figures are temporarily unavailable. Reload to retry.",
      );
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith(
        "[tearsheet] record span read failed",
        expect.objectContaining({ strategyId: expect.any(String) }),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a span read that throws fails closed the same way", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      stubAuth(ANON, undefined, undefined, "throw");
      await renderPage();
      expectAllAnnualizedDashed();
      expect(gateNote()?.textContent).toBe(
        "Annualized figures are temporarily unavailable. Reload to retry.",
      );
      expect(errSpy).toHaveBeenCalledWith(
        "[tearsheet] record span read failed",
        expect.objectContaining({ strategyId: expect.any(String) }),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("the span read is one strategy id, published-only, and the four aliases only", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(spanReadFilters).toContainEqual(["id", "s-1"]);
    expect(spanReadFilters).toContainEqual(["status", "published"]);
    expect(spanReadSelect).toBe(RECORD_SPAN_SELECT);
  });

  it("D-05: a 13-digit cumulative return prints like any other value", async () => {
    const base = (await vi.mocked(getFactsheetDetail)("s-1"))!;
    vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
      ...base,
      analytics: { ...base.analytics, cumulative_return: 1.2e13 },
    });
    stubAuth(ANON);
    await renderPage();
    const text = valueOf("Cumulative");
    expect(text).not.toBe(DASH);
    expect(text).toContain("1200000000000000");
  });
});

describe("TearSheet page - rounded-sign tones (170.6 D-03, D-04)", () => {
  const ANON = { data: { user: null }, error: null } as const;

  /** Render with the default fixture but the given analytics overrides (one read only). */
  async function renderWith(
    overrides: Record<string, unknown>,
    unitRead?: UnitRead,
  ) {
    const base = (await vi.mocked(getFactsheetDetail)("s-1")) as unknown as {
      analytics: Record<string, unknown>;
    };
    vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
      ...base,
      analytics: { ...base.analytics, ...overrides },
    } as unknown as Awaited<ReturnType<typeof getFactsheetDetail>>);
    stubAuth(ANON, undefined, unitRead);
    return renderPage();
  }

  /** The value paragraph under a hero label. */
  function heroValue(label: string): HTMLElement {
    return screen.getByText(label).nextElementSibling as HTMLElement;
  }

  it("a month of -0.0004 prints 0.0% and carries neither tone", async () => {
    await renderWith({ monthly_returns: { "2024": { Jan: -0.0004 } } });
    const cell = screen.getByText("0.0%");
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
    expect(cell.className).toContain("text-text-primary");
  });

  it("a month of 0.012 prints 1.2% in green and a month of -0.012 prints -1.2% in red", async () => {
    await renderWith({ monthly_returns: { "2024": { Jan: 0.012, Feb: -0.012 } } });
    expect(screen.getByText("1.2%").className).toContain("text-positive");
    expect(screen.getByText("-1.2%").className).toContain("text-negative");
  });

  it("the Max DD hero is not red for a drawdown of 0", async () => {
    await renderWith({ max_drawdown: 0 });
    const hero = heroValue("Max DD");
    expect(hero.textContent).toBe("0.00%");
    expect(hero.className).not.toContain("text-negative");
    expect(hero.className).not.toContain("text-positive");
  });

  it("the Max DD hero is not red for a drawdown of -0.00004 (prints 0.00%)", async () => {
    await renderWith({ max_drawdown: -0.00004 });
    const hero = heroValue("Max DD");
    expect(hero.textContent).toBe("0.00%");
    expect(hero.className).not.toContain("text-negative");
  });

  it("the Max DD hero is not red in the withheld state (the dash)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderWith({ max_drawdown: -0.1 }, "throw");
    } finally {
      errSpy.mockRestore();
    }
    const hero = heroValue("Max DD");
    expect(hero.textContent).toBe("—");
    expect(hero.className).not.toContain("text-negative");
  });

  it("the Max DD hero is red for a drawdown of -0.0342 and prints -3.42%", async () => {
    await renderWith({ max_drawdown: -0.0342 });
    const hero = heroValue("Max DD");
    expect(hero.textContent).toBe("-3.42%");
    expect(hero.className).toContain("text-negative");
  });
});

describe("TearSheet page - one Risk Disclosure block (195 D-09, UC-19, T-195-09)", () => {
  // Sentences are pinned as LITERALS: a test reading the page's own constants
  // cannot fail when a legally required sentence is dropped from them.
  const SENTENCES = [
    "Past performance does not guarantee future results.",
    "Cryptocurrency trading involves substantial risk of total loss.",
    "This tear sheet is for informational purposes only and does not constitute investment, legal, or tax advice.",
    "Strategies are monitored via read-only exchange APIs; managers retain asset custody.",
    "Quantalyze provides analytics only \u2014 no pooling, no fund administration, no custody of client assets.",
  ];

  it("carries every prior sentence once plus the analytics-only custody sentence, as the one block", async () => {
    stubAuth({ data: { user: null }, error: null });
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    for (const sentence of SENTENCES) {
      expect(text.split(sentence).length - 1, sentence).toBe(1);
    }
    // The custody box is gone: its capitalised wording appears nowhere.
    expect(text).not.toContain("Manager retains asset custody");

    const heading = screen.getByRole("heading", { name: "Risk Disclosure" });
    const section = heading.closest("section") as HTMLElement;
    expect(section.querySelector("p")?.textContent).toBe(
      `${SENTENCES.join(" ")} Read the full risk disclaimer at /legal/disclaimer.`,
    );
    expect(
      section.querySelector('a[href="/legal/disclaimer"]'),
    ).not.toBeNull();
  });

  it("the Risk Disclosure section sits below the contact CTA", async () => {
    stubAuth({ data: { user: null }, error: null });
    await renderPage();
    const cta = screen.getByText(/Interested in/).closest("section") as HTMLElement;
    const risk = screen
      .getByRole("heading", { name: "Risk Disclosure" })
      .closest("section") as HTMLElement;
    expect(
      cta.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
