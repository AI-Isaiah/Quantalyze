/** @vitest-environment jsdom */
/**
 * Phase 148 / OWN-02 — PAGE-LEVEL behaviour proofs for the two-lane factsheet
 * render surface (`/factsheet/[id]/v2`).
 *
 * The phase's reason to exist: an owner must be able to read their OWN
 * unpublished factsheet, and doing so must NOT populate the shared,
 * id-keyed `unstable_cache` entry that anonymous visitors read for the next
 * 3600s. Lane A (published) reads through the cached wrapper; Lane B (owner)
 * calls the builder DIRECTLY with an owner-inclusive predicate — no cache
 * read, no cache write.
 *
 * Three properties are pinned here, each with a literal oracle typed into
 * THIS file (never imported from the page or from `@/lib/visibility`):
 *
 *   SC1  — the owner renders a REAL payload (not the still-computing
 *          placeholder) and `FactsheetView` receives
 *          `viewerNotice="owner_unpublished"`.
 *   SC2-A— `unstable_cache` is invoked ZERO times on an owner render and
 *          exactly ONCE on a public render; an owner pass followed by an anon
 *          request for the same id still 404s. Includes the null-is-cached
 *          trap: a draft whose build returns `null` must not offer that null
 *          to the shared cache either.
 *   SC4  — anon, non-owner-authed and genuinely-missing all collapse to the
 *          SAME `notFound()`; the owner predicate is SESSION-keyed
 *          (`auth.getUser()`), never param-keyed.
 *
 * Plus a lane-ORDER lock: a published id rendered WITH an authed session must
 * record ZERO `auth.getUser()` calls and ZERO `.or` filters. That test is
 * green both before and after Lane B exists — it is here to catch the
 * "hoist auth.getUser() above the published probe" repair, which would put a
 * session probe on every public request.
 *
 * ⛔ Two harness properties are load-bearing and must not be "simplified":
 *   1. `unstable_cache` is a SPY — `vi.fn((fn) => fn)` — not a bare identity
 *      stub. Identity behaviour is preserved; the INVOCATION COUNT is the
 *      whole of SC2-A's teeth. A bare `(fn) => fn` stub makes tests 4/5/6
 *      vacuous (they would pass against a page that caches the owner lane).
 *   2. `@/lib/visibility` is loaded via `vi.importActual` + spread, so the
 *      REAL `withPublishedOnly` / `withPublishedOrOwner` run against a
 *      RECORDING query-builder stub. A passthrough mock would make the
 *      predicate-literal assertion (test 9) unfalsifiable.
 *
 * Neuter check: point Lane B's payload arm at `buildFactsheetPayloadCached`
 * (i.e. cache the owner render) → the `unstable_cache` call-count-0
 * assertions of tests 4/5/6 redden. RUN 2026-08-05, observed:
 *
 *   Tests  3 failed | 7 passed (10)
 *   4. AssertionError: an owner render must never reach the shared, id-keyed
 *      cache: expected "vi.fn()" to be called +0 times, but got 1 times
 *   6. AssertionError: a null must never be offered to the shared cache from
 *      the owner lane: expected "vi.fn()" to be called +0 times, but got 1 times
 *
 * Two sibling mutations were run the same way (full evidence in
 * `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md`):
 * swapping the Lane B predicate to `withPublishedOnly` reddens tests 1 & 9, and
 * param-keying the probe (`user.id` → the route `id`) reddens tests 8 & 9.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
// ⛔ CHANGE 1 vs the smoothed-wiring harness: a SPY, not a bare identity stub.
// Behaviour is identical (`(fn) => fn`), but the call count is now observable,
// which is what makes "the owner lane never touches the shared cache" a
// falsifiable claim rather than a comment.
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));
// ⛔ CHANGE 2 vs the smoothed-wiring harness: the REAL predicates run. The
// builder stubs below record what they append, so the assertions are made
// against the actual SQL-shaping helpers rather than against a passthrough.
vi.mock("@/lib/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visibility")>(
    "@/lib/visibility",
  );
  return { ...actual };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "44444444-4444-4444-8444-444444444444";
/** The session user id. LITERAL — the predicate assertion in test 9 is built
 *  from this same literal typed by hand, never from the page or the helper. */
