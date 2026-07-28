import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { AllocatorMatchQueue } from "./AllocatorMatchQueue";

/**
 * C-0126 (audit-2026-05-07) — public demo lane must never issue admin
 * mutations.
 *
 * `AllocatorMatchQueue` is the SAME component that backs both the
 * founder-facing `/admin/match/[allocator_id]` page and the public
 * `/demo/founder-view` page. The two surfaces are distinguished by two
 * props:
 *
 *   - `forceReadOnly: true` (demo) gates every action handler.
 *   - `sourceApiPath: "/api/demo/match"` (demo) swaps the GET source.
 *
 * The risk this test pins down: a regression that drops the
 * `forceReadOnly` gate from one of the keyboard shortcuts (s = Send
 * intro, u = thumbs up, d = thumbs down, r = recompute, ? = help)
 * would make the public demo issue authenticated admin POSTs to
 * `/api/admin/match/decisions`, `/api/admin/match/recompute`, or the
 * intro endpoints. Even though those endpoints reject unauthed callers,
 * an authed admin who opens `/demo/founder-view` in another tab would
 * silently mutate state from what they think is a sandbox.
 *
 * What we assert: with `forceReadOnly={true}` and
 * `sourceApiPath="/api/demo/match"`, simulating each of the documented
 * keyboard shortcuts (s/u/d/r/?) must NOT produce a fetch call to any
 * `/api/admin/match-decisions`, `/api/admin/match/recompute`, or
 * `/api/admin/intro/...` URL. The read-only GET to `/api/demo/match`
 * IS expected — that's how the queue loads.
 */

const ALLOCATOR_ID = "11111111-1111-4111-8111-111111111111";

// jsdom doesn't implement matchMedia. The component uses `useMediaQuery`
// to detect lg+ (>=1024px) viewports; we want lg+ so the keyboard
// shortcuts are active (otherwise they short-circuit on `!isLg` and the
// test would pass for the wrong reason — we want the gate to be
// `forceReadOnly`, not viewport-size).
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true, // pretend we're on lg+
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Minimal QueueData payload that satisfies the render path. */
function buildPayload() {
  return {
    profile: {
      id: "demo-allocator",
      display_name: "Demo Allocator",
      company: "Demo Capital",
      email: "demo@example.com",
      role: "allocator",
      allocator_status: "active",
      preferences_updated_at: null,
    },
    preferences: null,
    batch: {
      id: "batch-1",
      computed_at: new Date().toISOString(),
      mode: "personalized" as const,
      filter_relaxed: false,
      candidate_count: 1,
      excluded_count: 0,
      engine_version: "v1",
      weights_version: "v1",
      effective_preferences: {},
      effective_thresholds: {},
      source_strategy_count: 1,
      latency_ms: 50,
    },
    candidates: [
      {
        id: "cand-1",
        strategy_id: "strat-1",
        score: 0.81,
        score_breakdown: {},
        reasons: ["high sharpe"],
        rank: 1,
        exclusion_reason: null,
        exclusion_provenance: null,
        strategies: {
          id: "strat-1",
          name: "Alpha One",
          codename: "alpha",
          disclosure_tier: "named" as const,
          strategy_types: ["systematic"],
          supported_exchanges: ["binance"],
          aum: 1_000_000,
          max_capacity: 50_000_000,
          user_id: "user-1",
        },
        analytics: {
          sharpe: 1.5,
          sortino: 2.1,
          max_drawdown: -0.1,
          cagr: 0.18,
          volatility: 0.12,
          six_month_return: 0.09,
          cumulative_return: 0.35,
          total_aum: 1_000_000,
          sparkline_returns: [],
        },
      },
    ],
    excluded: [],
    decisions: [],
    existing_contact_requests: [],
  };
}

