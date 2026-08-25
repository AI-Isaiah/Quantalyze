/** @vitest-environment jsdom */
/**
 * Phase 162 / 162-06 / HONEST-06 / D-162-3 — THE PRESELECT SPEC.
 *
 * The measured bug this pins the fix for: an owner clicks "Finish setup →" on a
 * stored-but-unused key, and the wizard opens on a blank credential form. Pasting
 * that key's credentials collides with the venue-identity index and lands on
 * `KEY_ORPHANED` — a refusal whose own copy had to tell them the remedy was out
 * of reach. The click named a key; the wizard threw the name away.
 *
 * ⭐ THE WHOLE FILE RENDERS THE REAL WIZARD. `WizardClient`, `MultiKeyConnectStep`
 * and `ConnectKeyStep` are NOT mocked: the property under test is "the wizard
 * OPENS showing the clicked key", and a mock that echoes the prop it was handed
 * can only ever report which prop was passed — RESEARCH Pitfall 2, the exact
 * shape the sibling `ContributionWizardOverlay.test.tsx` deleted from itself.
 * Only `SyncPreviewStep` is stubbed, because it is the LANDING this file
 * observes, never the subject.
 *
 * Populations (162-UI-SPEC § C-5), each pinned so it can fail on its own:
 *   (a) a preselected key that already has a live wizard draft — the stale-page
 *       case (another tab started it). O-4.
 *   (b) an orphaned key: stored, live, nothing hangs off it. O-5.
 *   (c) a key mid-sync is COVERED by its strategy, so it is not a bare key and
 *       never renders "Finish setup →" at all. Pinned where that control is
 *       rendered — `StrategyTable.pending-chip.test.tsx`, O-7 — not here.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { flushWizardStateSaves } from "@/lib/wizard/localStorage";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContributionWizardOverlay } from "./ContributionWizardOverlay";
import { MyStrategiesSection } from "@/app/(dashboard)/my-strategies/MyStrategiesSection";

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

// The landing surface. It echoes the strategy id the WIZARD'S OWN state machine
// is holding, so "Continue with this key resolved onto that draft" is observed
// through the wizard's behavior rather than through a prop we passed in.
vi.mock("@/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep", () => ({
  SyncPreviewStep: (props: { strategyId: string; apiKeyId: string | null }) => (
    <div data-testid="mock-sync-preview">
      <span data-testid="sync-strategy-id">{props.strategyId}</span>
      <span data-testid="sync-api-key-id">{props.apiKeyId ?? "null"}</span>
    </div>
  ),
}));

// --- Fixtures --------------------------------------------------------------

const KEY_A = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  exchange: "bybit" as const,
  exchangeLabel: "Bybit",
  keyLabel: "Zavara main",
};
const KEY_B = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  exchange: "deribit" as const,
  exchangeLabel: "Deribit",
  keyLabel: "Helios options",
};

/** A draft belonging to KEY_A — the stale-page population (a). */
const DRAFT_ON_KEY_A = {
  id: "dddddddd-0000-4000-8000-000000000001",
  name: "Aurora",
  description: "",
  category_id: null,
  strategy_types: [],
  subtypes: [],
  markets: [],
  supported_exchanges: ["bybit"],
  leverage_range: "",
  aum: null,
  max_capacity: null,
  api_key_id: KEY_A.id,
  asset_class: "crypto",
};

const WIZARD_DRAFT_URL = "/api/strategies/wizard-draft";
const CREATE_URL = "/api/strategies/create-with-key";
const MEMBERS_URL = "/api/strategies/composite/members";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Every `create-with-key` POST body this test saw, parsed. */
let createCalls: Record<string, unknown>[] = [];
/**
 * Every `composite/members` URL this test saw.
 *
 * It is the wizard telling on itself: `MultiKeyConnectStep` issues this read
 * only when `WizardClient` handed it a `draftStrategyId`, i.e. only when the
 * wizard mounted HOLDING a draft. It is recorded when the request is made, not
 * when it answers, so it is settled by the time the summary is on screen.
 */
let membersCalls: string[] = [];
/** What the next `create-with-key` POST answers. */
let createResponder: () => Promise<Response>;
/** What the draft read answers. */
let draftResponder: () => Promise<Response>;

