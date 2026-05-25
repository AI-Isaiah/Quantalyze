/** @vitest-environment jsdom */
/**
 * H-0189 — ConnectKeyStep error-code mapping → wizard_error telemetry.
 *
 * On a non-2xx (or missing strategy_id/api_key_id) response, the step maps
 * the server `data.code` to a WizardErrorCode (falling back to "UNKNOWN")
 * and fires `trackForQuantsEventClient("wizard_error", { code, step })`.
 * On a thrown fetch (network/timeout) the catch sets code
 * "KEY_NETWORK_TIMEOUT". These are the only client-side telemetry-truth
 * paths for the error_code funnel dimension; the e2e spec asserts UI copy
 * only, not this payload.
 *
 * We assert the analytics-event `code` argument directly (it carries the
 * exact mapped code) so the test cannot be satisfied by an UNKNOWN
 * fallback masquerading as the right code.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectKeyStep } from "./ConnectKeyStep";

const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const SESSION = "wizard-session-12345";

function fillKeyAndSecret() {
  fireEvent.change(screen.getByPlaceholderText("Paste the read-only key"), {
    target: { value: "AK_LIVE_xxx" },
  });
  fireEvent.change(screen.getByPlaceholderText("Paste the secret"), {
    target: { value: "SECRET_xxx" },
  });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("[H-0189] ConnectKeyStep — server code → wizard_error mapping", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a known server data.code into the wizard_error event", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_HAS_TRADING_PERMS", error: "scoped" }, 422),
    );
    const onSuccess = vi.fn();
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={onSuccess} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(call).toBeDefined();
    const payload = call![1] as { code: string; step: string };
    expect(payload.code).toBe("KEY_HAS_TRADING_PERMS");
    expect(payload.step).toBe("connect_key");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("falls back to UNKNOWN when the server omits data.code on a non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "boom" }, 500),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    const payload = call![1] as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });

  it("maps a thrown fetch (network failure) to KEY_NETWORK_TIMEOUT", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    const payload = call![1] as { code: string; step: string };
    expect(payload.code).toBe("KEY_NETWORK_TIMEOUT");
    expect(payload.step).toBe("connect_key");
    errSpy.mockRestore();
  });

  it("calls onSuccess (no wizard_error) when the server returns ids on 2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          strategy_id: "33333333-3333-3333-3333-333333333333",
          api_key_id: "44444444-4444-4444-4444-444444444444",
        },
        200,
      ),
    );
    const onSuccess = vi.fn();
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={onSuccess} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalledWith({
      strategyId: "33333333-3333-3333-3333-333333333333",
      apiKeyId: "44444444-4444-4444-4444-444444444444",
      exchange: "binance",
    });
    const errorCall = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    );
    expect(errorCall).toBeUndefined();
  });
});