describe("<AllocatorMatchQueue> — C-0126 demo read-only", () => {
  it("never issues admin mutations when forceReadOnly + demo source path, even on s/u/d/r/?", async () => {
    const payload = buildPayload();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ID}
        forceReadOnly={true}
        sourceApiPath="/api/demo/match"
      />,
    );

    // Wait for the queue to finish loading (the loading state replaces
    // the keyboard-shortcut subtree with a skeleton, so the keydown
    // dispatch wouldn't reach the gated handlers otherwise).
    await waitFor(() => {
      expect(screen.getByText(/Demo Allocator/i)).toBeInTheDocument();
    });

    // At this point only the initial GET should have fired. Confirm it
    // was a read against the demo lane, not the admin lane — this also
    // doubles as the "read-only GET still allowed" assertion in the
    // finding.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [initialUrl] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(initialUrl).toBe(`/api/demo/match/${ALLOCATOR_ID}`);
    expect(initialUrl).not.toContain("/api/admin/");

    // Snapshot call count before pressing keys so we can detect ANY
    // new fetch that the shortcuts might have fired.
    const callsBeforeKeys = fetchMock.mock.calls.length;

    // Fire every shortcut documented in the finding. We dispatch on
    // window because useKeyboardShortcuts attaches its listener there;
    // the `?` overlay effect ALSO listens on window. Each is a clean
    // keydown with no modifiers (the hook bails on any modifier; `?`
    // is special-cased separately).
    //
    // NOTE: `?` is normally produced with Shift+/, but the component's
    // overlay effect checks `e.key === "?"` only, so we dispatch the
    // resolved character. We do NOT set shiftKey, because the shortcuts
    // hook also listens for keydown and bails on shiftKey — we want to
    // exercise both listeners with the same event.
    for (const key of ["s", "u", "d", "r", "?"]) {
      // The `?` overlay effect short-circuits unless the active element
      // is document.body — keep focus there.
      (document.body as HTMLElement).focus();
      fireEvent.keyDown(window, { key });
    }

    // Give any (mis-)fired handler a tick to enqueue its fetch.
    await Promise.resolve();
    await Promise.resolve();

    // The total call count must not have grown. If any shortcut leaked
    // through the forceReadOnly gate, it would have fired a POST here.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeKeys);

    // Belt-and-braces: scan every call URL and assert none touched the
    // admin mutation surface. This catches a future regression that
    // routes a mutation through a different URL pattern (e.g. someone
    // adds /api/admin/intro/send as the new "s" target).
    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      expect(url).not.toMatch(/\/api\/admin\/match[/-]decisions/);
      expect(url).not.toMatch(/\/api\/admin\/match\/recompute/);
      expect(url).not.toMatch(/\/api\/admin\/intro\//);
      // And more broadly — nothing on the admin lane at all from the
      // demo view.
      expect(url).not.toMatch(/^\/api\/admin\//);
    }
  });

  it("renders an empty, non-crashing queue when the demo seed is unprovisioned (profile: null)", async () => {
    // /api/demo/match degrades to a 200 empty payload (profile null) when the
    // seed demo allocator isn't provisioned in this environment. The component
    // must render the empty state — NOT crash dereferencing profile.display_name
    // (which it did before the null-guard, throwing on the public /demo page).
    const emptyPayload = {
      profile: null,
      preferences: null,
      batch: null,
      candidates: [],
      excluded: [],
      decisions: [],
      existing_contact_requests: [],
    };
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(emptyPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ID}
        forceReadOnly={true}
        sourceApiPath="/api/demo/match"
      />,
    );

    // The empty-state copy renders → the component got past the header without
    // dereferencing the null profile.
    expect(await screen.findByText(/No candidates yet/i)).toBeInTheDocument();
    // The read-only banner still shows on the public demo.
    expect(screen.getByText(/Read-only preview/i)).toBeInTheDocument();
  });

  it("still allows the read-only GET to /api/demo/match (queue loads)", async () => {
    const payload = buildPayload();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ID}
        forceReadOnly={true}
        sourceApiPath="/api/demo/match"
      />,
    );

    // Wait for the data to actually RENDER. The earlier version waited only
    // for `fetch` to have been CALLED — which resolves on mount, before the
    // response is awaited and applied — then synchronously asserted on the
    // rendered text. getByText has no retry, so under CI worker contention the
    // render lagged the assertion and the test flaked ("Unable to find element"
    // at the /Demo Allocator/ line). findByText retries until the render lands,
    // matching the first test's waitFor budget.
    expect(await screen.findByText(/Demo Allocator/i)).toBeInTheDocument();
    expect(screen.getByText(/Read-only preview/i)).toBeInTheDocument();

    // The render above proves the GET was honored; confirm it hit the demo
    // lane (the read-only banner did not suppress the data layer).
    expect(fetchMock).toHaveBeenCalledWith(`/api/demo/match/${ALLOCATOR_ID}`);
  });
});

