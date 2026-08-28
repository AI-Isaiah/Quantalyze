/** @vitest-environment jsdom */
/**
 * Phase 164 / SHARE-02 — THE ORDERED ADVERSARIAL ACCEPTANCE. This file is the
 * phase's headline proof and ROADMAP success criterion 3.
 *
 * ═══ WHAT IS BEING PROVEN, AND WHY ORDER IS THE WHOLE TEST ═══
 *
 * SL-1: for any strategy id `X`, the `unstable_cache` entry keyed
 * `["factsheet-v2-payload-vN", X]` must be exactly what
 * `fetchAndBuildPayload(X, withPublishedOnly)` returns — a pure function of
 * `(X, database state)`, independent of viewer, session, cookies and any share
 * token. The recipient token lane renders an UNPUBLISHED strategy. If any part
 * of that render reached the id-keyed cache, the private payload would then be
 * served to every ANONYMOUS visitor to `/factsheet/<id>` for the full 3600s
 * TTL.
 *
 * ⛔ THE FAILURE IS SILENT AND TTL-LONG (SL-1c). The poisoning request is the
 * legitimate recipient's own, so it renders perfectly. No error, no log, no
 * Sentry event. The disclosure window opens AFTERWARDS, to a different person.
 * That is why this test is ordered rather than two independent assertions: a
 * test that only checked "the token render works" and a separate test that
 * only checked "anon gets a 404" would BOTH stay green against a poisoned
 * cache, because neither observes the second request in the state the first
 * request left behind. The sequence — poison, then probe, on uncleared spies —
 * is the property.
 *
 * ⛔ ZERO IS THE ONLY ACCEPTABLE COUNT, not "a different key" (SL-1a). The
 * `::computedAt` suffix the id route passes is split off and DISCARDED, so the
 * effective key is id-ONLY. Any safety argument of the form "we vary the cache
 * key" is wrong by construction, and an assertion of the form "the token lane
 * uses a different key" would encode that wrong argument. The token lane must
 * produce zero cache reads and zero cache writes.
 *
 * ═══ HARNESS PROPERTIES THAT ARE LOAD-BEARING (do not "simplify") ═══
 *
 *  1. `unstable_cache` is a SPY — `vi.fn((fn) => fn)` — not a bare identity
 *     stub. Identity behaviour is preserved so the id route still works; the
 *     INVOCATION COUNT is the entirety of the teeth. Cloned deliberately from
 *     `factsheet/[id]/v2/page.owner-lane.test.tsx`, whose header records the
 *     same rule for the owner lane. A bare `(fn) => fn` makes every assertion
 *     here vacuous.
 *  2. The spies are NOT cleared between the two halves of a test. Clearing
 *     them would delete the ordering, which is the point.
 *  3. `@/lib/visibility` runs via `importActual`, so the REAL
 *     `withPublishedOnly` / `withPublishedOrOwner` shape the queries against a
 *     RECORDING builder stub. A passthrough mock would make the key-shape
 *     assertions unfalsifiable.
 *  4. The token is derived with the REAL `deriveShareToken` against the test
 *     fixture secret, and the page's REAL `verifyShareToken` scan authorises
 *     it. Nothing about the authorisation is stubbed — a fake "valid" token
 *     would prove nothing about the lane that actually renders.
 *  5. `fetchAndBuildPayload` is NOT mocked. Both lanes run the real builder
 *     against a mocked admin client, so the seam under test is the shipped one.
 *
 * ═══ ANTI-VACUITY — DEMONSTRATED, NOT ASSERTED ═══
 *
 * NEUTER-D, RUN 2026-08-28. The token page's payload fetch was temporarily
 * rewired through a `unstable_cache(..., ["factsheet-v2-payload-v6", id])`
 * wrapper — the exact poisoning D-01's structural argument prevents — and TWO
 * INDEPENDENT DETECTORS went red on the same tree:
 *
 *   (a) THIS FILE, on the zero-invocation assertion:
 *       Tests  3 failed | 1 passed (4)
 *       AssertionError: SL-1: the token lane must produce ZERO cache reads and
 *       ZERO cache writes — a key suffix is not a key: expected "vi.fn()" to be
 *       called +0 times, but got 1 times
 *
 *   (b) `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`, the
 *       structural repo walk, on its `buildFactsheetPayloadCached` /
 *       `unstable_cache` pins:
 *       Tests  2 failed | 15 passed (17)
 *       AssertionError: unstable_cache must appear EXACTLY ONCE in the repo's
 *       production sources … expected [ '…/factsheet-share/[token]/page.tsx',
 *       '…/factsheet/[id]/v2/page.tsx' ] to have a length of 1 but got 2
 *
 * Behavioural and structural, one defect. Restored from a byte backup verified
 * by `shasum` — never `git checkout --`, which discards uncommitted work — and
 * both suites re-run green. Full transcript in 164-05-SUMMARY.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// Both pages unwind through next/navigation, by DIFFERENT functions: the token
// lane `redirect()`s to the 410 sibling (D-08), the id lane `notFound()`s.
// Both throw here so a render that reaches them is observable as a rejection,
// and each is counted separately so "the anon probe 404'd" cannot be satisfied
// by a redirect and vice versa.
const redirectMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error("__REDIRECT__");
  },
  notFound: () => {
    notFoundMock();
    throw new Error("__NOT_FOUND__");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: async () => ({ success: true }),
  getClientIp: () => "203.0.113.7",
}));

// ⛔ HARNESS PROPERTY 1 — a SPY, not a bare identity stub.
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(
    (fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

// ⛔ HARNESS PROPERTY 3 — the REAL predicates run.
vi.mock("@/lib/visibility", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...actual };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ readPublicVerificationSignals: vi.fn() }));

import FactsheetSharePage from "./page";
import FactsheetV2Page from "@/app/factsheet/[id]/v2/page";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { deriveShareToken } from "@/lib/strategy-share-token";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

/** The PRIVATE strategy behind the share link. Draft — never published. */
const PRIVATE_ID = "44444444-4444-4444-8444-444444444444";
/** A DIFFERENT, genuinely published strategy. The sibling in case 3. */
const PUBLISHED_ID = "55555555-5555-4555-8555-555555555555";
/** Per-row MAC nonce. A MAC INPUT only — never rendered, never in a URL. */
const NONCE = "99999999-9999-4999-8999-999999999999";
const GENERATION = 1;

