import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MatchEvalDashboard } from "./MatchEvalDashboard";

/**
 * 140.3-11 / TS-18 + SEAMUX-04 — a 424 renders as the CALLER'S venue failing.
 *
 * WHY THIS FILE IS NEW. `MatchEvalDashboard` had no test file at all before
 * this plan; `140.3-08` READ it, recorded it as a rejected SEAMUX-05 candidate
 * (its `load()` already checks `res.ok` and it renders error-first), and
 * correctly did not add one. TS-18 is a different obligation: the question is
 * not whether the outcome is observed but WHICH outcome it is, and on that
 * question this component and `AllocatorMatchQueue` are the two members of one
 * class. Delivering the render at one of the two and reporting TS-18 closed is
 * the 5-of-7 signature this programme exists to end, and without this file that
 * half-delivery would have been invisible.
 *
 * `STATUS_CONTRACT.md` §1/§6 O-1: a 424 is CALLER'S EXCHANGE — recoverable,
 * never counting, and never OUR fault. Reported to an admin as our 500 it is
 * the theme-2 lie; reported without a retry it is the B-01/B-22 dead end.
 *
 * Every expected string is hand-typed. Nothing is imported from
 * `venueOutageCopy.ts` — a test that read the sentence out of the module that
 * declares it could not detect the sentence changing (C-1).
 */

const EVAL_URL_PREFIX = "/api/admin/match/eval";

/** The pre-424 answers, hand-typed so a change to either reddens here. */
const BREAKER_SENTENCE =
  "The analytics service is temporarily unavailable. Please try again in a moment.";
const GENERIC_500 = "Match evaluation failed. Please try again.";

/** Minimal EvalMetrics payload that satisfies the success render path. */
function buildMetrics() {
  return {
    window_days: 28,
    intros_shipped: 12,
    hits_top_3: 5,
    hits_top_10: 9,
    hit_rate_top_3: 0.42,
    hit_rate_top_10: 0.75,
    weekly: [],
    missed: [],
  };
}

/** The body shape `/api/admin/match/eval` forwards on a typed 4xx. */
function routeBody(error: string, dependency: string | null, status = 424) {
  return new Response(JSON.stringify({ error, dependency }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mountWith(response: () => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.startsWith(EVAL_URL_PREFIX)) {
      return response();
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MatchEvalDashboard />);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<MatchEvalDashboard> — TS-18: a 424 is the caller's venue, named", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a 424 naming a venue renders THAT venue and a retry control", async () => {
    mountWith(() =>
      Promise.resolve(routeBody("Binance is not responding.", "binance")),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
    // The venue the WIRE named, not one this component knows about.
    expect(document.body.textContent).toContain("Binance isn't responding");
    // A 424 is recoverable and non-counting, so a retry is honest here.
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("a SECOND venue renders too — no exchange is special-cased", async () => {
    mountWith(() =>
      Promise.resolve(routeBody("Bybit is not responding.", "bybit")),
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain("Bybit isn't responding");
    });
  });

  it("a 424 with a MISSING dependency degrades truthfully and renders no `undefined`", async () => {
    // The COMMON case: the flat `VenueTransientHTTPException` 424 that 140.3-06
    // put on the wire carries no `dependency` key at all.
    mountWith(() =>
      Promise.resolve(routeBody("A venue is not responding.", null)),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain("An exchange isn't responding");
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("null");
  });

  it("the 424 copy never says OUR service is degraded (SEAMUX-04)", async () => {
    mountWith(() =>
      Promise.resolve(routeBody("Binance is not responding.", "binance")),
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain("Binance isn't responding");
    });
    expect(document.body.textContent).not.toContain(BREAKER_SENTENCE);
    expect(document.body.textContent).not.toContain(GENERIC_500);
    expect(document.body.textContent).not.toMatch(
      /analytics service is (temporarily )?(unavailable|degraded|down)/i,
    );
  });

  it("ANTI-REGRESSION: a 500 still renders the route's own generic copy, unchanged", async () => {
    mountWith(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: GENERIC_500 }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(GENERIC_500)).toBeInTheDocument();
    });
    // The 424 arm did not swallow every failure into a venue state.
    expect(document.body.textContent).not.toContain("isn't responding");
  });

  it("ANTI-REGRESSION: a breaker 503 still renders the breaker sentence", async () => {
    mountWith(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: BREAKER_SENTENCE }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
    });
  });

  it("ANTI-REGRESSION: a 200 still renders the metrics, not an error", async () => {
    mountWith(() =>
      Promise.resolve(
        new Response(JSON.stringify(buildMetrics()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(/Intros shipped/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Retry/i }),
    ).not.toBeInTheDocument();
  });
});
