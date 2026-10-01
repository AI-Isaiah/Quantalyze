import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyForm } from "./StrategyForm";

/**
 * Phase 169.3-06 (D-76, scope WIDENED 2026-09-30 by orchestrator decision: the
 * founder's standing rule to close a defect class across its whole surface) on
 * the `/strategies/[id]/edit` "Connect Exchange API Key" modal in
 * StrategyForm.
 *
 * Same defect class as the routed `/profile` dialog: `autoComplete="off"` on the
 * masked secret and OKX passphrase does not stop saved-login autofill, and a
 * pasted key or secret kept its leading/trailing whitespace in the field while
 * `/api/keys/validate-and-encrypt` trims it server-side (`trimCredential`).
 * Key and secret now strip bulk-arriving whitespace; the OKX passphrase is
 * never stripped.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
    },
    from: (table: string) => {
      if (table === "discovery_categories") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

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

beforeEach(() => {
  // jsdom lacks HTMLDialogElement methods the <Modal> uses on mount.
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function openModal() {
  render(<StrategyForm mode="create" />);
  fireEvent.click(screen.getByRole("button", { name: /connect api key/i }));
  const key = screen.getByPlaceholderText("Your read-only API key") as HTMLInputElement;
  const secret = screen.getByPlaceholderText("Your API secret") as HTMLInputElement;
  const dialog = key.closest("dialog");
  if (!dialog) throw new Error("the Connect Exchange API Key modal has no dialog element");
  return { key, secret, dialog };
}

function selectOkx(dialog: HTMLElement) {
  const select = dialog.querySelector("select");
  if (!select) throw new Error("the modal's Exchange select is not rendered");
  fireEvent.change(select, { target: { value: "okx" } });
}

function spyValidateFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        api_key_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        valid: true,
        read_only: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function submitAndReadBody(fetchSpy: ReturnType<typeof spyValidateFetch>) {
  fireEvent.click(screen.getByRole("button", { name: "Connect Key" }));
  await screen.findByText("Read-only API key verified and connected.");
  const call = (fetchSpy.mock.calls as unknown as [string, RequestInit][]).find(
    (c) => c[0] === "/api/keys/validate-and-encrypt",
  );
  if (!call) throw new Error("no POST to /api/keys/validate-and-encrypt");
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

describe("StrategyForm Connect Exchange API Key modal: no saved-login autofill (D-76)", () => {
  it("the API Key input keeps autocomplete=off and carries the four vendor ignore attributes", () => {
    const { key } = openModal();
    expect(key.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(key);
  });

  it("the API Secret input carries autocomplete=new-password and the vendor ignore attributes, and is masked", () => {
    const { secret } = openModal();
    expect(secret.type).toBe("password");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(secret);
  });

  it("the OKX passphrase input carries autocomplete=new-password and the vendor ignore attributes", () => {
    const { dialog } = openModal();
    selectOkx(dialog);
    const passphrase = screen.getByPlaceholderText("OKX passphrase");
    expect(passphrase.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(passphrase);
  });

  it("with OKX selected, every password input in the modal carries autocomplete=new-password, so none is a saved-login target", () => {
    const { dialog } = openModal();
    selectOkx(dialog);
    const passwordInputs = dialog.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(2);
    for (const input of passwordInputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });
});

describe("StrategyForm Connect Exchange API Key modal: pasted whitespace is stripped from key and secret (D-76)", () => {
  it("pasting into API Key strips leading spaces, a trailing U+200B and a line break", async () => {
    const { key } = openModal();
    const user = userEvent.setup();
    await user.click(key);
    await user.paste("  AK_TEST_3​\n");
    expect(key.value).toBe("AK_TEST_3");
  });

  it("pasting into API Secret strips a leading U+FEFF, spaces and a trailing CRLF", async () => {
    const { secret } = openModal();
    const user = userEvent.setup();
    await user.click(secret);
    await user.paste("﻿ SECRET_TEST_3 \r\n");
    expect(secret.value).toBe("SECRET_TEST_3");
  });

  it("the posted api_key and api_secret equal the stripped fields, so what is sent equals what the field shows", async () => {
    const fetchSpy = spyValidateFetch();
    const { key, secret } = openModal();
    const user = userEvent.setup();
    await user.click(key);
    await user.paste("  AK_TEST_3​\n");
    await user.click(secret);
    await user.paste("﻿ SECRET_TEST_3 \r\n");
    const body = await submitAndReadBody(fetchSpy);
    expect(body.api_key).toBe("AK_TEST_3");
    expect(body.api_secret).toBe("SECRET_TEST_3");
  });

  it("typing an interior space into API Secret keeps it, because keystrokes are never normalized", async () => {
    const { secret } = openModal();
    const user = userEvent.setup();
    await user.click(secret);
    await user.type(secret, "ab cd");
    expect(secret.value).toBe("ab cd");
  });

  it("a pasted OKX passphrase is left exactly as pasted and posted unchanged, because it is user-chosen and its whitespace can be significant", async () => {
    const fetchSpy = spyValidateFetch();
    const { key, secret, dialog } = openModal();
    selectOkx(dialog);
    const user = userEvent.setup();
    const passphrase = screen.getByPlaceholderText("OKX passphrase") as HTMLInputElement;
    await user.click(passphrase);
    await user.paste("  pass phrase  ");
    expect(passphrase.value).toBe("  pass phrase  ");
    fireEvent.change(key, { target: { value: "AK_TEST_3" } });
    fireEvent.change(secret, { target: { value: "SECRET_TEST_3" } });
    const body = await submitAndReadBody(fetchSpy);
    expect(body.passphrase).toBe("  pass phrase  ");
  });
});
