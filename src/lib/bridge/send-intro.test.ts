/**
 * H-0432 — direct unit test for the sendBridgeIntro helper.
 *
 * This helper is the single-source-of-truth for POST
 * /api/match/decisions/holding (docstring: any caller recording allocator
 * intent on a flagged holding MUST go through it). Its three callers
 * (ScenarioFlaggedHoldingsList, BridgeDrawer, SendIntroPanel) mock it
 * wholesale via `vi.mock('@/lib/bridge/send-intro')`, so the helper's own
 * five return shapes were previously unpinned. These tests exercise the
 * REAL implementation against a stubbed global.fetch:
 *   1. 2xx + match_decision_id:string  → { ok:true, matchDecisionId }
 *   2. non-2xx + JSON { error:string }  → { ok:false, error:<server msg> }
 *   3. non-2xx where res.json() throws  → fallback copy (the
 *      `.catch(() => ({}))` swallow path)
 *   4. 2xx but match_decision_id not a string → "Malformed response…"
 *   5. fetch throws (network error)     → "Network error. Please retry."
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendBridgeIntro } from "./send-intro";

const ARGS = {
  holdingRef: "holding:okx:BTC-USDT:spot",
  topCandidateStrategyId: "strat-top",
};

function installFetch(fetchMock: ReturnType<typeof vi.fn>): void {
  // Cast through `unknown` so the loose vi.fn() return type can satisfy
  // the strict global fetch signature.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    fetchMock as unknown as typeof globalThis.fetch,
  );
}

describe("sendBridgeIntro", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues a POST to /api/match/decisions/holding with the canonical body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match_decision_id: "md-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    await sendBridgeIntro(ARGS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/match/decisions/holding");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      holding_ref: ARGS.holdingRef,
      top_candidate_strategy_id: ARGS.topCandidateStrategyId,
    });
  });

  it("returns { ok:true, matchDecisionId } on a 2xx with a string id (happy path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match_decision_id: "md-42" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({ ok: true, matchDecisionId: "md-42" });
  });

  it("returns the server error string on a non-2xx with { error } body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "This holding is already matched." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "This holding is already matched.",
    });
  });

  it("falls back to the canned copy when a non-2xx body fails to parse (the .catch swallow)", async () => {
    // res.json() rejects — the `.catch(() => ({}))` must swallow it and the
    // helper must NOT throw, returning the generic unavailable message.
    const badBody = {
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("invalid json")),
    };
    const fetchMock = vi.fn().mockResolvedValue(badBody);
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "This comparison isn't available.",
    });
  });

  it("falls back to canned copy when a non-2xx body has no string error field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 123 }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "This comparison isn't available.",
    });
  });

  it("returns 'Malformed response' when a 2xx omits match_decision_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ something_else: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "Malformed response from intro endpoint",
    });
  });

  it("returns 'Malformed response' when match_decision_id is a number (not a string)", async () => {
    // typeof guard must reject a numeric id — a truthy-only guard would
    // wrongly accept it and stringify-by-coercion downstream.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match_decision_id: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "Malformed response from intro endpoint",
    });
  });

  it("returns the network-error copy when fetch itself throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    installFetch(fetchMock);

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({ ok: false, error: "Network error. Please retry." });
  });
});
