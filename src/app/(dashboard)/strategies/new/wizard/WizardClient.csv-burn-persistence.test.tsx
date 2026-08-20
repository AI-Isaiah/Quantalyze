/** @vitest-environment jsdom */
/**
 * RT-3 (v1.19 xhigh red team, Phase 146.1-07) — the burned CSV-submit
 * fingerprint SURVIVES A RELOAD.
 *
 * ⚠️ RT-3 IS DEFENSE IN DEPTH, AND THIS FILE MUST NOT BE READ AS MORE THAN
 * THAT. The OPERATIVE fence against a changed resubmit being merged onto an
 * already-committed strategy is the SERVER-side equality refusal at
 * `src/app/api/strategies/csv-finalize/route.ts:820-863` (shipped 2026-08-18),
 * pinned by `src/__tests__/csv-finalize-cross-submission-merge.test.ts`.
 * Nothing here licenses weakening that arm.
 *
 * THE HOLE THIS CLOSES. `WizardClient.csv-durable-mint.test.tsx` pins the
 * CR-01 fence WITHIN one page life: after a failed submit, a change to the name
 * or the series mints a fresh `wizard_session_id`, so the server's 23505
 * idempotency arm can only ever fire for a genuine repeat. But the burn lived
 * in a `useRef` while `wizardSessionId` — the very id the burn exists to retire
 * — was persisted in the signed envelope. A refresh or a tab restore therefore
 * brought back the SPENT session id with nothing left to retire it, and the
 * resume path is exactly where a user comes back with a corrected file.
 *
 * ⭐ THE ORACLE IS THE OBSERVABLE OUTCOME — after a simulated reload, does a
 * CHANGED submission still mint a fresh session id? — never "does the stored
 * payload contain a field". A field that round-trips but is read by nothing is
 * a helper, not wiring. The storage contract itself is pinned separately in
 * `src/lib/wizard/localStorage.test.ts`.
 *
 * SIMULATED RELOAD = unmount the component (destroying every ref and all React
 * state) while leaving localStorage AND sessionStorage intact. That is exactly
 * what a browser reload does: sessionStorage survives a reload of the same tab
 * and is cleared only on tab close, which is why the per-tab HMAC nonce still
 * verifies the envelope afterwards. The real `saveWizardState` /
 * `loadWizardState` run here — only `newWizardSessionId` is spied, so mints are
 * countable.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Navigation ---
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams("source=csv"),
}));

// --- Analytics ---
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

// --- Supabase auth ---
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

// --- localStorage helpers: REAL save/load/derive (that is the point of this
// file), with ONLY the mint spied so sessions are countable. ---
const newWizardSessionIdMock = vi.fn(
  () => `mint-${newWizardSessionIdMock.mock.calls.length}`,
);
vi.mock("@/lib/wizard/localStorage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    newWizardSessionId: () => newWizardSessionIdMock(),
  };
});

const PREVIEW = {
  row_count: 12,
  date_range: { start: "2024-01-01", end: "2024-12-31" },
  columns_detected: ["date", "daily_return"],
} as const;

let uploadPayload: {
  fmt: string;
  preview: typeof PREVIEW;
  dailyReturnsSeries?: { date: string; daily_return: number }[];
  validationPassed: boolean;
  strategyName: string;
};

vi.mock("./steps/CsvUploadStep", () => ({
  CsvUploadStep: (props: {
    onSuccess: (p: typeof uploadPayload) => void;
    initialStrategyName?: string;
  }) => (
    <div data-testid="mock-csv-upload">
      {/* The restored name is this file's OBSERVABLE HYDRATION SIGNAL: it is
          only non-empty once the post-mount `loadWizardState` has resolved and
          applied its overrides — the same pass that re-seats the burn. Without
          it the reload cases would race the async HMAC verify and click Upload
          before the fence was armed, which is a flaky green, not a pass. */}
      <span data-testid="restored-name">{props.initialStrategyName ?? ""}</span>
      <button
        type="button"
        data-testid="fire-upload-success"
        onClick={() => props.onSuccess(uploadPayload)}
      >
        upload ok
      </button>
    </div>
  ),
}));