const OWNER_UID = "11111111-1111-4111-8111-111111111111";
const OTHER_UID = "22222222-2222-4222-8222-222222222222";

/** The Lane A select list, typed as a LITERAL. Lane B must select a SUPERSET
 *  of these columns or the payload-pending fallback (which reads
 *  `signature.name / codename / disclosure_tier`) breaks on the owner lane.
 *  Lane B additionally selects `status` — the lane/banner decision is derived
 *  from the ROW's status, never from which probe matched (review WR-01), so
 *  equality between the two lists is deliberately NOT pinned anymore. */
const SIGNATURE_SELECT =
  "id, name, codename, disclosure_tier, strategy_analytics ( computed_at )";

/** The owner-inclusive predicate string, typed as a LITERAL. A param-keyed
 *  predicate (`user_id.eq.<route id>`) cannot produce this string. */
const EXPECTED_OWNER_OR_FILTER =
  "status.eq.published,user_id.eq.11111111-1111-4111-8111-111111111111";

/** Banner heading copy — typed HERE, never imported from FactsheetView.tsx
 *  (oracle independence, same rule as FactsheetView.owner-notice.test.tsx). */
const BANNER_HEADING = "Unpublished — only you can see this";

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

/** Signature-probe row shape. Lane A rows carry no `status` (its select does
 *  not name the column); Lane B rows spread `status` on top of this — the
 *  column its select adds so the page can gate the lane on row status. */
function signatureRow(name: string) {
  return {
    id: STRATEGY_ID,
    name,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_analytics: { computed_at: "2026-07-01T00:00:00.000Z" },
  };
}