let fetchSpy: ReturnType<typeof vi.spyOn>;

/**
 * ⛔ vi.spyOn, never vi.stubGlobal — a leaked global stub is this repo's known
 * CI-only failure class (DEF-16-1).
 */
function installRoutes() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith(WIZARD_DRAFT_URL)) return draftResponder();
    if (url.startsWith(MEMBERS_URL)) {
      membersCalls.push(url);
      return jsonResponse({ members: [] });
    }
    if (url.startsWith(CREATE_URL)) {
      createCalls.push(
        JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      );
      return createResponder();
    }
    // Anything else is a surprise, and a silent 200 would hide it.
    throw new Error(`unexpected fetch in preselect spec: ${url}`);
  }) as typeof fetch);
}

beforeEach(async () => {
  createCalls = [];
  membersCalls = [];
  createResponder = async () =>
    jsonResponse({
      ok: true,
      strategy_id: "ssssssss-0000-4000-8000-000000000009",
      api_key_id: KEY_A.id,
    });
  draftResponder = async () => jsonResponse({ draft: null, kind: null });
  // ⚠️ DRAIN BEFORE CLEARING — wizard saves are fire-and-forget and a straggler
  // from the previous test lands between the clear and the assertion (the
  // Node-22-only failure the sibling overlay spec records).
  await flushWizardStateSaves();
  try {
    window.localStorage?.clear?.();
  } catch {
    /* nothing stored is the state we want anyway */
  }
  fetchSpy = installRoutes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The saved-key summary, once the deferred wizard mount has settled. */
async function findSummary(): Promise<HTMLElement> {
  return screen.findByTestId("wizard-preselect-summary");
}

describe("[162-06 / HONEST-06] the wizard OPENS on the key the owner clicked", () => {
  it("O-1: renders the saved-key summary — the clicked key's exchange and label, as TEXT", async () => {
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );

    const summary = await findSummary();
    // The eyebrow and the identity line: the two facts the placeholder row
    // showed, in the same server-formatted words.
    expect(within(summary).getByText("SAVED KEY")).toBeInTheDocument();
    expect(summary.textContent).toContain("Bybit");
    expect(summary.textContent).toContain("Zavara main");

    // ⛔ The credential form is REPLACED, not merely re-labelled. A prefilled
    // form is the measured unwinnable loop: it still re-POSTs and still refuses.
    expect(screen.queryByTestId("wizard-connect-submit")).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("O-1b: renders NO masked credential field and no fabricated dots", async () => {
    const { container } = render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );
    await findSummary();

    // The web tier cannot decrypt a stored secret at all, so any dots rendered
    // here would be a picture of a value nobody read.
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(document.body.querySelectorAll('input[type="password"]')).toHaveLength(
      0,
    );
    const text = document.body.textContent ?? "";
    for (const filler of ["••", "●●", "****", "＊＊"]) {
      expect(text).not.toContain(filler);
    }
  });

  it("O-3: focus lands on 'Continue with this key' when the step mounts preselected", async () => {
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );
    await findSummary();

    const cta = screen.getByTestId("wizard-preselect-continue");
    await waitFor(() => expect(document.activeElement).toBe(cta));
    // Conveyed by its visible label, never by color alone.
    expect(cta).toHaveTextContent("Continue with this key");
  });

  it("O-2: 'Use a different key' reverts to the blank credential form via a real remount", async () => {
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );
    await findSummary();
    // (No exchange cards to inspect yet — the summary REPLACES the form, which
    // is O-1's subject. The seeded venue becomes observable below, by its
    // absence after the remount.)
    fireEvent.click(screen.getByTestId("wizard-preselect-different"));

    // The credential form is back…
    expect(await screen.findByTestId("wizard-connect-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-preselect-summary")).toBeNull();
    // …and it is PRISTINE, which is the remount witness: `exchange` is a
    // `useState` initializer seeded from the preselect, so a component that had
    // merely hidden the summary would still be sitting on Bybit.
    expect(screen.getByTestId("wizard-exchange-binance")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("wizard-exchange-bybit")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Nothing was sent to create anything by changing one's mind.
    expect(createCalls).toEqual([]);
  });
});

describe("[162-06 / D-162-3] Continue with this key — the two live populations", () => {
  it("O-5 (population b, orphaned key): POSTs reuse_api_key_id with NO credentials and lands on the draft", async () => {
    createResponder = async () =>
      jsonResponse({
        ok: true,
        strategy_id: "ssssssss-0000-4000-8000-00000000000b",
        api_key_id: KEY_B.id,
      });

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );
    await findSummary();

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.getByTestId("sync-strategy-id")).toHaveTextContent(
      "ssssssss-0000-4000-8000-00000000000b",
    );

    expect(createCalls).toHaveLength(1);
    const body = createCalls[0];
    expect(body.reuse_api_key_id).toBe(KEY_B.id);
    expect(typeof body.wizard_session_id).toBe("string");
    // ⛔ THE POINT OF THE ARM: no credential fields exist on this request. A
    // "prefilled" form would send these and collide on the same index that
    // produced KEY_ORPHANED in the first place.
    for (const field of ["api_key", "api_secret", "passphrase", "exchange"]) {
      expect(body).not.toHaveProperty(field);
    }
    // …and the owner is never routed into the refusal this path exists to end.
    expect(
      screen.queryByText(/This key is already stored, but nothing uses it\./),
    ).toBeNull();
  });

  it("O-4 (population a, key with a live draft): shows the summary first, then resumes THAT draft", async () => {
    // The stale-page case: another tab started a draft on this very key while
    // this page's placeholder row was already rendered.
    draftResponder = async () =>
      jsonResponse({ draft: DRAFT_ON_KEY_A, kind: "api" });
    // The server's reuse arm hands the existing draft back rather than minting
    // a second one (its own idempotency fence) — so the client needs no
    // "does a draft exist?" branch of its own.
    createResponder = async () =>
      jsonResponse({
        ok: true,
        strategy_id: DRAFT_ON_KEY_A.id,
        api_key_id: KEY_A.id,
        deduped: true,
      });

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );

    // ⭐ THE SUMMARY WINS OVER THE DRAFT'S RESUME STEP. A draft normally resumes
    // straight onto sync_preview; doing that here would skip the one screen that
    // says WHICH key this is about and offers to change it.
    await findSummary();
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.getByTestId("sync-strategy-id")).toHaveTextContent(
      DRAFT_ON_KEY_A.id,
    );
    expect(screen.getByTestId("sync-api-key-id")).toHaveTextContent(KEY_A.id);
    // ⛔ No "These credentials are already connected." strip: this arm received
    // no credentials, and the user asked for exactly the key they got.
    expect(screen.queryByTestId("wizard-dedup-notice")).toBeNull();
  });

  it("a draft on a DIFFERENT key is never resumed under a preselect", async () => {
    // The wrong-key confusion the threat register calls T-162-06-B. The draft
    // read asks for the caller's LATEST draft, which has nothing to do with the
    // row they clicked.
    draftResponder = async () =>
      jsonResponse({ draft: DRAFT_ON_KEY_A, kind: "api" });

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );

    const summary = await findSummary();
    expect(summary.textContent).toContain("Deribit");
    expect(summary.textContent).toContain("Helios options");
    // Not resumed onto key A's draft, and not showing key A anywhere.
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();
    expect(summary.textContent).not.toContain("Zavara main");

    // ⭐ THE ASSERTION THAT ACTUALLY PINS THE GUARD, and it is here because the
    // three above do NOT — measured, by neutering the guard and watching all
    // three stay green. The step initializer starts on `connect_key` whenever a
    // preselect is present, so the summary renders key B either way. What the
    // guard stops is key A's DRAFT being MOUNTED underneath key B's summary:
    // `initialDraft` wins over the preselect for `strategyId`, `apiKeyId` and
    // the entire metadata draft, so key A's name, markets and category would
    // carry into the strategy built here.
    //
    // The wizard tells on itself through this read: `MultiKeyConnectStep` asks
    // for a draft's members only when `WizardClient` handed it a
    // `draftStrategyId`. Recorded at REQUEST time, so it is settled by the time
    // the summary is on screen — unlike the resume banner, which lands after an
    // async localStorage read and would make this a false negative.
    expect(
      membersCalls,
      "The wizard mounted HOLDING a draft while the summary claims this is " +
        "about a different key. That draft's name, markets and category would " +
        "carry into the strategy built here from key B.",
    ).toEqual([]);
  });

  it("a server refusal renders through the existing envelope, and the summary survives it", async () => {
    createResponder = async () =>
      jsonResponse(
        {
          code: "KEY_REUSE_UNAVAILABLE",
          error: "That stored key is not available to reuse.",
        },
        409,
      );

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );
    await findSummary();
    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    expect(
      await screen.findByText("That stored key is not available to reuse."),
    ).toBeInTheDocument();
    // Still on the step, still holding the key — never advanced, never stranded.
    expect(screen.getByTestId("wizard-preselect-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();
    expect(
      screen.getByTestId("wizard-preselect-continue"),
    ).not.toBeDisabled();
  });
});

