/** @vitest-environment jsdom */
/**
 * H-0182 — WizardClient top-level state machine.
 *
 * The 429-line orchestrator shipped with no unit/integration test. These
 * pin the deterministic, regression-prone branches that don't require
 * driving a full step transition through the network:
 *   (b) onAuthStateChange("SIGNED_OUT") sets the session-expired banner AND
 *       fires wizard_error with code="SESSION_EXPIRED";
 *   (d) initialDraft present + LS pointer mismatch → Resume banner (NOT a
 *       silent "use loaded step"), and Resume fires wizard_resume;
 *   plus the wizard_start telemetry gating on `hydrated`.
 */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Navigation ---
const pushMock = vi.fn();
const refreshMock = vi.fn();
// Phase 15: mutable so a test can drive the ?source=csv branch. Default ""
// = api branch (matches the original hardcoded value).
let searchParamsString = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

// --- Analytics ---
const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

// --- Supabase auth: capture the onAuthStateChange callback so a test can
// drive a SIGNED_OUT event. ---
let authCallback: ((event: string) => void) | null = null;
const unsubscribeMock = vi.fn();
// H-0187/M-0238: count subscribes so a regression that re-adds `step` to the
// auth-effect deps (resubscribing on every step transition) fails loudly.
const onAuthStateChangeMock = vi.fn((cb: (event: string) => void) => {
  authCallback = cb;
  return { data: { subscription: { unsubscribe: unsubscribeMock } } };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => onAuthStateChangeMock(cb),
    },
  }),
}));

// --- localStorage helpers: control resume overrides per-test. ---
let resumeOverrides: Record<string, unknown> = {};
const clearWizardStateMock = vi.fn();
// Phase 15: capture saveWizardState so the CSV autosave test can assert the
// debounced write of the typed strategy name.
const saveWizardStateMock = vi.fn(async (..._args: unknown[]) => {});
// WIZ-03: a spy (not a bare arrow) so a test can assert whether the wizard
// regenerated its session id. Only the DESTRUCTIVE "Try another key" path calls
// it after mount; the non-destructive "Review your keys" path must NOT.
const newWizardSessionIdMock = vi.fn(() => "ssr-session-throwaway");
vi.mock("@/lib/wizard/localStorage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadWizardState: vi.fn(async () => null),
    saveWizardState: saveWizardStateMock,
    clearWizardState: () => clearWizardStateMock(),
    newWizardSessionId: () => newWizardSessionIdMock(),
    deriveWizardResumeOverrides: () => resumeOverrides,
  };
});

// WIZ-03: stub the two step children so this WizardClient-level test drives the
// step machine + callback wiring directly, not the children's internals.
// SyncPreviewStep exposes BOTH review affordances as separate buttons so each
// WizardClient callback (non-destructive onReviewKeys vs destructive
// onTryAnotherKey) can be exercised in isolation. MultiKeyConnectStep renders a
// marker so "step is now connect_key" is observable. None of the pre-existing
// tests assert either child's content, so these stubs are inert for them.
vi.mock("./steps/SyncPreviewStep", () => ({
  SyncPreviewStep: (props: {
    wizardSessionId: string;
    onReviewKeys?: () => void;
    onTryAnotherKey: () => void;
  }) => (
    <div data-testid="mock-sync-preview">
      <span data-testid="sync-session">{props.wizardSessionId}</span>
      <button
        type="button"
        data-testid="sync-review-keys"
        onClick={() => props.onReviewKeys?.()}
      >
        Review your keys
      </button>
      <button
        type="button"
        data-testid="sync-try-another"
        onClick={() => props.onTryAnotherKey()}
      >
        Try another key
      </button>
    </div>
  ),
}));