/** Admin-side full strategy row consumed by fetchAndBuildPayload. */
function adminStrategyRow(status: "published" | "draft") {
  return {
    id: STRATEGY_ID,
    name: status === "draft" ? "Draft Alpha" : "Phoenix Options",
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

// --- Switchable request/admin state -----------------------------------------

const STATE = {
  /** `auth.getUser()` resolution — null models anon. */
  sessionUser: null as { id: string } | null,
  /** Lane A result: the row the published-only probe resolves. */
  publishedRow: null as unknown,
  /** Lane B result: the row the owner-inclusive probe resolves. */
  ownerRow: null as unknown,
  /** When set, the Lane B probe resolves `{data:null,error}` (fail-loud arm). */
  probeError: null as { code: string; message: string } | null,
  /** Admin-side strategy row; `null` models a build that yields no payload. */
  adminRow: null as unknown,
  observed: {
    /** `.or(filter)` strings appended on the REQUEST-scoped client (the probe). */
    requestOrFilters: [] as string[],
    /** `.or(filter)` strings appended on the ADMIN client (the injected predicate). */
    adminOrFilters: [] as string[],
    /** `.eq("status", ...)` values appended on the request client. */
    requestStatusEqs: [] as string[],
    /** SELECT column lists seen on the request client, in call order. */
    requestSelects: [] as string[],
  },
};

const getUserSpy = vi.fn();

/**
 * Request-client stub. Each `.from()` call yields a FRESH builder so Lane A and
 * Lane B cannot clobber each other's state. The builder dispatches on whether
 * `.or()` was appended: the owner-inclusive predicate produces the Lane B
 * result, the published-only predicate the Lane A result.
 */
function mockRequestClient() {
  return {
    auth: { getUser: getUserSpy },
    from: () => {
      let sawOr = false;
      const chain = {
        select: (cols: string) => {
          STATE.observed.requestSelects.push(cols);
          return chain;
        },
        eq: (col: string, val: string) => {
          if (col === "status") STATE.observed.requestStatusEqs.push(val);
          return chain;
        },
        or: (filter: string) => {
          sawOr = true;
          STATE.observed.requestOrFilters.push(filter);
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(
            sawOr
              ? { data: STATE.ownerRow, error: STATE.probeError }
              : { data: STATE.publishedRow, error: null },
          ),
      };
      return chain;
    },
  };
}

/**
 * Admin-client stub, cloned from `page.smoothed-wiring.test.tsx:123-151` with
 * ONE mandatory addition: an `or()` method. The REAL `withPublishedOrOwner`
 * (running via `importActual`) appends `.or(...)` to the Lane B builder chain;
 * without this method Lane B throws "chain.or is not a function" and every
 * owner test fails for the wrong reason.
 */
function mockAdmin(): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: (filter: string) => {
        STATE.observed.adminOrFilters.push(filter);
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          table === "strategies"
            ? { data: STATE.adminRow, error: null }
            : { data: null, error: null },
        ),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

// --- Tree helpers -----------------------------------------------------------

/** Depth-first search of an RSC element tree for the FactsheetView payload prop. */
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

/**
 * Sibling of `findPayload` returning the WHOLE props object of the element
 * carrying the payload (i.e. `FactsheetView`), so lane-derived render props
 * such as `viewerNotice` are assertable. `findPayload` is left unmutated —
 * it is copied verbatim from the smoothed-wiring harness.
 */
function findViewProps(node: unknown): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findViewProps(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props as Record<string, unknown>;
  return findViewProps(el.props?.children ?? null);
}

const renderPage = () =>
  FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });

// --- Scenario helpers (STATE presets) ---------------------------------------

/** Published id: Lane A hits. */
function givenPublished() {
  STATE.publishedRow = signatureRow("Phoenix Options");
  STATE.adminRow = adminStrategyRow("published");
}

/** Unpublished id owned by the session user: Lane A misses, Lane B hits.
 *  The Lane B row carries `status: "draft"` — the column the owner probe's
 *  select adds so the page can gate the lane on row status (WR-01). */
function givenOwnerDraft() {
  STATE.publishedRow = null;
  STATE.ownerRow = { ...signatureRow("Draft Alpha"), status: "draft" };
  STATE.adminRow = adminStrategyRow("draft");
  STATE.sessionUser = { id: OWNER_UID };
}

beforeEach(() => {
  vi.clearAllMocks();
  STATE.sessionUser = null;
  STATE.publishedRow = null;
  STATE.ownerRow = null;
  STATE.probeError = null;
  STATE.adminRow = null;
  STATE.observed.requestOrFilters = [];
  STATE.observed.adminOrFilters = [];
  STATE.observed.requestStatusEqs = [];
  STATE.observed.requestSelects = [];

  getUserSpy.mockImplementation(async () => ({
    data: { user: STATE.sessionUser },
    error: null,
  }));
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(createAdminClient).mockImplementation(() => mockAdmin() as never);
  // Empty map = no PUBLISHED verification signal, which is the truth for a
  // draft (get_published_trust_signals is published-gated at the DB level).
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map() as never,
  );
});

// ---------------------------------------------------------------------------

describe("SC1 — the owner renders their own unpublished factsheet", () => {
  it("1. owner + unpublished id → real payload and viewerNotice='owner_unpublished'", async () => {
    givenOwnerDraft();

    const jsx = await renderPage();

    const payload = findPayload(jsx);
    expect(payload, "owner must receive a REAL payload, not the placeholder").not.toBeNull();
    expect(payload!.strategyName).toBe("Draft Alpha");
    expect(findViewProps(jsx)?.viewerNotice).toBe("owner_unpublished");
  });

  it("2. published id (Lane A) → payload present, viewerNotice undefined", async () => {
    givenPublished();

    const jsx = await renderPage();

    expect(findPayload(jsx)).not.toBeNull();
    expect(findViewProps(jsx)?.viewerNotice).toBeUndefined();
  });

  it("3. owner lane trust tier is never fabricated — no published signal → null tier", async () => {
    givenOwnerDraft();
    vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);

    const jsx = await renderPage();

    const payload = findPayload(jsx);
    expect(payload).not.toBeNull();
    expect(payload!.trustTier).toBeNull();
  });
});

