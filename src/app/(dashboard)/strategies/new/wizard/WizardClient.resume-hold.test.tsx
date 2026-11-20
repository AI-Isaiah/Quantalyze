/** @vitest-environment jsdom */
/**
 * Phase 218 / 218-SC-6 — a draft with no matching local pointer shows the
 * resume banner ALONE until the founder chooses.
 *
 * Why this is its own file: `WizardClient.test.tsx` replaces
 * `deriveWizardResumeOverrides` with a stub, so it can only say "if the banner
 * is flagged, X". The hold depends on the REAL derivation (no pointer or a
 * mismatched pointer holds; a matching pointer resumes silently), so here only
 * `loadWizardState` is mocked and the real derivation runs.
 *
 * The founder's 2026-11-19 finding: the draft's step was already mounted under
 * the banner, so the Resume / Start fresh choice was pre-made. A test that can
 * still pass with the step mounted under the banner is the wrong shape, so
 * every banner case asserts the step's ABSENCE.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));
let searchParamsString = "";

const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
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

// Only the pointer READ is controlled; `deriveWizardResumeOverrides` is REAL.
let storedPointer: Record<string, unknown> | null = null;
vi.mock("@/lib/wizard/localStorage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadWizardState: vi.fn(async () => storedPointer),
    saveWizardState: vi.fn(async () => {}),
    clearWizardState: vi.fn(),
  };
});

vi.mock("./steps/SyncPreviewStep", () => ({
  SyncPreviewStep: () => <div data-testid="mock-sync-preview" />,
}));
vi.mock("./steps/MultiKeyConnectStep", () => ({
  MultiKeyConnectStep: () => <div data-testid="mock-connect-step" />,
}));

const DRAFT = {
  id: "draft-1",
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
const CSV_DRAFT = { ...DRAFT, id: "draft-csv-1", api_key_id: null };

const matchingPointer = (over: Record<string, unknown> = {}) => ({
  strategyId: DRAFT.id,
  wizardSessionId: "sess-from-pointer",
  step: "sync_preview",
  savedAt: Date.now(),
  source: "api",
  apiKeyId: DRAFT.api_key_id,
  ...over,
});

const stepViewCalls = () =>
  trackMock.mock.calls.filter((c) =>
    String((c as unknown[])[0]).startsWith("wizard_step_view_"),
  );

let WizardClient: typeof import("./WizardClient").WizardClient;

beforeEach(async () => {
  storedPointer = null;
  searchParamsString = "";
  trackMock.mockClear();
  ({ WizardClient } = await import("./WizardClient"));
});

describe("[218-SC-6] the resume banner holds every step until the founder chooses", () => {
  it("no local pointer: the banner is alone — no sync preview, no CSV dropzone, no connect form", async () => {
    render(<WizardClient initialDraft={DRAFT} />);

    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();
    expect(screen.queryByTestId("wizard-csv-dropzone")).toBeNull();
    expect(screen.queryByTestId("mock-connect-step")).toBeNull();
  });

  it("a pointer for ANOTHER draft is the same hold", async () => {
    storedPointer = matchingPointer({ strategyId: "some-other-draft" });
    render(<WizardClient initialDraft={DRAFT} />);

    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();
  });

  it("a CSV draft holds the dropzone too", async () => {
    searchParamsString = "source=csv";
    render(<WizardClient initialDraft={CSV_DRAFT} initialDraftKind="csv" />);

    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-csv-dropzone")).toBeNull();
  });

  it("Resume mounts the draft's step and the step-view event fires once, for it", async () => {
    render(<WizardClient initialDraft={DRAFT} />);
    fireEvent.click(await screen.findByTestId("wizard-resume"));

    expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
    await waitFor(() => expect(stepViewCalls()).toHaveLength(1));
    expect(
      (stepViewCalls()[0] as unknown[])[1],
      "the view is of the step that mounted, not a held one",
    ).toMatchObject({ step: "sync_preview" });
  });

  it("the step-view event does NOT fire while the step is held", async () => {
    render(<WizardClient initialDraft={DRAFT} />);
    await screen.findByTestId("wizard-resume");
    // Let any queued effects flush; a held step must stay unviewed.
    await new Promise((r) => setTimeout(r, 20));

    expect(stepViewCalls()).toHaveLength(0);
  });

  it("a MATCHING pointer resumes silently: no banner, the draft's step mounts (unchanged)", async () => {
    storedPointer = matchingPointer();
    render(<WizardClient initialDraft={DRAFT} />);

    expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
  });

  it("a throw during hydration still un-holds the step: a draft user is never stranded on a blank wizard", async () => {
    // A stored session id the key fence declines makes hydration call the tracker
    // after `loadWizardState` settled. If that throws, `hydrated` must still settle.
    storedPointer = matchingPointer({ apiKeyId: "some-other-key" });
    trackMock.mockImplementation((name: unknown) => {
      if (name === "wizard_session_id_not_restored") throw new Error("tracker down");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<WizardClient initialDraft={DRAFT} />);

      expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledWith(
        "[wizard] hydration failed",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
      trackMock.mockReset();
    }
  });

  it("no draft: nothing is held, the first step mounts with no banner (unchanged)", async () => {
    render(<WizardClient initialDraft={null} />);

    expect(await screen.findByTestId("mock-connect-step")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
  });
});
