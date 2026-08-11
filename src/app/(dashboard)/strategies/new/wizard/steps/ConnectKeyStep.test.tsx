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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, render, screen, fireEvent } from "@testing-library/react";
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

  /**
   * ⚠️ 140.5-03 / SEAMPROSE-03 — THIS CASE USED TO PIN `KEY_NETWORK_TIMEOUT`
   * AND IT PINNED A FALSE ATTRIBUTION. A rejected `wizardFetch` means the
   * request to OUR OWN route never completed; the exchange may never have been
   * contacted at all. `KEY_NETWORK_TIMEOUT`'s copy is "We could not reach the
   * exchange", so the funnel and the screen both blamed the venue for a fault
   * on our hop — the rule `wizardErrors.ts` states by name beside that entry.
   *
   * The NEGATIVE half is the load-bearing one: a rename that left the old code
   * anywhere in this catch (the state assignment OR the telemetry payload)
   * satisfies only the positive assertion.
   */
  it("maps a thrown fetch (our own hop failing) to SERVICE_UNREACHABLE, never the venue-fault code", async () => {
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
    expect(payload.code).toBe("SERVICE_UNREACHABLE");
    expect(payload.code).not.toBe("KEY_NETWORK_TIMEOUT");
    expect(payload.step).toBe("connect_key");

    // The RENDERED half — the copy the user reads, asserted as a hand-typed
    // literal rather than by importing the table entry.
    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveTextContent("We could not reach our own service.");
    expect(envelope).not.toHaveTextContent("We could not reach the exchange.");
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

  /**
   * MT5-03 / D-03 — the OKX half of the per-venue masking contract.
   *
   * MT5 reuses this EXACT passphrase slot to collect a broker SERVER NAME and
   * unmasks it with `passphraseSecret: false`. OKX's passphrase is a genuine
   * API credential, so it must stay masked at rest and the pre-existing
   * Show/Hide toggle must keep working bit-for-bit. The founder rejected a
   * global unmask precisely because it would leak this field.
   *
   * This is the load-bearing half of SC-7: flipping OKX to
   * `passphraseSecret: false` — or deleting the `?? true` default that makes
   * OKX byte-identical without editing its config entry — turns this RED.
   * The `type` attribute is asserted directly, not via a snapshot, so the
   * failure names the actual regression.
   */
  it("keeps the OKX passphrase MASKED at rest and Show-toggleable (D-03 byte-identity)", () => {
    renderStep();
    fireEvent.click(screen.getByTestId("wizard-exchange-okx"));
    expect(screen.getByLabelText("OKX Passphrase")).toHaveAttribute(
      "type",
      "password",
    );
    // The Show/Hide behaviour that existed before the flag is unchanged.
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByLabelText("OKX Passphrase")).toHaveAttribute(
      "type",
      "text",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByLabelText("OKX Passphrase")).toHaveAttribute(
      "type",
      "password",
    );
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

  /**
   * MT5-03 / D-03 — the broker server renders as LEGIBLE TEXT.
   *
   * The founder was typing a server name into a dot-masked field and could not
   * verify it, against helper copy that instructs "copy the server name exactly
   * as it appears in your MT5 terminal" — an instruction that is unfollowable
   * if you cannot read what you typed. The slot is a broker SERVER NAME, not a
   * credential, so it is unmasked UNCONDITIONALLY: it does not ride the
   * Show/Hide secret toggle in either direction.
   *
   * The same-render contrast on "Investor password" is what stops a blanket
   * "unmask everything" regression from satisfying this case.
   *
   * (Display only — the value still POSTs on the `passphrase` key and is
   * encrypted at rest; the slot-mapping case below pins that separately.)
   */
  it("renders Broker server as legible text, unconditionally, while the investor password stays masked", async () => {
    await renderWithMt5On();
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    expect(screen.getByLabelText("Broker server")).toHaveAttribute(
      "type",
      "text",
    );
    // Same render, same form: a genuine credential IS still masked.
    expect(screen.getByLabelText("Investor password")).toHaveAttribute(
      "type",
      "password",
    );
    // Independent of the Show/Hide toggle in BOTH directions.
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByLabelText("Broker server")).toHaveAttribute(
      "type",
      "text",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByLabelText("Broker server")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText("Investor password")).toHaveAttribute(
      "type",
      "password",
    );
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

/**
 * 140.3-13a / SEAMUX-08 — the unvalidated `as WizardErrorCode` cast is now a
 * membership check.
 *
 * Before this plan the step cast `data.code` with a bare `as WizardErrorCode`
 * (widened with an optional, then defaulted to `"UNKNOWN"`) — a
 * compile-time assertion applied to NETWORK DATA. Any string an upstream, a
 * proxy or an edge/WAF layer put in `code` became a "typed" `WizardErrorCode`,
 * was handed to `buildEnvelope`, and rendered `WIZARD_ERROR_COPY[code]` —
 * `undefined` — while the funnel recorded a code outside our vocabulary.
 *
 * ⚠️ The POSITIVE case is the load-bearing one. A guard that rejected
 * EVERYTHING would satisfy every unrecognised-code assertion below while
 * silently collapsing the whole funnel to UNKNOWN — which is the defect
 * SEAMUX-08 exists to close, recreated. Both directions are asserted.
 */
describe("[140.3-13a / SEAMUX-08] ConnectKeyStep — data.code is membership-checked, never cast", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function readWizardErrorPayload(): { code: string; step: string } {
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(
      call,
      "no wizard_error event was emitted at all — the funnel cannot tell an outage from nobody trying",
    ).toBeDefined();
    return call![1] as { code: string; step: string };
  }

  it("an UNRECOGNISED code resolves to UNKNOWN rather than being admitted into the union", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "ZZ_NOT_A_WIZARD_CODE" }, 500),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    // Both surfaces, because they are set from the SAME local: an upstream
    // string reaching either one is the defect.
    expect(
      envelope.getAttribute("data-error-code"),
      "an upstream string was rendered as a wizard error code — WIZARD_ERROR_COPY has no entry for it, so the envelope renders undefined copy",
    ).toBe("UNKNOWN");
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    expect(readWizardErrorPayload().code).toBe("UNKNOWN");
  });

  it("POSITIVE: a code from the route's classifier half is emitted UNCHANGED (a reject-everything guard would fail here)", async () => {
    // SERVICE_UNAVAILABLE_RETRY is what classifyKeyValidationError returns for a
    // CircuitOpenError, i.e. this is a breaker trip during key connect. It is
    // the code an outage must be distinguishable BY.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "SERVICE_UNAVAILABLE_RETRY" }, 503),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute(
      "data-error-code",
      "SERVICE_UNAVAILABLE_RETRY",
    );
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const payload = readWizardErrorPayload();
    expect(
      payload.code,
      "a breaker trip reported as UNKNOWN is indistinguishable from a bad key in the funnel — SEAMUX-08",
    ).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(payload.step).toBe("connect_key");
  });

  it("a code belonging to a DIFFERENT route's contract is NOT admitted here", async () => {
    // MULTI_KEY_WINDOWS_INVALID is a real WizardErrorCode — but it belongs to
    // composite/set-members, which this step never calls. A totality check over
    // the whole union would admit it and render "fix your key windows" on the
    // single-key exchange form.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "MULTI_KEY_WINDOWS_INVALID" }, 400),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });
});

/**
 * 140.4-15 / SEAMRIM-08 — the seam WIRE vocabulary is translated BEFORE the
 * membership check, at this surface too.
 *
 * ⚠️ WHY THIS EXISTS AS A SEPARATE BLOCK, AND WHY IT IS NOT A ROSTER MEMBER.
 * Plan `140.4-13` made `create-with-key/route.ts` answer a limiter
 * MISCONFIGURATION with the wire code `SEAM_MISCONFIGURED` instead of the 429
 * `KEY_RATE_LIMIT` it used to emit — our own outage had been blamed on the
 * user's exchange. Plan `140.4-12` gave the kickoff arm (`SyncPreviewStep`) a
 * translation hop so that code reaches its own copy, but the two key-entry
 * steps never got one: each plan's SUMMARY assigned the edit to the other, and
 * plan 12's GREEN commit landed BEFORE plan 13's. The code therefore arrived
 * here, missed `KNOWN_CREATE_WITH_KEY_CODES`, and rendered `UNKNOWN` —
 * *"Try the last action again."* with a Retry control — for a fault whose own
 * authored copy says *"Retrying will not clear it."*
 *
 * The remedy is the ONE shared table (`SEAM_CODE_TO_WIZARD_CODE`, consulted
 * through `recogniseSeamErrorCode`), NOT a new roster member: a roster member
 * is coverage-law row 2 (hand-typed allow-list) and would have to be added
 * again at every surface the next wire code reaches. The table is row 1.
 *
 * ⚠️ THE `recoverable` HALF IS LOAD-BEARING, NOT DECORATION. `recoverable` is
 * DERIVED in `buildEnvelope` from the code's `actions` — `SEAM_MISCONFIGURED`
 * carries neither `clear_and_retry` nor `try_another_key`, so it derives
 * `false` and the Retry control does not render. `UNKNOWN` carries
 * `clear_and_retry` and DOES render one. Asserting the absence alone would be
 * satisfied by an envelope that renders no controls at all, so the UNKNOWN
 * contrast below is the positive counterpart that keeps it discriminating.
 */
describe("[140.4-15 / SEAMRIM-08] ConnectKeyStep — a seam WIRE code is translated before the membership check", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("our own configuration fault (SEAM_MISCONFIGURED) reaches its own state and offers NO retry", async () => {
    // The exact body `rateLimitDenyJson`'s misconfigured arm puts on the wire
    // at create-with-key/route.ts — hand-typed from the route, not imported.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "SEAM_MISCONFIGURED", error: "Rate limiter unavailable" },
        503,
      ),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "the wire code collapsed to UNKNOWN — the user is told to try the last " +
        "action again for a misconfiguration that retrying cannot clear, and " +
        "the honest copy this phase authored is unreachable at this surface",
    ).toHaveAttribute("data-error-code", "SEAM_MISCONFIGURED");

    expect(
      screen.getByText(
        "We could not send this request — our own configuration is wrong.",
      ),
    ).toBeInTheDocument();

    // The BEHAVIOURAL half: no retry affordance, because retrying is futile.
    expect(
      screen.queryByRole("button", { name: "Retry" }),
      "a Retry control was offered for a fault that stays wrong until we " +
        "redeploy — the control contradicts the sentence beside it",
    ).toBeNull();

    // The funnel must see the specific code too: a configuration fault
    // recorded as UNKNOWN is indistinguishable from a drifted upstream string.
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const payload = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    )![1] as { code: string; step: string };
    expect(payload.code).toBe("SEAM_MISCONFIGURED");
    expect(payload.step).toBe("connect_key");
  });

  it("POSITIVE COUNTERPART: an unrecognised code still falls to UNKNOWN, which DOES render Retry", async () => {
    // Without this the absence assertion above is satisfiable by a component
    // that renders no controls at all.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "ZZ_NOT_A_WIZARD_CODE" }, 500),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
    expect(
      screen.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("[140.4-16 / WR-09] the NESTED python envelope's code is read here too", async () => {
    // `body.detail.code` is the shape every `service_error()` answer carries.
    // A top-level-only reader answers `undefined` on it — byte-identical to a
    // body that carried no code at all, which is how 21 codes stay invisible.
    // `SyncPreviewStep` and `SubmitStep` have read through the leaf since
    // 140.3-05 / 140.4-12; the two key-entry surfaces claimed to "mirror
    // SyncPreviewStep exactly" while reading `data.code` directly. This case is
    // what makes the claim true rather than aspirational.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: "SEAM_MISCONFIGURED",
            dependency: null,
            retryable: false,
            detail: "Rate limiter unavailable.",
            correlation_id: "srv-nested-8b2d1f40-6c93-4a55-b027-1e5f9a3c7d64",
          },
        },
        503,
      ),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "the nested envelope carried the code and this arm did not see it. The " +
        "flat and nested shapes must produce the SAME state.",
    ).toHaveAttribute("data-error-code", "SEAM_MISCONFIGURED");
  });

  it("the translation hop does not shadow the roster: a wire code with no table entry is still UNKNOWN", async () => {
    // `SEAM_DEGRADED` is a real seam wire code that is deliberately ABSENT
    // from SEAM_CODE_TO_WIZARD_CODE — the table is explicit, not an identity
    // rule. A translation hop written as `code as WizardErrorCode` would
    // admit it and render undefined copy.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "SEAM_DEGRADED" }, 503),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });
});