/** The shape-versioned key prefix, typed HERE by hand. Never imported from the
 *  page: an oracle read out of the module under test cannot fail. */
const EXPECTED_KEY_PREFIX = "factsheet-v2-payload-v6";

const CASH_DAILY = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: -0.02 },
  { date: "2025-08-03", value: 0.015 },
  { date: "2025-08-04", value: 0.005 },
  { date: "2025-08-05", value: -0.01 },
  { date: "2025-08-06", value: 0.02 },
  { date: "2025-08-07", value: -0.005 },
  { date: "2025-08-08", value: 0.03 },
  { date: "2025-08-09", value: -0.015 },
  { date: "2025-08-10", value: 0.01 },
];

/** Admin-side full strategy row consumed by the REAL fetchAndBuildPayload. */
function adminStrategyRow(id: string, name: string, status: "published" | "draft") {
  return {
    id,
    name,
    codename: null,
    disclosure_tier: "exploratory",
    status,
    markets: ["BTC"],
    strategy_types: ["options"],
    description: null,
    subtypes: [],
    supported_exchanges: ["deribit"],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: {
      daily_returns: CASH_DAILY,
      returns_series: null,
      computed_at: "2026-07-01T00:00:00.000Z",
      data_quality_flags: {},
      metrics_json_by_basis: null,
      computation_status: "complete",
    },
  };
}

/** Lane A signature-probe row for the id route (published lane). */
function signatureRow(id: string, name: string) {
  return {
    id,
    name,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_analytics: { computed_at: "2026-07-01T00:00:00.000Z" },
  };
}

// --- Switchable request/admin state -----------------------------------------

