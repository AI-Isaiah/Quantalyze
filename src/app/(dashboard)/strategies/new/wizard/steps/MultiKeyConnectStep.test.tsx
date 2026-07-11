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

describe("[UAT] MultiKeyConnectStep — add-another-key UX (F-4 / F-5)", () => {
  // F-4: entering a key in the State-A single-key form and THEN clicking
  // "+ Add another key window" must carry that draft into panel 1 — not erase
  // it (the reported bug: the first key vanished on the switch to multi-key).
  it("F-4: carries the in-progress single-key draft into panel 1 instead of erasing it", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);

    // Type a key into the State-A ConnectKeyStep form…
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "GeSKFf5E" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "zav1-secret" },
    });

    // …then switch to multi-key mode.
    fireEvent.click(screen.getByTestId("multi-add-key"));

    // Panel 1 (index 0) retains the typed credentials — NOT reset to blank.
    const panel0 = screen.getByTestId("key-panel-0");
    expect(within(panel0).getByTestId("key-0-api-key")).toHaveValue("GeSKFf5E");
    expect(within(panel0).getByTestId("key-0-api-secret")).toHaveValue(
      "zav1-secret",
    );
  });

  // F-5: the add-another-key affordance must sit BEFORE the primary
  // "Validate key and continue" CTA (you decide to go multi-key before
  // validating a single key). Falsifiable on DOM order.
  it("F-5: '+ Add another key window' precedes 'Validate key and continue' in the DOM", () => {
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    const add = screen.getByTestId("multi-add-key");
    const validate = screen.getByTestId("wizard-connect-submit");
    // add.compareDocumentPosition(validate) carries DOCUMENT_POSITION_FOLLOWING
    // iff `validate` comes AFTER `add`.
    expect(
      add.compareDocumentPosition(validate) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

describe("[88-review] MultiKeyConnectStep — Continue server-reject envelope (regression from 6b8237d4)", () => {
  // add-key succeeds so both panels validate; set-members rejects the windows
  // the client already passed (reachable via browser-vs-server clock skew). The
  // rejected code MULTI_KEY_WINDOWS_INVALID is a SUMMARY-ONLY table entry
  // (empty cause/fix, recoverable:false), so a bare buildEnvelope on the
  // Continue path produced a dead box: title only, no cause, no Retry. Pre-fix
  // (before the spread+override) this test fails on both the cause and Retry
  // assertions. Before 6b8237d4 the server returned INVALID_KEY_WINDOWS →
  // UNKNOWN → populated + recoverable, so this is a true regression guard.
  function fetchWithSetMembersReject() {
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
          return jsonResponse({ code: "MULTI_KEY_WINDOWS_INVALID" }, 400);
        }
        return jsonResponse({}, 200);
      });
  }

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

  it("renders a POPULATED, recoverable envelope (non-empty cause + Retry) when set-members rejects windows client validation passed — not a dead summary-only box", async () => {
    fetchWithSetMembersReject();
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("multi-add-key"));

    // Adjacent handoff (a.end === b.start) does NOT overlap → client validation
    // passes, so there is no inline/summary highlight to fall back on.
    await validatePanel(0, "2024-01-01", "2024-06-01");
    await validatePanel(1, "2024-06-01", "2024-09-01");

    // Precondition for the dead-box bug: client validation passed, so the
    // step-level summary envelope is absent (nothing to "highlight").
    expect(screen.queryByTestId("multi-key-validation-summary")).toBeNull();

    const cont = screen.getByTestId("multi-continue");
    expect(cont).not.toBeDisabled();
    fireEvent.click(cont);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute(
      "data-error-code",
      "MULTI_KEY_WINDOWS_INVALID",
    );
    // Non-empty cause (pre-fix: empty — summary-only table entry).
    expect(envelope).toHaveTextContent(/server rejected them/i);
    // Recoverable → the Retry affordance renders (pre-fix: recoverable=false).
    expect(
      within(envelope).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
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

describe("[WIZ-02] MultiKeyConnectStep — State B rehydration (back-nav)", () => {
  const AK1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const AK2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  // Two members that pass keyWindowsSchema (monotone seq, adjacent handoff, the
  // open-ended/live window LAST): member 1 is bounded binance, member 2 is a
  // live-window deribit key (window_end null). The GET NEVER returns secrets —
  // WIZ-01 is secretless by construction — so nothing here plants credentials.
  const MEMBERS = [
    {
      seq: 1,
      api_key_id: AK1,
      exchange: "binance",
      nickname: "First key",
      window_start: "2025-08-03",
      window_end: "2025-09-27",
      verified: true,
    },
    {
      seq: 2,
      api_key_id: AK2,
      exchange: "deribit",
      nickname: null,
      window_start: "2025-09-27",
      window_end: null,
      verified: true,
    },
  ];

  /** Route the WIZ-01 members GET + set-members; add-key is deliberately routed
   *  so a spurious re-validation would be observable (and asserted absent). */
  function routeRehydrateFetch(members: unknown[]) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("composite/members")) {
          return jsonResponse({ ok: true, members }, 200);
        }
        if (url.includes("composite/set-members")) {
          return jsonResponse({ ok: true, member_count: members.length }, 200);
        }
        if (url.includes("composite/add-key")) {
          return jsonResponse(
            { ok: true, strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID },
            200,
          );
        }
        return jsonResponse({}, 200);
      });
  }

  it("rehydrates State B with verified panels on mount — no blank form, no re-validation", async () => {
    const fetchSpy = routeRehydrateFetch(MEMBERS);
    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={vi.fn()}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    // State B renders (the ordered KeyPanel list), the single-key ConnectKeyStep
    // form is gone — back-nav does NOT show a blank single-key form.
    await waitFor(() =>
      expect(screen.getByTestId("multi-key-list")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("wizard-connect-submit")).toBeNull();

    // The GET was fetched with the draft's strategy_id.
    expect(
      fetchSpy.mock.calls.some((c) =>
        String(c[0]).includes(`composite/members?strategy_id=${STRATEGY_ID}`),
      ),
    ).toBe(true);

    // Two panels, both collapsed to their verified summary (status "validated").
    expect(screen.getByTestId("key-0-summary")).toHaveTextContent("Binance");
    expect(screen.getByTestId("key-0-summary")).toHaveTextContent("2025-08-03");
    expect(screen.getByTestId("key-1-summary")).toHaveTextContent("Deribit");
    // The live-window member shows "live" (window_end null → stillLive).
    expect(screen.getByTestId("key-1-summary")).toHaveTextContent("live");
    // Verified pill on each panel.
    expect(
      within(screen.getByTestId("key-0-summary")).getByTestId("trust-tier-label"),
    ).toHaveAttribute("data-trust-tier", "api_verified");

    // NEGATIVE SPACE: rehydration must NOT re-validate — no add-key POST fires.
    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]).includes("composite/add-key")),
    ).toBe(false);
  });

  it("enables Continue with empty secrets and resubmits secretlessly via set-members (api_key_id only)", async () => {
    const fetchSpy = routeRehydrateFetch(MEMBERS);
    const onSuccess = vi.fn();
    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={onSuccess}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    const cont = await screen.findByTestId("multi-continue");
    // Continue is enabled for the rehydrated keys with NO secret re-entry.
    expect(cont).not.toBeDisabled();
    fireEvent.click(cont);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const setCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("composite/set-members"),
    )!;
    const rawBody = (setCall[1] as RequestInit).body as string;
    const body = JSON.parse(rawBody);

    // Body carries the draft's strategy_id + both api_key_ids with pinned windows.
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(body.keys).toEqual([
      {
        api_key_id: AK1,
        window_start: "2025-08-03",
        window_end: "2025-09-27",
        seq: 1,
      },
      {
        api_key_id: AK2,
        window_start: "2025-09-27",
        window_end: null,
        seq: 2,
      },
    ]);

    // SECRETLESS BY CONSTRUCTION: the payload carries NO plaintext credential
    // fields (camelCase apiKey/apiSecret/passphrase never appear).
    expect(rawBody).not.toContain("apiKey");
    expect(rawBody).not.toContain("apiSecret");
    expect(rawBody).not.toContain("passphrase");

    // And no add-key re-validation happened on the whole rehydrate→Continue flow.
    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]).includes("composite/add-key")),
    ).toBe(false);
  });

  it("stays on single-key State A when the draft has no composite members", async () => {
    const fetchSpy = routeRehydrateFetch([]);
    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={vi.fn()}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    // The GET fires but returns []; the step stays byte-neutral State A: the
    // single-key ConnectKeyStep form + the ghost affordance, no State B list.
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) =>
          String(c[0]).includes("composite/members"),
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId("wizard-connect-submit")).toBeInTheDocument();
    expect(screen.getByTestId("multi-add-key")).toHaveTextContent(
      "+ Add another key window",
    );
    expect(screen.queryByTestId("multi-key-list")).toBeNull();
  });

  it("never fetches composite/members without a draftStrategyId", async () => {
    const fetchSpy = routeRehydrateFetch(MEMBERS);
    render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);

    // State A single-key form renders and no rehydration fetch is ever issued.
    expect(screen.getByTestId("wizard-connect-submit")).toBeInTheDocument();
    await waitFor(() => Promise.resolve());
    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]).includes("composite/members")),
    ).toBe(false);
  });
});

