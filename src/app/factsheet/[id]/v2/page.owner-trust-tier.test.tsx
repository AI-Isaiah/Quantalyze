/** @vitest-environment jsdom */
/**
 * Phase 237 / FACT-04 (ROADMAP SC-4) — the owner's own unpublished factsheet shows
 * the data source of their own strategy, and nobody else's reading changes.
 *
 * `get_published_trust_signals` is published-gated, so on Lane B (lane === "owner")
 * the page used to read "Data source —" for the owner's own key-backed strategy.
 * The page now reads the latest `strategy_verifications` row on the OWNER LANE only,
 * with the request's user-scoped client (RLS `strategy_verifications_owner_select`
 * is the ownership check) and overlays it per request through `withTrustTier`.
 *
 * Oracles are literals typed here (tier labels, call counts), never imported from
 * the page. The real `readOwnerTrustTier` runs behind a call-counting spy so both
 * the value and the "was it even asked" question are falsifiable.
 *
 * The strategy builder is stubbed to return a payload that carries a USD view, so
 * every case asserts BOTH unit views on the real `FactsheetView`: the Terms
 * "Data source" row and the masthead pill.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/factsheet/x/v2",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));
vi.mock("@/lib/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...actual };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));
// The REAL read behind a spy: `.mock.calls.length` is the "was it asked" oracle.
vi.mock("@/lib/factsheet/owner-trust-tier", async () => {
  const actual = await vi.importActual<typeof import("@/lib/factsheet/owner-trust-tier")>(
    "@/lib/factsheet/owner-trust-tier",
  );
  return { ...actual, readOwnerTrustTier: vi.fn(actual.readOwnerTrustTier) };
});
vi.mock("@/lib/factsheet/fetch-and-build-payload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/factsheet/fetch-and-build-payload")>(
    "@/lib/factsheet/fetch-and-build-payload",
  );
  return { ...actual, fetchAndBuildPayloadWithReason: vi.fn() };
});

import FactsheetV2Page from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { readOwnerTrustTier } from "@/lib/factsheet/owner-trust-tier";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { captureToSentry } from "@/lib/sentry-capture";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "66666666-6666-4666-8666-666666666666";
const OWNER_UID = "11111111-1111-4111-8111-111111111111";
const OTHER_UID = "22222222-2222-4222-8222-222222222222";

// `localStorage` is read by the view's persisted-state hooks; install a store per test
// (`unstubGlobals: true` in vitest.config.ts removes stubs between tests).
const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

function series(n: number, startDay = 1): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, startDay));
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: 0.0015 + Math.sin(i * 0.27) * 0.005 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

/** As the cached/owner builders return it: native BTC payload plus a USD view, both with a
 *  null tier (the tier is never part of the build). */
function builtPayload(): FactsheetPayload {
  const native = buildScenarioFactsheetPayload({ portfolioDaily: series(300), benchmark: null });
  const usd = buildScenarioFactsheetPayload({ portfolioDaily: series(297, 3), benchmark: null });
  return {
    ...native,
    strategyId: STRATEGY_ID,
    strategyName: "Draft Alpha",
    trustTier: null,
    returnsUnit: "BTC",
    usdView: {
      payload: { ...usd, returnsUnit: "USD", convertedFrom: "BTC", trustTier: null } as FactsheetPayload,
      convertedFrom: "BTC",
      usdStart: "2023-01-03",
      usdEnd: "2023-10-26",
      leadingHole: true,
      unpricedDays: [],
      removedReturns: 0,
    },
  } as FactsheetPayload;
}

// --- Switchable request-client state ----------------------------------------

type VerificationResult = {
  data: { trust_tier: unknown } | null;
  error: { code?: string; message: string } | null;
};

const STATE = {
  sessionUser: null as { id: string } | null,
  /** Lane A: the published-only probe's row. */
  publishedRow: null as unknown,
  /** Lane B: the owner-inclusive probe's row. */
  ownerRow: null as unknown,
  /** What the request client answers for `strategy_verifications`. */
  verification: { data: null, error: null } as VerificationResult,
  /** Every table the REQUEST client was asked for, in order. */
  tablesRead: [] as string[],
};