vi.mock("./steps/CsvPreviewStep", () => ({
  CsvPreviewStep: (props: { onContinue: () => void }) => (
    <div data-testid="mock-csv-preview">
      <button type="button" data-testid="preview-continue" onClick={props.onContinue}>
        continue
      </button>
    </div>
  ),
}));

vi.mock("./steps/MetadataStep", () => ({
  MetadataStep: (props: { onComplete: (d: unknown) => void }) => (
    <div data-testid="mock-metadata">
      <button
        type="button"
        data-testid="metadata-complete"
        onClick={() => props.onComplete({ name: "x", category_id: "c" })}
      >
        complete
      </button>
    </div>
  ),
}));

vi.mock("./steps/ReviewStep", () => ({
  ReviewStep: (props: { onContinue: () => void }) => (
    <div data-testid="mock-review">
      <button type="button" data-testid="review-continue" onClick={props.onContinue}>
        submit
      </button>
    </div>
  ),
}));

vi.mock("./steps/CsvSubmitStep", () => ({
  CsvSubmitStep: (props: {
    onSubmitFailed?: () => void;
    onStartNewStrategy: () => void;
  }) => (
    <div data-testid="mock-csv-submit">
      <button
        type="button"
        data-testid="submit-fail"
        onClick={() => props.onSubmitFailed?.()}
      >
        fail
      </button>
      {/* 146.2-08 / B1 — stands in for the real "Start a new strategy" control
          the refusal panel renders. The LABEL and the panel that carries it are
          `CsvSubmitStep`'s to prove (see its own suite); what only this file can
          prove is what the PARENT does when it fires. */}
      <button
        type="button"
        data-testid="start-new-strategy"
        onClick={() => props.onStartNewStrategy()}
      >
        start new
      </button>
    </div>
  ),
}));

let WizardClient: typeof import("./WizardClient").WizardClient;

const SERIES_A = [{ date: "2024-01-01", daily_return: 0.01 }];
const SERIES_B = [{ date: "2024-01-01", daily_return: 0.09 }];

/**
 * Explicit storage doubles. Node 25 shadows jsdom's `window.localStorage` with
 * its own experimental implementation, which has no `clear()`; wiring these
 * also makes the reload boundary explicit — `localStore` and `sessionStore`
 * are the ONLY state that crosses the unmount, which is precisely what a
 * browser reload preserves.
 */
let localStore: Record<string, string>;
let sessionStore: Record<string, string>;

function installStorage() {
  const mk = (get: () => Record<string, string>, set: (v: Record<string, string>) => void) =>
    ({
      getItem: (k: string) => (k in get() ? get()[k] : null),
      setItem: (k: string, v: string) => {
        get()[k] = v;
      },
      removeItem: (k: string) => {
        delete get()[k];
      },
      clear: () => set({}),
      key: () => null,
      length: 0,
    }) as unknown as Storage;
  Object.defineProperty(window, "localStorage", {
    value: mk(
      () => localStore,
      (v) => (localStore = v),
    ),
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: mk(
      () => sessionStore,
      (v) => (sessionStore = v),
    ),
    configurable: true,
  });
}