describe("SC2-A — the owner lane never touches the shared cache", () => {
  it("4. owner render invokes unstable_cache 0 times; a public render invokes it exactly 1 time", async () => {
    givenOwnerDraft();

    await renderPage();
    expect(
      vi.mocked(unstable_cache),
      "an owner render must never reach the shared, id-keyed cache",
    ).toHaveBeenCalledTimes(0);

    // Same spy, no clear: the public lane's single invocation is the only one.
    STATE.publishedRow = signatureRow("Phoenix Options");
    STATE.adminRow = adminStrategyRow("published");
    STATE.sessionUser = null;

    await renderPage();
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(1);
  });

  it("5. owner renders a draft, then an anon request for the SAME id still 404s (cache never populated)", async () => {
    givenOwnerDraft();

    const jsx = await renderPage();
    expect(findPayload(jsx), "owner pass must succeed").not.toBeNull();
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);

    // Anon, same id: published probe still misses, no session → notFound.
    STATE.sessionUser = null;
    STATE.publishedRow = null;
    STATE.ownerRow = null;

    await expect(renderPage()).rejects.toThrow(/notFound/);
    expect(
      vi.mocked(unstable_cache),
      "no owner-populated entry can exist for anon to read",
    ).toHaveBeenCalledTimes(0);
  });

  it("6. draft whose build returns null → placeholder arm, and STILL 0 cache invocations (null-is-cached trap)", async () => {
    givenOwnerDraft();
    STATE.adminRow = null; // admin build yields no payload

    const jsx = await renderPage();

    expect(findPayload(jsx), "payload-pending placeholder carries no payload").toBeNull();
    expect(
      vi.mocked(unstable_cache),
      "a null must never be offered to the shared cache from the owner lane",
    ).toHaveBeenCalledTimes(0);

    // WR-02 regression — the OWNER-lane placeholder must carry the visibility
    // notice. The still-computing draft shows its real name and reads like a
    // soon-to-be-live factsheet; the pending state is when an owner is MOST
    // likely to share the URL "for when it's ready", so the disclosure must
    // be present here too, not only on the full render.
    const ownerPlaceholder = render(jsx as ReactElement);
    const note = ownerPlaceholder.container.querySelector('[role="note"]');
    expect(note, "owner placeholder must carry the visibility notice").not.toBeNull();
    expect(note!.textContent).toContain(BANNER_HEADING);

    // …and the PUBLIC-lane placeholder must NOT: a published strategy whose
    // build returns null renders the same placeholder with zero banner nodes.
    STATE.sessionUser = null;
    STATE.publishedRow = signatureRow("Phoenix Options");
    STATE.ownerRow = null;
    STATE.adminRow = null;
    const publicJsx = await renderPage();
    expect(findPayload(publicJsx), "public placeholder carries no payload").toBeNull();
    const publicPlaceholder = render(publicJsx as ReactElement);
    expect(
      publicPlaceholder.container.querySelector('[role="note"]'),
      "public-lane placeholder must carry ZERO banner nodes",
    ).toBeNull();
    expect(publicPlaceholder.container.textContent).not.toContain(BANNER_HEADING);
  });
});

