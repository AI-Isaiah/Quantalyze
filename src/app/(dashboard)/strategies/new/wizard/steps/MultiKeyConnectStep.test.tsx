/** @vitest-environment jsdom */
/**
 * Phase 88 / ONB-01 — MultiKeyConnectStep behavior + State-A neutrality pin.
 *
 * The multi-key connect step wraps today's single-key ConnectKeyStep (State A)
 * and, once the user clicks the ghost "+ Add another key window" affordance,
 * reveals State B: an ordered KeyPanel list with per-key credentials, native
 * date windows, Move ↑/↓ (position-derived seq), remove-with-confirm, per-key
 * validate against composite/add-key, live keyWindowsSchema validation (inline
 * + step-level summary via buildEnvelope), and a Continue that persists members
 * wholesale via composite/set-members before advancing.
 *
 * The load-bearing assertion is A1: a user who never clicks the affordance
 * completes onboarding through a DOM- and behavior-identical path. The
 * neutrality snapshot proves the ONLY delta vs a bare ConnectKeyStep render is
 * the ghost affordance; the behavior pin proves the single-key form still POSTs
 * to create-with-key.
 *
 * String literals are byte-copied from the ConnectKeyStep source (the busy
 * label is ASCII "Validating...", superseding the UI-SPEC's typographic
 * ellipsis) or the UI-SPEC copy table.
 */
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiKeyConnectStep } from "./MultiKeyConnectStep";
import { ConnectKeyStep } from "./ConnectKeyStep";

const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const SESSION = "11111111-1111-4111-8111-111111111111";
const STRATEGY_ID = "22222222-2222-4222-8222-222222222222";
const API_KEY_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Route fetch by URL so per-key validate (add-key), Continue (set-members) and
 * the single-key path (create-with-key) each resolve independently.
 */
function routeFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composite/add-key")) {
        return jsonResponse(
          { ok: true, strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID },
          200,
        );
      }
      if (url.includes("composite/set-members")) {
        return jsonResponse({ ok: true, member_count: 2 }, 200);
      }
      if (url.includes("create-with-key")) {
        return jsonResponse(
          { strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID },
          200,
        );
      }
      return jsonResponse({}, 200);
    });
}

/** Strip the dynamic plumbing attributes useId/correlation-id generate so the
 *  neutrality compare is structural + textual, not id-sensitive. */
