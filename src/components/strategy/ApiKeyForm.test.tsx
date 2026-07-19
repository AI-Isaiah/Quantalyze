import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeyForm } from "./ApiKeyForm";

/**
 * Reveal-toggle behaviour for the API Secret field. Motivated by dogfooding:
 * deribit rejects a mistyped secret as `invalid_credentials`, and a permanently
 * masked field gives the user no way to catch the typo. The toggle must flip the
 * field between masked (`type=password`) and visible (`type=text`), and — because
 * this is a credential form that scrubs plaintext on every close path — the
 * reveal must reset to masked when the form is cancelled, so a reopened form
 * never starts with a secret on screen.
 */
function renderForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <ApiKeyForm onSubmit={onSubmit} onCancel={onCancel} loading={false} error={null} />,
  );
  const secret = screen.getByLabelText("API Secret") as HTMLInputElement;
  return { onSubmit, onCancel, secret };
}

describe("ApiKeyForm — API Secret reveal toggle", () => {
  it("starts masked and flips password ↔ text on Show/Hide", () => {
    const { secret } = renderForm();
    expect(secret.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show API secret" }));
    expect(secret.type).toBe("text");
    expect(
      screen.getByRole("button", { name: "Hide API secret" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide API secret" }));
    expect(secret.type).toBe("password");
  });

  it("re-masks the secret when the form is cancelled (no revealed secret survives a reopen)", () => {
    const { onCancel, secret } = renderForm();
    fireEvent.change(secret, { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: "Show API secret" }));
    expect(secret.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    // The toggle reset to masked, so a re-render can't show a stale plaintext.
    expect(
      screen.getByRole("button", { name: "Show API secret" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect((screen.getByLabelText("API Secret") as HTMLInputElement).type).toBe(
      "password",
    );
  });
});

/**
 * Phase 122 / SFOX-08 — sfox-aware ApiKeyForm (token-only + F3-honest footer).
 *
 * The Select auto-widens via EXCHANGES (OQ4) when NEXT_PUBLIC_SFOX_ENABLED flips,
 * but the form body must handle sfox's token-only shape: the API Key input
 * relabels to "API Token", the secret input (+ its Show/Hide toggle) is not
 * rendered, submit proceeds with apiSecret "", and the footer states the honest
 * F3 read-only claim. Non-sfox exchanges keep the "will be rejected" copy — the
 * scope-probe claim is TRUE for ccxt exchanges.
 *
 * EXCHANGES is a module-scope const read from the env-gated closed-sets, so
 * flag-ON renders stub the env, reset the registry, and dynamic-import the form.
 */
describe("Phase 122 — ApiKeyForm sfox token-only (SFOX-08)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("flag OFF (default): the Select offers exactly the four exchanges, no sfox", () => {
    render(
      <ApiKeyForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error={null}
      />,
    );
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["binance", "okx", "bybit", "deribit"]);
    expect(options).not.toContain("sfox");
  });

  it("flag ON: the Select offers sFOX (value sfox)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ApiKeyForm: Fresh } = await import("./ApiKeyForm");
    render(
      <Fresh
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error={null}
      />,
    );
    const sfox = screen.getByRole("option", {
      name: "sFOX",
    }) as HTMLOptionElement;
    expect(sfox.value).toBe("sfox");
  });

  it("flag ON + sfox selected: relabels to API Token, drops the secret input, honest footer", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ApiKeyForm: Fresh } = await import("./ApiKeyForm");
    render(
      <Fresh
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        defaultExchange="sfox"
      />,
    );
    // Key input relabels; NO secret input / toggle for sfox.
    expect(screen.getByLabelText("API Token")).toBeInTheDocument();
    expect(screen.queryByLabelText("API Secret")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /API secret/i }),
    ).toBeNull();
    // F3 honest footer: read-only by our adapter + no per-key scope check.
    expect(screen.getByText(/read-only by our adapter/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/trading or withdrawal permissions will be rejected/i),
    ).toBeNull();
    // F6 (Phase 122): the footer links to the /security#sfox-readonly guide.
    const guideLink = screen.getByRole("link", { name: /sFOX read-only key guide/i });
    expect(guideLink).toHaveAttribute("href", "/security#sfox-readonly");
  });

  it("flag ON + sfox selected: submits with apiSecret as empty string", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ApiKeyForm: Fresh } = await import("./ApiKeyForm");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Fresh
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        defaultExchange="sfox"
      />,
    );
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Main sFOX" },
    });
    fireEvent.change(screen.getByLabelText("API Token"), {
      target: { value: "SFOX_TOKEN_xxx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Key" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        exchange: "sfox",
        apiKey: "SFOX_TOKEN_xxx",
        apiSecret: "",
      }),
    );
  });

  it("flag ON + non-sfox: the secret input is required and the footer copy is unchanged", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    vi.resetModules();
    const { ApiKeyForm: Fresh } = await import("./ApiKeyForm");
    render(
      <Fresh
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        defaultExchange="binance"
      />,
    );
    expect(screen.getByLabelText("API Secret")).toBeInTheDocument();
    expect(
      screen.getByText(/trading or withdrawal permissions will be rejected/i),
    ).toBeInTheDocument();
  });
});