/**
 * Phase 140.5-03 / SEAMPROSE-02 — `Retry-After` ARRIVES at this surface.
 *
 * ⭐ HARD PREREQUISITE FOR PHASE 141. This is the SECOND of the four actionable
 * threads, which is why the Falsifiability Ledger's SC-RA-1 mutation targets it
 * rather than the first one an author checks.
 *
 * The wait travels: route (or the analytics service, via the choke-point relay
 * landed in this same plan) stamps `Retry-After` → `parseRetryAfterSeconds`
 * reads the HEADER (never the body's `retry_after_seconds`, which would be a
 * second extraction path for one fact) → component state →
 * `buildEnvelope({retryAfterSeconds})` → `ErrorEnvelope`'s
 * `data-testid="error-envelope-wait"`.
 *
 * ⚠️ `ErrorEnvelope` renders the wait only when `showRetry` — i.e. the code is
 * recoverable AND an `onRetry` is supplied. Threading a wait onto a
 * non-recoverable code reaches nothing, so the polarity is re-derived here:
 * `KEY_RATE_LIMIT` is `clear_and_retry` and this step always passes `onRetry`.
 */
describe("[140.5-03 / SEAMPROSE-02] ConnectKeyStep — the advertised wait reaches the envelope", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rateLimited(retryAfter?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (retryAfter !== undefined) headers["Retry-After"] = retryAfter;
    return new Response(JSON.stringify({ code: "KEY_RATE_LIMIT" }), {
      status: 429,
      headers,
    });
  }

  async function submit() {
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));
    return screen.findByTestId("error-envelope");
  }

  it("a 429 carrying `Retry-After: 30` renders the wait", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rateLimited("30"));
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    await submit();

    const wait = await screen.findByTestId("error-envelope-wait");
    // 30 is the hand-typed literal from the fixture header, not a value read
    // back out of the component.
    expect(wait).toHaveTextContent("30s");
  });

  it("a 429 with NO header renders NO wait — absence is not zero (TRAP-3)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rateLimited());
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    await submit();

    expect(screen.queryByTestId("error-envelope-wait")).toBeNull();
  });

  it("a SECOND failure with no header does NOT render the FIRST one's wait", async () => {
    // ⭐ THE CLEAR-ON-FRESH-ATTEMPT HALF — the one a copy-paste of the working
    // thread drops. Without the reset, attempt 2's envelope names attempt 1's
    // duration: a wait nobody advertised, for a failure that never mentioned
    // one, which is worse than naming none because it is specific.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimited("30"))
      .mockResolvedValueOnce(rateLimited());
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);

    await submit();
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "30s",
    );

    // Dismiss and re-submit — the same handler, a fresh attempt.
    fireEvent.click(screen.getByLabelText("Retry"));
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));
    await screen.findByTestId("error-envelope");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("error-envelope-wait")).toBeNull();
  });
});

