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
// WIZ-04: a minimal snapshot the sync-complete trigger fires so the stepper
// tests can drive syncSnapshot != null (⇒ metadata/review become navigable).
const SYNC_SNAPSHOT = {
  tradeCount: 42,
  csvRowCount: 0,
  earliestTradeAt: null,
  latestTradeAt: null,
  detectedMarkets: ["BTC"],
  exchange: "binance",
  metrics: [],
  sparkline: null,
  computedAt: null,
};

vi.mock("./steps/SyncPreviewStep", () => ({
  SyncPreviewStep: (props: {
    wizardSessionId: string;
    onComplete: (snapshot: typeof SYNC_SNAPSHOT) => void;
    onReviewKeys?: () => void;
    onTryAnotherKey: () => void;
    cachedSnapshot?: typeof SYNC_SNAPSHOT | null;
  }) => (
    <div data-testid="mock-sync-preview">
      <span data-testid="sync-session">{props.wizardSessionId}</span>
      {/* F1: expose whether WizardClient handed us a cached snapshot. A stale
          snapshot surviving a member change would render "present" here. */}
      <span data-testid="cached-snapshot">
        {props.cachedSnapshot ? "present" : "null"}
      </span>
      {/* WIZ-04: drive handleSyncComplete so syncSnapshot is set and the
          stepper's forward review cell becomes navigable. Inert for the
          pre-existing tests, which never click it. */}
      <button
        type="button"
        data-testid="sync-complete"
        onClick={() => props.onComplete(SYNC_SNAPSHOT)}
      >
        Complete sync
      </button>
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
  MultiKeyConnectStep: (props: {
    wizardSessionId: string;
    onSuccess?: (result: {
      strategyId: string;
      apiKeyId: string;
      exchange: string;
    }) => void;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="mock-connect-step">
      <span data-testid="connect-session">{props.wizardSessionId}</span>
      {/* F1: drive handleConnectSuccess (a re-connect after a member change).
          WizardClient must invalidate any cached syncSnapshot on this path. */}
      <button
        type="button"
        data-testid="connect-success"
        onClick={() =>
          props.onSuccess?.({
            strategyId: "strat-reconnected",
            apiKeyId: "key-reconnected",
            exchange: "okx",
          })
        }
      >
        Connect success
      </button>
      {/* F2: drive the dirty signal so the stepper-gating test can prove a
          forward jump is blocked while connect_key holds unsaved edits. */}
      <button
        type="button"
        data-testid="connect-dirty"
        onClick={() => props.onDirtyChange?.(true)}
      >
        Mark dirty
      </button>
      <button
        type="button"
        data-testid="connect-clean"
        onClick={() => props.onDirtyChange?.(false)}
      >
        Mark clean
      </button>
    </div>
  ),
}));

// WIZ-04: stub the metadata + review steps so the stepper-navigation tests
// observe the active step without depending on either step's internals. The
// pre-existing tests never reach these steps, so the stubs are inert for them.
vi.mock("./steps/MetadataStep", () => ({
  MetadataStep: () => <div data-testid="mock-metadata-step" />,
}));

vi.mock("./steps/ReviewStep", () => ({
  ReviewStep: () => <div data-testid="mock-review-step" />,
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

describe("[94-04] WizardClient — clickable stepper (WIZ-04)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Forward-skip block (T-94-15 / research Pitfall 4). At connect_key with no
  // strategyId, NO forward step is complete, so none is navigable — the render
  // guards at :699/:724 (strategyId && syncSnapshot && metadataDraft) can never
  // be reached with missing deps. This is the RED-under-mutation pin: neuter
  // stepNavigable to always-true and the forward cells appear ⇒ these fail.
  it("blocks forward navigation to steps whose prerequisites are missing", async () => {
    render(<WizardClient initialDraft={null} />);
    await screen.findByTestId("mock-connect-step");

    // Active step (connect_key) is inert (no button); every forward step is
    // non-navigable because its data prerequisites are absent.
    expect(screen.queryByTestId("wizard-step-connect_key")).toBeNull();
    expect(screen.queryByTestId("wizard-step-sync_preview")).toBeNull();
    expect(screen.queryByTestId("wizard-step-metadata")).toBeNull();
    expect(screen.queryByTestId("wizard-step-review")).toBeNull();
    expect(screen.queryByTestId("wizard-step-submit")).toBeNull();
  });

  // "Change nothing, go forward" (T-94-16). After reaching review-eligible
  // state, a backward click then a forward click redoes NO work: handleStepSelect
  // is setStep + persistPointer only, and syncSnapshot/metadataDraft persist in
  // WizardClient state — so the round-trip issues zero network calls (no
  // /api/keys/sync POST, no add-key/set-members POST).
  it("returns forward to a completed step after a backward click with no refetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    // initialDraft seeds strategyId + metadataDraft; syncSnapshot starts null.
    render(<WizardClient initialDraft={DRAFT} />);
    await screen.findByTestId("mock-sync-preview");

    // review is not navigable yet — syncSnapshot is missing (forward-skip block).
    expect(screen.queryByTestId("wizard-step-review")).toBeNull();

    // Complete sync → syncSnapshot set, step advances to metadata.
    fireEvent.click(screen.getByTestId("sync-complete"));
    await screen.findByTestId("mock-metadata-step");

    // Now every lower-ordinal step is complete ⇒ review is navigable.
    await screen.findByTestId("wizard-step-review");

    // Inventory network calls, then run the back → forward round-trip.
    const callsBeforeRoundTrip = fetchSpy.mock.calls.length;

    fireEvent.click(screen.getByTestId("wizard-step-sync_preview"));
    await screen.findByTestId("mock-sync-preview");

    fireEvent.click(await screen.findByTestId("wizard-step-review"));
    await screen.findByTestId("mock-review-step");

    // No work redone: the stepper round-trip issued no new fetch calls.
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeRoundTrip);
  });
});

describe("[94.1 F1] WizardClient — stale snapshot invalidation on re-connect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Root cause: handleConnectSuccess set strategyId/apiKeyId/step but NOT
  // syncSnapshot. Combined with `cachedSnapshot={syncSnapshot}` + SyncPreviewStep's
  // unconditional cached-snapshot short-circuit, a user who went back, CHANGED a
  // key/window, and re-continued re-entered sync_preview with the OLD snapshot
  // (member set {A,B}) even though the fresh set was {A,B,C} — finalizing a
  // composite whose displayed provenance ≠ its actual keys. The fix adds
  // setSyncSnapshot(null) so the re-entry re-probes the DB for the CURRENT set.
  //
  // RED without the fix: syncSnapshot survives the re-connect, so
  // SyncPreviewStep receives the stale object → cached-snapshot reads "present".
  it("clears the cached syncSnapshot when a (re)connect succeeds so SyncPreviewStep re-probes instead of rendering the stale snapshot", async () => {
    // initialDraft → mounts on sync_preview with strategyId already set.
    render(<WizardClient initialDraft={DRAFT} />);
    await screen.findByTestId("mock-sync-preview");

    // Complete a sync → syncSnapshot is set (would be the stale cache), advance
    // to metadata.
    fireEvent.click(screen.getByTestId("sync-complete"));
    await screen.findByTestId("mock-metadata-step");

    // Back-nav to connect_key via the clickable stepper (backward always free).
    fireEvent.click(await screen.findByTestId("wizard-step-connect_key"));
    await screen.findByTestId("mock-connect-step");

    // The user changed the key set and re-continued → handleConnectSuccess.
    fireEvent.click(screen.getByTestId("connect-success"));

    // Back on sync_preview: the cached snapshot must have been invalidated so
    // the step re-probes the DB for the CURRENT member set (no stale render).
    await screen.findByTestId("mock-sync-preview");
    expect(screen.getByTestId("cached-snapshot")).toHaveTextContent("null");
  });
});

describe("[94.1 F2] WizardClient — dirty connect_key blocks forward stepper jump", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Root cause: stepCompleted/stepNavigable derived completion purely from
  // WizardClient state (strategyId/syncSnapshot/metadataDraft) with NO knowledge
  // of unsaved MultiKeyConnectStep panel edits. A user who reached review, went
  // back to connect_key, edited a panel, then clicked the review/submit stepper
  // cell (instead of Continue) jumped forward — the client-only edits were never
  // POSTed and the strategy finalized with old members + old snapshot. The fix
  // threads an onDirtyChange signal into stepCompleted('connect_key').
  //
  // RED without the fix: connect_key stays "complete" while dirty, so the
  // forward review/submit cells remain navigable and this assertion fails.
  it("blocks the forward review/submit stepper cells while connect_key holds unsaved edits, and restores them when clean", async () => {
    // initialDraft seeds strategyId + metadataDraft; syncSnapshot starts null.
    render(<WizardClient initialDraft={DRAFT} />);
    await screen.findByTestId("mock-sync-preview");

    // Complete sync → syncSnapshot set, advance to metadata. Now every
    // lower-ordinal step is complete ⇒ review becomes navigable.
    fireEvent.click(screen.getByTestId("sync-complete"));
    await screen.findByTestId("mock-metadata-step");
    await screen.findByTestId("wizard-step-review");

    // Back-nav to connect_key (backward always allowed).
    fireEvent.click(screen.getByTestId("wizard-step-connect_key"));
    await screen.findByTestId("mock-connect-step");

    // Sanity: with connect_key clean, the forward review cell is still navigable.
    await screen.findByTestId("wizard-step-review");

    // The user edits a panel → connect_key reports dirty. Forward jumps must be
    // blocked (review + submit cells disappear); the stale-member finalize hole
    // is closed. Backward remains free.
    fireEvent.click(screen.getByTestId("connect-dirty"));
    await waitFor(() =>
      expect(screen.queryByTestId("wizard-step-review")).toBeNull(),
    );
    expect(screen.queryByTestId("wizard-step-submit")).toBeNull();
    expect(screen.queryByTestId("wizard-step-metadata")).toBeNull();

    // Committing (or clearing) the edit re-opens forward navigation.
    fireEvent.click(screen.getByTestId("connect-clean"));
    await screen.findByTestId("wizard-step-review");
  });
});
