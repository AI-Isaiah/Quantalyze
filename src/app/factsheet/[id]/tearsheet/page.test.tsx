/**
 * The tear sheet is the factsheet's PRINT VIEW (Phase 196 D-03, LEAN-02, LEAN-05).
 *
 * WHY THESE ARMS MATTER. The print view must show the same figures as the factsheet
 * (so it takes the factsheet's own payload through `FactsheetView printView`, never a
 * second derivation), must keep the ranks and the contact block it printed before (no
 * decision removed them), and must never show a manager's identity to someone the
 * attestation gate would refuse.
 *
 * DISCLOSURE (audit-2026-05-07 C-0189 + red-team c9 closure, 2026-05-17). The route
 * lives in PUBLIC_ROUTES (src/proxy.ts) so cap-intro partners can open it without a
 * login. The first fix gated institutional disclosure on `isAuthenticated` only, which
 * left any logged-in-but-never-attested user seeing full institutional identity. The
 * /discovery/* layout walls it off behind BOTH login AND a row in
 * `investor_attestations`; this route enforces the same predicate. An anonymous,
 * unattested or unreadable viewer sees the redacted exploratory panel whatever the
 * strategy's real tier; an attested viewer sees the full identity. A regression that
 * drops the attestation lookup, reverts to an auth-only gate or removes the
 * `effectiveDisclosureTier` indirection flips the unattested arms from null to non-null.
 *
 * `FactsheetView` is stubbed to a recorder: its own tests prove the opening view
 * renders; what is asserted here is what THIS page hands it (the payload the factsheet's
 * published lane builds, `printView`, the AUM decision) and what the page prints around it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));

const recorded = vi.hoisted(() => ({
  views: [] as Array<Record<string, unknown>>,
  // D-20 / U-03 print arm only: render the REAL `FactsheetView` under the stub's recorder.
  renderReal: false,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  // Only the real `FactsheetView` (the print arm) reads the router.
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// next/link needs the App Router context; a plain anchor keeps the className and href.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => React.createElement("a", { href, className }, children),
}));

vi.mock("../v2/FactsheetView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../v2/FactsheetView")>();
  return {
    FactsheetView: (props: Record<string, unknown>) => {
      recorded.views.push(props);
      if (recorded.renderReal) {
        return React.createElement(actual.FactsheetView, props as unknown as React.ComponentProps<typeof actual.FactsheetView>);
      }
      return React.createElement("div", { "data-testid": "factsheet-view" }, "OPENING VIEW");
    },
  };
});

vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn(),
  getPercentiles: vi.fn(),
  readPublicVerificationSignals: vi.fn(),
}));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({ fetchAndBuildPayloadWithReason: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// 194 D-06: the AUM gate asks `getUserRolesResult` whether the viewer is an allocator.
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));

import TearSheetPage, { generateMetadata } from "./page";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFactsheetDetail, getPercentiles, readPublicVerificationSignals } from "@/lib/queries";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { getUserRolesResult } from "@/lib/auth";
import { withPublishedOnly } from "@/lib/visibility";
import { KCS10_PUBLIC_SENTENCE } from "@/lib/status-surface-copy";
import { figureRecord } from "@/lib/figure-gate";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { censusPayloadA } from "../v2/test-fixtures/census-payloads";

const RECORD = figureRecord({
  seriesStart: "2024-01-01",
  seriesEnd: "2026-01-01",
  observations: 500,
  periodsPerYear: 252,
});

/** Only the fields this page reads or hands on; the builder's own tests own the rest. */
function payloadFixture(over: Record<string, unknown> = {}): FactsheetPayload {
  return {
    strategyId: "s-1",
    aum: 100_000,
    maxCapacity: 500_000,
    trustTier: null,
    figureRecord: RECORD,
    ...over,
  } as unknown as FactsheetPayload;
}