/**
 * TABLE-01 / T-53-11 — AllocatorMatchQueue @container parent/child STRUCTURAL
 * guard (#551). All THREE raw `<table>`s (left rail, excluded list, decision
 * history) migrated onto `ResponsiveTable className="@container"` hosts with
 * `@max-*` priority-collapse on the CHILD cells. A class-string jsdom check
 * FALSE-PASSES the same-element regression, so this guard asserts the
 * RELATIONSHIP structurally: EVERY `@container` host must be a STRICT ANCESTOR
 * of every `@-`variant cell beneath it (never the same node), and numeric
 * columns keep `tabular-nums`.
 */
function buildRichPayload() {
  const base = buildPayload();
  return {
    ...base,
    excluded: [
      {
        id: "exc-1",
        strategy_id: "strat-x",
        score: 0.2,
        score_breakdown: {},
        reasons: [],
        rank: null,
        exclusion_reason: "AUM below floor",
        exclusion_provenance: "preference_fit < 0.3",
        strategies: {
          id: "strat-x",
          name: "Excluded One",
          codename: "exc",
          disclosure_tier: "named" as const,
          strategy_types: ["systematic"],
          supported_exchanges: ["binance"],
          aum: 100_000,
          max_capacity: 1_000_000,
          user_id: "user-x",
        },
        analytics: null,
      },
    ],
    decisions: [
      {
        id: "dec-1",
        strategy_id: "strat-1",
        decision: "thumbs_up",
        founder_note: "Strong track record, low correlation with the book.",
        contact_request_id: null,
        created_at: new Date().toISOString(),
        strategies: {
          id: "strat-1",
          name: "Alpha One",
          codename: "alpha",
          disclosure_tier: "named" as const,
        },
      },
    ],
  };
}

describe("<AllocatorMatchQueue> — @container parent/child structural guard", () => {
  function variantEls(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        '[class*="@max-"], [class*="@min-"], [class*="@2xl:"], [class*="@3xl:"]',
      ),
    );
  }

  it("EVERY @container host is a STRICT ANCESTOR of its @-variant cells (all three tables)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(buildRichPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { container } = render(
      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ID}
        forceReadOnly={true}
        sourceApiPath="/api/demo/match"
      />,
    );

    // Left rail renders once candidates load. displayStrategyName returns the
    // codename ("alpha"), which appears in both the shortlist card and the
    // left-rail row, so match all.
    await screen.findAllByText(/alpha/);

    // Open the excluded + history <details> so all three tables are in the DOM.
    fireEvent.click(screen.getByText(/Excluded strategies/));
    fireEvent.click(screen.getByText(/Decision history/));
    // Excluded row renders the AUM-below-floor reason cell.
    await screen.findByText(/AUM below floor/);

    const hosts = Array.from(
      container.querySelectorAll<HTMLElement>('[class*="@container"]'),
    );
    // Three migrated tables → three @container hosts.
    expect(hosts.length).toBe(3);

    for (const host of hosts) {
      // Same-element host is the #551 bug — host must carry NO @-variant.
      expect(host.className).not.toMatch(/@(max|min|2xl|3xl)/);
      // Each host has @-variant descendants and is a strict ancestor of each.
      const variants = variantEls(host);
      expect(variants.length).toBeGreaterThan(0);
      for (const el of variants) {
        expect(host.contains(el)).toBe(true);
        expect(host).not.toBe(el);
      }
    }
  });

  it("preserves tabular-nums on numeric columns across the reshape", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(buildRichPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { container } = render(
      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ID}
        forceReadOnly={true}
        sourceApiPath="/api/demo/match"
      />,
    );
    await screen.findAllByText(/alpha/);

    const tabular = container.querySelectorAll('[class*="tabular-nums"]');
    expect(tabular.length).toBeGreaterThan(0);
  });
});

