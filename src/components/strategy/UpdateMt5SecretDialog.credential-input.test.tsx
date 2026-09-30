import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateMt5SecretDialog } from "./UpdateMt5SecretDialog";

/**
 * Phase 169.3-06 (D-76, scope WIDENED 2026-09-30 by orchestrator decision) on
 * the MT5 "Update password" dialog.
 *
 * Attributes only, NO strip. The lone masked "New password" field needs the
 * masked-input opt-out, or a browser treats it as a saved-login target. But the
 * rotate-secret path (`PATCH /api/keys/[id]/rotate-secret` and the Python seam)
 * stores the password exactly as sent and never trims it, so a client strip
 * would change the stored password compared with today.
 */

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
  vi.restoreAllMocks();
});

function renderDialog() {
  const onUpdated = vi.fn();
  const onClose = vi.fn();
  render(
    <UpdateMt5SecretDialog open apiKeyId="key-1" onClose={onClose} onUpdated={onUpdated} />,
  );
  return { onUpdated, onClose, input: screen.getByLabelText("New password") as HTMLInputElement };
}

describe("UpdateMt5SecretDialog: the New password input (D-76, attributes only)", () => {
  it("carries autocomplete=new-password and the four vendor ignore attributes, and is masked by default", () => {
    const { input } = renderDialog();
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("data-bwignore")).toBe("true");
    expect(input.getAttribute("data-lpignore")).toBe("true");
    expect(input.getAttribute("data-form-type")).toBe("other");
  });

  it("a pasted password is left exactly as pasted and sent unchanged, because the rotate-secret route and the Python seam store it as sent and never trim, so a client strip would change the stored password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { input, onUpdated } = renderDialog();
    const user = userEvent.setup();
    await user.click(input);
    await user.paste("  pw TEST 4  ");
    expect(input.value).toBe("  pw TEST 4  ");

    fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/keys/key-1/rotate-secret");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string).new_secret).toBe("  pw TEST 4  ");
  });
});