beforeEach(async () => {
  localStore = {};
  sessionStore = {};
  installStorage();
  newWizardSessionIdMock.mockClear();
  uploadPayload = {
    fmt: "daily_returns",
    preview: PREVIEW,
    dailyReturnsSeries: SERIES_A,
    validationPassed: true,
    strategyName: "Alpha 2024",
  };
  ({ WizardClient } = await import("./WizardClient"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drive csv_upload → csv_submit, firing the current `uploadPayload`. */
async function advanceToSubmit() {
  fireEvent.click(await screen.findByTestId("fire-upload-success"));
  fireEvent.click(await screen.findByTestId("preview-continue"));
  fireEvent.click(await screen.findByTestId("metadata-complete"));
  fireEvent.click(await screen.findByTestId("review-continue"));
  await screen.findByTestId("mock-csv-submit");
}

/**
 * Fail a submit and wait until the burn has reached localStorage. The write is
 * fire-and-forget (async HMAC sign), so a test that unmounted immediately would
 * be racing the signature, not measuring persistence.
 */
/**
 * Block until the post-mount `loadWizardState` has resolved AND its overrides
 * have been applied — the same pass that re-seats the burn ref. The restored
 * strategy name is the signal: it is empty on the SSR-default first paint and
 * only becomes "Alpha 2024" once the async HMAC verify has completed.
 *
 * ⛔ Do NOT replace this with a mint-count wait. The remount's own useState
 * initializer mints once unconditionally, so "a mint happened" is true before
 * hydration and would let the upload click race the fence being armed.
 */
async function awaitHydration() {
  await screen.findByTestId("mock-csv-upload");
  await waitFor(() => {
    expect(screen.getByTestId("restored-name").textContent).toBe("Alpha 2024");
  });
}

/**
 * Read the CURRENTLY PERSISTED wizard envelope. The signed shape is
 * `{ p: <json payload string>, … }`, matching the ad-hoc reads the burn/clear
 * waiters below already do.
 */
function readPersistedEnvelope(): {
  wizardSessionId?: string;
  failedCsvSubmitSig?: string | null;
} {
  const raw = localStore["quantalyze_wizard_state_v1"];
  expect(raw).toBeTruthy();
  return JSON.parse(JSON.parse(raw as string).p);
}

async function failSubmitAndAwaitPersistedBurn() {
  fireEvent.click(screen.getByTestId("submit-fail"));
  await waitFor(() => {
    const raw = localStore["quantalyze_wizard_state_v1"];
    expect(raw).toBeTruthy();
    expect(JSON.parse(JSON.parse(raw as string).p).failedCsvSubmitSig).toBeTruthy();
  });
}

describe("WizardClient — RT-3: the burned CSV submission survives a reload", () => {
  it("mints a fresh session id when the series changes AFTER a reload", async () => {
    const first = render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();

    // --- RELOAD: every ref and all React state die; storage survives. ---
    first.unmount();

    render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    const mintsAfterHydration = newWizardSessionIdMock.mock.calls.length;

    // The user comes back with a CORRECTED file — the resume path the whole
    // fence exists for.
    uploadPayload = { ...uploadPayload, dailyReturnsSeries: SERIES_B };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));

    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterHydration,
      );
    });
  });

  it("mints a fresh session id when the NAME changes after a reload", async () => {
    const first = render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();
    first.unmount();

    render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    const mintsAfterHydration = newWizardSessionIdMock.mock.calls.length;

    uploadPayload = { ...uploadPayload, strategyName: "Alpha 2025" };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));

    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterHydration,
      );
    });
  });

  /**
   * THE NEGATIVE CONTROL, and the reason the mint effect refuses to compare
   * while the series is still undefined. An IDENTICAL retry after a reload must
   * NOT mint: reusing the session id is what lets the server's idempotent 200
   * arm echo the strategy the first attempt committed. A wizard that re-minted
   * on every refresh would turn every honest retry into a SECOND strategy —
   * strictly worse than the pre-RT-3 behaviour it replaces.
   */
  it("does NOT mint when the identical submission is re-uploaded after a reload", async () => {
    const first = render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();
    first.unmount();

    render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    const mintsAfterHydration = newWizardSessionIdMock.mock.calls.length;

    // Same name, an EQUAL-but-new-reference series — the exact shape a
    // re-upload of the same file produces.
    uploadPayload = {
      ...uploadPayload,
      dailyReturnsSeries: [{ date: "2024-01-01", daily_return: 0.01 }],
    };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));
    await screen.findByTestId("mock-csv-preview");
    // Give the effect the same number of ticks the positive cases needed.
    await Promise.resolve();

    expect(newWizardSessionIdMock.mock.calls.length).toBe(mintsAfterHydration);
  });

  /**
   * The CLEAR half. Without a persisted clear, a burn that was legitimately
   * retired in one page life would come back on the next reload and re-mint
   * against content the user never touched — a permanent lockout shipped as a
   * feature. The observable: after the burn is cleared and the page reloads,
   * re-uploading the (now current) file does NOT mint again.
   */
  it("persists the CLEAR, so a retired burn does not resurrect across a reload", async () => {
    const first = render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();
    first.unmount();

    // --- RELOAD 1: the user comes back and uploads the CORRECTED file. That
    // retires the burn (and mints), and the retirement must reach storage. ---
    const second = render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    uploadPayload = { ...uploadPayload, dailyReturnsSeries: SERIES_B };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));
    await waitFor(() => {
      const raw = localStore["quantalyze_wizard_state_v1"];
      expect(
        JSON.parse(JSON.parse(raw as string).p).failedCsvSubmitSig ?? null,
      ).toBeNull();
    });
    second.unmount();

    // --- RELOAD 2: nothing is burned any more, so re-uploading the file that
    // is now current must NOT mint. A resurrected burn would re-mint here and
    // turn every subsequent honest retry into a second strategy. ---
    render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    const mintsAfterHydration = newWizardSessionIdMock.mock.calls.length;

    fireEvent.click(await screen.findByTestId("fire-upload-success"));
    await screen.findByTestId("mock-csv-preview");
    await Promise.resolve();

    expect(newWizardSessionIdMock.mock.calls.length).toBe(mintsAfterHydration);
  });

  /**
   * R4 (v1.19 review of 146.1) — THE PAIR MUST NOT DE-SYNC. The clear case
   * above proves the burn reaches storage; this proves the re-mint's OTHER
   * half does too. The re-mint writes the envelope and swaps the session id;
   * if the write carries the RETIRED id, the reload window between that write
   * and the next save restores a SPENT session id with the fence DISARMED —
   * strictly the worst of both states, and precisely what RT-3 exists to
   * prevent. The changed resubmit then takes the server's equality refusal
   * (409) with no burn left to re-mint it, so the user is stuck. Nothing
   * repairs it: the name autosave is gated on step `csv_upload` and the
   * re-mint fires past it.
   *
   * ⭐ ASSERTING THE PAIR IN ONE CASE IS THE POINT. Either half alone passes
   * on the defective ordering — the burn is cleared (this file's case above
   * already covers that) and the id is *a* valid id (just the spent one).
   * Only "the persisted id is the NEWLY MINTED one AND the burn is cleared"
   * can fail on it.
   */
  it("persists the NEW session id together with the cleared burn, so a reload in the re-mint window cannot resume a spent id", async () => {
    const first = render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();
    first.unmount();

    render(<WizardClient initialDraft={null} />);
    await awaitHydration();
    // The id the failed submit SPENT — restored from the envelope, and the id
    // the server's idempotency arm has already seen.
    const spentSessionId = readPersistedEnvelope().wizardSessionId;
    expect(spentSessionId).toBeTruthy();
    const mintsAfterHydration = newWizardSessionIdMock.mock.calls.length;

    // The user comes back with a CORRECTED file: the re-mint path.
    uploadPayload = { ...uploadPayload, dailyReturnsSeries: SERIES_B };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));

    // The re-mint happened, and its envelope write has LANDED (the cleared
    // burn is the signal — the same one the case above waits on), so what we
    // read next is the state a reload right now would resume from.
    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterHydration,
      );
      expect(readPersistedEnvelope().failedCsvSubmitSig ?? null).toBeNull();
    });

    const mintedSessionId = newWizardSessionIdMock.mock.results.at(-1)?.value as
      | string
      | undefined;
    expect(mintedSessionId).toBeTruthy();
    expect(mintedSessionId).not.toBe(spentSessionId);

    const resumed = readPersistedEnvelope();
    expect(
      resumed.wizardSessionId,
      "a reload here must resume the FRESH session id: the persisted envelope carries the retired one, so the corrected resubmit would replay a spent id with the burn already cleared",
    ).toBe(mintedSessionId);
    expect(
      resumed.failedCsvSubmitSig ?? null,
      "…and it must resume with the burn cleared: a fence armed against content the user already corrected locks the resubmit out forever",
    ).toBeNull();
  });
});

