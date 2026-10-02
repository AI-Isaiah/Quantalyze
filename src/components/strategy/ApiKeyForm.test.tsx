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

/**
 * Phase 167.2 / KCS-01 — the optional `submitBlockedReason` prop.
 *
 * WHY. On the strategy key card, an Add Key submitted while a tracked sync
 * attempt is live would start a second sync beside it, and the card holds one
 * attempt at a time. The key card passes the reason; the form disables its
 * submit, ties the reason to it with `aria-describedby`, and refuses the
 * Enter-key submit the same way (the NEW-C37-02 lesson: a disabled button does
 * not stop Enter inside an input).
 *
 * WHY OPTIONAL. The form is shared with `AllocatorExchangeManager`, which
 * passes nothing and must render exactly as before (RESEARCH P6).
 *
 * The reason strings below are HAND-TYPED synthetic values: this component
 * renders whatever it is given, and the locked copy is pinned where it is
 * built (`ApiKeyManager.test.tsx`).
 */
describe("ApiKeyForm — KCS-01 submitBlockedReason", () => {
  const REASON =
    'Wait for the sync of "Example Bybit" to finish before connecting another key.';

  function fillForm() {
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Example Label" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "example-key" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "example-secret" },
    });
  }

  it("blocked: Connect Key is disabled, described by the reason, and neither a click nor Enter submits", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ApiKeyForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        submitBlockedReason={REASON}
      />,
    );
    fillForm();

    const submit = screen.getByRole("button", { name: "Connect Key" });
    expect(submit).toBeDisabled();
    // The label and the style of the button are unchanged; only the state is.
    expect(submit).toHaveTextContent("Connect Key");
    expect(submit).toHaveAccessibleDescription(REASON);
    const describedBy = submit.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const line = document.getElementById(describedBy!);
    expect(line?.tagName).toBe("P");
    expect(line?.textContent).toBe(REASON);
    expect(line).toHaveClass("text-xs", "text-text-muted", "mt-3");

    fireEvent.click(submit);
    // The Enter-key path: a submit event on the form itself.
    fireEvent.submit(submit.closest("form")!);
    await Promise.resolve();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("the reason renders after the form's error line when both are present", () => {
    render(
      <ApiKeyForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error="Example error"
        submitBlockedReason={REASON}
      />,
    );
    const errorLine = screen.getByText("Example error");
    const reasonLine = screen.getByText(REASON);
    expect(
      errorLine.compareDocumentPosition(reasonLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("unblocking unmounts the line and enables Connect Key, which then submits", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ApiKeyForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        submitBlockedReason={REASON}
      />,
    );
    rerender(
      <ApiKeyForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        submitBlockedReason={null}
      />,
    );
    expect(screen.queryByText(REASON)).toBeNull();
    const submit = screen.getByRole("button", { name: "Connect Key" });
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveAttribute("aria-describedby");

    fillForm();
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("CONTROL: without the prop the form renders as before (no caption, enabled submit, no aria-describedby)", () => {
    const { container, unmount } = render(
      <ApiKeyForm onSubmit={vi.fn()} onCancel={vi.fn()} loading={false} error={null} />,
    );
    const submit = screen.getByRole("button", { name: "Connect Key" });
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveAttribute("aria-describedby");
    // The footer caption is the only paragraph: no reason line was added.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    // React's useId values differ per mount; everything else must match.
    const normalise = (html: string) => html.replace(/_r_[0-9a-z]+_|«[^»]*»|:r[0-9a-z]+:/g, "ID");
    const withoutProp = normalise(container.innerHTML);
    unmount();

    // An explicit null renders the same DOM as an absent prop.
    const { container: explicitNull } = render(
      <ApiKeyForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
        error={null}
        submitBlockedReason={null}
      />,
    );
    expect(normalise(explicitNull.innerHTML)).toBe(withoutProp);
  });
});