/**
 * ⚠️ STOPGAP regression (hotfix 2026-08-06, incident 2026-08-05) — see the
 * `KNOWN_CREATE_WITH_KEY_CODES` roster comment. The server classified a
 * validate-key failure as `SERVICE_UNREACHABLE`, but the roster did not carry
 * the code, so the membership check rejected the honest server code and the
 * wizard rendered the UNKNOWN card ("Try the last action again.", with a
 * Retry control) for a fault whose own copy says the request never got an
 * answer. The two verify-key scope codes travel with it. The CLASS fix (a
 * roster DERIVED from the route contract) stays with Phase 153 / WIZFORM-02.
 */
describe("[hotfix 2026-08-06] ConnectKeyStep — server-emitted SERVICE_UNREACHABLE + scope codes render their own copy, never UNKNOWN", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a 502 body carrying code SERVICE_UNREACHABLE reaches its own envelope state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "SERVICE_UNREACHABLE", error: "validation never answered" },
        502,
      ),
    );
    render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fillKeyAndSecret();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "the server's honest code collapsed to UNKNOWN — the 2026-08-05 " +
        "incident rendering. The roster must admit SERVICE_UNREACHABLE.",
    ).toHaveAttribute("data-error-code", "SERVICE_UNREACHABLE");
    // The copy the user reads — hand-typed literals, not imports.
    expect(envelope).toHaveTextContent("We could not reach our own service.");
    expect(envelope).not.toHaveTextContent("Try the last action again.");

    // The funnel sees the specific code too, not UNKNOWN.
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalled());
    const payload = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    )![1] as { code: string };
    expect(payload.code).toBe("SERVICE_UNREACHABLE");
  });

  it.each([
    ["KEY_MISSING_READ_SCOPE", "This key is missing a read permission we need."],
    ["KEY_PERMISSION_DENIED", "The exchange refused this key's permissions."],
  ] as const)(
    "the verify-key scope code %s is admitted and renders its own title",
    async (code, title) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ code, error: "scope refused" }, 400),
      );
      render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
      fillKeyAndSecret();
      fireEvent.click(screen.getByTestId("wizard-connect-submit"));

      const envelope = await screen.findByTestId("error-envelope");
      expect(envelope).toHaveAttribute("data-error-code", code);
      expect(envelope).toHaveTextContent(title);
    },
  );
});