describe("[94.1 F3/F4] MultiKeyConnectStep — rehydration status + draft protection", () => {
  const AK1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MEMBERS = [
    {
      seq: 1,
      api_key_id: AK1,
      exchange: "binance",
      nickname: "First key",
      window_start: "2025-01-01",
      window_end: "2025-06-01",
    },
  ];

  /** A hand-controlled promise so a test can hold the members GET pending
   *  (loading window) and resolve/reject it on demand. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // F3 — Root cause: the rehydration mount effect only console.error'd on a
  // failed/pending GET, leaving the blank single-key State-A form. A user with
  // stored composite keys returning to a blank form (no spinner, no error) could
  // not tell a rehydration was even attempted — "keys lost". The fix tracks a
  // rehydration status and renders a loading indicator + a retryable error.
  it("F3: shows a loading indicator while the members GET is in flight (not a bare blank form)", async () => {
    const d = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("composite/members")) return d.promise;
      return jsonResponse({}, 200);
    });

    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={vi.fn()}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    // A loading indication is present while the GET is pending (RED pre-fix: no
    // such element existed — only the blank form).
    expect(await screen.findByTestId("rehydrate-loading")).toBeInTheDocument();

    // Resolve empty to settle the effect (avoids act warnings on teardown).
    d.resolve(jsonResponse({ ok: true, members: [] }, 200));
    await waitFor(() =>
      expect(screen.queryByTestId("rehydrate-loading")).toBeNull(),
    );
  });

  it("F3: surfaces a retryable error envelope (not the blank single-key form) when the members GET fails, and Retry refetches", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("composite/members")) {
          return jsonResponse({}, 500);
        }
        return jsonResponse({}, 200);
      });

    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={vi.fn()}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    const err = await screen.findByTestId("rehydrate-error");
    // Distinguishable, actionable error — not a silent blank fallback.
    expect(within(err).getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "COMPOSITE_MEMBERSHIP_UNKNOWN",
    );
    expect(screen.queryByTestId("wizard-connect-submit")).toBeNull();

    // Retry re-issues the members GET (recoverable envelope → Retry control).
    const membersCallsBefore = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("composite/members"),
    ).length;
    fireEvent.click(within(err).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      const membersCallsAfter = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes("composite/members"),
      ).length;
      expect(membersCallsAfter).toBeGreaterThan(membersCallsBefore);
    });
  });

  // F4 — Root cause: the clobber guard only checked `panelsRef.current.length`,
  // but single-key typing lands in `singleDraftRef.current`, never in `panels`.
  // A slow GET resolving mid-typing then flipped mode→multi + replaced panels,
  // blowing the in-progress single-key entry away. The fix extends the guard to
  // also bail when the single-key draft is dirty.
  it("F4: does NOT clobber an in-progress single-key draft when a slow rehydrate resolves with stored members", async () => {
    const d = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("composite/members")) return d.promise;
      return jsonResponse({}, 200);
    });

    render(
      <MultiKeyConnectStep
        wizardSessionId={SESSION}
        onSuccess={vi.fn()}
        draftStrategyId={STRATEGY_ID}
      />,
    );

    // The single-key form stays usable during the loading window (the F3 banner
    // is additive, not a form-replacing skeleton) — the user types a key.
    fireEvent.change(await screen.findByLabelText("API Key"), {
      target: { value: "IN_PROGRESS_KEY" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "IN_PROGRESS_SECRET" },
    });

    // Only NOW does the slow GET resolve with stored composite members.
    d.resolve(jsonResponse({ ok: true, members: MEMBERS }, 200));

    // The guard bails: mode stays single (no State-B list) and the typed draft
    // survives verbatim (RED pre-fix: mode flips to multi, the draft is gone).
    await waitFor(() =>
      expect(screen.queryByTestId("rehydrate-loading")).toBeNull(),
    );
    expect(screen.queryByTestId("multi-key-list")).toBeNull();
    expect(screen.getByLabelText("API Key")).toHaveValue("IN_PROGRESS_KEY");
    expect(screen.getByLabelText("API Secret")).toHaveValue(
      "IN_PROGRESS_SECRET",
    );
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
