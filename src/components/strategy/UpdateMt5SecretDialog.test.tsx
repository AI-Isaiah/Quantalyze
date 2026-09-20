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