/**
 * Phase 140.3 plan 08 / SEAMUX-05 (B-05 / B-17) — `handleRecompute` must observe
 * the HTTP outcome before it does anything with the body.
 *
 * The defect: `const body = await res.json();` with **no `res.ok` and no
 * `res.status`**. `/api/admin/match/recompute` answers a breaker trip with
 * `{ error: <the breaker sentence> }` and a 503; that body has no `disabled`
 * field, so it fell to the `else` branch and called `load()`. The queue
 * refetched, re-rendered the SAME batch it already had, and the founder read a
 * tripped breaker as a COMPLETED recompute — with the batch's own "Computed Nh
 * ago" stamp beside it as apparent corroboration.
 *
 * The fix shape was already in this file, twenty lines below the defect:
 * `handleDecision` does `if (!res.ok) throw new Error(await res.text());`.
 *
 * ⚠️ This is the SECOND member of the observe-the-outcome class (ledger row
 * M63). `ApiKeyManager` is the first. Mutating this one is the class test — a
 * green M63 would mean the class had been fixed at the instance.
 *
 * Also pinned here: the `r` shortcut's in-flight guard. `recomputing` is React
 * state, so two presses inside one frame both observe `false` and both POST —
 * duplicate recomputes against a service that is already struggling is exactly
 * the shape an outage produces.
 */