/**
 * Phase 153.4-04 / D-05 / WIZFORM-05 — THE HONEST LONG WAIT.
 *
 * 153.4-01/02 granted a serialized venue (MT5) a 120 000 ms validate budget.
 * Before this plan that budget bought a two-minute disabled button reading
 * `Validating...` and nothing else. Every assertion below is about the four
 * promises the card makes in exchange for that silence: it appears (but not for
 * a fast answer), it escalates, it can be abandoned for free, and it ENDS —
 * with a stated verdict rather than an indefinite spinner.
 *
 * ⚠️ EVERY EXPECTED STRING IS HAND-TYPED, never imported from the component or
 * from `validate-budget.ts`. Importing the constants would assert the component
 * equals itself; the `120` in the copy below is the number the SEAM grants,
 * pinned to `SEAM_BUDGETS` by the agreement pin in `seam-constants.pin.test.ts`,
 * and a test that DERIVED it would go green on a budget that silently moved.
 * A self-scan at the bottom of this block asserts that property about this file.
 *
 * ⚠️ FAKE TIMERS, and the fetch never resolves. The wait is the subject, so the
 * clock has to be an input rather than a race: every threshold below is reached
 * by advancing time, and the only thing that can end a wait in these cases is
 * the abort the component itself fires.
 */
