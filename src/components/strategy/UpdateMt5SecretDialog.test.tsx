import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { UpdateMt5SecretDialog } from "./UpdateMt5SecretDialog";

/**
 * Phase 164.5.3 / MT5CREDS Plan 05 — the shared dialog's own contract,
 * independent of which card hosts it.
 *
 * Pins:
 *   - Exactly one credential field (password only, D-03) — no login/server
 *     field anywhere in the DOM.
 *   - A validated 200 calls onUpdated() then onClose().
 *   - A non-2xx JSON failure renders ErrorEnvelope with that code's human
 *     message, keeps the dialog OPEN, and calls NEITHER callback.
 */

// Polyfill jsdom's missing HTMLDialogElement methods so <Modal> doesn't throw.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpdateMt5SecretDialog", () => {
  it("renders a single password-style field, no login or broker-server field", () => {
    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    // The one credential field.
    const secretInput = screen.getByLabelText("New password");
    expect(secretInput).toBeInTheDocument();
    expect(secretInput).toHaveAttribute("type", "password");

    // D-03: no login or broker-server field anywhere in the DOM.
    expect(screen.queryByLabelText(/login/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/server/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /login|server/i }),
    ).not.toBeInTheDocument();

    // Submit affordance present.
    expect(
      screen.getByRole("button", { name: /Update password/i }),
    ).toBeInTheDocument();
  });

  it("toggles the reveal state via the Show/Hide button (ApiKeyForm idiom)", () => {
    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    const secretInput = screen.getByLabelText("New password");
    expect(secretInput).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(secretInput).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("a validated 200 calls onUpdated() then onClose()", async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={onClose}
        onUpdated={onUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "correct-investor-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/keys/key-1/rotate-secret",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ new_secret: "correct-investor-password" }),
      }),
    );
  });

  it("a non-2xx JSON failure renders ErrorEnvelope, stays open, calls neither callback", async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "KEY_MT5_MASTER_PASSWORD",
          error: "This is a master password.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={onClose}
        onUpdated={onUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "master-password-not-investor" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });

    // The KEY_MT5_MASTER_PASSWORD envelope's human message (wizardErrors.ts).
    await waitFor(() => {
      expect(
        screen.getByText("This MT5 login can place trades."),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("error-envelope")).toBeInTheDocument();

    // Dialog stays open — the Modal's <dialog> element carries `open`.
    expect(document.querySelector("dialog")).toHaveAttribute("open");

    expect(onUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an unrecognised/absent code still renders the honest UNKNOWN envelope, never throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "some-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument();
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        "UNKNOWN",
      );
    });
  });

  // 167 review round 1 / WR-02. This dialog's route is MT5-only by
  // construction, so its envelopes must be built WITH the MT5 venue. Before the
  // fix `buildEnvelope` got no context and every venue-gated bullet took its
  // venue-unknown answer: the MT5 investor-password remedy was suppressed on
  // the one surface guaranteed to be MT5, and the rate-limit card told an MT5
  // owner to try "a different exchange account". Expected text is typed here,
  // not read out of the copy table it pins.
  async function submitAndFailWith(code: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code }), {
          status: 424,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "some-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        code,
      );
    });
    return screen.getByTestId("error-envelope");
  }

  it("KEY_SIGN_IN_FAILED renders the MT5 investor-password bullet (venue passed)", async () => {
    const envelope = await submitAndFailWith("KEY_SIGN_IN_FAILED");
    expect(envelope.textContent).toContain(
      "For MT5 that is the investor (read-only) password: your broker can reset it, and changing the master password changes it too.",
    );
    // Non-vacuity: the unconditional bullets still render beside it, so the
    // assertion above is about the gated slot, not about an empty list.
    expect(envelope.textContent).toContain(
      "Open this account at the venue and confirm its credentials are current",
    );
  });

  it("KEY_RATE_LIMIT does not tell an MT5 owner to try a different exchange account", async () => {
    const envelope = await submitAndFailWith("KEY_RATE_LIMIT");
    expect(envelope.textContent).not.toContain(
      "try a different exchange account",
    );
    expect(envelope.textContent).toContain(
      "This is your broker account, so there is no other venue to try.",
    );
  });

  it("the submit button is disabled while the field is empty", () => {
    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Update password/i }),
    ).toBeDisabled();
  });

  it("a rejected fetch (network failure) renders UNKNOWN, calls neither callback, and never logs the password", async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    // A per-request secret with a distinctive, synthetic shape — never a
    // real credential (repo is public). Long enough that an accidental
    // substring match would be unmistakable in the assertion below.
    const SYNTHETIC_PASSWORD = "sYnTh3tic-N3tw0rk-F41lure-Pr0be-99887766";
    // The rejection embeds the secret in its OWN message — modelling the
    // documented risk this fix defends against (undici/V8 inlining a window
    // of the outgoing request into a thrown error's text), not a generic
    // "Failed to fetch". Without this the rejection carries nothing the
    // redaction could ever strip, and assertion (c) below would pass
    // whether or not the redaction call ran at all.
    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError(
        `Failed to fetch: request body {"new_secret":"${SYNTHETIC_PASSWORD}"}`,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={onClose}
        onUpdated={onUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: SYNTHETIC_PASSWORD },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });

    // (a) the UNKNOWN envelope renders.
    await waitFor(() => {
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument();
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        "UNKNOWN",
      );
    });

    // (b) neither callback fires — nothing was persisted on this arm.
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // (c) THE ASSERTION THAT MATTERS: the synthetic password never appears
    // anywhere in the captured console output. Would fail loudly if the
    // scrubSeamError(err, [newSecret]) redaction were removed and the raw
    // caught value (or the request body it can carry) were logged instead.
    const allConsoleErrorText = consoleErrorSpy.mock.calls
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(allConsoleErrorText).not.toContain(SYNTHETIC_PASSWORD);
    // The redaction DID run — a log line was produced, it just doesn't carry
    // the secret. Without this, a no-op console mock would pass (a) trivially.
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("re-pointing the dialog at a different apiKeyId clears a prior typed secret and error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-1"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "some-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("error-envelope")).toBeInTheDocument();
    });

    rerender(
      <UpdateMt5SecretDialog
        open
        apiKeyId="key-2"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("error-envelope")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });
});
