/** @vitest-environment jsdom */
/**
 * Phase 110 / CONTRIB-01 + Phase 154 / WIZCONT-01 — ContributionWizardOverlay.
 *
 * Two describes, two levels, deliberately:
 *
 *   1. The OVERLAY WIRING contract (WizardClient mocked): the
 *      `{ isOpen, onClose, onSuccess }` seam, the createPortal panel, Esc
 *      dismissal, the keyed CSV↔API remount driven by the internal source
 *      selector (NOT route searchParams — Pitfall 3), the deferred mount while
 *      the draft read is in flight, the close-reset, and the degrade-to-fresh
 *      arm when the read fails.
 *
 *   2. RESUME, through the REAL WizardClient. ⚠️ This file used to render the
 *      mocked wizard's `initialDraft` prop into a testid and assert it read
 *      "null". That is RESEARCH Pitfall 2's exact warning shape: the assertion
 *      can only ever report which prop was passed, so it would have gone green
 *      against an overlay that handed a perfect draft to a mount unable to
 *      consume it. The stub and the assertion are both DELETED (the retired
 *      testid is named nowhere in this file — its acceptance gate is a literal
 *      grep, the 154-02 docblock-hygiene lesson). Resume is proven instead by
 *      the REAL banner rendering and the REAL step machine landing on the
 *      draft.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { flushWizardStateSaves } from "@/lib/wizard/localStorage";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mountCount proves `key=` actually tears down + remounts. useRealWizard flips
// the mock between the wiring stub and the genuine component (see describe 2).
const hoisted = vi.hoisted(() => ({ mountCount: 0, useRealWizard: false }));

vi.mock(
  "@/app/(dashboard)/strategies/new/wizard/WizardClient",
  async (importOriginal) => {
    const React = await import("react");
    const actual = (await importOriginal()) as {
      WizardClient: React.ComponentType<Record<string, unknown>>;
    };

    // The WIRING stub. It reports what the overlay's own contract is about —
    // entry context and branch — and NOTHING about the draft prop.
    const StubWizardClient = (props: {
      entryContext: string;
      sourceOverride: string;
      onSuccess?: (id: string) => void;
      onClose?: () => void;
    }) => {
      React.useEffect(() => {
        hoisted.mountCount += 1;
      }, []);
      return (
        <div data-testid="mock-wizard">
          <span data-testid="wizard-entry">{props.entryContext}</span>
          <span data-testid="wizard-source">{props.sourceOverride}</span>
          <button
            type="button"
            data-testid="wizard-fire-success"
            onClick={() => props.onSuccess?.("id-1")}
          >
            fire success
          </button>
          <button
            type="button"
            data-testid="wizard-fire-close"
            onClick={() => props.onClose?.()}
          >
            fire close
          </button>
        </div>
      );
    };

    return {
      WizardClient: (props: Record<string, unknown>) =>
        hoisted.useRealWizard
          ? React.createElement(actual.WizardClient, props)
          : React.createElement(
              StubWizardClient as React.ComponentType<Record<string, unknown>>,
              props,
            ),
    };
  },
);

// --- Leaf mocks so the REAL WizardClient can mount in describe 2. They are
// inert for describe 1 (the stub imports none of them). ---
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

// The sync_preview surface. It echoes the strategyId the WIZARD'S OWN state
// machine is holding — not a prop the overlay passed through — so "the draft
// reached the wizard" is observed through the wizard's behavior.
vi.mock("@/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep", () => ({
  SyncPreviewStep: (props: { strategyId: string }) => (
    <div data-testid="mock-sync-preview">
      <span data-testid="sync-strategy-id">{props.strategyId}</span>
    </div>
  ),
}));

// The fresh-start step. Stubbed for the same reason as SyncPreviewStep: this
// file's subject is which step the wizard LANDS on, not what that step does.
vi.mock(
  "@/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep",
  () => ({
    MultiKeyConnectStep: () => <div data-testid="mock-connect-key" />,
  }),
);

const API_DRAFT = {
  id: "draft-overlay-1",
  name: "Aurora",
  description: "desc",
  category_id: "cat-aaa",
  strategy_types: ["Directional"],
  subtypes: [],
  markets: ["BTC"],
  supported_exchanges: ["binance"],
  leverage_range: "1x-3x",
  aum: 1_000_000,
  max_capacity: 5_000_000,
  api_key_id: "key-1",
  asset_class: "crypto",
};

const WIZARD_DRAFT_URL = "/api/strategies/wizard-draft";

// jsdom implements neither HTMLDialogElement.showModal() nor .close(). The
// stubs are the repo's existing pattern (Modal.test.tsx:23-39,
// WizardClient.test.tsx:993-1006) and are required here because Start fresh
// opens the confirm dialog — the TRAP-4 case below drives that path for real.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

/**
 * Install the wizard-draft route double. ⛔ vi.spyOn, never vi.stubGlobal —
 * a leaked global stub is this repo's known CI-only failure class (DEF-16-1).
 */