describe("[153.4-04 / WIZFORM-05] ConnectKeyStep — the honest long wait", () => {
  // ── The two live budgets, in ms, hand-typed ────────────────────────────────
  const SERIALIZED_BUDGET_MS = 120_000;
  const DEFAULT_BUDGET_MS = 30_000;
  // The ENCRYPT leg the route spends AFTER validate, hand-typed. The browser is
  // aborting the ROUTE, and the route is `validateKey` → `encryptKey` → RPC.
  const ENCRYPT_BUDGET_MS = 30_000;
  // The browser's margin OVER the promise it made, hand-typed.
  const ABORT_GRACE_MS = 15_000;
  const MOUNT_DELAY_MS = 300;
  /** When the browser gives up on the ROUTE, hand-typed on the serialized arm. */
  const SERIALIZED_DEADLINE_MS =
    SERIALIZED_BUDGET_MS + ENCRYPT_BUDGET_MS + ABORT_GRACE_MS;

  // ── The copy, hand-typed ───────────────────────────────────────────────────
  const SIGNING_IN = "Signing in to your broker...";
  const CHECKING_BINANCE = "Checking your key with Binance...";
  const WAIT_PROMISE_120 = "We wait up to 120s for your broker to answer.";
  const QUEUE_LINE =
    "Still signing in. MetaTrader allows one sign-in at a time, so your check may be waiting behind another.";
  const SLOW_LINE_120 =
    "This is slower than usual. We will wait until 120s, then tell you what we found.";
  const STOP_WAITING = "Stop waiting";
  const CANCELLED_LINE =
    "We stopped waiting for your broker. Your key details are still on this page — the check may still be finishing on our side, and connecting again picks up that key rather than storing a second one.";
  const BUSY_LABEL = "Validating...";

  beforeEach(() => {
    trackMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /**
   * A `fetch` that answers nothing and honours its `AbortSignal`.
   *
   * ⭐ THE SIGNAL CAPTURE IS THE LOAD-BEARING PART. A mock that merely never
   * resolves would let `Stop waiting` look like it works while the request runs
   * on: the card would unmount (local state), the sentence would render (local
   * state), and the credential-carrying POST would still be in flight. The
   * returned array is what the abort assertions read, and it stays EMPTY if the
   * component ever stops passing a signal.
   */
  function mockAbortableFetch(): AbortSignal[] {
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = (init as RequestInit | undefined)?.signal ?? null;
      if (signal) signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          // The shape a real `fetch` rejects with on abort.
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    return signals;
  }

  /** Render a fresh step; `mt5` stubs the flag the MT5 card is gated on. */
  async function renderFresh(venue: "binance" | "mt5") {
    if (venue === "mt5") vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    const onSuccess = vi.fn();
    render(<Fresh wizardSessionId={SESSION} onSuccess={onSuccess} />);
    return { onSuccess };
  }

  /** Fill the credential fields for a venue and press submit. Timers are FAKE. */
  function fillAndSubmit(venue: "binance" | "mt5") {
    if (venue === "mt5") {
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
    } else {
      fillKeyAndSecret();
    }
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));
  }

  /** Advance the fake clock and let every resulting update commit. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function card(): HTMLElement | null {
    return screen.queryByTestId("validate-wait-card");
  }

  /** Every `class` attribute rendered inside an element, joined. */
  function allClasses(el: HTMLElement): string {
    return [el, ...Array.from(el.querySelectorAll("*"))]
      .map((node) => node.getAttribute("class") ?? "")
      .join(" ");
  }

  /**
   * The module specifiers a source file actually IMPORTS — static `from "…"`
   * edges and dynamic `import("…")` calls — read over comment-stripped source.
   * A specifier mentioned in prose or held in a plain string is not an edge.
   */
  function importSpecifiers(source: string): string[] {
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n")
      .map((line) => (line.trim().startsWith("//") ? "" : line))
      .join("\n");
    return Array.from(
      stripped.matchAll(
        /\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g,
      ),
    ).map((m) => m[1] ?? m[2]!);
  }

  function wizardErrorCalls(): { code: string; step: string }[] {
    return trackMock.mock.calls
      .filter((c) => (c as unknown[])[0] === "wizard_error")
      .map((c) => (c as unknown[])[1] as { code: string; step: string });
  }

  it("a sub-300ms answer never flashes a card — the gate is a TIMER, not a comparison", async () => {
    mockAbortableFetch();
    await renderFresh("binance");
    fillAndSubmit("binance");

    await advance(MOUNT_DELAY_MS - 1);
    expect(
      card(),
      "the wait card mounted before 300ms. Most validates answer in well under " +
        "that, and a card that appears and vanishes reads as a fault rather than " +
        "as a wait (UI-SPEC Surface 1 §Render gate).",
    ).toBeNull();

    await advance(2);
    expect(card()).not.toBeNull();
  });

  it("a serialized venue names what is happening and the deadline it was granted", async () => {
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    await advance(MOUNT_DELAY_MS + 1);

    const shown = card()!;
    expect(shown).toHaveTextContent(SIGNING_IN);
    expect(
      shown,
      "the card promised no duration on the arm that waits two minutes. The " +
        "figure must be the budget the seam will actually honour — read from the " +
        "budget module, never typed into copy (UI-SPEC forbidden item #8).",
    ).toHaveTextContent(WAIT_PROMISE_120);
  });

  it("a NON-serialized venue names the venue and promises no wait", async () => {
    mockAbortableFetch();
    await renderFresh("binance");
    fillAndSubmit("binance");
    await advance(MOUNT_DELAY_MS + 1);

    const shown = card()!;
    expect(shown).toHaveTextContent(CHECKING_BINANCE);
    // A 30s promise for a call that usually answers in two is an invented
    // expectation; the promise belongs to the arm that needs it.
    expect(shown.textContent).not.toMatch(/We wait up to \d+s/);
    expect(shown).not.toHaveTextContent(SIGNING_IN);
  });

  it("escalates at 40% and 75% of the venue's budget, and nothing goes red inside it", async () => {
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    await advance(MOUNT_DELAY_MS + 1);

    // Below the first rung: no queue disclosure, no escape control.
    expect(card()).not.toHaveTextContent(QUEUE_LINE);
    expect(screen.queryByRole("button", { name: STOP_WAITING })).toBeNull();

    // 40% of 120 000 ms = 48 000 ms.
    await advance(SERIALIZED_BUDGET_MS * 0.4);
    expect(card()).toHaveTextContent(QUEUE_LINE);
    expect(screen.getByRole("button", { name: STOP_WAITING })).toBeTruthy();
    expect(allClasses(card()!)).not.toContain("text-negative");

    // 75% of 120 000 ms = 90 000 ms.
    await advance(SERIALIZED_BUDGET_MS * 0.35);
    const slow = screen.getByText(SLOW_LINE_120, {
      ignore: "script, style, [role='status']",
    });
    expect(slow.getAttribute("class")).toContain("text-warning");
    expect(
      allClasses(card()!),
      "a negative (red) tone appeared while the wait is still INSIDE its budget. " +
        "Red asserts a permanent failure; this check may still answer correctly.",
    ).not.toContain("text-negative");
  });

  it("`Stop waiting` aborts the request, keeps every field, and says so in a NEUTRAL line", async () => {
    const signals = mockAbortableFetch();
    await renderFresh("binance");
    fillAndSubmit("binance");
    // 40% of the DEFAULT budget = 12 000 ms — the ladder is a fraction, so a
    // ccxt user reaches the escape control at 12s, not at 48s.
    await advance(DEFAULT_BUDGET_MS * 0.4);

    fireEvent.click(screen.getByRole("button", { name: STOP_WAITING }));
    await advance(0);

    // ⭐ THE REQUEST ACTUALLY STOPPED. Everything else here is local state and
    // would look identical while the POST ran on.
    expect(
      signals[0]?.aborted,
      "the in-flight request was not aborted. `Stop waiting` updated the screen " +
        "while the credential-carrying POST stayed on the wire — the control " +
        "would be a lie told in the user's favour.",
    ).toBe(true);

    expect(card()).toBeNull();
    const line = screen.getByTestId("wizard-connect-wait-cancelled");
    expect(line).toHaveTextContent(CANCELLED_LINE);
    // ⭐ 153.4 review CR-02 — THE CLAIM THIS BROWSER CANNOT MAKE. The abort stops
    // US listening; `create-with-key` runs on past validate into `encryptKey` and
    // the create RPC and reads no `request.signal`, so on any run where validate
    // then succeeds the key IS stored. A user cancelling at 48 s of a 120 s MT5
    // validate was told nothing was saved while their credential was being
    // written. Asserted as a PROPERTY (no server-outcome claim), not as the
    // absence of one sentence, so a reworded version of the same lie also reds.
    expect(
      line.textContent,
      "the cancelled line asserts a SERVER-SIDE outcome this browser cannot " +
        "know. Aborting the fetch does not cancel the invocation, and the route " +
        "continues into encryptKey + the create RPC.",
    ).not.toMatch(/nothing (was|is) (saved|stored)|was not (saved|stored)/i);
    // ⛔ NOT an error envelope and ⛔ not red: the user chose this and nothing
    // failed (DESIGN.md §Semantic-color gates).
    expect(screen.queryByTestId("error-envelope")).toBeNull();
    expect(line.closest('[role="alert"]')).toBeNull();
    expect(line.getAttribute("class")).not.toContain("text-negative");

    // Nothing was lost: the typed credentials are still on the form.
    expect(
      (screen.getByPlaceholderText("Paste the read-only key") as HTMLInputElement)
        .value,
    ).toBe("AK_LIVE_xxx");
    expect(
      (screen.getByPlaceholderText("Paste the secret") as HTMLInputElement).value,
    ).toBe("SECRET_xxx");

    // Focus lands on the control the user will press next, not on <body>.
    expect(document.activeElement).toBe(
      screen.getByTestId("wizard-connect-submit"),
    );
  });

  it("`Stop waiting` asks for no confirmation — there is nothing to confirm", async () => {
    // `validate-key` is strictly pre-encrypt / pre-RPC: nothing is persisted
    // server-side, so a confirmation step on the one control whose purpose is
    // escaping a stall is the opposite of the affordance.
    mockAbortableFetch();
    await renderFresh("binance");
    fillAndSubmit("binance");
    await advance(DEFAULT_BUDGET_MS * 0.4);

    fireEvent.click(screen.getByRole("button", { name: STOP_WAITING }));
    await advance(0);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /are you sure|confirm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: STOP_WAITING })).toBeNull();
  });

  it("a user cancel is NOT recorded as a seam failure", async () => {
    // The funnel and the screen must not be able to disagree. A deliberate
    // cancel logged as `wizard_error` tells an operator MT5 is failing when a
    // user simply chose not to wait (T-153.4-15).
    mockAbortableFetch();
    await renderFresh("binance");
    fillAndSubmit("binance");
    await advance(DEFAULT_BUDGET_MS * 0.4);

    fireEvent.click(screen.getByRole("button", { name: STOP_WAITING }));
    await advance(0);

    expect(wizardErrorCalls()).toEqual([]);
  });

  it("⭐ the browser does NOT give up while the route is still encrypting and storing the key", async () => {
    // ⭐ 153.4 review CR-01 — THE ASSERTION THE SHIPPED DEADLINE FAILED.
    //
    // The browser aborts a ROUTE, not a seam call, and `create-with-key` spends
    // `validateKey` THEN `encryptKey` THEN the create RPC — and reads no
    // `request.signal`, so the abort has no server-side effect whatsoever. A
    // deadline of `budget + grace` (135 000 ms here) sits BELOW the route's own
    // worst case, which meant it was reachable almost exclusively in the window
    // where validate had already SUCCEEDED and the route was storing the key. The
    // user was then shown "Nothing was saved — your key was not stored", and the
    // funnel recorded a seam deadline, for a request that was at that moment
    // writing their `api_keys` row.
    //
    // 149 999 ms is inside that window: past the old deadline, short of the new
    // one. Nothing may have happened yet.
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    await advance(SERIALIZED_BUDGET_MS + ABORT_GRACE_MS + 1);

    expect(
      screen.queryByTestId("error-envelope"),
      "the browser gave up 30 seconds before the route it is waiting on does. " +
        "Every second in this window is a request that has PASSED validate and " +
        "is encrypting and storing the key — and the verdict rendered here " +
        "tells the user nothing was saved.",
    ).toBeNull();
    expect(
      wizardErrorCalls(),
      "a seam deadline was reported to the funnel for a request that is still " +
        "running INSIDE its route's budget. An operator reads this to decide " +
        "whether the seam is healthy.",
    ).toEqual([]);
    // Still waiting, and still saying so.
    expect(card()).not.toBeNull();
    expect(screen.getByTestId("wizard-connect-submit")).toBeDisabled();
  });

  it("a wait past the budget ends in a STATED verdict that names the budget and offers no Retry", async () => {
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    // The browser gives up LAST: after the whole ROUTE's budget (validate +
    // encrypt) plus its own grace, never at the validate budget itself —
    // aborting there could cut off a verdict already on the wire, or a key
    // already being stored (153.4 review CR-01).
    await advance(SERIALIZED_DEADLINE_MS + 1);

    expect(card(), "the card outlived the request it describes").toBeNull();
    const envelope = screen.getByTestId("error-envelope");
    expect(envelope).toHaveAttribute(
      "data-error-code",
      "SEAM_DEADLINE_EXCEEDED",
    );
    // The budget WE granted, named — hand-typed here, read from the budget
    // module there.
    expect(envelope).toHaveTextContent(
      "We gave your broker 120 seconds to answer and it did not.",
    );
    expect(envelope).toHaveTextContent("Nothing was saved");
    // ⭐ THE ABSENCE IS THE FIX (PATTERNS Shared Pattern B). The code carries
    // no recoverable action, so `buildEnvelope` derives `recoverable: false` and
    // no Retry renders. A Retry here would offer to re-run a two-minute wait
    // that just proved it does not fit.
    expect(
      screen.queryByRole("button", { name: "Retry" }),
      "a Retry control was offered for a check that just spent its whole budget",
    ).toBeNull();
  });

  it("the deadline path DOES record a wizard_error, carrying the code the screen shows", async () => {
    // ⚠️ ITS OWN CASE, deliberately, and not an extra assertion on the envelope
    // one above. Both must be able to red INDEPENDENTLY: an envelope assertion
    // that throws first would hide a funnel still reporting SERVICE_UNREACHABLE,
    // and the funnel is what an operator reads to decide whether the seam is
    // healthy. The screen and the funnel must not be able to disagree.
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    await advance(SERIALIZED_DEADLINE_MS + 1);

    expect(wizardErrorCalls()).toEqual([
      {
        wizard_session_id: SESSION,
        step: "connect_key",
        code: "SEAM_DEADLINE_EXCEEDED",
      },
    ]);
  });

  it("⭐ the deadline verdict tells the user their key details are still on the page", async () => {
    // ⛔ THE UNPAID GATE, PAID. That reassurance bullet declares
    // REQUIRES_CONNECT_SURFACE and ABSENCE SUPPRESSES it, so a step that emits
    // this code without passing `surface: "connect"` renders an envelope that is
    // silent about the credentials the user just spent two minutes typing —
    // the worst outcome this phase can produce, and a silent one.
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");
    await advance(SERIALIZED_DEADLINE_MS + 1);

    expect(screen.getByTestId("error-envelope")).toHaveTextContent(
      "Your key details are still on this page.",
    );
  });

  it("⭐ an MT5 failure never offers a remedy that presupposes another venue (D-17)", async () => {
    // The `venue` half of the same call site. Absence renders the substitutable
    // remedy unconditionally, so an MT5 user — whose broker account IS the venue
    // — was told to "switch to a different exchange".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_NETWORK_TIMEOUT" }, 504),
    );
    await renderFresh("mt5");
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
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveTextContent(
      "This is your broker account, so there is no other venue to try.",
    );
    expect(
      envelope,
      "an unwinnable remedy reached a venue that IS the user's account",
    ).not.toHaveTextContent("switch to a different exchange");
  });

  it("the submit button stays mounted reading ASCII `Validating...` for the whole wait", async () => {
    // ⚠️ SWEPT BACKWARD against `e2e/` — the busy label is read by a Playwright
    // assertion (`getByRole("button", { name: /Validating/i })`), which needs the
    // button MOUNTED and still reading it. The long-wait card renders BESIDE it,
    // never instead of it, and the spelling stays ASCII (D-21).
    mockAbortableFetch();
    await renderFresh("mt5");
    fillAndSubmit("mt5");

    for (const step of [MOUNT_DELAY_MS + 1, SERIALIZED_BUDGET_MS * 0.4, SERIALIZED_BUDGET_MS * 0.35]) {
      await advance(step);
      const submit = screen.getByTestId("wizard-connect-submit");
      expect(submit).toBeInTheDocument();
      expect(submit).toHaveTextContent(BUSY_LABEL);
      expect(submit).toBeDisabled();
    }
    expect(screen.getByTestId("validate-wait-card").textContent).not.toContain(
      "…",
    );
  });

  it("the form reports aria-busy while in flight and drops it afterwards", async () => {
    mockAbortableFetch();
    const { container } = { container: document.body };
    await renderFresh("binance");
    fillAndSubmit("binance");
    await advance(MOUNT_DELAY_MS + 1);

    const form = container.querySelector("form")!;
    expect(form.getAttribute("aria-busy")).toBe("true");

    await advance(DEFAULT_BUDGET_MS * 0.4);
    fireEvent.click(screen.getByRole("button", { name: STOP_WAITING }));
    await advance(0);

    // Absent, not `"false"` — the attribute's absence and its false value are
    // the same state to AT, and one of the two is noise.
    expect(form.getAttribute("aria-busy")).toBeNull();
  });

  it("the FAST path is unchanged: no card, no cancelled line, the same success callback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          strategy_id: "33333333-3333-3333-3333-333333333333",
          api_key_id: "44444444-4444-4444-4444-444444444444",
        },
        200,
      ),
    );
    const { onSuccess } = await renderFresh("binance");
    fillAndSubmit("binance");
    await advance(0);

    expect(onSuccess).toHaveBeenCalledWith({
      strategyId: "33333333-3333-3333-3333-333333333333",
      apiKeyId: "44444444-4444-4444-4444-444444444444",
      exchange: "binance",
    });
    // The mount timer was cleared by the completion, so time passing changes
    // nothing.
    await advance(5_000);
    expect(card()).toBeNull();
    expect(screen.queryByTestId("wizard-connect-wait-cancelled")).toBeNull();
    expect(wizardErrorCalls()).toEqual([]);
  });

  it("⭐ this file's `120` is HAND-TYPED, not derived from the module under test", async () => {
    // ⚠️ THE ORACLE-INDEPENDENCE GUARD. Every duration above is a hand-typed
    // twin of a figure the SEAM grants. If this file ever imported
    // `validate-budget.ts` — or divided a millisecond budget by 1000 — the copy
    // assertions would follow a budget change silently, and a card promising a
    // wait the seam no longer honours would ship green. The repo has paid for
    // self-referential oracles before; this is the cheap fence.
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx",
      ),
      "utf8",
    );
    // Vacuity floor: the thing the guard is about must be present.
    expect(source).toContain("120s");
    expect(source.length).toBeGreaterThan(1_000);

    // ⚠️ AN IMPORT-EDGE SCAN, NOT A SUBSTRING GREP — the house form for
    // "module X must not import module Y" (`seam-ssr-exposure.pin.test.ts`, and
    // `validate-budget.test.ts` for this very module). A substring check is
    // satisfied FOREVER by its own assertion text: the sentence that names the
    // forbidden module is itself an occurrence of it, and the natural "fix" is
    // to weaken the guard until it stops complaining. This reads edges.
    const specifiers = importSpecifiers(source);
    expect(
      specifiers.filter((s) => s.includes("validate-budget")),
      "this test file imports the budget module. Its expectations would then " +
        "assert the component equals itself, and a budget that moved would take " +
        "the copy assertions along with it.",
    ).toEqual([]);
    // Self-test: the extractor sees an EDGE and not a mention. Without this, an
    // extractor that matched nothing at all would pass the assertion above.
    //
    // ⚠️ THE POSITIVE FIXTURE IS BUILT, NOT WRITTEN OUT, and that is the same
    // collision one level down: a literal `from "…budget"` sitting in this file
    // IS an edge to the whole-file scan above, so spelling the fixture would
    // make the guard fail on itself. Interpolating the quote keeps the fixture
    // edge-shaped to the extractor and invisible to the scan.
    const q = '"';
    expect(
      importSpecifiers(`import { x } from ${q}@/lib/wizard/validate-budget${q};`),
    ).toEqual(["@/lib/wizard/validate-budget"]);
    expect(
      importSpecifiers('const s = "@/lib/wizard/validate-budget"; // a mention'),
    ).toEqual([]);
    // …and it really did read THIS file's edges.
    expect(specifiers).toContain("@testing-library/react");
    expect(specifiers).toContain("./ConnectKeyStep");

    expect(
      /\/\s*1_?000/.test(source),
      "this test file converts milliseconds to seconds. The seconds figure in " +
        "copy must be typed out, so a budget change is a visible, reviewed edit.",
    ).toBe(false);
  });
});