vi.mock("./steps/MultiKeyConnectStep", () => ({
  MultiKeyConnectStep: (props: { wizardSessionId: string }) => (
    <div data-testid="mock-connect-step">
      <span data-testid="connect-session">{props.wizardSessionId}</span>
    </div>
  ),
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

let WizardClient: typeof import("./WizardClient").WizardClient;

beforeEach(async () => {
  authCallback = null;
  resumeOverrides = {};
  searchParamsString = "";
  trackMock.mockClear();
  pushMock.mockClear();
  clearWizardStateMock.mockClear();
  saveWizardStateMock.mockClear();
  onAuthStateChangeMock.mockClear();
  unsubscribeMock.mockClear();
  newWizardSessionIdMock.mockClear();
  ({ WizardClient } = await import("./WizardClient"));
});

describe("[H-0182] WizardClient — session expiry", () => {
  it("SIGNED_OUT sets the session-expired banner and fires wizard_error", async () => {
    render(<WizardClient initialDraft={null} />);
    // Let the mount + hydration effects settle (wizard_start fires).
    await waitFor(() => expect(authCallback).not.toBeNull());

    act(() => {
      authCallback!("SIGNED_OUT");
    });

    expect(await screen.findByText(/Your session expired\./i)).toBeInTheDocument();
    const errCall = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(errCall).toBeDefined();
    expect((errCall![1] as { code: string }).code).toBe("SESSION_EXPIRED");
  });

  it("a non-SIGNED_OUT auth event does NOT show the session-expired banner", async () => {
    render(<WizardClient initialDraft={null} />);
    await waitFor(() => expect(authCallback).not.toBeNull());

    act(() => {
      authCallback!("TOKEN_REFRESHED");
    });

    expect(screen.queryByText(/Your session expired\./i)).toBeNull();
  });
});

describe("[H-0182] WizardClient — resume banner on LS pointer mismatch", () => {
  it("shows the Resume banner (not the loaded step) when override flags it", async () => {
    resumeOverrides = { showResumeBanner: true };
    render(<WizardClient initialDraft={DRAFT} />);

    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-start-fresh")).toBeInTheDocument();
  });

  it("Resume fires wizard_resume and hides the banner", async () => {
    resumeOverrides = { showResumeBanner: true };
    render(<WizardClient initialDraft={DRAFT} />);
    const resume = await screen.findByTestId("wizard-resume");

    fireEvent.click(resume);

    await waitFor(() => {
      const call = trackMock.mock.calls.find(
        (c) => (c as unknown[])[0] === "wizard_resume",
      );
      expect(call).toBeDefined();
    });
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
  });

  it("does NOT resubscribe the auth listener on a step transition (H-0187/M-0238)", async () => {
    resumeOverrides = { showResumeBanner: true };
    render(<WizardClient initialDraft={DRAFT} />);
    await waitFor(() => expect(authCallback).not.toBeNull());
    // The listener mounts exactly once.
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);

    // Resume → handleResume → setStep("sync_preview"): a real step transition.
    fireEvent.click(await screen.findByTestId("wizard-resume"));
    await waitFor(() =>
      expect(screen.queryByTestId("wizard-resume")).toBeNull(),
    );

    // The pre-fix deps `[wizardSessionId, step]` tore down + re-subscribed the
    // supabase-js auth channel on this transition, leaving a window where a
    // token-refresh SIGNED_OUT fired unheard. With `step` read via a ref and
    // `[wizardSessionId]` deps, the subscription must survive the step change.
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).not.toHaveBeenCalled();

    // And the listener still reports the LIVE step via the ref, not a stale one.
    act(() => authCallback!("SIGNED_OUT"));
    const errCall = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(errCall).toBeDefined();
    expect((errCall![1] as { step: string }).step).toBe("sync_preview");
  });

  it("does NOT show the Resume banner when no override is set", async () => {
    resumeOverrides = {};
    render(<WizardClient initialDraft={null} />);
    // Let hydration settle.
    await waitFor(() =>
      expect(
        trackMock.mock.calls.some((c) => (c as unknown[])[0] === "wizard_start"),
      ).toBe(true),
    );
    expect(screen.queryByTestId("wizard-resume")).toBeNull();
  });
});

describe("[H-0182] WizardClient — wizard_start telemetry", () => {
  it("fires wizard_start once after hydration with resume=false for a fresh start", async () => {
    render(<WizardClient initialDraft={null} />);
    await waitFor(() => {
      const call = trackMock.mock.calls.find(
        (c) => (c as unknown[])[0] === "wizard_start",
      );
      expect(call).toBeDefined();
    });
    const startCalls = trackMock.mock.calls.filter(
      (c) => (c as unknown[])[0] === "wizard_start",
    );
    expect(startCalls).toHaveLength(1);
    expect((startCalls[0]![1] as { resume: boolean }).resume).toBe(false);
  });
});

describe("[Phase 15] WizardClient — CSV strategy-name autosave (BUG P1)", () => {
  it("persists the typed CSV strategy name (debounced) so a tab refresh keeps it", async () => {
    // Root cause: pre-fix the CSV strategy name only reached localStorage
    // inside the csv_upload onSuccess handler (after a successful file
    // validate). A user who typed a name and refreshed BEFORE validating
    // lost it — Phase 15 VERIFICATION item #4. The fix reports name edits up
    // (onNameChange) and debounce-autosaves them from WizardClient. This test
    // drives the ?source=csv branch, types a name, and asserts the autosave
    // write — it fails pre-fix because typing never triggered saveWizardState.
    searchParamsString = "source=csv";
    render(<WizardClient initialDraft={null} />);

    const input = await screen.findByTestId("csv-strategy-name");
    fireEvent.change(input, { target: { value: "BTC Vol Carry" } });

    await waitFor(() => {
      const autosave = saveWizardStateMock.mock.calls.find((c) => {
        const arg = (c as unknown[])[0] as {
          step?: string;
          source?: string;
          strategyName?: string;
        };
        return (
          arg?.step === "csv_upload" &&
          arg?.source === "csv" &&
          arg?.strategyName === "BTC Vol Carry"
        );
      });
      expect(autosave).toBeDefined();
    });
  });

  it("does NOT autosave an empty/whitespace-only name", async () => {
    // Guard: the debounce early-returns on a blank name so we never write an
    // empty strategyName envelope (which would resume to a blank field anyway).
    searchParamsString = "source=csv";
    render(<WizardClient initialDraft={null} />);

    const input = await screen.findByTestId("csv-strategy-name");
    fireEvent.change(input, { target: { value: "   " } });

    // Give the debounce window time to (not) fire.
    await new Promise((r) => setTimeout(r, 500));
    const blankWrite = saveWizardStateMock.mock.calls.find((c) => {
      const arg = (c as unknown[])[0] as { step?: string; strategyName?: string };
      return arg?.step === "csv_upload";
    });
    expect(blankWrite).toBeUndefined();
  });

  it("coalesces rapid edits — only the final typed name is persisted (debounce cleanup)", async () => {
    // The 400ms debounce must clearTimeout the prior pending write on each
    // keystroke, so a burst of edits produces ONE write with the final value,
    // not one per character. Both changes land synchronously before the timer
    // fires, so the intermediate "A" timer is cancelled before it can run.
    searchParamsString = "source=csv";
    render(<WizardClient initialDraft={null} />);

    const input = await screen.findByTestId("csv-strategy-name");
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.change(input, { target: { value: "Aurora Capital" } });

    await waitFor(() => {
      const finalWrite = saveWizardStateMock.mock.calls.find((c) => {
        const arg = (c as unknown[])[0] as { step?: string; strategyName?: string };
        return arg?.step === "csv_upload" && arg?.strategyName === "Aurora Capital";
      });
      expect(finalWrite).toBeDefined();
    });

    // The intermediate "A" timer must have been cleared before firing.
    const intermediateWrite = saveWizardStateMock.mock.calls.find((c) => {
      const arg = (c as unknown[])[0] as { strategyName?: string };
      return arg?.strategyName === "A";
    });
    expect(intermediateWrite).toBeUndefined();
  });
});

describe("[94-03] WizardClient — non-destructive composite review (WIZ-03)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // RED before Task 1: WizardClient passed NO onReviewKeys prop, so the mock's
  // `props.onReviewKeys?.()` was a no-op — the step stayed sync_preview and
  // mock-connect-step never appeared. GREEN once onReviewKeys wires
  // setStep("connect_key") + persistPointer.
  it("Review your keys navigates to connect_key WITHOUT deleting the draft or minting a new session", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<WizardClient initialDraft={DRAFT} />);

    // initialDraft present → the wizard mounts on sync_preview.
    const reviewBtn = await screen.findByTestId("sync-review-keys");
    const sessionBefore = screen.getByTestId("sync-session").textContent;
    // newWizardSessionId is called once at mount (the useState initializer).
    const sessionGensAtMount = newWizardSessionIdMock.mock.calls.length;

    fireEvent.click(reviewBtn);

    // Step transitioned to connect_key (where the composite rehydrates, WIZ-02).
    expect(await screen.findByTestId("mock-connect-step")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-sync-preview")).toBeNull();

    // Non-destructive: NO DELETE fetch to the draft route was issued.
    const deleteCalls = fetchSpy.mock.calls.filter(
      (c) =>
        String(c[0]).includes("/api/strategies/draft/") &&
        (c[1] as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);

    // Session id survives the round-trip: no NEW session was minted after mount,
    // and the connect step received the same id the sync step held.
    expect(newWizardSessionIdMock.mock.calls.length).toBe(sessionGensAtMount);
    expect(screen.getByTestId("connect-session").textContent).toBe(sessionBefore);
  });

  // Destructive pin (research Pitfall 3): the split must NOT blanket-remove the
  // single-key "Try another key" delete. This fails if onTryAnotherKey were
  // pointed at the non-destructive callback.
  it("Try another key (single-key destructive path) still issues the draft DELETE", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<WizardClient initialDraft={DRAFT} />);

    fireEvent.click(await screen.findByTestId("sync-try-another"));

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(
        (c) =>
          String(c[0]).includes("/api/strategies/draft/draft-1") &&
          (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCalls).toHaveLength(1);
    });
    // And the destructive path re-arms the F6 fence by minting a fresh session.
    expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(1);
  });
});