function signatureRow(status?: string, userId?: string) {
  return {
    id: STRATEGY_ID,
    name: "Draft Alpha",
    codename: null,
    disclosure_tier: "exploratory",
    strategy_analytics: { computed_at: "2026-07-01T00:00:00.000Z" },
    ...(status ? { status } : {}),
    ...(userId ? { user_id: userId } : {}),
  };
}

function mockRequestClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: STATE.sessionUser }, error: null }),
    },
    from: (table: string) => {
      STATE.tablesRead.push(table);
      let sawOr = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => {
          sawOr = true;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === "strategy_verifications") return Promise.resolve(STATE.verification);
          if (table === "strategy_shares") return Promise.resolve({ data: null, error: null });
          return Promise.resolve(
            sawOr ? { data: STATE.ownerRow, error: null } : { data: STATE.publishedRow, error: null },
          );
        },
      };
      return chain;
    },
  };
}

function givenOwnerDraft(verification: VerificationResult) {
  STATE.publishedRow = null;
  STATE.ownerRow = signatureRow("draft", OWNER_UID);
  STATE.sessionUser = { id: OWNER_UID };
  STATE.verification = verification;
}

const renderPage = () => FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });

// --- Tree + DOM helpers -----------------------------------------------------

function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}

function termValue(container: HTMLElement, label: string): string {
  const heading = Array.from(container.querySelectorAll("h3")).find((h) => h.textContent === "Terms");
  expect(heading, "the Terms panel did not render").toBeDefined();
  const panel = heading!.closest("section") as HTMLElement;
  const dt = Array.from(panel.querySelectorAll("dt")).find((el) => el.textContent === label);
  expect(dt, `Terms row "${label}" did not render`).toBeDefined();
  return (dt!.nextElementSibling as HTMLElement).textContent ?? "";
}

async function openAdvanced(container: HTMLElement) {
  fireEvent.click(container.querySelector("#factsheet-advanced > summary")!);
  await waitFor(() =>
    expect(container.querySelector("#factsheet-advanced [data-advanced-contents]")).not.toBeNull(),
  );
}

function toggleUsd(container: HTMLElement) {
  const t = container.querySelector('[data-testid="factsheet-unit-toggle"]') as HTMLElement;
  fireEvent.click(within(t).getByRole("button", { name: "USD" }));
}

/** Terms "Data source" and the masthead pill, read in the native view and then the USD view. */
async function readSurfaces(jsx: unknown) {
  const { container } = render(jsx as ReactElement);
  await openAdvanced(container);
  const pill = () => container.querySelector('[data-testid="trust-tier-label"]');
  const native = { term: termValue(container, "Data source"), pill: pill()?.textContent ?? null };
  toggleUsd(container);
  const usd = { term: termValue(container, "Data source"), pill: pill()?.textContent ?? null };
  return { native, usd };
}

beforeEach(() => {
  vi.clearAllMocks();
  lsStore.clear();
  STATE.sessionUser = null;
  STATE.publishedRow = null;
  STATE.ownerRow = null;
  STATE.verification = { data: null, error: null };
  STATE.tablesRead = [];
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(createAdminClient).mockReturnValue({} as unknown as SupabaseClient);
  // A draft has no PUBLISHED verification signal (the RPC is published-gated).
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: builtPayload(),
    reason: null,
  } as never);
});

// ---------------------------------------------------------------------------

