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
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: unsubscribeMock } } };
      },
    },
  }),
}));

// --- localStorage helpers: control resume overrides per-test. ---
let resumeOverrides: Record<string, unknown> = {};
const clearWizardStateMock = vi.fn();
// Phase 15: capture saveWizardState so the CSV autosave test can assert the
// debounced write of the typed strategy name.
const saveWizardStateMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/wizard/localStorage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadWizardState: vi.fn(async () => null),
    saveWizardState: saveWizardStateMock,
    clearWizardState: () => clearWizardStateMock(),
    newWizardSessionId: () => "ssr-session-throwaway",
    deriveWizardResumeOverrides: () => resumeOverrides,
  };
});

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