function stripDynamicAttrs(html: string): string {
  return html.replace(
    / (id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g,
    "",
  );
}

beforeEach(() => {
  trackMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("[ONB-01] MultiKeyConnectStep — State-A neutrality pin (A1)", () => {
  it("renders State A byte-neutral to ConnectKeyStep except the ghost add affordance", () => {
    // Bare ConnectKeyStep.
    const bare = render(
      <ConnectKeyStep wizardSessionId={SESSION} onSuccess={vi.fn()} />,
    );
    const bareHtml = stripDynamicAttrs(
      bare.container.querySelector("section")!.outerHTML,
    );
    cleanup();

    // MultiKeyConnectStep State A (first mount, affordance never clicked).
    const multi = render(
      <MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />,
    );
    const ghost = screen.getByTestId("multi-add-key");
    expect(ghost).toHaveTextContent("+ Add another key window");
    // The ONLY additive element: remove it and the DOM must equal bare.
    ghost.remove();
    const multiHtml = stripDynamicAttrs(
      multi.container.querySelector("section")!.outerHTML,
    );
    expect(multiHtml).toBe(bareHtml);
  });

  it("single-key submit still POSTs to create-with-key when the affordance is never clicked (behavior identity)", async () => {
    const fetchSpy = routeFetch();
    const onSuccess = vi.fn();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText("Paste the read-only key"), {
      target: { value: "AK_LIVE_xxx" },
    });
    fireEvent.change(screen.getByPlaceholderText("Paste the secret"), {
      target: { value: "SECRET_xxx" },
    });
    fireEvent.click(screen.getByTestId("wizard-connect-submit"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/api/strategies/create-with-key");
    expect(url).not.toContain("composite");
    expect(onSuccess).toHaveBeenCalledWith({
      strategyId: STRATEGY_ID,
      apiKeyId: API_KEY_ID,
      exchange: "binance",
    });
  });
});

describe("[ONB-01] MultiKeyConnectStep — Add converts to State B", () => {
  it("reveals ordered KeyPanels, appends an empty Key 2, announces + focuses it", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    // Two panels, position-derived legends.
    expect(screen.getByTestId("key-panel-0")).toHaveTextContent("Key 1 / 2");
    expect(screen.getByTestId("key-panel-1")).toHaveTextContent("Key 2 / 2");

    // Window inputs + move/remove now present on Key 1.
    const panel0 = screen.getByTestId("key-panel-0");
    expect(within(panel0).getByTestId("key-0-window-start")).toBeInTheDocument();
    expect(within(panel0).getByTestId("key-0-move-down")).toBeInTheDocument();
    expect(within(panel0).getByTestId("key-0-remove")).toBeInTheDocument();

    // Non-blocking announcement + focus on the new panel's first control.
    // The State-A→State-B transition creates BOTH panels at once, so the
    // announcement reflects the two-key start (not "Key 2 added", which would
    // imply key 1 pre-existed).
    expect(screen.getByTestId("multi-key-announce")).toHaveTextContent(
      "Multi-key mode on — 2 keys added",
    );
    expect(screen.getByTestId("key-1-exchange-binance")).toHaveFocus();
  });
});

describe("[ONB-01] MultiKeyConnectStep — per-key validate", () => {
  function enterMultiAndFillKey2() {
    const fetchSpy = routeFetch();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel1 = screen.getByTestId("key-panel-1");
    fireEvent.change(within(panel1).getByTestId("key-1-api-key"), {
      target: { value: "AK_LIVE_key2" },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-api-secret"), {
      target: { value: "SECRET_key2" },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-window-start"), {
      target: { value: "2024-01-01" },
    });
    return { fetchSpy, panel1 };
  }

  it("POSTs creds to composite/add-key and collapses to a verified summary on success", async () => {
    const { fetchSpy, panel1 } = enterMultiAndFillKey2();
    fireEvent.click(within(panel1).getByTestId("key-1-validate"));

    await waitFor(() =>
      expect(screen.getByTestId("key-1-summary")).toBeInTheDocument(),
    );
    const addCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("composite/add-key"),
    )!;
    const body = JSON.parse((addCall[1] as RequestInit).body as string);
    expect(body.api_key).toBe("AK_LIVE_key2");
    expect(body.api_secret).toBe("SECRET_key2");
    expect(body.exchange).toBe("binance");
    expect(body.wizard_session_id).toBe(SESSION);

    const summary = screen.getByTestId("key-1-summary");
    expect(summary).toHaveTextContent("Binance");
    expect(summary).toHaveTextContent("2024-01-01");
    const pill = within(summary).getByTestId("trust-tier-label");
    expect(pill).toHaveAttribute("data-trust-tier", "api_verified");
  });

  it("renders the WizardErrorEnvelope inline and keeps the panel open on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "KEY_HAS_TRADING_PERMS" }, 400),
    );
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel1 = screen.getByTestId("key-panel-1");
    fireEvent.change(within(panel1).getByTestId("key-1-api-key"), {
      target: { value: "AK_LIVE_key2" },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-api-secret"), {
      target: { value: "SECRET_key2" },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-window-start"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.click(within(panel1).getByTestId("key-1-validate"));

    const envelope = await within(screen.getByTestId("key-panel-1")).findByTestId(
      "error-envelope",
    );
    expect(envelope).toHaveAttribute("data-error-code", "KEY_HAS_TRADING_PERMS");
    // Panel stays open (creds inputs still present, no collapse to summary).
    expect(
      within(screen.getByTestId("key-panel-1")).getByTestId("key-1-api-key"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("key-1-summary")).toBeNull();
  });
});

describe("[ONB-01] MultiKeyConnectStep — reorder (Move ↑/↓, position-derived seq)", () => {
  it("swaps positions and renumbers legends; ends disable move-up/move-down", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    // Distinguish the panels: type a nickname into Key 1.
    fireEvent.change(within(screen.getByTestId("key-panel-0")).getByLabelText(
      "Key nickname (optional)",
    ), { target: { value: "FIRST" } });

    // First panel's move-up is disabled; last panel's move-down is disabled.
    expect(within(screen.getByTestId("key-panel-0")).getByTestId("key-0-move-up")).toBeDisabled();
    expect(within(screen.getByTestId("key-panel-1")).getByTestId("key-1-move-down")).toBeDisabled();

    // Move Key 1 down → it becomes panel index 1 (legend "Key 2 / 2").
    fireEvent.click(within(screen.getByTestId("key-panel-0")).getByTestId("key-0-move-down"));

    // The nickname FIRST now lives in panel index 1.
    expect(
      (within(screen.getByTestId("key-panel-1")).getByLabelText(
        "Key nickname (optional)",
      ) as HTMLInputElement).value,
    ).toBe("FIRST");
    expect(screen.getByTestId("key-panel-0")).toHaveTextContent("Key 1 / 2");
    expect(screen.getByTestId("key-panel-1")).toHaveTextContent("Key 2 / 2");
  });
});

describe("[ONB-01] MultiKeyConnectStep — remove", () => {
  it("removes an empty panel immediately", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    expect(screen.getAllByTestId(/^key-panel-/)).toHaveLength(2);

    fireEvent.click(within(screen.getByTestId("key-panel-1")).getByTestId("key-1-remove"));
    expect(screen.getAllByTestId(/^key-panel-/)).toHaveLength(1);
  });

  it("shows the confirm copy before clearing a panel with entered creds", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel1 = screen.getByTestId("key-panel-1");
    fireEvent.change(within(panel1).getByTestId("key-1-api-key"), {
      target: { value: "AK_LIVE_key2" },
    });

    fireEvent.click(within(panel1).getByTestId("key-1-remove"));
    // Not removed yet — confirm prompt appears.
    expect(screen.getAllByTestId(/^key-panel-/)).toHaveLength(2);
    expect(screen.getByText(
      "Remove Key 2? The credentials you entered for it will be cleared.",
    )).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("key-panel-1")).getByTestId("key-1-remove-confirm"));
    expect(screen.getAllByTestId(/^key-panel-/)).toHaveLength(1);
  });
});

