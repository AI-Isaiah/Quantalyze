import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getWizardCorrelationId,
  wizardFetch,
  _resetWizardCorrelationIdForTests,
} from "./wizard-correlation";

/**
 * UX-02 (#30) → 164.6.5-07 / D-14 — client-safe wizard correlation ids.
 *
 * Two ids ride every wizard request:
 *   - `X-Correlation-Id`: a FRESH id minted PER REQUEST (or the caller's own
 *     supplied value, if any) — this is what makes two failed attempts
 *     distinguishable in support, MEASURED identical across attempts hours
 *     apart before this change.
 *   - `X-Wizard-Page-Load-Id`: the STABLE per-page-load id
 *     (`getWizardCorrelationId()`), unchanged in meaning and behaviour, so
 *     existing funnel telemetry keeps joining on it (D-14, KEEP-ALONGSIDE).
 */

// The server allowlist (correlation-id.ts CORRELATION_ID_SHAPE) that any inbound
// header must pass, or the server discards it for a fresh UUID (breaking the join).
const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;
const WIZARD_ID_RE = /^wizard:[0-9a-f-]{36}$/;

describe("wizard-correlation — getWizardCorrelationId", () => {
  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
  });

  it("returns a wizard:<uuid-v4> id", () => {
    const id = getWizardCorrelationId();
    expect(id).toMatch(WIZARD_ID_RE);
  });

  it("stays inside the server allowlist and ≤128 chars", () => {
    const id = getWizardCorrelationId();
    expect(id.length).toBeLessThanOrEqual(128);
    expect(CORRELATION_ID_SHAPE.test(id)).toBe(true);
  });

  it("returns the SAME id on repeated calls (one id per page load)", () => {
    const first = getWizardCorrelationId();
    const second = getWizardCorrelationId();
    expect(second).toBe(first);
  });

  it("generates a fresh id after the memo is reset", () => {
    const first = getWizardCorrelationId();
    _resetWizardCorrelationIdForTests();
    const second = getWizardCorrelationId();
    expect(second).not.toBe(first);
  });
});

describe("wizard-correlation — wizardFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentHeaders(callIndex = 0): Headers {
    const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
    return new Headers(init.headers);
  }

  it("stamps X-Correlation-Id with a per-request id in the canonical shape", async () => {
    await wizardFetch("/api/thing");
    expect(sentHeaders().get("X-Correlation-Id")).toMatch(WIZARD_ID_RE);
  });

  it("mints two DIFFERENT correlation values across two calls (the uniqueness gate)", async () => {
    await wizardFetch("/api/one");
    await wizardFetch("/api/two");
    const first = sentHeaders(0).get("X-Correlation-Id");
    const second = sentHeaders(1).get("X-Correlation-Id");
    expect(second).not.toBe(first);
  });

  it("stamps X-Wizard-Page-Load-Id with the SAME value on every call, equal to the page-load id (the session-header-carriage gate)", async () => {
    await wizardFetch("/api/one");
    await wizardFetch("/api/two");
    const pageLoadId = getWizardCorrelationId();
    expect(sentHeaders(0).get("X-Wizard-Page-Load-Id")).toBe(pageLoadId);
    expect(sentHeaders(1).get("X-Wizard-Page-Load-Id")).toBe(pageLoadId);
  });

  it("preserves method and body", async () => {
    await wizardFetch("/api/thing", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("preserves caller headers passed as a plain object", async () => {
    await wizardFetch("/api/thing", {
      headers: { "Content-Type": "application/json" },
    });
    expect(sentHeaders().get("Content-Type")).toBe("application/json");
  });

  it("preserves caller headers passed as a Headers instance", async () => {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    await wizardFetch("/api/thing", { headers: h });
    expect(sentHeaders().get("Content-Type")).toBe("application/json");
  });

  it("respects a caller-supplied X-Correlation-Id rather than overwriting it", async () => {
    await wizardFetch("/api/thing", {
      headers: { "X-Correlation-Id": "caller:override" },
    });
    expect(sentHeaders().get("X-Correlation-Id")).toBe("caller:override");
  });

  it("still stamps the page-load header even when the caller supplies its own correlation value", async () => {
    await wizardFetch("/api/thing", {
      headers: { "X-Correlation-Id": "caller:override" },
    });
    expect(sentHeaders().get("X-Wizard-Page-Load-Id")).toBe(
      getWizardCorrelationId(),
    );
  });

  it("the optional capture callback receives exactly the id that went on the wire (the capture-path gate)", async () => {
    let captured: string | null = null;
    await wizardFetch("/api/thing", undefined, {
      onCorrelationId: (id) => {
        captured = id;
      },
    });
    expect(captured).toBe(sentHeaders().get("X-Correlation-Id"));
  });

  it("the capture callback receives a caller-supplied id verbatim", async () => {
    let captured: string | null = null;
    await wizardFetch(
      "/api/thing",
      { headers: { "X-Correlation-Id": "caller:override" } },
      {
        onCorrelationId: (id) => {
          captured = id;
        },
      },
    );
    expect(captured).toBe("caller:override");
  });

  it("wizardFetch remains callable with only (input) — backward-compatible signature", async () => {
    await expect(wizardFetch("/api/thing")).resolves.toBeInstanceOf(Response);
  });
});
