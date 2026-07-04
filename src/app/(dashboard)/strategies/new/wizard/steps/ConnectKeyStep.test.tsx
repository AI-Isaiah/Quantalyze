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

/**
 * Phase 69 — Deribit wizard card (UX-01, SC-1).
 *
 * The wizard exposes Deribit as a fourth exchange card whose credential
 * fields are labelled "Client ID"/"Client Secret" (Deribit issues an
 * OAuth-style Client ID + Client Secret, NOT an API key/secret + passphrase).
 * Selecting Deribit renders NO passphrase field (contrast: OKX renders one)
 * and the setup-guide deep-link resolves to /security#deribit-readonly.
 *
 * Every assertion derives from the single `EXCHANGES` deribit entry + the
 * per-exchange credential-label wiring, so deleting either turns the block
 * red (wiring-invocation rule / D-09 revert-proof).
 */
describe("Phase 69 — Deribit wizard card (UX-01)", () => {
  function renderStep() {
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
  }

  it("renders a Deribit card with the pinned name + caption", () => {
    renderStep();
    const card = screen.getByTestId("wizard-exchange-deribit");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("Deribit");
    expect(card).toHaveTextContent(
      "Spot + Inverse Perpetuals + Options supported.",
    );
  });

  it("shows NO passphrase field for Deribit but DOES for OKX (contrast)", () => {
    renderStep();
    // Selecting Deribit: requiresPassphrase false → no passphrase field.
    fireEvent.click(screen.getByTestId("wizard-exchange-deribit"));
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
    // Contrast: OKX requires a passphrase → the assertion above can fail.
    fireEvent.click(screen.getByTestId("wizard-exchange-okx"));
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
  });

  it("swaps credential labels + placeholders per exchange (both directions)", () => {
    renderStep();
    // Default (binance) state: generic API Key / API Secret wiring.
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("API Secret")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Paste the read-only key"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste the secret")).toBeInTheDocument();

    // Deribit state: Client ID / Client Secret wiring.
    fireEvent.click(screen.getByTestId("wizard-exchange-deribit"));
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Paste the Deribit Client ID"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Paste the Deribit Client Secret"),
    ).toBeInTheDocument();

    // Revert direction: back to binance restores the generic labels.
    fireEvent.click(screen.getByTestId("wizard-exchange-binance"));
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("API Secret")).toBeInTheDocument();
  });

  it("points the Deribit setup-guide link at /security#deribit-readonly", () => {
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-exchange-deribit"));
    const link = screen.getByRole("link", { name: /Deribit setup guide/ });
    expect(link).toHaveAttribute("href", "/security#deribit-readonly");
  });

  it("submits Deribit with api_key/api_secret + passphrase:null (rename is label-only)", async () => {
    // SC-1 invariant: the "Client ID"/"Client Secret" relabel is PRESENTATION
    // ONLY. The POST body must still use the generic api_key/api_secret keys
    // (the server + storage columns are exchange-agnostic) and Deribit carries
    // NO passphrase. This is the revert-proof for the risk the production
    // comment calls out: a future edit wiring the label rename through into the
    // payload keys (client_id/client_secret) would break the server contract —
    // and turn this test red.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(
          {
            strategy_id: "55555555-5555-5555-5555-555555555555",
            api_key_id: "66666666-6666-6666-6666-666666666666",
          },
          200,
        ),
      );
    const onSuccess = vi.fn();
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByTestId("wizard-exchange-deribit"));
    fireEvent.change(
      screen.getByPlaceholderText("Paste the Deribit Client ID"),
      { target: { value: "DRB_CLIENT_ID_xxx" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Paste the Deribit Client Secret"),
      { target: { value: "DRB_CLIENT_SECRET_xxx" } },
    );
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.exchange).toBe("deribit");
    expect(body.api_key).toBe("DRB_CLIENT_ID_xxx");
    expect(body.api_secret).toBe("DRB_CLIENT_SECRET_xxx");
    expect(body.passphrase).toBeNull();
    // The renamed field labels must NOT have leaked into the payload keys.
    expect(body).not.toHaveProperty("client_id");
    expect(body).not.toHaveProperty("client_secret");
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ exchange: "deribit" }),
    );
  });
});
