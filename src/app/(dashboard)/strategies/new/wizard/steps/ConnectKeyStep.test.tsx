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

  it("does NOT render a sFOX card when the flag is OFF (default) — byte-neutral offer", () => {
    // Default env: NEXT_PUBLIC_SFOX_ENABLED unset → SFOX_UI_ENABLED false. Exactly
    // the four wizard-exchange-* cards, no sfox. This static-import render reads
    // the default (OFF) flag; the flag-ON block below re-imports with the stub.
    renderStep();
    expect(screen.getByTestId("wizard-exchange-binance")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-okx")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-bybit")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-deribit")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-exchange-sfox")).toBeNull();
  });
});

/**
 * Phase 122 / SFOX-08 — flag-gated sFOX wizard card (token-only + F3-honest).
 *
 * With NEXT_PUBLIC_SFOX_ENABLED === "true" the picker offers a fifth sFOX card.
 * sFOX authenticates with a SINGLE Bearer token (no secret), so the card is
 * token-only: ONE credential field labelled "API Token", no secret input, submit
 * enables on the token alone, and the POST carries api_secret as "" (the validate
 * route's 119 carve-out normalizes+accepts it). F3: the "What we reject" trust
 * atom must state structural facts (no order/withdraw path; sFOX exposes no
 * per-key scope endpoint) — never a false "verified read-only scope" claim.
 *
 * SFOX_UI_ENABLED is a module-scope const, so each flag-ON render stubs the env,
 * resets the registry, and dynamic-imports the step fresh. vi.unstubAllEnvs in
 * afterEach prevents the stub leaking into a sibling test.
 */
describe("Phase 122 — sFOX wizard card (flag ON, SFOX-08)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function renderWithFlagOn() {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);
  }

  it("renders a sFOX card whose credential collection is token-only (no secret input)", async () => {
    await renderWithFlagOn();
    const card = screen.getByTestId("wizard-exchange-sfox");
    expect(card).toHaveTextContent("sFOX");

    fireEvent.click(card);
    // ONE credential field, labelled "API Token".
    expect(screen.getByLabelText("API Token")).toBeInTheDocument();
    // NO secret field is rendered for sfox (contrast: binance renders one).
    expect(screen.queryByLabelText("API Secret")).toBeNull();
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
  });

  it("enables submit with the token alone and POSTs api_secret as an empty string", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          strategy_id: "77777777-7777-7777-7777-777777777777",
          api_key_id: "88888888-8888-8888-8888-888888888888",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    const onSuccess = vi.fn();
    render(<Fresh wizardSessionId={SESSION} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByTestId("wizard-exchange-sfox"));
    const submit = screen.getByTestId("wizard-connect-submit");
    // Submit is gated only on the token — no secret required.
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("API Token"), {
      target: { value: "SFOX_TOKEN_xxx" },
    });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.exchange).toBe("sfox");
    expect(body.api_key).toBe("SFOX_TOKEN_xxx");
    expect(body.api_secret).toBe("");
    expect(body.passphrase).toBeNull();
  });

  // WR-01: sFOX's per-exchange #sfox-readonly SubAnchor is server-flag-gated
  // (isSfoxEnabledServer), so it is dark in the card-visible / guide-dark
  // half-state. The setup-guide link must target the UNCONDITIONAL #readonly-key
  // Section anchor (always rendered) so it is never a dead link.
  it("points the sFOX setup-guide link at the unconditional /security#readonly-key", async () => {
    await renderWithFlagOn();
    fireEvent.click(screen.getByTestId("wizard-exchange-sfox"));
    const link = screen.getByRole("link", { name: /sFOX setup guide/ });
    expect(link).toHaveAttribute("href", "/security#readonly-key");
  });

  it("renders the F3-honest read-only claim for sFOX — never a scope-verification claim", async () => {
    await renderWithFlagOn();
    fireEvent.click(screen.getByTestId("wizard-exchange-sfox"));
    // Honest structural facts: read-only by our adapter + no per-key scope endpoint.
    expect(screen.getByText(/read-only by our adapter/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no per-key scope endpoint/i),
    ).toBeInTheDocument();
    // The scope-rejection claim (true for ccxt, FALSE for sfox) must NOT render.
    expect(
      screen.queryByText(/rejected before we store it/i),
    ).toBeNull();
  });

  it("renders the scripted KEY_AUTH_FAILED envelope on an invalid sFOX key (no false-verified path)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "KEY_AUTH_FAILED" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByTestId("wizard-exchange-sfox"));
    fireEvent.change(screen.getByLabelText("API Token"), {
      target: { value: "BAD_TOKEN" },
    });
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "KEY_AUTH_FAILED");
  });

  it("non-sfox exchanges STILL require a secret when the flag is ON (Rule-2 pin)", async () => {
    await renderWithFlagOn();
    // Binance (default) still renders the secret input and gates submit on it.
    expect(screen.getByLabelText("API Secret")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "AK_LIVE_xxx" },
    });
    // Token filled but secret empty → submit stays disabled for a ccxt exchange.
    expect(screen.getByTestId("wizard-connect-submit")).toBeDisabled();
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