describe("<AllocatorMatchQueue> — SEAMUX-05: handleRecompute observes the outcome", () => {
  // Hand-typed, never imported: `src/lib/seam-copy.ts` holds the production
  // declaration and a test that read it could not detect it changing (C-1).
  const BREAKER_SENTENCE =
    "The analytics service is temporarily unavailable. Please try again in a moment.";

  const QUEUE_URL = `/api/admin/match/${ALLOCATOR_ID}`;
  const RECOMPUTE_URL = "/api/admin/match/recompute";

  function countCalls(mock: ReturnType<typeof vi.fn>, url: string) {
    return mock.mock.calls.filter((c) => c[0] === url).length;
  }

  /**
   * Mount the WRITE surface (not the demo lane) with the queue loaded, and route
   * the recompute POST to `recomputeResponse`.
   */
  async function mountLoaded(recomputeResponse: () => Promise<Response>) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === RECOMPUTE_URL) return recomputeResponse();
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />);
    // On the WRITE surface the name renders twice (breadcrumb + header h1), so
    // anchor on the heading rather than the ambiguous text.
    await screen.findByRole("heading", { name: /Demo Allocator/i });
    return fetchMock;
  }

  beforeEach(() => {
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a breaker 503 does NOT call load() and DOES render the error state (B-05/B-17)", async () => {
    const fetchMock = await mountLoaded(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: BREAKER_SENTENCE }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    // One GET so far: the mount load.
    expect(countCalls(fetchMock, QUEUE_URL)).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    // The failure surfaces on the component's own error-first card …
    await waitFor(() => {
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
    });
    // … and the queue it invalidates nothing about is NOT refetched. A refetch
    // is what made a trip read as a completed recompute.
    expect(countCalls(fetchMock, QUEUE_URL)).toBe(1);
    // The error card replaces the queue (`if (error || !data) return`), so the
    // founder cannot mistake the pre-existing batch for a fresh one.
    expect(
      screen.queryByRole("heading", { name: /Demo Allocator/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("a 500 with no JSON body still reaches the error state, not load()", async () => {
    // A gateway HTML page: `res.json()` on it throws. Before the fix that
    // SyntaxError was the caught value and `alert`ed as "Recompute failed:
    // Unexpected token" — a parse error standing in for the real failure.
    const fetchMock = await mountLoaded(() =>
      Promise.resolve(
        new Response("<html>502</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
    expect(countCalls(fetchMock, QUEUE_URL)).toBe(1);
    // No parse-error text reached the DOM in place of the failure.
    expect(document.body.textContent).not.toMatch(/SyntaxError|Unexpected token/);
  });

  it("ANTI-REGRESSION: a 200 with disabled:true still renders the disabled path", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    const fetchMock = await mountLoaded(() =>
      Promise.resolve(
        new Response(JSON.stringify({ disabled: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining("Engine is disabled"),
      );
    });
    // The disabled reply is a SUCCESS, not a failure — no refetch, no error card.
    expect(countCalls(fetchMock, QUEUE_URL)).toBe(1);
    expect(
      screen.getByRole("heading", { name: /Demo Allocator/i }),
    ).toBeInTheDocument();
  });

  it("ANTI-REGRESSION: a plain 200 still calls load()", async () => {
    const fetchMock = await mountLoaded(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(countCalls(fetchMock, QUEUE_URL)).toBe(2);
    });
    expect(
      screen.getByRole("heading", { name: /Demo Allocator/i }),
    ).toBeInTheDocument();
  });

  it("the `r` shortcut pressed twice in flight issues ONE request", async () => {
    // A recompute that never settles, so both presses land inside the in-flight
    // window. `recomputing` is state and does not update between two synchronous
    // keydowns — only a synchronously-written ref can hold here.
    const fetchMock = await mountLoaded(() => new Promise<Response>(() => {}));

    (document.body as HTMLElement).focus();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "r" });

    await Promise.resolve();
    await Promise.resolve();

    expect(countCalls(fetchMock, RECOMPUTE_URL)).toBe(1);
  });
});

/**
 * 140.3-11 / TS-18 + SEAMUX-04 — a 424 renders as the CALLER'S venue failing.
 *
 * `STATUS_CONTRACT.md` §1/§6 O-1: a 424 is CALLER'S EXCHANGE — the third party
 * the caller named is at fault, it is recoverable, and it never counts against
 * our own health. Reported to an admin as OUR failure it is the theme-2 lie
 * (copy that asserts something false); reported as an un-retryable dead end it
 * is the B-01/B-22 shape O-1 exists to forbid.
 *
 * A SEPARATE describe from the SEAMUX-05 block above, with its own mount
 * helper, on purpose. That block asserts the OUTCOME IS OBSERVED; this one
 * asserts WHICH outcome it is. Sharing a helper across two obligations is how a
 * green run stops telling you which one it was green for.
 *
 * Every expected string is hand-typed. Nothing is imported from
 * `venueOutageCopy.ts` — a test that read the sentence out of the module that
 * declares it could not detect the sentence changing (C-1).
 */
describe("<AllocatorMatchQueue> — TS-18: a 424 is the caller's venue, named", () => {
  const QUEUE_URL = `/api/admin/match/${ALLOCATOR_ID}`;
  const RECOMPUTE_URL = "/api/admin/match/recompute";

  /** The pre-424 answers, hand-typed so a change to either reddens here. */
  const BREAKER_SENTENCE =
    "The analytics service is temporarily unavailable. Please try again in a moment.";
  const GENERIC_500 = "Match recompute failed. Please try again.";

  async function mountLoaded(recomputeResponse: () => Promise<Response>) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === RECOMPUTE_URL) return recomputeResponse();
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />);
    await screen.findByRole("heading", { name: /Demo Allocator/i });
    return fetchMock;
  }

  /** The body shape `/api/admin/match/recompute` forwards on a typed 4xx. */
  function routeBody(error: string, dependency: string | null) {
    return new Response(JSON.stringify({ error, dependency }), {
      status: 424,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 424 naming a venue renders THAT venue and a retry control", async () => {
    const fetchMock = await mountLoaded(() =>
      Promise.resolve(routeBody("Binance is not responding.", "binance")),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
    // The venue the WIRE named, not one this component knows about.
    expect(document.body.textContent).toContain("Binance isn't responding");
    // A 424 is recoverable and non-counting, so a retry is honest here.
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    // The stale queue is gone — the error-first guard still holds.
    expect(countCalls(fetchMock, QUEUE_URL)).toBe(1);
  });

  it("a SECOND venue renders too — no exchange is special-cased", async () => {
    // A component that recognised one venue and not another would render a real
    // outage as no outage for every exchange its author did not think of.
    await mountLoaded(() =>
      Promise.resolve(routeBody("Bybit is not responding.", "bybit")),
    );
    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("Bybit isn't responding");
    });
  });

  it("a 424 with a MISSING dependency degrades truthfully and renders no `undefined`", async () => {
    // This is the COMMON case, not the corner: the flat
    // `VenueTransientHTTPException` 424 that 140.3-06 put on the wire carries no
    // `dependency` key at all.
    await mountLoaded(() =>
      Promise.resolve(routeBody("A venue is not responding.", null)),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain("An exchange isn't responding");
    // The literal, which is what an interpolated absent value renders as.
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("null");
  });

  it("the 424 copy never says OUR service is degraded (SEAMUX-04)", async () => {
    await mountLoaded(() =>
      Promise.resolve(routeBody("Binance is not responding.", "binance")),
    );
    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("Binance isn't responding");
    });
    // The two sentences this surface answers with when the fault IS ours.
    expect(document.body.textContent).not.toContain(BREAKER_SENTENCE);
    expect(document.body.textContent).not.toContain(GENERIC_500);
    expect(document.body.textContent).not.toMatch(
      /analytics service is (temporarily )?(unavailable|degraded|down)/i,
    );
  });

  it("ANTI-REGRESSION: a 500 still renders the route's own generic copy, unchanged", async () => {
    await mountLoaded(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: GENERIC_500 }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));

    await waitFor(() => {
      expect(screen.getByText(GENERIC_500)).toBeInTheDocument();
    });
    // The 424 arm did not swallow every failure into a venue state.
    expect(document.body.textContent).not.toContain("isn't responding");
  });

  it("ANTI-REGRESSION: a breaker 503 still renders the breaker sentence", async () => {
    await mountLoaded(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: BREAKER_SENTENCE }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Recompute now/i }));
    await waitFor(() => {
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
    });
  });

  function countCalls(mock: ReturnType<typeof vi.fn>, url: string) {
    return mock.mock.calls.filter((c) => c[0] === url).length;
  }
});

