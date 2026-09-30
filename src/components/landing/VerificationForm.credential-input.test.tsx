/**
 * Phase 169.3-06 (D-76, WIDENED 2026-09-30 at plan-check round 1 by
 * orchestrator decision: a user-facing member of the same defect class) on the
 * anonymous verification form on `/`, rendered by `VerificationSection`.
 *
 * The API Key, masked API Secret and OKX Passphrase inputs carried no
 * autocomplete attribute and raw onChanges. Masked inputs now carry
 * `autocomplete="new-password"`, every credential input carries the vendor
 * ignore attributes, and key and secret strip bulk-arriving whitespace. The
 * passphrase is never stripped.
 *
 * `/api/verify-strategy` forwards the key raw and is unchanged (out of scope),
 * so here the client strip is what makes the posted value equal the field.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerificationForm } from "./VerificationForm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const VENDOR_IGNORE_ATTRS: Record<string, string> = {
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
};

function expectVendorIgnore(el: Element) {
  for (const [name, value] of Object.entries(VENDOR_IGNORE_ATTRS)) {
    expect(el.getAttribute(name), name).toBe(value);
  }
}

function renderForm() {
  const onResult = vi.fn();
  const utils = render(<VerificationForm onResult={onResult} />);
  return {
    ...utils,
    onResult,
    key: screen.getByLabelText("API Key") as HTMLInputElement,
    secret: screen.getByLabelText("API Secret") as HTMLInputElement,
  };
}

function selectOkx() {
  fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "okx" } });
}

function spyVerifyFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ verification_id: "vid-169306", public_token: "tok-169306" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

async function submitAndReadBody(
  fetchSpy: ReturnType<typeof spyVerifyFetch>,
  onResult: ReturnType<typeof vi.fn>,
) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "someone@example.com" },
  });
  fireEvent.submit(screen.getByRole("button", { name: /Verify My Strategy/i }));
  await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
  const call = (fetchSpy.mock.calls as unknown as [string, RequestInit][]).find(
    (c) => c[0] === "/api/verify-strategy",
  );
  if (!call) throw new Error("no POST to /api/verify-strategy");
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

describe("VerificationForm credential inputs: no saved-login autofill (D-76)", () => {
  it("the API Key input carries autocomplete=off and the four vendor ignore attributes", () => {
    const { key } = renderForm();
    expect(key.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(key);
  });

  it("the API Secret input carries autocomplete=new-password and the vendor ignore attributes, and is masked", () => {
    const { secret } = renderForm();
    expect(secret.type).toBe("password");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(secret);
  });

  it("the OKX passphrase input carries autocomplete=new-password and the vendor ignore attributes", () => {
    renderForm();
    selectOkx();
    const passphrase = screen.getByPlaceholderText("OKX API passphrase");
    expect(passphrase.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(passphrase);
  });

  it("with OKX selected, every password input in the form carries autocomplete=new-password, so none is a saved-login target", () => {
    const { container } = renderForm();
    selectOkx();
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(2);
    for (const input of passwordInputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });
});

describe("VerificationForm credential inputs: pasted whitespace is stripped from key and secret (D-76)", () => {
  it("pasting into API Key strips leading spaces, a trailing U+200B and a line break", async () => {
    const { key } = renderForm();
    const user = userEvent.setup();
    await user.click(key);
    await user.paste("  AK_TEST_5​\n");
    expect(key.value).toBe("AK_TEST_5");
  });

  it("pasting into API Secret strips a leading U+FEFF, spaces and a trailing CRLF", async () => {
    const { secret } = renderForm();
    const user = userEvent.setup();
    await user.click(secret);
    await user.paste("﻿ SECRET_TEST_5 \r\n");
    expect(secret.value).toBe("SECRET_TEST_5");
  });

  it("the posted api_key and api_secret equal the stripped fields, because the route forwards the key raw and the client strip is what makes the posted value equal the field", async () => {
    const fetchSpy = spyVerifyFetch();
    const { key, secret, onResult } = renderForm();
    const user = userEvent.setup();
    await user.click(key);
    await user.paste("  AK_TEST_5​\n");
    await user.click(secret);
    await user.paste("﻿ SECRET_TEST_5 \r\n");
    const body = await submitAndReadBody(fetchSpy, onResult);
    expect(body.api_key).toBe("AK_TEST_5");
    expect(body.api_secret).toBe("SECRET_TEST_5");
  });

  it("typing an interior space into API Secret keeps it, because keystrokes are never normalized", async () => {
    const { secret } = renderForm();
    const user = userEvent.setup();
    await user.click(secret);
    await user.type(secret, "ab cd");
    expect(secret.value).toBe("ab cd");
  });

  it("a pasted OKX passphrase is left exactly as pasted and posted unchanged, because it is user-chosen and its whitespace can be significant", async () => {
    const fetchSpy = spyVerifyFetch();
    const { key, secret, onResult } = renderForm();
    selectOkx();
    const user = userEvent.setup();
    const passphrase = screen.getByPlaceholderText("OKX API passphrase") as HTMLInputElement;
    await user.click(passphrase);
    await user.paste("  pass phrase  ");
    expect(passphrase.value).toBe("  pass phrase  ");
    fireEvent.change(key, { target: { value: "AK_TEST_5" } });
    fireEvent.change(secret, { target: { value: "SECRET_TEST_5" } });
    const body = await submitAndReadBody(fetchSpy, onResult);
    expect(body.passphrase).toBe("  pass phrase  ");
  });
});