/**
 * Phase 138 / MT5UI-01+02 — flag-gated MT5 wizard card (3-credential variant).
 *
 * With NEXT_PUBLIC_MT5_ENABLED === "true" the picker offers an MT5 card. MT5
 * collects THREE credentials that map onto the existing {api_key, api_secret,
 * passphrase} slots (the 135 chokepoint): login → api_key, investor password →
 * api_secret, broker server → passphrase. The third (passphrase) field carries
 * a per-exchange LABEL override ("Broker server", NOT "OKX Passphrase") and is
 * REQUIRED, gating submit. The "What we reject" trust atom swaps to the MT5
 * master-password-honest body. Three failure codes (KEY_AUTH_FAILED /
 * KEY_MT5_WRONG_SERVER / KEY_MT5_MASTER_PASSWORD) each render their OWN
 * distinguishable envelope. All copy is pre-authored (Phase 135) — ZERO new
 * envelope strings.
 *
 * MT5_UI_ENABLED is a module-scope const, so each flag-ON render stubs the env,
 * resets the registry, and dynamic-imports the step fresh. vi.unstubAllEnvs +
 * vi.restoreAllMocks in afterEach prevent the stub/spy leaking into a sibling
 * test (the Node22 stub-leak lesson).
 */
const MT5_STEER =
  "Use your investor (read-only) password — not your master password. A master password can place trades, so we refuse it and store nothing.";
const MT5_SERVER_HELPER =
  "Open your MT5 terminal's login window and copy the server name exactly as it appears there — it is broker-specific and often carries a region or Demo/Live suffix.";
const MT5_REJECT_ATOM =
  "MT5 master passwords can place trades, so we reject them at connect time and store nothing — only a read-only investor login is accepted.";