const STATE = {
  /** Active `strategy_shares` rows the token page scans. */
  shareRows: [] as Array<{
    strategy_id: string;
    generation: number;
    nonce: string;
  }>,
  /** `auth.getUser()` resolution on the id route — null models anon. */
  sessionUser: null as { id: string } | null,
  /** The row the PUBLISHED-only probe resolves on the id route. */
  publishedRow: null as unknown,
  /** Admin-side rows, keyed by strategy id. Absent id -> builder returns null. */
  adminRows: {} as Record<string, unknown>,
};

function mockRequestClient() {
  return {
    auth: { getUser: async () => ({ data: { user: STATE.sessionUser }, error: null }) },
    from: () => {
      let sawOr = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => {
          sawOr = true;
          return chain;
        },
        // The owner-inclusive probe (Lane B) never resolves a row in this
        // file: every id-route render here is ANONYMOUS by construction, so
        // the page 404s before it. Returning null keeps the arm honest rather
        // than unreachable-by-omission.
        maybeSingle: async () =>
          sawOr ? { data: null, error: null } : { data: STATE.publishedRow, error: null },
      };
      return chain;
    },
  };
}

/**
 * Admin client serving BOTH consumers on the service-role transport:
 * `strategy_shares` for the token page's constant-time scan, and `strategies`
 * for the real `fetchAndBuildPayload`.
 *
 * ⛔ Any OTHER table is thrown on. Nothing on either lane is bounded except the
 * active-shares read and the matched strategy id, so an unexpected table is a
 * disclosure bug and must fail the test rather than quietly return null.
 */