describe("SC4 — uniform notFound, session-keyed owner predicate", () => {
  it("7. anon + unpublished id → notFound with NO owner probe issued", async () => {
    STATE.publishedRow = null;
    STATE.sessionUser = null;

    await expect(renderPage()).rejects.toThrow(/notFound/);
    expect(
      STATE.observed.requestOrFilters,
      "anon must not pay an owner probe",
    ).toEqual([]);
  });

  it("8. non-owner authed + unpublished id → the owner probe RUNS, finds no row, and 404s identically", async () => {
    STATE.publishedRow = null;
    STATE.ownerRow = null; // the published-OR-owner probe matches nothing
    STATE.sessionUser = { id: OTHER_UID };

    await expect(renderPage()).rejects.toThrow(/notFound/);
    expect(
      STATE.observed.requestOrFilters,
      "a non-owner session must be REJECTED BY the probe, not short-circuited before it",
    ).toHaveLength(1);
    expect(STATE.observed.requestOrFilters[0]).toBe(
      "status.eq.published,user_id.eq.22222222-2222-4222-8222-222222222222",
    );
  });

  it("9. the owner predicate is session-keyed: the recorded .or filter names the SESSION uuid", async () => {
    givenOwnerDraft();

    await renderPage();

    expect(STATE.observed.requestOrFilters[0]).toBe(EXPECTED_OWNER_OR_FILTER);
    // The route param is the strategy id, not the user id — a param-keyed
    // predicate could not produce the string above.
    expect(STATE.observed.requestOrFilters[0]).not.toContain(STRATEGY_ID);
    // Lane B must select a SUPERSET of Lane A's columns, or the
    // payload-pending fallback breaks on the owner lane only. NOT equality:
    // Lane B additionally selects `status`, the column the WR-01 lane gate
    // reads (a probe-derived lane cannot distinguish "matched because
    // published" from "matched because owner").
    expect(STATE.observed.requestSelects).toHaveLength(2);
    expect(STATE.observed.requestSelects[0]).toBe(SIGNATURE_SELECT);
    const laneBSelect = STATE.observed.requestSelects[1];
    for (const col of SIGNATURE_SELECT.split(", ")) {
      expect(
        laneBSelect,
        `Lane B select must carry Lane A column "${col}" (payload-pending fallback reads it)`,
      ).toContain(col);
    }
    expect(
      laneBSelect,
      "Lane B select must carry `status` — the WR-01 lane gate reads it",
    ).toContain("status");
  });
});

describe("WR-01 regression — a PUBLISHED row reached via Lane B renders WITHOUT the owner banner", () => {
  it("11. authed viewer + published row via Lane B (Lane A miss: transient error / publish race) → cached public lane, viewerNotice undefined", async () => {
    // Lane A misses (models the publish race / a transient published-probe
    // miss), the viewer is authed, and the owner-inclusive probe matches the
    // row via its `status.eq.published` arm — which it does for ANY authed
    // viewer, owner or not. The row's status says "published", so the page
    // must NOT claim "Unpublished — only you can see this … anyone else sees
    // a 404" on a public document, and must serve it through the shared
    // cached lane like any other published render.
    STATE.publishedRow = null;
    STATE.ownerRow = { ...signatureRow("Phoenix Options"), status: "published" };
    STATE.adminRow = adminStrategyRow("published");
    STATE.sessionUser = { id: OTHER_UID }; // a random authed NON-owner

    const jsx = await renderPage();

    expect(findPayload(jsx), "published row must still render").not.toBeNull();
    expect(
      findViewProps(jsx)?.viewerNotice,
      "a published row must never carry the owner_unpublished notice",
    ).toBeUndefined();
    // lane stays "public" → the payload is served via the shared cached lane.
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(1);
  });
});

describe("lane order lock — published/cached lane FIRST", () => {
  it("10. published id rendered WITH an authed session → ZERO auth.getUser calls, ZERO .or filters", async () => {
    givenPublished();
    STATE.sessionUser = { id: OWNER_UID }; // authed viewer on a PUBLIC page

    const jsx = await renderPage();
    expect(findPayload(jsx)).not.toBeNull();

    expect(
      getUserSpy,
      "a public authed view must not pay a session probe (lane order: published FIRST)",
    ).toHaveBeenCalledTimes(0);
    expect(STATE.observed.requestOrFilters).toEqual([]);
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(1);
  });
});