const DETAIL = {
  strategy: {
    id: "s-1",
    name: "Test Strategy",
    codename: "STRAT-001",
    status: "published",
    disclosure_tier: "institutional",
    user_id: "u-1",
    discovery_categories: { slug: "momentum" },
  },
  analytics: { computation_status: "complete" },
  manager: {
    display_name: "Jane Doe",
    company: "Doe Capital",
    bio: "Test bio body that proves the institutional bio leaked.",
    years_trading: 12,
    aum_range: "$10M-$50M",
    linkedin: "https://linkedin.com/in/jane-doe-test",
  },
  disclosureTier: "institutional",
};

const RANKS = { cagr: 70, sharpe: 80, sortino: 75, max_drawdown: 60, volatility: 55 };

type GetUserResult = {
  data: { user: { id: string; email?: string } | null };
  error: { message: string } | null;
};
type AttestationResult = {
  data: { attested_at: string | null } | null;
  error: { message: string } | null;
};

const ANON: GetUserResult = { data: { user: null }, error: null };
const user = (id: string): GetUserResult => ({ data: { user: { id } }, error: null });
const ATTESTED: AttestationResult = { data: { attested_at: "2026-04-08T12:00:00Z" }, error: null };

/**
 * Stub the request client. `getUserResult` answers auth.getUser(); `attestationResult`
 * answers `.from("investor_attestations").select().eq().maybeSingle()` and defaults to
 * "no row", the safest sentinel for a fail-closed gate.
 */
function stubAuth(
  getUserResult: GetUserResult,
  attestationResult: AttestationResult = { data: null, error: null },
) {
  const from = vi.fn((table: string) => {
    if (table !== "investor_attestations") throw new Error(`unexpected table ${table}`);
    const maybeSingle = vi.fn().mockResolvedValue(attestationResult);
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    return { select: vi.fn().mockReturnValue({ eq }) };
  });
  vi.mocked(createClient).mockResolvedValueOnce({
    auth: { getUser: vi.fn().mockResolvedValue(getUserResult) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

async function renderPage() {
  const page = await TearSheetPage({ params: Promise.resolve({ id: "s-1" }) });
  return render(page as React.ReactElement);
}

const lastView = () => recorded.views[recorded.views.length - 1];

beforeEach(() => {
  recorded.views.length = 0;
  recorded.renderReal = false;
  vi.mocked(notFound).mockClear();
  vi.mocked(getFactsheetDetail).mockReset().mockResolvedValue(DETAIL as never);
  vi.mocked(getPercentiles).mockReset().mockResolvedValue(null);
  vi.mocked(readPublicVerificationSignals).mockReset().mockResolvedValue(new Map());
  vi.mocked(fetchAndBuildPayloadWithReason).mockReset().mockResolvedValue({ payload: payloadFixture(), reason: null });
  vi.mocked(createClient).mockReset();
  vi.mocked(getUserRolesResult).mockReset();
});

afterEach(cleanup);

describe("TearSheet page - C-0189 disclosure-tier redaction", () => {
  it("anonymous viewer: institutional bio / LinkedIn / AUM range are NOT rendered", async () => {
    stubAuth(ANON);
    await renderPage();

    // The redacted block renders this blurb when the tier downgrades to "exploratory".
    expect(screen.getByText("Pseudonymous manager")).toBeInTheDocument();
    expect(screen.getByText(/Exploratory/i)).toBeInTheDocument();
    // The bio text is the load-bearing assertion: its presence proves the bypass.
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/Jane Doe/)).toBeNull();
    expect(screen.queryByText(/Doe Capital/)).toBeNull();
    expect(screen.queryByText(/12\+ years trading/)).toBeNull();
    expect(screen.queryByText(/\$10M-\$50M AUM/)).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
  });

  it("authenticated + attested viewer: institutional identity IS rendered", async () => {
    // The redaction is targeted, not a blanket drop: both predicates satisfied.
    stubAuth(
      { data: { user: { id: "alloc-1", email: "allocator@example.com" } }, error: null },
      ATTESTED,
    );
    await renderPage();

    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Test bio body/i)).toBeInTheDocument();
    expect(screen.getByText(/12\+ years trading/)).toBeInTheDocument();
    expect(screen.getByText(/\$10M-\$50M AUM/)).toBeInTheDocument();
    expect(screen.getByText(/LinkedIn profile/i)).toBeInTheDocument();
    expect(screen.queryByText("Pseudonymous manager")).toBeNull();
  });

  it("authenticated + UNATTESTED viewer: redacted (red-team C-9 closure)", async () => {
    // A brand-new account, a manager viewing their own work, a link recipient who skipped
    // /discovery: logged in, no attestation row (maybeSingle returns null).
    stubAuth({ data: { user: { id: "newbie-1", email: "newbie@example.com" } }, error: null });
    await renderPage();

    expect(screen.getByText("Pseudonymous manager")).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/Jane Doe/)).toBeNull();
    expect(screen.queryByText(/Doe Capital/)).toBeNull();
    expect(screen.queryByText(/12\+ years trading/)).toBeNull();
    expect(screen.queryByText(/\$10M-\$50M AUM/)).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
  });

  it("authenticated + attestation lookup errors: redacted (fail-closed)", async () => {
    // RLS denial or a transient DB blip must redact, never leak (mirrors /discovery/layout.tsx).
    stubAuth(user("u-2"), { data: null, error: { message: "permission denied" } });
    await renderPage();
    expect(screen.getByText("Pseudonymous manager")).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
    expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
  });

  it("createClient throws: falls back to the redacted lane", async () => {
    // Specialist-review S1 (security c8): an outage that surfaces as a thrown error must NOT
    // open institutional disclosure. The lookup is wrapped in a try/catch that leaves
    // isAttested false.
    vi.mocked(createClient).mockImplementationOnce(async () => {
      throw new Error("supabase outage");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderPage();
      expect(screen.getByText("Pseudonymous manager")).toBeInTheDocument();
      expect(screen.queryByText(/Test bio body/i)).toBeNull();
      expect(screen.queryByText(/Jane Doe/)).toBeNull();
      expect(screen.queryByText(/LinkedIn profile/i)).toBeNull();
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] attestation lookup failed:", expect.any(Error));
    } finally {
      errSpy.mockRestore();
    }
  });

  it("auth getUser() returns error (no throw): falls back to redacted", async () => {
    // `error != null` indicates a validation failure (expired JWT); it must NOT read as attested.
    vi.mocked(createClient).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    await renderPage();
    expect(screen.getByText("Pseudonymous manager")).toBeInTheDocument();
    expect(screen.queryByText(/Test bio body/i)).toBeNull();
  });
});