describe("[ONB-01] MultiKeyConnectStep — loud dual-surface validation", () => {
  async function validatePanel(panelIdx: number, start: string, end: string) {
    const panel = screen.getByTestId(`key-panel-${panelIdx}`);
    fireEvent.change(within(panel).getByTestId(`key-${panelIdx}-api-key`), {
      target: { value: `AK_${panelIdx}` },
    });
    fireEvent.change(within(panel).getByTestId(`key-${panelIdx}-api-secret`), {
      target: { value: `SECRET_${panelIdx}` },
    });
    fireEvent.change(within(panel).getByTestId(`key-${panelIdx}-window-start`), {
      target: { value: start },
    });
    if (end) {
      fireEvent.change(within(panel).getByTestId(`key-${panelIdx}-window-end`), {
        target: { value: end },
      });
    }
    fireEvent.click(within(panel).getByTestId(`key-${panelIdx}-validate`));
    await waitFor(() =>
      expect(screen.getByTestId(`key-${panelIdx}-summary`)).toBeInTheDocument(),
    );
  }

  it("surfaces overlapping windows inline on BOTH panels + a role=alert summary; Continue disabled", async () => {
    routeFetch();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    await validatePanel(0, "2024-01-01", "2024-06-01");
    await validatePanel(1, "2024-03-01", "2024-09-01"); // overlaps panel 0

    // Inline note on BOTH panels.
    expect(screen.getByTestId("key-0-window-error")).toHaveTextContent(/overlapping/i);
    expect(screen.getByTestId("key-1-window-error")).toHaveTextContent(/overlapping/i);

    // Step-level summary (role=alert) with the interpolated title.
    const summary = screen.getByTestId("multi-key-validation-summary");
    expect(within(summary).getByText("Fix 1 issue before continuing")).toBeInTheDocument();
    expect(summary.querySelector('[role="alert"]')).not.toBeNull();

    const cont = screen.getByTestId("multi-continue");
    expect(cont).toBeDisabled();
    expect(cont).toHaveAttribute("aria-describedby", "multi-key-validation-summary");
  });

  it("Continue persists members via set-members then advances when all keys validate cleanly", async () => {
    const fetchSpy = routeFetch();
    const onSuccess = vi.fn();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    // Adjacent handoff (a.end === b.start) does NOT overlap.
    await validatePanel(0, "2024-01-01", "2024-06-01");
    await validatePanel(1, "2024-06-01", "2024-09-01");

    const cont = screen.getByTestId("multi-continue");
    expect(cont).not.toBeDisabled();
    fireEvent.click(cont);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const setCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("composite/set-members"),
    )!;
    const body = JSON.parse((setCall[1] as RequestInit).body as string);
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: STRATEGY_ID }),
    );
  });
});

describe("[ONB-01] MultiKeyConnectStep — credential posture (T-88-18/19)", () => {
  it("never persists credential material to localStorage and never logs secrets", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    routeFetch();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    const SECRET = "SUPER_SECRET_ZZZ_do_not_leak";
    const panel1 = screen.getByTestId("key-panel-1");
    fireEvent.change(within(panel1).getByTestId("key-1-api-key"), {
      target: { value: "AK_LIVE_key2" },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-api-secret"), {
      target: { value: SECRET },
    });
    fireEvent.change(within(panel1).getByTestId("key-1-window-start"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.click(within(panel1).getByTestId("key-1-validate"));
    await waitFor(() =>
      expect(screen.getByTestId("key-1-summary")).toBeInTheDocument(),
    );

    // No localStorage value carries the secret. (The jsdom setup stubs
    // localStorage as a plain object; a component that called setItem would
    // throw here — the component provably never persists secrets client-side.)
    const stored = JSON.stringify(globalThis.localStorage ?? {});
    expect(stored).not.toContain(SECRET);
    // No console call echoes the secret.
    const allLogs = [...errSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((a) => String(a))
      .join(" ");
    expect(allLogs).not.toContain(SECRET);
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("[ONB-01] MultiKeyConnectStep — tap targets (v1.4 flex-compression)", () => {
  it("Move and Remove controls carry explicit >=44px width AND height classes", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));
    const panel0 = screen.getByTestId("key-panel-0");
    for (const id of ["key-0-move-up", "key-0-move-down", "key-0-remove"]) {
      const btn = within(panel0).getByTestId(id);
      expect(btn.className).toContain("min-h-[44px]");
      expect(btn.className).toContain("min-w-[44px]");
      expect(btn.className).toContain("shrink-0");
    }
  });
});
