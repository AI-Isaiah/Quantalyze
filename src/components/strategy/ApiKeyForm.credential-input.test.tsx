import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeyForm } from "./ApiKeyForm";

/**
 * Phase 169.3-06 (D-76) on the `/profile` Exchanges "Connect exchange" dialog.
 * `AllocatorExchangeManager.tsx` renders this form inside its "Connect exchange"
 * Modal (and `ApiKeyManager.tsx` renders it too). It closes the two
 * ROUTED IN 2026-09-27 items:
 *
 * 1. Autofill: a saved site login was filled into API Key and API Secret even
 *    with `autoComplete="off"` on both. Masked credential inputs now carry
 *    `autocomplete="new-password"` and every credential input carries the
 *    vendor ignore attributes, so no rendered password input is a saved-login
 *    target.
 * 2. Pasted whitespace: a key or secret pasted from a spreadsheet cell keeps
 *    its leading/trailing whitespace in the field while the server trims it.
 *    Key and secret now strip bulk-arriving whitespace (including U+200B and
 *    U+FEFF); the OKX passphrase is never stripped.
 */

const VENDOR_IGNORE_ATTRS: Record<string, string> = {
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
};

function expectVendorIgnore(el: HTMLElement) {
  for (const [name, value] of Object.entries(VENDOR_IGNORE_ATTRS)) {
    expect(el.getAttribute(name), name).toBe(value);
  }
}

function renderForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <ApiKeyForm onSubmit={onSubmit} onCancel={vi.fn()} loading={false} error={null} />,
  );
  return { onSubmit, ...utils };
}

function selectOkx() {
  fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "okx" } });
}

describe("ApiKeyForm credential inputs: no saved-login autofill (D-76)", () => {
  it("the API Key input keeps autocomplete=off and carries the four vendor ignore attributes", () => {
    renderForm();
    const key = screen.getByLabelText("API Key");
    expect(key.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(key);
  });

  it("the API Secret input carries autocomplete=new-password and the vendor ignore attributes, and starts masked", () => {
    renderForm();
    const secret = screen.getByLabelText("API Secret") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(secret);
  });

  it("the OKX passphrase input carries autocomplete=new-password and the vendor ignore attributes", () => {
    renderForm();
    selectOkx();
    const passphrase = screen.getByLabelText("Passphrase (OKX)");
    expect(passphrase.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(passphrase);
  });

  it("with OKX selected, every rendered password input carries autocomplete=new-password, so none is a saved-login target", () => {
    const { container } = renderForm();
    selectOkx();
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(2);
    for (const input of passwordInputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });
});

describe("ApiKeyForm credential inputs: pasted whitespace is stripped from key and secret (D-76)", () => {
  it("pasting into API Key strips leading spaces, a trailing U+200B and a line break", async () => {
    renderForm();
    const user = userEvent.setup();
    const key = screen.getByLabelText("API Key") as HTMLInputElement;
    await user.click(key);
    await user.paste("  AK_TEST_1​\n");
    expect(key.value).toBe("AK_TEST_1");
  });

  it("pasting into API Secret strips a leading U+FEFF, spaces and a trailing CRLF", async () => {
    renderForm();
    const user = userEvent.setup();
    const secret = screen.getByLabelText("API Secret") as HTMLInputElement;
    await user.click(secret);
    await user.paste("﻿  SECRET_TEST \r\n");
    expect(secret.value).toBe("SECRET_TEST");
  });

  it("submitting after the pastes passes exactly the stripped key and secret, so what is sent equals what the field shows", async () => {
    const { onSubmit } = renderForm();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Test label" } });
    await user.click(screen.getByLabelText("API Key"));
    await user.paste("  AK_TEST_1​\n");
    await user.click(screen.getByLabelText("API Secret"));
    await user.paste("﻿  SECRET_TEST \r\n");
    fireEvent.click(screen.getByRole("button", { name: "Connect Key" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      apiKey: "AK_TEST_1",
      apiSecret: "SECRET_TEST",
    });
  });

  it("typing an interior space into API Secret keeps it, because keystrokes are never normalized", async () => {
    renderForm();
    const user = userEvent.setup();
    const secret = screen.getByLabelText("API Secret") as HTMLInputElement;
    await user.click(secret);
    await user.type(secret, "ab cd");
    expect(secret.value).toBe("ab cd");
  });

  it("a pasted OKX passphrase is left exactly as pasted, because it is user-chosen and its whitespace can be significant", async () => {
    const { onSubmit } = renderForm();
    const user = userEvent.setup();
    selectOkx();
    const passphrase = screen.getByLabelText("Passphrase (OKX)") as HTMLInputElement;
    await user.click(passphrase);
    await user.paste("  pass phrase  ");
    expect(passphrase.value).toBe("  pass phrase  ");

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Test label" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "AK_TEST_1" } });
    fireEvent.change(screen.getByLabelText("API Secret"), { target: { value: "SECRET_TEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Key" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].passphrase).toBe("  pass phrase  ");
  });
});
