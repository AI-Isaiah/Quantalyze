import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