describe("TearSheet page - the factsheet's own opening view (D-03, LEAN-05)", () => {
  it("FactsheetView is rendered once, in printView, from the payload the published lane builds", async () => {
    stubAuth(ANON);
    await renderPage();

    expect(screen.getAllByTestId("factsheet-view")).toHaveLength(1);
    expect(recorded.views).toHaveLength(1);
    expect(lastView().printView).toBe(true);
    // The builder is the factsheet's one builder, given the published-only predicate: the
    // service-role read has no other gate (T-196-35).
    expect(fetchAndBuildPayloadWithReason).toHaveBeenCalledTimes(1);
    expect(fetchAndBuildPayloadWithReason).toHaveBeenCalledWith("s-1", withPublishedOnly);
    expect((lastView().payload as { strategyId: string }).strategyId).toBe("s-1");
  });

  it("the full render carries #tearsheet-main, the marker tearsheet.pdf requires, and the pending render does not (R2-01)", async () => {
    stubAuth(ANON);
    const { unmount } = await renderPage();
    expect(document.getElementById("tearsheet-main")).not.toBeNull();
    unmount();

    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({ payload: null, reason: "not_computed" });
    await renderPage();
    expect(screen.getByTestId("tearsheet-pending")).toBeTruthy();
    expect(document.getElementById("tearsheet-main")).toBeNull();
  });

  it("the trust tier is read per request and overlaid on the payload", async () => {
    vi.mocked(readPublicVerificationSignals).mockResolvedValue(
      new Map([["s-1", { trust_tier: "api_verified" }]]) as never,
    );
    stubAuth(ANON);
    await renderPage();
    expect(readPublicVerificationSignals).toHaveBeenCalledWith(["s-1"]);
    expect((lastView().payload as { trustTier: unknown }).trustTier).toBe("api_verified");
  });

  it("a tier outside the three known kinds is dropped to null, never passed through", async () => {
    vi.mocked(readPublicVerificationSignals).mockResolvedValue(
      new Map([["s-1", { trust_tier: "platinum" }]]) as never,
    );
    stubAuth(ANON);
    await renderPage();
    expect((lastView().payload as { trustTier: unknown }).trustTier).toBeNull();
  });

  it("the page prints none of the blocks the HEAD tear sheet derived for itself", async () => {
    stubAuth(ANON);
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    for (const gone of ["Monthly Returns", "Allocation Terms", "Equity Curve", "Peer-relative ranks"]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(screen.queryByTestId("tearsheet-figure-gate-note")).toBeNull();
    expect(screen.queryByTestId("tearsheet-var-method-line")).toBeNull();
  });
});

describe("TearSheet page - a strategy that is not published or not built answers not-found", () => {
  it("a missing or unpublished strategy calls notFound() and builds nothing", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue(null as never);
    await expect(renderPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(fetchAndBuildPayloadWithReason).not.toHaveBeenCalled();
  });

  it("a strategy without an analytics row calls notFound()", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue({ ...DETAIL, analytics: null } as never);
    await expect(renderPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("a strategy the builder reports as not visible calls notFound(), never a 200 text page", async () => {
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({ payload: null, reason: "not_visible" });
    stubAuth(ANON);
    await expect(renderPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Strategy not found.")).toBeNull();
  });
});

describe("TearSheet page - a published strategy that is not built yet is not a 404 (SF-04)", () => {
  it.each(["not_computed", "composite_unbuildable", "too_few_points", "malformed_series"] as const)(
    "reason %s renders the pending state with the factsheet's own sentence: no 404, no opening view",
    async (reason) => {
      vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({ payload: null, reason });
      stubAuth(ANON);
      await renderPage();
      expect(notFound).not.toHaveBeenCalled();
      expect(screen.getByTestId("tearsheet-pending")).toBeTruthy();
      // 199-18: the shipped sentence, then the one action a visitor has (factsheet.public-pending).
      const pending = screen.getByText(
        `${KCS10_PUBLIC_SENTENCE} Check with the person who shared this link before trying again.`,
      );
      expect(pending.getAttribute("data-degrade-id")).toBe("factsheet.public-pending");
      // Phase 201 D-09: the H1 is the name discovery prints for a published strategy.
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Test Strategy");
      expect(screen.getByRole("link", { name: "Back to factsheet" }).getAttribute("href")).toBe("/factsheet/s-1");
      expect(recorded.views).toHaveLength(0);
    },
  );

  it("a failed read is thrown to the error boundary, never answered as a 404 or a pending page", async () => {
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({ payload: null, reason: "read_error" });
    stubAuth(ANON);
    await expect(renderPage()).rejects.toThrow("tearsheet payload read failed");
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("TearSheet page - AUM follows 194 D-06 / D-22 (the payload handed down is stripped per viewer)", () => {
  const aumOf = () => (lastView().payload as { aum: number | null }).aum;
  const capacityOf = () => (lastView().payload as { maxCapacity: number | null }).maxCapacity;

  it("anonymous viewer: showAum false, the payload carries no AUM or capacity, no roles lookup", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(lastView().showAum).toBe(false);
    expect(aumOf()).toBeNull();
    expect(capacityOf()).toBeNull();
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("attested viewer without the allocator role (analyst): no AUM", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["analyst"] });
    stubAuth(user("u-9"), ATTESTED);
    await renderPage();
    expect(lastView().showAum).toBe(false);
    expect(aumOf()).toBeNull();
  });

  it("a different manager (quant_manager, not the owner): no AUM", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["quant_manager"] });
    stubAuth(user("u-2"));
    await renderPage();
    expect(lastView().showAum).toBe(false);
    expect(aumOf()).toBeNull();
  });

  it("an admin who is neither an allocator nor the owner: no AUM (D-12)", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["admin"] });
    stubAuth(user("u-3"));
    await renderPage();
    expect(lastView().showAum).toBe(false);
    expect(aumOf()).toBeNull();
  });

  it("the strategy's own manager: AUM and capacity ride the payload, no roles lookup", async () => {
    stubAuth(user("u-1"));
    await renderPage();
    expect(lastView().showAum).toBe(true);
    expect(aumOf()).toBe(100_000);
    expect(capacityOf()).toBe(500_000);
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("an allocator: AUM rides the payload", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValueOnce({ ok: true, roles: ["allocator"] });
    stubAuth(user("u-4"));
    await renderPage();
    expect(lastView().showAum).toBe(true);
    expect(aumOf()).toBe(100_000);
  });

  it("a roles lookup that returns ok: false removes AUM and logs [tearsheet]", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getUserRolesResult).mockResolvedValueOnce({
        ok: false,
        error: { code: "XX000", message: "boom" },
      });
      stubAuth(user("u-4"));
      await renderPage();
      expect(lastView().showAum).toBe(false);
      expect(aumOf()).toBeNull();
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] aum gate failed:", expect.anything());
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a roles lookup that throws removes AUM and logs [tearsheet]", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getUserRolesResult).mockRejectedValueOnce(new Error("roles exploded"));
      stubAuth(user("u-4"));
      await renderPage();
      expect(lastView().showAum).toBe(false);
      expect(aumOf()).toBeNull();
      expect(errSpy).toHaveBeenCalledWith("[tearsheet] aum gate failed:", expect.any(Error));
    } finally {
      errSpy.mockRestore();
    }
  });

  it("no request client (createClient threw): showAum stays false", async () => {
    vi.mocked(createClient).mockImplementationOnce(async () => {
      throw new Error("supabase outage");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderPage();
      expect(lastView().showAum).toBe(false);
      expect(aumOf()).toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });
});

