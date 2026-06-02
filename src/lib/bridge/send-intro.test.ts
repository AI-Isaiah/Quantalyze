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
    // H-0435: helper emits a diagnostic console.error here; silence it so
    // this test's intent (the fallback copy) is the only signal in the output.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);
    // Red-team F1: HTTP status is NEVER in the user-facing copy. The
    // diagnostic status is on console.error (asserted in the H-0435 logs test
    // further below).
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
    // Red-team F1: helper now logs an HTTP error diagnostic for non-string
    // error bodies; silence the noise.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({
      ok: false,
      error: "This comparison isn't available.",
    });
  });

  // Red-team F1: pin the contract that the HTTP status NEVER leaks into the
  // user-facing toast, but DOES land on console.error for ops. A regression
  // that puts `(HTTP ${res.status})` back in the toast copy must fail here.
  it("logs HTTP status on console.error and keeps the toast clean (F1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 123 }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);

    // User-facing copy: NO digits, NO "HTTP", NO parens.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("This comparison isn't available.");
    expect(result.error).not.toMatch(/HTTP|\d/);
    // Diagnostic payload: status IS on console.error.
    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] HTTP error:",
      expect.objectContaining({ status: 503 }),
    );
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
    // H-0435: silence the diagnostic console.error — the dedicated test below
    // asserts on the log payload; this one just pins the return shape.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);
    expect(result).toEqual({ ok: false, error: "Network error. Please retry." });
  });

  // H-0435: pin the diagnostic-signal contract so a regression that drops the
  // console.error (or reverts to a bare `catch {}`) is caught here. A real
  // connectivity regression in production must produce a log line — without
  // it the helper is the diagnostic dead-end the original audit flagged.
  it("logs the underlying error when fetch throws (H-0435 diagnostic signal)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendBridgeIntro(ARGS);

    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] failed:",
      expect.objectContaining({ message: "ECONNREFUSED" }),
    );
  });

  it("logs HTTP status when a non-2xx body fails to parse (H-0435)", async () => {
    const badBody = {
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("invalid json")),
    };
    const fetchMock = vi.fn().mockResolvedValue(badBody);
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);

    // Red-team F1: user-facing copy is clean; HTTP status is diagnostic-only.
    expect(result).toEqual({
      ok: false,
      error: "This comparison isn't available.",
    });
    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] non-OK body parse failed (HTTP 502):",
      expect.objectContaining({ message: "invalid json" }),
    );
    // F1: the HTTP-error diagnostic also fires (with the parsed empty body).
    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] HTTP error:",
      expect.objectContaining({ status: 502 }),
    );
  });

  // H-0435 G3 (pr-test-analyzer): TypeError("Failed to fetch") path — the
  // canonical browser fingerprint for CORS / offline / DNS failures. Must
  // produce the network-error copy AND log the underlying TypeError so an
  // ops dashboard can distinguish a connectivity regression from a backend
  // 5xx. A bare `catch {}` regression would silently lose this signal.
  it("returns network-error copy and logs when fetch throws TypeError (CORS/offline) — G3", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);

    expect(result).toEqual({
      ok: false,
      error: "Network error. Please retry.",
    });
    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] failed:",
      expect.objectContaining({
        name: "TypeError",
        message: "Failed to fetch",
      }),
    );
  });

  // H-0435 G3 (pr-test-analyzer): malformed 2xx body — `res.ok === true` but
  // `res.json()` rejects (HTML masquerading as JSON from a CDN, truncated
  // stream). Previously this propagated as an unhandled rejection to the
  // submit handler. The helper must catch it, log, and return the network
  // copy so the UI sees a structured failure instead of a crash.
  it("returns network-error copy and logs when a 2xx body fails to parse — G3", async () => {
    const goodBody = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Unexpected token < in JSON")),
    };
    const fetchMock = vi.fn().mockResolvedValue(goodBody);
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);

    expect(result).toEqual({
      ok: false,
      error: "Network error. Please retry.",
    });
    expect(errSpy).toHaveBeenCalledWith(
      "[sendBridgeIntro] 2xx body parse failed:",
      expect.objectContaining({ message: "Unexpected token < in JSON" }),
    );
  });

  // F9 H-0084: the optional abort signal must reach fetch so the caller
  // (BridgeDrawer) can cancel an in-flight send when the drawer is dismissed.
  it("forwards the abort signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match_decision_id: "md-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installFetch(fetchMock);
    const controller = new AbortController();

    await sendBridgeIntro({ ...ARGS, signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  // F9 H-0084: a deliberate abort is NOT a failure — return a quiet
  // { aborted: true } result and do NOT log it as a connectivity error (a real
  // network failure still logs, pinned by the tests above).
  it("returns a quiet aborted result (no console.error) when the signal aborts", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    installFetch(fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendBridgeIntro(ARGS);

    expect(result).toEqual({
      ok: false,
      error: "Cancelled.",
      aborted: true,
    });
    expect(errSpy).not.toHaveBeenCalled();
  });
});