describe("FACT-04 — the owner sees their own data source on an unpublished factsheet", () => {
  it.each([
    ["api_verified", "API-verified", "API verified"],
    ["csv_uploaded", "CSV-uploaded (verification pending)", "CSV uploaded — verification pending"],
    ["self_reported", "Self-reported", "Self-reported"],
  ] as const)(
    "owner with a %s row: the payload, the Terms row and the pill carry it in BOTH unit views",
    async (tier, termText, pillText) => {
      givenOwnerDraft({ data: { trust_tier: tier }, error: null });

      const jsx = await renderPage();

      const payload = findPayload(jsx);
      expect(payload, "owner must receive a real payload").not.toBeNull();
      expect(payload!.trustTier).toBe(tier);
      expect(payload!.usdView!.payload.trustTier).toBe(tier);
      expect(vi.mocked(readOwnerTrustTier)).toHaveBeenCalledTimes(1);

      const surfaces = await readSurfaces(jsx);
      expect(surfaces.native).toEqual({ term: termText, pill: pillText });
      expect(surfaces.usd.term).toBe(termText);
      // D-19: the masthead stays on the native payload under the USD toggle.
      expect(surfaces.usd.pill).toBe(pillText);
    },
  );

  it("owner with NO verification row: tier null, Data source reads —, no pill", async () => {
    givenOwnerDraft({ data: null, error: null });

    const jsx = await renderPage();

    const payload = findPayload(jsx);
    expect(payload).not.toBeNull();
    expect(payload!.trustTier).toBeNull();
    expect(payload!.usdView!.payload.trustTier).toBeNull();

    const surfaces = await readSurfaces(jsx);
    expect(surfaces.native).toEqual({ term: "—", pill: null });
    expect(surfaces.usd).toEqual({ term: "—", pill: null });
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("the owner read goes through the request client: strategy_verifications is read there and the admin client is never built", async () => {
    givenOwnerDraft({ data: { trust_tier: "api_verified" }, error: null });
    await renderPage();
    expect(STATE.tablesRead).toContain("strategy_verifications");
    // The builder is stubbed, so any admin client here would have come from the page or the read.
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});

describe("FACT-04 — an owner read that fails degrades to Data source —, never to a broken page", () => {
  it("a PostgREST error: the page still renders, the tier is null, and the failure reaches Sentry with its stage tag", async () => {
    givenOwnerDraft({ data: null, error: { code: "42501", message: "permission denied for table x" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const jsx = await renderPage();

    const payload = findPayload(jsx);
    expect(payload, "the owner's page must still render a real payload").not.toBeNull();
    expect(payload!.trustTier).toBeNull();
    expect(vi.mocked(readOwnerTrustTier)).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    const stages = vi
      .mocked(captureToSentry)
      .mock.calls.map(([, ctx]) => (ctx as { tags?: { stage?: string } } | undefined)?.tags?.stage);
    expect(stages).toContain("owner-trust-tier");

    // A view really mounts: the owner sees the page with "Data source —" and no pill.
    const surfaces = await readSurfaces(jsx);
    expect(surfaces.native).toEqual({ term: "—", pill: null });
    expect(surfaces.usd).toEqual({ term: "—", pill: null });
  });

  it("a thrown read: the page still renders with a null tier", async () => {
    givenOwnerDraft({ data: null, error: null });
    const base = mockRequestClient();
    vi.mocked(createClient).mockResolvedValue({
      ...base,
      from: (table: string) => {
        if (table === "strategy_verifications") throw new Error("socket hang up");
        return base.from(table);
      },
    } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const payload = findPayload(await renderPage());

    expect(payload, "a thrown read must not take the page down").not.toBeNull();
    expect(payload!.trustTier).toBeNull();
  });
});

describe("FACT-04 — an unpublished strategy's data source is never read for anyone but its owner", () => {
  it("anon on an unpublished strategy: 404 and the owner read is never called", async () => {
    STATE.sessionUser = null;
    STATE.publishedRow = null;
    STATE.ownerRow = signatureRow("draft", OWNER_UID);
    STATE.verification = { data: { trust_tier: "api_verified" }, error: null };

    await expect(renderPage()).rejects.toThrow(/notFound/);

    expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
    expect(STATE.tablesRead).not.toContain("strategy_verifications");
  });

  it("signed-in non-owner on an unpublished strategy: 404 and the owner read is never called", async () => {
    STATE.sessionUser = { id: OTHER_UID };
    STATE.publishedRow = null;
    // RLS on the owner-inclusive probe hides another user's draft: no row comes back.
    STATE.ownerRow = null;
    STATE.verification = { data: { trust_tier: "api_verified" }, error: null };

    await expect(renderPage()).rejects.toThrow(/notFound/);

    expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
    expect(STATE.tablesRead).not.toContain("strategy_verifications");
  });

  it("WR-01: a PUBLISHED row that reaches Lane B keeps its published signal and the owner read is not called", async () => {
    STATE.sessionUser = { id: OTHER_UID };
    STATE.publishedRow = null; // Lane A missed (transient error or the publish race)
    STATE.ownerRow = signatureRow("published", OWNER_UID);
    // The owner read WOULD say self_reported if it ran; the published signal says api_verified.
    STATE.verification = { data: { trust_tier: "self_reported" }, error: null };
    vi.mocked(readPublicVerificationSignals).mockResolvedValue(
      new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
    );

    const payload = findPayload(await renderPage());

    expect(payload).not.toBeNull();
    expect(payload!.trustTier).toBe("api_verified");
    expect(payload!.usdView!.payload.trustTier).toBe("api_verified");
    expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
  });

  it("a published strategy on Lane A never asks the owner read either", async () => {
    STATE.sessionUser = { id: OTHER_UID };
    STATE.publishedRow = signatureRow();
    STATE.verification = { data: { trust_tier: "self_reported" }, error: null };

    const payload = findPayload(await renderPage());

    expect(payload).not.toBeNull();
    expect(payload!.trustTier).toBeNull();
    expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
  });

  // UI-SPEC 3.2 last paragraph: owner AND anon each get a test on every surface where the tier
  // renders (the Terms row and the masthead pill, in both unit views). The anon reader's surfaces
  // are the published lane's, unchanged by this plan: the published signal fills them, nothing else.
  it.each([
    ["api_verified", "API-verified", "API verified"],
    ["csv_uploaded", "CSV-uploaded (verification pending)", "CSV uploaded — verification pending"],
  ] as const)(
    "anon on a PUBLISHED strategy with a %s published signal: the Terms row and the pill carry it in both views, and the owner read is never called",
    async (tier, termText, pillText) => {
      STATE.sessionUser = null;
      STATE.publishedRow = signatureRow();
      // Would be the owner's tier if the owner read ran for an anon reader.
      STATE.verification = { data: { trust_tier: "self_reported" }, error: null };
      vi.mocked(readPublicVerificationSignals).mockResolvedValue(
        new Map([[STRATEGY_ID, { trust_tier: tier, status: "verified" }]]) as never,
      );

      const jsx = await renderPage();

      const surfaces = await readSurfaces(jsx);
      expect(surfaces.native).toEqual({ term: termText, pill: pillText });
      expect(surfaces.usd.term).toBe(termText);
      expect(surfaces.usd.pill).toBe(pillText);
      expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
    },
  );

  it("anon on a PUBLISHED strategy with no published signal: Data source reads — and there is no pill, in both views", async () => {
    STATE.sessionUser = null;
    STATE.publishedRow = signatureRow();
    STATE.verification = { data: { trust_tier: "api_verified" }, error: null };

    const surfaces = await readSurfaces(await renderPage());

    expect(surfaces.native).toEqual({ term: "—", pill: null });
    expect(surfaces.usd).toEqual({ term: "—", pill: null });
    expect(vi.mocked(readOwnerTrustTier)).not.toHaveBeenCalled();
  });

  it("a share-link recipient still reads Data source —: the share route does not import the owner read", () => {
    const source = readFileSync(join(process.cwd(), "src/app/factsheet-share/[token]/page.tsx"), "utf8");
    const code = stripCommentsPreserveLines(source);
    // Vacuity fence: the stripped source is the real page, so an absent reference means something.
    expect(code).toContain("FactsheetView");
    expect(code).not.toContain("owner-trust-tier");
    expect(code).not.toContain("readOwnerTrustTier");
  });
});