/**
 * Phase 201 plan 23 (D-20, U-03): the print view carries no Term. `FactsheetView printView`
 * wraps its body in `PlainTerms`, so every `Term` prints as its plain label: no dotted underline,
 * no tab stop and no bubble on paper. The factsheet's own test proves that for the view alone;
 * this arm asserts it on the tearsheet ROUTE, where the page hands the view `printView`, so a
 * page that stopped passing the flag, or a view that dropped the wrapper, fails here. The real
 * `FactsheetView` is rendered (the rest of this file stubs it), and the same payload on screen is
 * the control that proves the arm can see a trigger.
 */
describe("TearSheet page - the print view renders no Term (D-20, U-03)", () => {
  const MOMENTUM_RANKS = { "s-1": RANKS };

  async function renderRealPage() {
    recorded.renderReal = true;
    vi.mocked(getPercentiles).mockResolvedValue(MOMENTUM_RANKS as never);
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
      payload: { ...censusPayloadA(), strategyId: "s-1" } as FactsheetPayload,
      reason: null,
    });
    stubAuth(ANON);
    return renderPage();
  }

  it("has no [data-term] and no Term tab stop, while the strip and section labels still read their text", async () => {
    const { container } = await renderRealPage();

    expect(lastView().printView).toBe(true);
    expect(container.querySelectorAll("[data-term]")).toHaveLength(0);
    // A Term is the only element here that carries both; under PlainTerms there is none.
    expect(container.querySelectorAll("[data-term][tabindex]")).toHaveLength(0);
    // The labels the Terms wrapped are still printed: the strip's own, and the page's section heading.
    const labels = Array.from(container.querySelectorAll('[data-testid="factsheet-kpi-label"]')).map((l) => l.textContent);
    expect(labels).toContain("Sharpe");
    expect(screen.getByText("Peer-relative ranks")).toBeInTheDocument();
  });

  it("the same payload as the on-screen view does render triggers (the print arm is not vacuous)", async () => {
    const { FactsheetView: Screen } = await vi.importActual<typeof import("../v2/FactsheetView")>("../v2/FactsheetView");
    const { container } = render(<Screen payload={censusPayloadA()} />);
    expect(container.querySelectorAll("[data-term]").length).toBeGreaterThan(0);
  });
});