/**
 * ⭐ 146.2-08 / B1 — THE ESCAPE THE CONTENT-KEYED FENCE CANNOT PROVIDE.
 *
 * Every case above is about a CHANGED submission. The refusal this closes is
 * the opposite: the server's 409 `CSV_SESSION_REUSED` burns the session id, and
 * the user's answer is "yes, make this a separate strategy" — the SAME file,
 * deliberately. The re-mint effect above is keyed on the content signature, so
 * it sees `current === burned` and does nothing; the resubmit replays the spent
 * id and takes the same 409, forever. Neither reset control reaches this branch
 * (Start fresh needs `initialDraft`, Delete draft needs `strategyId`; on the CSV
 * branch both are structurally absent), and re-opening the wizard restores the
 * spent id AND the burn from the envelope — so before this the only exits were
 * clearing site data or abandoning the upload.
 *
 * ⭐ THE PAIR IS ASSERTED IN ONE CASE, for the reason the R4 case above gives:
 * either half alone passes on the defective ordering. A handler that wrote the
 * envelope before the swap persists the RETIRED id beside the CLEARED burn, and
 * a reload in that window resumes a spent session with the fence disarmed.
 *
 * ⭐ AND THE UPLOAD MUST SURVIVE. The series is deliberately never persisted
 * (too large for localStorage), so a handler that reset to `csv_upload` would
 * make the refusal cost the user their file rather than one click. The
 * observable is that the submit step is still mounted afterwards and the
 * persisted name is untouched.
 */