function mockAdmin(): SupabaseClient {
  const from = (table: string) => {
    if (table === "strategy_shares") {
      return {
        select: () => ({
          is: async () => ({ data: STATE.shareRows, error: null }),
        }),
      };
    }
    if (table === "strategies") {
      let requestedId: string | null = null;
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "id") requestedId = val;
          return chain;
        },
        or: () => chain,
        maybeSingle: async () => ({
          data: requestedId ? (STATE.adminRows[requestedId] ?? null) : null,
          error: null,
        }),
      };
      return chain;
    }
    throw new Error(`unexpected admin table read: ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

// --- Tree helper ------------------------------------------------------------

/** Depth-first search of an RSC element tree for the FactsheetView payload. */
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

const renderTokenPage = (token: string) =>
  FactsheetSharePage({ params: Promise.resolve({ token }) });
const renderIdPage = (id: string) =>
  FactsheetV2Page({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  STATE.shareRows = [];
  STATE.sessionUser = null;
  STATE.publishedRow = null;
  STATE.adminRows = {};
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(createAdminClient).mockImplementation(() => mockAdmin() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);
});

/** The private strategy has ONE active share row; nothing is published. */
function givenPrivateStrategyWithLiveShare() {
  STATE.shareRows = [
    { strategy_id: PRIVATE_ID, generation: GENERATION, nonce: NONCE },
  ];
  STATE.adminRows[PRIVATE_ID] = adminStrategyRow(PRIVATE_ID, "Draft Alpha", "draft");
  // ⛔ `publishedRow` stays null: the id route's published probe must MISS.
  STATE.publishedRow = null;
}

/** The real deriver, real fixture secret — the page's real scan authorises it. */
const validToken = () => deriveShareToken(PRIVATE_ID, NONCE, GENERATION);

// ---------------------------------------------------------------------------

describe("SHARE-02 — the ORDERED adversarial cache isolation", () => {
  it("1. token render of an UNPUBLISHED strategy succeeds and touches the cache ZERO times", async () => {
    givenPrivateStrategyWithLiveShare();

    const jsx = await renderTokenPage(validToken());

    const payload = findPayload(jsx);
    expect(payload, "a valid token must render the private factsheet").not.toBeNull();
    expect(payload!.strategyName).toBe("Draft Alpha");
    expect(redirectMock, "a valid token must not take the 410 path").not.toHaveBeenCalled();

    expect(
      vi.mocked(unstable_cache),
      "SL-1: the token lane must produce ZERO cache reads and ZERO cache writes — a key suffix is not a key",
    ).toHaveBeenCalledTimes(0);
  });

  it("2. ORDER IS THE TEST — after that token render, an ANONYMOUS request for the SAME id still 404s, cache still at zero", async () => {
    givenPrivateStrategyWithLiveShare();

    // ── FIRST: the render that would poison a shared cache, if anything could.
    const jsx = await renderTokenPage(validToken());
    expect(findPayload(jsx), "the token pass must succeed").not.toBeNull();
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);

    // ── THEN, same test, SPIES UNCLEARED: the adversary's probe. Anonymous,
    //    same id, bare id route. It must still 404 — nothing the token render
    //    did left an artefact an anonymous reader can reach.
    STATE.sessionUser = null;
    await expect(
      renderIdPage(PRIVATE_ID),
      "an anonymous probe for the shared id must still 404 after the token render",
    ).rejects.toThrow("__NOT_FOUND__");
    expect(notFoundMock).toHaveBeenCalledTimes(1);

    // And the miss happened BEFORE the cache: the signature gate 404s first, so
    // the count is still zero across BOTH renders.
    expect(
      vi.mocked(unstable_cache),
      "the anon miss must 404 before the cache, and the token render must not have changed that",
    ).toHaveBeenCalledTimes(0);
  });

  it("3. the token lane does not shift the PUBLIC lane's key shape — a published sibling still caches under its own id alone", async () => {
    givenPrivateStrategyWithLiveShare();

    // ── FIRST: the private token render, again uncleared.
    expect(findPayload(await renderTokenPage(validToken()))).not.toBeNull();
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);

    // ── THEN: a genuinely PUBLISHED sibling through the normal public lane.
    STATE.publishedRow = signatureRow(PUBLISHED_ID, "Phoenix Options");
    STATE.adminRows[PUBLISHED_ID] = adminStrategyRow(
      PUBLISHED_ID,
      "Phoenix Options",
      "published",
    );

    const jsx = await renderIdPage(PUBLISHED_ID);
    expect(findPayload(jsx)).not.toBeNull();

    expect(
      vi.mocked(unstable_cache),
      "the public lane caches exactly once",
    ).toHaveBeenCalledTimes(1);

    // keyParts is the SECOND argument of unstable_cache(cb, keyParts, opts).
    const keyParts = vi.mocked(unstable_cache).mock.calls[0][1] as string[];
    expect(keyParts).toEqual([EXPECTED_KEY_PREFIX, PUBLISHED_ID]);
    // ⛔ The private id must appear NOWHERE in the key — not as a part, not as
    // a suffix, not concatenated into one.
    expect(keyParts.join("|")).not.toContain(PRIVATE_ID);

    const tags = (
      vi.mocked(unstable_cache).mock.calls[0][2] as { tags: string[] }
    ).tags;
    expect(tags).toContain(`factsheet-v2:${PUBLISHED_ID}`);
    expect(tags.join("|")).not.toContain(PRIVATE_ID);
  });

  it("4. anti-vacuity: the harness CAN observe a cache invocation, and the token is genuinely authorising", async () => {
    // (a) The spy really does count — otherwise every "0 times" above is a
    //     statement about a broken harness, not about the token lane.
    STATE.publishedRow = signatureRow(PUBLISHED_ID, "Phoenix Options");
    STATE.adminRows[PUBLISHED_ID] = adminStrategyRow(
      PUBLISHED_ID,
      "Phoenix Options",
      "published",
    );
    await renderIdPage(PUBLISHED_ID);
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(1);

    // (b) The token lane really is gated — a WRONG token on the same fixtures
    //     takes the 410 path, so test 1's success is the token's doing and not
    //     a page that renders for anyone.
    vi.clearAllMocks();
    givenPrivateStrategyWithLiveShare();
    const wrongToken = deriveShareToken(PRIVATE_ID, NONCE, GENERATION + 1);
    await expect(renderTokenPage(wrongToken)).rejects.toThrow("__REDIRECT__");
    expect(redirectMock).toHaveBeenCalledWith("/factsheet-share/gone");
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
  });
});