describe("TearSheet page - what the print view keeps around the opening view", () => {
  const MOMENTUM_RANKS = { "s-1": RANKS };

  it("the peer ranks render after the opening view and before the manager panel, scoped to the strategy's category", async () => {
    vi.mocked(getPercentiles).mockResolvedValue(MOMENTUM_RANKS as never);
    stubAuth(ANON);
    await renderPage();

    expect(getPercentiles).toHaveBeenCalledWith("momentum");
    const view = screen.getByTestId("factsheet-view");
    const ranks = screen.getByText("Peer-relative ranks");
    const identity = screen.getByText("Pseudonymous manager");
    const follows = (a: Node, b: Node) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(view, ranks)).toBeTruthy();
    expect(follows(ranks, identity)).toBeTruthy();
    expect(within(ranks.closest("section") as HTMLElement).getAllByTestId("percentile-rank-badge")).toHaveLength(5);
  });

  it("with no rank map for the strategy there is no ranks section at all (no bare heading)", async () => {
    vi.mocked(getPercentiles).mockResolvedValue(null);
    stubAuth(ANON);
    await renderPage();
    expect(screen.queryByText("Peer-relative ranks")).toBeNull();
  });

  // Phase 201 D-11: the stamp prints through formatDay, read in UTC. The instant is pinned just
  // after midnight UTC so a local-time reading (any zone west of UTC) would print the day before.
  it("the Generated stamp is formatDay of the request instant, read in UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T00:30:00Z"));
    try {
      stubAuth(ANON);
      await renderPage();
      expect(screen.getByText("Generated Oct 9, 2026")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the Generated line renders once, is printed, and sits after the opening view", async () => {
    stubAuth(ANON);
    await renderPage();
    const lines = screen.getAllByText(/^Generated /);
    expect(lines).toHaveLength(1);
    expect(lines[0].className).not.toContain("print:hidden");
    expect(
      screen.getByTestId("factsheet-view").compareDocumentPosition(lines[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("the contact block keeps its own copy under a hairline, printed, with no accent tint and a screen-only link", async () => {
    stubAuth(ANON);
    await renderPage();

    // The display name is the real name the H1 and the title show (Phase 201 D-09).
    const heading = screen.getByText(/^Interested in /);
    expect(heading.textContent).toMatch(/^Interested in .+\?$/);
    const block = heading.closest("section") as HTMLElement;
    expect(block.textContent).toContain(
      "Request an introduction through Quantalyze. The manager will be notified and will respond directly.",
    );
    expect(block.className).toContain("border-t");
    expect(block.className).not.toContain("print:hidden");
    expect(block.className).not.toContain("bg-accent");
    expect(block.className).not.toContain("text-center");

    const link = within(block).getByRole("link", { name: "Open the factsheet" });
    expect(link.getAttribute("href")).toBe("/factsheet/s-1");
    expect(link.className).toContain("print:hidden");
    expect(link.className).toContain("underline");
    // It carries no manager identity and no AUM.
    expect(block.textContent).not.toMatch(/Jane Doe|\$100,000/);
  });

  it("the page's section order is: opening view, ranks, manager panel, contact, Risk Disclosure", async () => {
    vi.mocked(getPercentiles).mockResolvedValue(MOMENTUM_RANKS as never);
    stubAuth(ANON);
    await renderPage();
    const nodes = [
      screen.getByTestId("factsheet-view"),
      screen.getByText("Peer-relative ranks"),
      screen.getByText("Pseudonymous manager"),
      screen.getByText(/^Interested in /),
      screen.getByRole("heading", { name: "Risk Disclosure" }),
    ];
    for (let i = 1; i < nodes.length; i++) {
      expect(
        nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `block ${i} follows block ${i - 1}`,
      ).toBeTruthy();
    }
  });
});

describe("TearSheet page - screen-only controls (D-09, UI-SPEC Print and Tearsheet)", () => {
  /** The row of controls: the one container that is print:hidden and holds the PDF link. */
  function controls(): HTMLElement {
    return screen.getByRole("link", { name: "Download PDF" }).parentElement as HTMLElement;
  }

  it("reads Back to factsheet, Print tearsheet, Download PDF in that order, left-aligned, hidden in print", async () => {
    stubAuth(ANON);
    await renderPage();
    const row = controls();
    expect(row.className).toContain("print:hidden");
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("gap-2");
    expect(row.className).not.toContain("justify-center");

    const items = Array.from(row.children) as HTMLElement[];
    expect(items.map((el) => el.textContent)).toEqual(["Back to factsheet", "Print tearsheet", "Download PDF"]);
    expect(items[0].getAttribute("href")).toBe("/factsheet/s-1");
    expect(items[1].tagName).toBe("BUTTON");
    expect(items[2].getAttribute("href")).toBe("/api/factsheet/s-1/tearsheet.pdf");
    expect(items[2].getAttribute("target")).toBe("_blank");
  });

  it("Download PDF is the row's one accent fill; the other two are secondary; every control has a 44px target", async () => {
    stubAuth(ANON);
    await renderPage();
    const [back, print, pdf] = Array.from(controls().children) as HTMLElement[];
    expect(pdf.className).toContain("bg-accent");
    for (const secondary of [back, print]) {
      expect(secondary.className).not.toContain("bg-accent");
      expect(secondary.className).toContain("border-border");
    }
    for (const el of [back, print, pdf]) expect(el.className).toContain("min-h-[44px]");
  });

  it("the old 'Download as PDF' label and the accent 'View full factsheet' button are gone", async () => {
    stubAuth(ANON);
    await renderPage();
    expect(screen.queryByText("Download as PDF")).toBeNull();
    expect(screen.queryByText(/View full factsheet/)).toBeNull();
    expect(screen.getAllByText(/Download PDF/)).toHaveLength(1);
  });

  it("Print tearsheet calls window.print()", async () => {
    const print = vi.fn();
    const original = window.print;
    window.print = print;
    try {
      stubAuth(ANON);
      await renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Print tearsheet" }));
      expect(print).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  });
});

describe("TearSheet page - one Risk Disclosure block (195 D-09, UC-19, T-195-09)", () => {
  // Sentences are pinned as LITERALS: a test reading the page's own constants cannot fail
  // when a legally required sentence is dropped from them.
  const LEAD = [
    "Past performance does not guarantee future results.",
    "Cryptocurrency trading involves substantial risk of total loss.",
    "This tear sheet is for informational purposes only and does not constitute investment, legal, or tax advice.",
  ];
  const ANALYTICS_ONLY =
    "Quantalyze provides analytics only — no pooling, no fund administration, no custody of client assets.";
  const API_CLAUSE = "Strategies are monitored via read-only exchange APIs; managers retain asset custody.";
  const PLAIN_CLAUSE = "Managers retain asset custody.";

  async function disclosureText(tier: string | null) {
    if (tier !== null) {
      vi.mocked(readPublicVerificationSignals).mockResolvedValue(
        new Map([["s-1", { trust_tier: tier }]]) as never,
      );
    }
    stubAuth(ANON);
    const { container } = await renderPage();
    const heading = screen.getByRole("heading", { name: "Risk Disclosure" });
    const section = heading.closest("section") as HTMLElement;
    return { container, section, paragraph: section.querySelector("p")?.textContent ?? "" };
  }

  it("an api_verified strategy carries every prior sentence once plus the analytics-only custody sentence, as the one block", async () => {
    const { container, section, paragraph } = await disclosureText("api_verified");
    const text = container.textContent ?? "";
    for (const sentence of [...LEAD, API_CLAUSE, ANALYTICS_ONLY]) {
      expect(text.split(sentence).length - 1, sentence).toBe(1);
    }
    // The custody box is gone: its capitalised wording appears nowhere.
    expect(text).not.toContain("Manager retains asset custody");
    expect(paragraph).toBe(
      `${[...LEAD, API_CLAUSE, ANALYTICS_ONLY].join(" ")} Read the full risk disclaimer at /legal/disclaimer.`,
    );
    expect(section.querySelector('a[href="/legal/disclaimer"]')).not.toBeNull();
  });

  // Phase 201 D-24 (founder-folded D-16): a record uploaded as a CSV, or reported by the manager
  // themselves, is NOT monitored through an exchange API, so the tear sheet must not say it is.
  // A reader (an allocator weighing a record) relies on this sentence to know how far the numbers
  // were checked. Each arm goes RED if the API-monitoring sentence is printed for that tier.
  it.each([
    ["csv_uploaded", "csv_uploaded"],
    ["self_reported", "self_reported"],
    ["a missing tier", null],
    ["a tier outside the three known kinds", "platinum"],
  ])("%s: the clause is the plain custody sentence and never says API-monitored", async (_label, tier) => {
    const { container, section, paragraph } = await disclosureText(tier);
    const text = container.textContent ?? "";
    expect(text).not.toContain("read-only exchange APIs");
    expect(text.split(PLAIN_CLAUSE).length - 1).toBe(1);
    for (const sentence of [...LEAD, ANALYTICS_ONLY]) {
      expect(text.split(sentence).length - 1, sentence).toBe(1);
    }
    expect(paragraph).toBe(
      `${[...LEAD, PLAIN_CLAUSE, ANALYTICS_ONLY].join(" ")} Read the full risk disclaimer at /legal/disclaimer.`,
    );
    expect(section.querySelector('a[href="/legal/disclaimer"]')).not.toBeNull();
  });

  it("the Risk Disclosure section sits below the contact block", async () => {
    stubAuth(ANON);
    await renderPage();
    const contact = screen.getByText(/^Interested in /).closest("section") as HTMLElement;
    const risk = screen.getByRole("heading", { name: "Risk Disclosure" }).closest("section") as HTMLElement;
    expect(contact.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("TearSheet page - the real name in the title, the H1 and the manager card (Phase 201 D-09, U-11)", () => {
  const GHOST = {
    ...DETAIL,
    strategy: { ...DETAIL.strategy, name: "Fibonacci Ghost", codename: "Ghost-7", disclosure_tier: "exploratory" },
    manager: null,
    disclosureTier: "exploratory",
  };

  it("generateMetadata titles a published exploratory strategy with its real name", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue(GHOST as never);
    const meta = await generateMetadata({ params: Promise.resolve({ id: "s-1" }) });
    expect(String(meta.title).startsWith("Fibonacci Ghost")).toBe(true);
    expect(String(meta.title)).not.toContain("Ghost-7");
  });

  it("falls back to the codename when the name is blank, and to the neutral word when nothing was read", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue({
      ...GHOST,
      strategy: { ...GHOST.strategy, name: "   " },
    } as never);
    expect(String((await generateMetadata({ params: Promise.resolve({ id: "s-1" }) })).title)).toMatch(/^Ghost-7 /);
    vi.mocked(getFactsheetDetail).mockResolvedValue(null as never);
    expect(String((await generateMetadata({ params: Promise.resolve({ id: "s-1" }) })).title)).toMatch(/^Strategy /);
  });

  it("the pending H1 prints the real name", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue(GHOST as never);
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({ payload: null, reason: "not_computed" });
    stubAuth(ANON);
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fibonacci Ghost");
  });

  it("the exploratory manager card reads Pseudonymous manager and Manages {name}", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue(GHOST as never);
    stubAuth(ANON);
    await renderPage();
    expect(screen.getByRole("heading", { level: 3, name: "Pseudonymous manager" })).toBeInTheDocument();
    expect(screen.getByText(/^Manages Fibonacci Ghost\./)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Fibonacci Ghost" })).toBeNull();
  });

  it("an unattested viewer of an institutional strategy still gets the exploratory card (C-0189 unchanged)", async () => {
    vi.mocked(getFactsheetDetail).mockResolvedValue({
      ...DETAIL,
      strategy: { ...DETAIL.strategy, name: "Fibonacci Ghost" },
    } as never);
    stubAuth(user("newbie-1"));
    await renderPage();
    expect(screen.getByText(/^Manages Fibonacci Ghost\./)).toBeInTheDocument();
    expect(screen.queryByText(/Jane Doe/)).toBeNull();
  });
});