describe("Phase 138 — MT5 wizard card (MT5UI-01+02)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function renderWithMt5On(fetchImpl?: Response | Error) {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    if (fetchImpl instanceof Error) {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(fetchImpl);
    } else if (fetchImpl) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(fetchImpl);
    }
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    const onSuccess = vi.fn();
    render(<Fresh wizardSessionId={SESSION} onSuccess={onSuccess} />);
    return { onSuccess };
  }

  function fillMt5Fields() {
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    fireEvent.change(screen.getByLabelText("MT5 login"), {
      target: { value: "5000123" },
    });
    fireEvent.change(screen.getByLabelText("Investor password"), {
      target: { value: "investor-pw-xxx" },
    });
    fireEvent.change(screen.getByLabelText("Broker server"), {
      target: { value: "MyBroker-Live" },
    });
  }

  it("does NOT render an MT5 card when the flag is OFF (default) — byte-identical offer", () => {
    // Static import reads the default (OFF) flag: exactly the four base cards.
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    expect(screen.getByTestId("wizard-exchange-binance")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-okx")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-bybit")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-exchange-deribit")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-exchange-mt5")).toBeNull();
  });

  it("renders an MT5 card with the pinned name + caption when the flag is ON", async () => {
    await renderWithMt5On();
    const card = screen.getByTestId("wizard-exchange-mt5");
    expect(card).toHaveTextContent("MT5");
    expect(card).toHaveTextContent(
      "Live investor (read-only) login. Forex & CFD.",
    );
  });

  it("shows exactly three labeled MT5 credential fields (broker-server override, not OKX)", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    expect(screen.getByLabelText("MT5 login")).toBeInTheDocument();
    expect(screen.getByLabelText("Investor password")).toBeInTheDocument();
    // The third (passphrase-slot) field carries the label override.
    expect(screen.getByLabelText("Broker server")).toBeInTheDocument();
    expect(screen.queryByLabelText("OKX Passphrase")).toBeNull();
    // Generic labels are gone for MT5.
    expect(screen.queryByLabelText("API Secret")).toBeNull();
  });

  it("renders the muted investor-password steer and the broker-server find-it helper", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    const steer = screen.getByText(MT5_STEER);
    expect(steer).toBeInTheDocument();
    // Muted neutral, NEVER amber/red on the resting form (DESIGN.md gate).
    expect(steer.className).toContain("text-text-muted");
    expect(steer.className).not.toMatch(/amber|red|negative/);
    expect(screen.getByText(MT5_SERVER_HELPER)).toBeInTheDocument();
  });

  it("keeps submit disabled until the broker server (third field) is filled", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    const submit = screen.getByTestId("wizard-connect-submit");
    fireEvent.change(screen.getByLabelText("MT5 login"), {
      target: { value: "5000123" },
    });
    fireEvent.change(screen.getByLabelText("Investor password"), {
      target: { value: "investor-pw-xxx" },
    });
    // Login + investor pw filled, broker server empty → still disabled.
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Broker server"), {
      target: { value: "MyBroker-Live" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("POSTs the 135 slot mapping: login→api_key, investor pw→api_secret, server→passphrase", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          strategy_id: "99999999-9999-9999-9999-999999999999",
          api_key_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
        200,
      ),
    );
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    const onSuccess = vi.fn();
    render(<Fresh wizardSessionId={SESSION} onSuccess={onSuccess} />);
    fillMt5Fields();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.exchange).toBe("mt5");
    expect(body.api_key).toBe("5000123");
    expect(body.api_secret).toBe("investor-pw-xxx");
    expect(body.passphrase).toBe("MyBroker-Live");
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ exchange: "mt5" }),
    );
  });

  // WR-01: MT5's per-exchange #mt5-readonly SubAnchor is server-flag-gated
  // (isMt5EnabledServer), so in the documented card-visible / guide-dark
  // half-state (NEXT_PUBLIC_MT5_ENABLED set, MT5_ENABLED unset) it does not
  // render and a deep link to it lands on /security top with no guide. The link
  // must target the UNCONDITIONAL #readonly-key Section anchor (always rendered).
  it("points the MT5 setup-guide link at the unconditional /security#readonly-key", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    const link = screen.getByRole("link", { name: /MT5 setup guide/ });
    expect(link).toHaveAttribute("href", "/security#readonly-key");
  });

  it("swaps the 'What we reject' trust atom to the MT5-honest body (mt5 only)", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    expect(screen.getByText(MT5_REJECT_ATOM)).toBeInTheDocument();
    // The generic ccxt scope-rejection claim must NOT render for mt5.
    expect(screen.queryByText(/rejected before we store it/i)).toBeNull();
    // Contrast: switching to binance restores the generic atom.
    fireEvent.click(screen.getByTestId("wizard-exchange-binance"));
    expect(screen.queryByText(MT5_REJECT_ATOM)).toBeNull();
    expect(
      screen.getByText(/rejected before we store it/i),
    ).toBeInTheDocument();
  });

  it("leaves the sFOX trust-atom swap intact when both flags are ON", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("wizard-exchange-sfox"));
    expect(screen.getByText(/read-only by our adapter/i)).toBeInTheDocument();
    expect(screen.getByText(/no per-key scope endpoint/i)).toBeInTheDocument();
    // The MT5 atom must NOT bleed into the sfox selection.
    expect(screen.queryByText(MT5_REJECT_ATOM)).toBeNull();
  });

  it.each([
    ["KEY_AUTH_FAILED", "The exchange rejected these credentials."],
    ["KEY_MT5_WRONG_SERVER", "We could not find that broker server."],
    ["KEY_MT5_MASTER_PASSWORD", "This MT5 login can place trades."],
  ])(
    "surfaces a distinguishable envelope for %s (own data-error-code + title)",
    async (code, title) => {
      const { onSuccess } = await renderWithMt5On(
        jsonResponse({ code }, 422),
      );
      fillMt5Fields();
      fireEvent.click(screen.getByTestId("wizard-connect-submit"));

      const envelope = await screen.findByTestId("error-envelope");
      expect(envelope).toHaveAttribute("data-error-code", code);
      expect(envelope).toHaveTextContent(title);
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it("OKX regression: the passphrase field still labels 'OKX Passphrase' with today's helper", async () => {
    // The label-override refactor must be byte-neutral for existing venues.
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("wizard-exchange-okx"));
    expect(screen.getByLabelText("OKX Passphrase")).toBeInTheDocument();
    expect(
      screen.getByText(
        /OKX requires a passphrase in addition to key and secret/i,
      ),
    ).toBeInTheDocument();
  });
});
