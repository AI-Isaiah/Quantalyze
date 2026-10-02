/** @vitest-environment jsdom */
/**
 * Phase 169.3-06 (D-76) on the single-key wizard step (also State A of
 * MultiKeyConnectStep, which delegates to this component). It closes the two
 * ROUTED IN 2026-09-27 items on this surface:
 *
 * 1. Autofill: `autoComplete="off"` on the key and the masked secret did not
 *    stop a saved site login being filled into them. Masked credential inputs
 *    now carry `autocomplete="new-password"` and every credential input carries
 *    the vendor ignore attributes.
 * 2. Pasted whitespace: key and secret strip bulk-arriving leading/trailing
 *    whitespace (including U+200B and U+FEFF). The passphrase slot is never
 *    stripped: the OKX passphrase is user-chosen, and MT5's "Broker server"
 *    keeps its raw onChange too.
 *
 * The passphrase slot's attribute set follows `passphraseSecret` (D-76
 * refinement, plan-check round 1): the masked OKX passphrase gets the secret
 * set; MT5's visible "Broker server" gets the key set.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConnectKeyStep } from "./ConnectKeyStep";

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

const SESSION = "wizard-session-169306";

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

function renderStep() {
  return render(<ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
}

function secretInput(container: HTMLElement) {
  const el = container.querySelector("#wizard-api-secret");
  if (!(el instanceof HTMLInputElement)) throw new Error("#wizard-api-secret not rendered");
  return el;
}

async function selectOkx(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^OKX\b/ }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ConnectKeyStep credential inputs: no saved-login autofill (D-76)", () => {
  it("the API Key input keeps autocomplete=off and carries the four vendor ignore attributes", () => {
    renderStep();
    const key = screen.getByLabelText("API Key");
    expect(key.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(key);
  });

  it("the secret input carries autocomplete=new-password and the vendor ignore attributes, and starts masked", () => {
    const { container } = renderStep();
    const secret = secretInput(container);
    expect(secret.type).toBe("password");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(secret);
  });

  it("the OKX passphrase input carries autocomplete=new-password and the vendor ignore attributes", async () => {
    renderStep();
    const user = userEvent.setup();
    await selectOkx(user);
    const passphrase = screen.getByLabelText("OKX Passphrase");
    expect(passphrase.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(passphrase);
  });

  it("with OKX selected, every rendered password input carries autocomplete=new-password, so none is a saved-login target", async () => {
    const { container } = renderStep();
    const user = userEvent.setup();
    await selectOkx(user);
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBe(2);
    for (const input of passwordInputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });

  it("MT5's Broker server (the passphrase slot, passphraseSecret false) gets the key set, autocomplete=off, because it is a visible non-secret field and new-password would invite a password-generation offer there", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    const { ConnectKeyStep: Fresh } = await import("./ConnectKeyStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("wizard-exchange-mt5"));
    const server = screen.getByLabelText("Broker server") as HTMLInputElement;
    expect(server.type).toBe("text");
    expect(server.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(server);
  });
});

describe("ConnectKeyStep credential inputs: pasted whitespace is stripped from key and secret (D-76)", () => {
  it("pasting into API Key strips leading spaces and a trailing line break", async () => {
    renderStep();
    const user = userEvent.setup();
    const key = screen.getByLabelText("API Key") as HTMLInputElement;
    await user.click(key);
    await user.paste("  AK_TEST_1\n");
    expect(key.value).toBe("AK_TEST_1");
  });

  it("pasting into the secret strips a leading U+200B and a trailing U+FEFF and space", async () => {
    const { container } = renderStep();
    const user = userEvent.setup();
    const secret = secretInput(container);
    await user.click(secret);
    await user.paste("​SECRET_TEST﻿ ");
    expect(secret.value).toBe("SECRET_TEST");
  });

  it("typing an interior space into the secret keeps it, because keystrokes are never normalized", async () => {
    const { container } = renderStep();
    const user = userEvent.setup();
    const secret = secretInput(container);
    await user.click(secret);
    await user.type(secret, "ab cd");
    expect(secret.value).toBe("ab cd");
  });

  it("a pasted OKX passphrase is left exactly as pasted, because it is user-chosen and its whitespace can be significant", async () => {
    renderStep();
    const user = userEvent.setup();
    await selectOkx(user);
    const passphrase = screen.getByLabelText("OKX Passphrase") as HTMLInputElement;
    await user.click(passphrase);
    await user.paste("  pass phrase  ");
    expect(passphrase.value).toBe("  pass phrase  ");
  });
});
