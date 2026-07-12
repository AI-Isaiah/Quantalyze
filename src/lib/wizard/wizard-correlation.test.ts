import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getWizardCorrelationId,
  wizardFetch,
  _resetWizardCorrelationIdForTests,
} from "./wizard-correlation";

/**
 * UX-02 (#30) — client-safe wizard correlation id.
 *
 * The contract this module upholds: one id per wizard session, of a shape the
 * server allowlist accepts (`wizard:<uuid>`), sent on every wizard fetch so the
 * DISPLAYED id and the SENT header are the SAME value (client↔server log join).
 */

// The server allowlist (correlation-id.ts CORRELATION_ID_SHAPE) that any inbound
// header must pass, or the server discards it for a fresh UUID (breaking the join).
const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

describe("wizard-correlation — getWizardCorrelationId", () => {
  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
  });

  it("returns a wizard:<uuid-v4> id", () => {
    const id = getWizardCorrelationId();
    expect(id).toMatch(/^wizard:[0-9a-f-]{36}$/);
  });

  it("stays inside the server allowlist and ≤128 chars", () => {
    const id = getWizardCorrelationId();
    expect(id.length).toBeLessThanOrEqual(128);
    expect(CORRELATION_ID_SHAPE.test(id)).toBe(true);
  });

  it("returns the SAME id on repeated calls (one id per session)", () => {
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

  function sentHeaders(): Headers {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return new Headers(init.headers);
  }

  it("stamps X-Correlation-Id equal to the session id", async () => {
    await wizardFetch("/api/thing");
    expect(sentHeaders().get("X-Correlation-Id")).toBe(getWizardCorrelationId());
  });

  it("sends the same header on every call (stable across the session)", async () => {
    await wizardFetch("/api/one");
    await wizardFetch("/api/two");
    const first = new Headers(
      (fetchMock.mock.calls[0][1] as RequestInit).headers,
    ).get("X-Correlation-Id");
    const second = new Headers(
      (fetchMock.mock.calls[1][1] as RequestInit).headers,
    ).get("X-Correlation-Id");
    expect(second).toBe(first);
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

  it("the session id wins over a caller-supplied X-Correlation-Id (not silently dropped)", async () => {
    await wizardFetch("/api/thing", {
      headers: { "X-Correlation-Id": "attacker:override" },
    });
    // Deterministic: the session id wins (single stable id is the contract).
    expect(sentHeaders().get("X-Correlation-Id")).toBe(getWizardCorrelationId());
    expect(sentHeaders().get("X-Correlation-Id")).not.toBe("attacker:override");
  });
});
