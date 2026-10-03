/** @vitest-environment jsdom */
/**
 * Phase 169.3-06 (D-76) on the multi-key wizard panels (State B). State A
 * delegates to ConnectKeyStep and is covered by
 * `ConnectKeyStep.credential-input.test.tsx`. It closes the two ROUTED IN
 * 2026-09-27 items on this surface:
 *
 * 1. Autofill: `autoComplete="off"` on each panel's key and masked secret did
 *    not stop a saved site login being filled into them. Masked credential
 *    inputs now carry `autocomplete="new-password"` and every credential input
 *    carries the vendor ignore attributes.
 * 2. Pasted whitespace: each panel's key and secret strip bulk-arriving
 *    leading/trailing whitespace (including U+200B and U+FEFF). The passphrase
 *    slot is never stripped.
 *
 * The passphrase slot's attribute set follows `passphraseSecret` (D-76
 * refinement, plan-check round 1): the masked OKX passphrase gets the secret
 * set; MT5's visible "Broker server" gets the key set.
 */
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MultiKeyConnectStep } from "./MultiKeyConnectStep";

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

const SESSION = "11111111-1111-4111-8111-111111111111";

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

/** Render, then "+ Add another key window": panels 0 and 1 exist. */
function renderPanels() {
  const utils = render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
  fireEvent.click(screen.getByTestId("multi-add-key"));
  return { ...utils, panel1: screen.getByTestId("key-panel-1") };
}