function installDraftRoute(
  respond: (url: string) => Promise<Response>,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    const url = typeof input === "string" ? input : String(input);
    return respond(url);
  }) as typeof fetch);
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The settled "you have no draft" answer — the default for the wiring cases. */
const noDraft = async () => jsonResponse({ draft: null, kind: null });

let ContributionWizardOverlay: typeof import("./ContributionWizardOverlay").ContributionWizardOverlay;

beforeEach(async () => {
  hoisted.mountCount = 0;
  hoisted.useRealWizard = false;
  // No stored wizard pointer, so the resume decision below comes from the
  // SERVER draft alone. Guarded: the storage implementation differs between
  // the local and CI node versions (`clear` is not always present), and this
  // must not be the thing that reddens.
  // ⚠️ DRAIN BEFORE CLEARING. Saves are fire-and-forget (`void saveWizardState`)
  // and, since RT-3, serialized behind an async read + HMAC verify — so a save
  // started by the PREVIOUS test can settle after this clear and write its
  // state back into THIS one. That is exactly what reddened TRAP-4 on CI's
  // Node 22 while passing on Node 25: the test passes alone and fails in file
  // order, because the straggler lands between the clear and the assertion.
  await flushWizardStateSaves();
  try {
    window.localStorage?.clear?.();
  } catch {
    /* nothing stored is the state we want anyway */
  }
  fetchSpy = installDraftRoute(noDraft);
  ({ ContributionWizardOverlay } = await import("./ContributionWizardOverlay"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[110-03] ContributionWizardOverlay — portal + keying wiring", () => {
  it("renders nothing when isOpen=false (null gate) and never asks for a draft", () => {
    const { container } = render(
      <ContributionWizardOverlay isOpen={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("mock-wizard")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the portal panel mounting WizardClient in contribution mode", async () => {
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Add a strategy" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("mock-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-entry")).toHaveTextContent("contribution");
    // Default branch is the API-key source.
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
  });

  it("defers the wizard mount until the draft read settles (Pitfall W-1)", async () => {
    // A read that never settles: the overlay chrome is up, the wizard is not.
    // Mounting first and threading the draft in later is the no-op this
    // deferral exists to prevent — WizardClient reads initialDraft once.
    let release: (() => void) | null = null;
    fetchSpy = installDraftRoute(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ draft: null, kind: null }));
        }),
    );

    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Add a strategy" })).toBeInTheDocument();
    expect(await screen.findByTestId("overlay-draft-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-wizard")).toBeNull();

    await waitFor(() => expect(release).not.toBeNull());
    release!();

    expect(await screen.findByTestId("mock-wizard")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-draft-pending")).toBeNull();
  });

  it("calls onClose on Escape keydown", () => {
    const onClose = vi.fn();
    render(<ContributionWizardOverlay isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggling the source selector remounts WizardClient with the matching sourceOverride", async () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    await screen.findByTestId("mock-wizard");
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
    const mountsAfterOpen = hoisted.mountCount;

    // Switch to CSV → sourceOverride flips AND the key forces a remount.
    fireEvent.click(screen.getByTestId("overlay-source-csv"));
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("csv");
    expect(hoisted.mountCount).toBeGreaterThan(mountsAfterOpen);

    // And back to API.
    fireEvent.click(screen.getByTestId("overlay-source-api"));
    expect(screen.getByTestId("wizard-source")).toHaveTextContent("api");
  });

  it("opens on the CSV branch when the caller's draft is a CSV draft", async () => {
    fetchSpy = installDraftRoute(async () =>
      jsonResponse({
        draft: { ...API_DRAFT, id: "draft-csv-9", api_key_id: null },
        kind: "csv",
      }),
    );

    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    // Without this the CSV draft would be filtered out by draftMatchesSource
    // against the default API tab and silently never surface.
    await waitFor(() =>
      expect(screen.getByTestId("wizard-source")).toHaveTextContent("csv"),
    );
  });

  it("re-reads the draft on every open — a close clears what the open fetched", async () => {
    const { rerender } = render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} />,
    );
    await screen.findByTestId("mock-wizard");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Close: the overlay stays mounted and renders null.
    rerender(<ContributionWizardOverlay isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId("mock-wizard")).toBeNull();

    // Reopen: it asks again rather than reusing a draft that may have been
    // deleted or submitted in between.
    rerender(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);
    // SYNCHRONOUS on purpose: the reopen re-enters the pending state, and the
    // fetch cannot settle before this line (it needs a microtask). `findBy`
    // would poll past the transition and report nothing.
    expect(screen.getByTestId("overlay-draft-pending")).toBeInTheDocument();
    await screen.findByTestId("mock-wizard");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]![0]).toBe(WIZARD_DRAFT_URL);
  });

  it("a failed draft read still offers a fresh wizard (never blocks the flow)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy = installDraftRoute(async () => jsonResponse({ code: "UNKNOWN" }, 500));

    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    expect(await screen.findByTestId("mock-wizard")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-draft-pending")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("propagates the wizard's onSuccess(strategyId) to the overlay's onSuccess prop", async () => {
    const onSuccess = vi.fn();
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} onSuccess={onSuccess} />,
    );

    fireEvent.click(await screen.findByTestId("wizard-fire-success"));
    expect(onSuccess).toHaveBeenCalledWith("id-1");
  });

  it("clicking the backdrop dismisses via onClose but a click inside the panel does not", async () => {
    const onClose = vi.fn();
    render(<ContributionWizardOverlay isOpen onClose={onClose} />);

    // A click inside the wizard body must NOT close the overlay.
    fireEvent.click(await screen.findByTestId("mock-wizard"));
    expect(onClose).not.toHaveBeenCalled();

    // A click on the backdrop (the dialog element itself) closes it.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * Phase 154-05 / WIZCONT-01 — the resume the overlay deferred in Phase 110,
 * asserted through the GENUINE WizardClient.
 *
 * Nothing here reads a prop. The banner is the real `:899-925` markup, the
 * step is chosen by the real initializer, and the strategy id on the sync
 * surface comes from the wizard's own state.
 */
describe("[154-05] ContributionWizardOverlay — resume, through the real WizardClient", () => {
  beforeEach(() => {
    hoisted.useRealWizard = true;
    fetchSpy = installDraftRoute(async (url) => {
      if (url === WIZARD_DRAFT_URL) {
        return jsonResponse({ draft: API_DRAFT, kind: "api" });
      }
      return jsonResponse({ ok: true });
    });
  });

  it("an existing API draft renders the real resume banner and lands on the draft", async () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    // The founder gets the explicit choice — the whole point of WIZCONT-01.
    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-start-fresh")).toBeInTheDocument();
    expect(
      screen.getByText(/A draft from an earlier session is ready/i),
    ).toBeInTheDocument();

    // And the wizard is genuinely holding THIS draft, not merely holding a prop.
    expect(await screen.findByTestId("sync-strategy-id")).toHaveTextContent(
      API_DRAFT.id,
    );

    fireEvent.click(screen.getByTestId("wizard-resume"));

    await waitFor(() =>
      expect(screen.queryByTestId("wizard-resume")).toBeNull(),
    );
    expect(screen.getByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.getByTestId("sync-strategy-id")).toHaveTextContent(API_DRAFT.id);
  });

  it("Start fresh only OPENS the confirm dialog — it never deletes (TRAP-4)", async () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("wizard-start-fresh"));

    // The dialog is the observable, not the text: the Modal renders its title
    // whether or not it is open, so asserting on copy is not an oracle
    // (WizardClient.test.tsx:1023-1028, the same reasoning).
    await waitFor(() => {
      const dialog = screen
        .getByText(/Delete this draft\?/i)
        .closest("dialog") as HTMLDialogElement | null;
      expect(
        Boolean(dialog?.hasAttribute("open")),
        "Start fresh must ASK before it destroys — TRAP-4 is a standing invariant, and reaching the wizard through the overlay must not weaken it.",
      ).toBe(true);
    });

    // And nothing was destroyed by the click itself.
    const deleteCalls = (fetchSpy.mock.calls as unknown[][]).filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);
    // The draft is still there to resume if the founder cancels.
    expect(screen.getByTestId("wizard-resume")).toBeInTheDocument();
  });

  it("switching to the CSV tab offers a FRESH flow, never the API draft", async () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);
    await screen.findByTestId("wizard-resume");

    fireEvent.click(screen.getByTestId("overlay-source-csv"));

    // draftMatchesSource refuses the api draft on the csv branch, so the
    // remounted wizard starts clean on the upload step rather than resuming a
    // draft whose CSV upload can never feed it.
    expect(await screen.findByTestId("wizard-csv-dropzone")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
  });

  it("no draft at all: no banner, and the wizard still mounts", async () => {
    fetchSpy = installDraftRoute(noDraft);

    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    // The positive counterpart to the resume case: "renders nothing at all"
    // cannot satisfy both this absence and the banner assertion above.
    await waitFor(() =>
      expect(screen.queryByTestId("overlay-draft-pending")).toBeNull(),
    );
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
    expect(screen.getByTestId("mock-connect-key")).toBeInTheDocument();
    // No draft ⇒ no strategyId ⇒ the chrome offers no delete-draft control.
    expect(screen.queryByTestId("wizard-delete-draft")).toBeNull();
  });
});