/**
 * O-6 — THE BACKSTOP (162-UI-SPEC UI-Considerations, zero-one-many row).
 *
 * ⭐ IT CLICKS, IT DOES NOT PASS A PROP. Every case above hands the overlay a
 * preselect directly, which proves the overlay renders what it is given and
 * nothing about WHICH key a click selects. A thread that hard-codes the first
 * (or the last) bare key satisfies all of them. This one renders the real
 * /my-strategies host — table and overlay together — and discriminates between
 * two bare keys by clicking each one's own row.
 */
describe("[162-06 backstop] the summary shows the CLICKED row's key, for each of two bare keys", () => {
  const renderSection = () =>
    render(
      <MyStrategiesSection
        strategies={[]}
        placeholderKeys={[KEY_A, KEY_B]}
        portfolioId={null}
        percentiles={null}
      />,
    );

  async function clickFinishSetupFor(label: string) {
    const row = screen
      .getAllByRole("row")
      .find((r) => (r.textContent ?? "").includes(label));
    expect(row, `no placeholder row rendered for ${label}`).toBeDefined();
    fireEvent.click(
      within(row!).getByRole("button", { name: /Finish setup/ }),
    );
  }

  it("clicking key A's row shows A; clicking key B's row shows B", async () => {
    const { unmount } = renderSection();
    await clickFinishSetupFor(KEY_A.keyLabel);

    let summary = await findSummary();
    expect(summary.textContent).toContain("Bybit");
    expect(summary.textContent).toContain("Zavara main");
    expect(summary.textContent).not.toContain("Deribit");
    expect(summary.textContent).not.toContain("Helios options");

    unmount();
    await flushWizardStateSaves();
    renderSection();
    await clickFinishSetupFor(KEY_B.keyLabel);

    summary = await findSummary();
    expect(summary.textContent).toContain("Deribit");
    expect(summary.textContent).toContain("Helios options");
    expect(summary.textContent).not.toContain("Bybit");
    expect(summary.textContent).not.toContain("Zavara main");
  });

  it("the second row's click is not answered by the first row's key (first-key falsifier)", async () => {
    // Stated separately from the pair above so a regression that always answers
    // with the FIRST key fails on an assertion whose message says exactly that.
    renderSection();
    await clickFinishSetupFor(KEY_B.keyLabel);

    const identity = await screen.findByTestId("wizard-preselect-identity");
    expect(
      identity.textContent,
      "The summary answered with the FIRST bare key for a click on the second " +
        "row. The id must be read off the row being rendered, not off the head " +
        "of the placeholder array.",
    ).toBe(`${KEY_B.exchangeLabel} — ${KEY_B.keyLabel}`);
    // The full nickname is recoverable even when the line truncates.
    expect(identity).toHaveAttribute(
      "title",
      `${KEY_B.exchangeLabel} — ${KEY_B.keyLabel}`,
    );
  });
});

describe("[162-06] no preselect = the pre-162 wizard, byte for byte", () => {
  it("opens on the credential form when no key was clicked", async () => {
    render(<ContributionWizardOverlay isOpen onClose={vi.fn()} />);

    expect(await screen.findByTestId("wizard-connect-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-preselect-summary")).toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
