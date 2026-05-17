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
import { render, screen } from "@testing-library/react";
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
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
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

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";

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
function stubAuth(
  getUserResult: GetUserResult,
  attestationResult: AttestationResult = { data: null, error: null },
) {
  const maybeSingle = vi.fn().mockResolvedValue(attestationResult);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
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