function selectOkxInPanel1(panel1: HTMLElement) {
  fireEvent.click(within(panel1).getByTestId("key-1-exchange-okx"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  cleanup();
});

describe("MultiKeyConnectStep panel credential inputs: no saved-login autofill (D-76)", () => {
  it("a panel's API key input keeps autocomplete=off and carries the four vendor ignore attributes", () => {
    const { panel1 } = renderPanels();
    const key = within(panel1).getByTestId("key-1-api-key");
    expect(key.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(key);
  });

  it("a panel's secret input carries autocomplete=new-password and the vendor ignore attributes, and starts masked", () => {
    const { panel1 } = renderPanels();
    const secret = within(panel1).getByTestId("key-1-api-secret") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(secret);
  });

  it("a panel's OKX passphrase input carries autocomplete=new-password and the vendor ignore attributes", () => {
    const { panel1 } = renderPanels();
    selectOkxInPanel1(panel1);
    const passphrase = within(panel1).getByTestId("key-1-passphrase");
    expect(passphrase.getAttribute("autocomplete")).toBe("new-password");
    expectVendorIgnore(passphrase);
  });

  it("with OKX selected in a panel, every rendered password input in the step carries autocomplete=new-password, so none is a saved-login target", () => {
    const { container, panel1 } = renderPanels();
    selectOkxInPanel1(panel1);
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    // Panel 0's secret, panel 1's secret and panel 1's OKX passphrase.
    expect(passwordInputs.length).toBe(3);
    for (const input of passwordInputs) {
      expect(input.getAttribute("autocomplete")).toBe("new-password");
    }
  });

  it("an MT5 panel's Broker server (the passphrase slot, passphraseSecret false) gets the key set, autocomplete=off, because it is a visible non-secret field and new-password would invite a password-generation offer there", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    const { MultiKeyConnectStep: Fresh } = await import("./MultiKeyConnectStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    // State A on MT5 (the draft carry-over route), then "+ Add another key window".
    fireEvent.click(screen.getByTestId("wizard-exchange-mt5"));
    fireEvent.change(screen.getByLabelText("MT5 login"), { target: { value: "5000123" } });
    fireEvent.change(screen.getByLabelText("Broker server"), {
      target: { value: "TestBroker-Demo" },
    });
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel0 = screen.getByTestId("key-panel-0");
    const server = within(panel0).getByTestId("key-0-passphrase") as HTMLInputElement;
    expect(server.type).toBe("text");
    expect(server.getAttribute("autocomplete")).toBe("off");
    expectVendorIgnore(server);
  });
});

describe("MultiKeyConnectStep panel credential inputs: pasted whitespace is stripped from key and secret (D-76)", () => {
  it("pasting into a panel's API key strips leading spaces and a trailing CRLF", async () => {
    const { panel1 } = renderPanels();
    const user = userEvent.setup();
    const key = within(panel1).getByTestId("key-1-api-key") as HTMLInputElement;
    await user.click(key);
    await user.paste("  AK_TEST_2\r\n");
    expect(key.value).toBe("AK_TEST_2");
  });

  it("pasting into a panel's secret strips a leading U+FEFF and a trailing U+200B", async () => {
    const { panel1 } = renderPanels();
    const user = userEvent.setup();
    const secret = within(panel1).getByTestId("key-1-api-secret") as HTMLInputElement;
    await user.click(secret);
    await user.paste("﻿SECRET_TEST_2​");
    expect(secret.value).toBe("SECRET_TEST_2");
  });

  it("typing an interior space into a panel's secret keeps it, because keystrokes are never normalized", async () => {
    const { panel1 } = renderPanels();
    const user = userEvent.setup();
    const secret = within(panel1).getByTestId("key-1-api-secret") as HTMLInputElement;
    await user.click(secret);
    await user.type(secret, "ab cd");
    expect(secret.value).toBe("ab cd");
  });

  it("undo in a panel's secret keeps the typed interior space (R3 WR-01): `pass w` + undo stays `pass `, so typing `word` cannot post `password`", async () => {
    const { panel1 } = renderPanels();
    const user = userEvent.setup();
    const secret = within(panel1).getByTestId("key-1-api-secret") as HTMLInputElement;
    await user.click(secret);
    await user.type(secret, "pass w");
    // The browser's undo: the DOM value drops the `w` and the input event carries historyUndo.
    fireEvent.input(secret, { target: { value: "pass " }, inputType: "historyUndo" });
    expect(secret.value).toBe("pass ");
  });

  it("a pasted OKX passphrase is left exactly as pasted, because it is user-chosen and its whitespace can be significant", async () => {
    const { panel1 } = renderPanels();
    const user = userEvent.setup();
    selectOkxInPanel1(panel1);
    const passphrase = within(panel1).getByTestId("key-1-passphrase") as HTMLInputElement;
    await user.click(passphrase);
    await user.paste("  pass phrase  ");
    expect(passphrase.value).toBe("  pass phrase  ");
  });

  /** MT5 enabled, two panels, MT5 selected on panel 1. */
  async function renderPanel1OnMt5() {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    vi.resetModules();
    const { MultiKeyConnectStep: Fresh } = await import("./MultiKeyConnectStep");
    render(<Fresh wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel1 = screen.getByTestId("key-panel-1");
    fireEvent.click(within(panel1).getByTestId("key-1-exchange-mt5"));
    return panel1;
  }

  it("with MT5 selected in a panel, a pasted investor password is kept exactly as pasted (D-08), because the server now stores it verbatim and a client strip would be the only trim left", async () => {
    const panel1 = await renderPanel1OnMt5();
    const user = userEvent.setup();
    const secret = within(panel1).getByTestId("key-1-api-secret") as HTMLInputElement;
    await user.click(secret);
    await user.paste(" Inv Pw 7 "); // fabricated
    expect(
      secret.value,
      "since D-08 the server stores the MT5 password exactly as sent, so stripping " +
        "the paste here would store a password other than the one the user chose " +
        "(169.3 D-76's own exclusion rule, as for UpdateMt5SecretDialog)",
    ).toBe(" Inv Pw 7 ");
  });

  it("with MT5 selected in a panel, a pasted login is still stripped (D-08 exempts the password only)", async () => {
    const panel1 = await renderPanel1OnMt5();
    const user = userEvent.setup();
    const login = within(panel1).getByTestId("key-1-api-key") as HTMLInputElement;
    await user.click(login);
    await user.paste(" 5550001 "); // fabricated
    expect(
      login.value,
      "the MT5 login is a numeric account id; widening the verbatim exemption to " +
        "the key slot would let a pasted space reach the broker as part of it",
    ).toBe("5550001");
  });
});