/**
 * [140.4-05 / SEAMRIM-10] The load failure is ANNOUNCED, not only drawn.
 *
 * This surface is the SECOND member of the converted class (the first is
 * `PortfolioOptimizer`), and it is the member the Falsifiability Ledger row
 * M96 mutates — mutating the second member is what distinguishes a class fix
 * from an instance fix.
 *
 * Why the announcement is the only channel here: the queue's primary action is
 * bound to the `r` keyboard shortcut, and this surface regressed from a modal
 * `alert()` (which assistive tech always announces) to a silent inline card.
 * The error branch is an early `return` — the loaded tree never mounts — so
 * there is no focus event either.
 */
describe("<AllocatorMatchQueue> — [140.4-05] the load failure is announced", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** The message the route hands back, hand-typed so a copy change reddens here. */
  const ROUTE_MESSAGE = "Match queue is unavailable.";

  it("ANNOUNCES the load failure through role=alert, carrying the card's own message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: ROUTE_MESSAGE }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ROUTE_MESSAGE);

    // The visible card is unchanged — the announcement is purely additive.
    expect(screen.getByText(ROUTE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("ANNOUNCES the static fallback when the route sends no message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not json", { status: 500 }),
    );

    render(<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />);

    // `error || "Failed to load"` — the announcement carries whichever of the
    // two the card is showing, never a third string invented for the region.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load match queue");
  });

  it("NEGATIVE CONTROL: the loaded queue exposes NO role=alert", async () => {
    // Without this the assertions above are satisfied by a component that
    // announces unconditionally, which would fire on every successful load.
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(buildPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />);

    // `findByRole("heading", …)` not `findByText` — the allocator name appears
    // in BOTH the breadcrumb span and the h1, so a bare text query is ambiguous.
    expect(
      await screen.findByRole("heading", { name: /Demo Allocator/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