describe("WizardClient — 146.2-08 / B1: 'Start a new strategy' mints without discarding the upload", () => {
  it("mints a FRESH session id, clears the burn, persists both together, and keeps the user on csv_submit", async () => {
    render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    await failSubmitAndAwaitPersistedBurn();

    const spentSessionId = readPersistedEnvelope().wizardSessionId;
    expect(spentSessionId).toBeTruthy();
    const mintsBefore = newWizardSessionIdMock.mock.calls.length;

    // The user takes the remedy the refusal panel offers.
    fireEvent.click(screen.getByTestId("start-new-strategy"));

    await waitFor(() => {
      expect(
        newWizardSessionIdMock.mock.calls.length,
        "the escape did not mint: the next submit replays the SAME spent id " +
          "and takes the same 409 — the refusal is permanent",
      ).toBeGreaterThan(mintsBefore);
      expect(readPersistedEnvelope().failedCsvSubmitSig ?? null).toBeNull();
    });

    const mintedSessionId = newWizardSessionIdMock.mock.results.at(-1)?.value as
      | string
      | undefined;
    expect(mintedSessionId).toBeTruthy();
    expect(mintedSessionId).not.toBe(spentSessionId);

    const resumed = readPersistedEnvelope();
    expect(
      resumed.wizardSessionId,
      "a reload here must resume the FRESH id: persisting the retired one " +
        "beside the cleared burn resumes a spent session with the fence " +
        "disarmed — strictly the worst of both states",
    ).toBe(mintedSessionId);
    expect(resumed.failedCsvSubmitSig ?? null).toBeNull();

    // …and the upload is still in hand. Landing back on csv_upload would mean
    // re-uploading a file the wizard is holding, because the series is never
    // persisted.
    expect(
      screen.getByTestId("mock-csv-submit"),
      "the escape threw the user back to the upload step — the series is not " +
        "persisted, so that silently costs them the file they just uploaded",
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mock-csv-upload")).toBeNull();
  });
});
