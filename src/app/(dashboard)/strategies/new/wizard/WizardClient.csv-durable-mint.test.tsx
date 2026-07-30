/** @vitest-environment jsdom */
/**
 * CR-01 (140.4-REVIEW) — the DURABLE half of the CSV double-submit fence.
 *
 * The server floor (`process_key.py` 23505 arm → 409 `CSV_SESSION_REUSED`) and
 * the persist stale-range fence are already pinned by
 * `src/__tests__/csv-finalize-cross-submission-merge.test.ts` and
 * `analytics-service/tests/test_process_key.py`. Those catch a CHANGED-NAME
 * resubmit at the wire; they do NOT stop a same-name / different-FILE resubmit,
 * because `wizard_session_id` is stable across a failed submit
 * (`clearWizardState` fires only on success / delete-draft / start-fresh —
 * `localStorage.ts:390-393`).
 *
 * This file pins the review's PRESCRIBED durable shape: after a FAILED CSV
 * submit, any change to the strategy name OR the daily-return series makes the
 * next submission a NEW submission BY CONSTRUCTION — WizardClient mints a fresh
 * `wizard_session_id`, so the 23505 arm can only ever fire for a genuine repeat.
 *
 * The scenario reproduced verbatim from the review:
 *   1. name "Alpha 2024", series A, advance to csv_submit, submit → FAILS.
 *   2. user steps back, renames to "Alpha 2025", uploads series B, resubmits.
 *   -> pre-fix: same session id → server merges B onto S ("Alpha 2024" + A∪B).
 *   -> post-fix: the material change minted a fresh session id first.
 *
 * The negative control is the other half of the invariant: an UNCHANGED
 * resubmit (same name, an equal-but-new-reference series array) must NOT mint —
 * that is the exact case the idempotent 200 arm exists to serve, and minting
 * there would defeat it.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Navigation ---
const pushMock = vi.fn();
let searchParamsString = "source=csv";
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
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

// --- localStorage helpers. Spy the mint so we can count sessions. ---
const newWizardSessionIdMock = vi.fn(() => `mint-${newWizardSessionIdMock.mock.calls.length}`);
vi.mock("@/lib/wizard/localStorage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadWizardState: vi.fn(async () => null),
    saveWizardState: vi.fn(async () => {}),
    clearWizardState: vi.fn(),
    newWizardSessionId: () => newWizardSessionIdMock(),
    deriveWizardResumeOverrides: () => ({}),
  };
});

// --- Step stubs. Each exposes only the callback THIS scenario drives, plus a
// marker so the current step is observable. onSuccess/onComplete/onContinue
// carry the minimal payloads WizardClient's render guards require. ---

const PREVIEW = {
  row_count: 12,
  date_range: { start: "2024-01-01", end: "2024-12-31" },
  columns_detected: ["date", "daily_return"],
} as const;

// A module-level knob so a single CsvUploadStep stub can fire different
// payloads across the two uploads a test drives.
let uploadPayload: {
  fmt: string;
  preview: typeof PREVIEW;
  dailyReturnsSeries?: { date: string; daily_return: number }[];
  validationPassed: boolean;
  strategyName: string;
} = {
  fmt: "daily_returns",
  preview: PREVIEW,
  dailyReturnsSeries: [{ date: "2024-01-01", daily_return: 0.01 }],
  validationPassed: true,
  strategyName: "Alpha 2024",
};

vi.mock("./steps/CsvUploadStep", () => ({
  CsvUploadStep: (props: { onSuccess: (p: typeof uploadPayload) => void }) => (
    <div data-testid="mock-csv-upload">
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
  ReviewStep: (props: {
    onContinue: () => void;
    onEdit: (step: string) => void;
  }) => (
    <div data-testid="mock-review">
      <button type="button" data-testid="review-continue" onClick={props.onContinue}>
        submit
      </button>
      <button
        type="button"
        data-testid="review-edit-upload"
        onClick={() => props.onEdit("csv_upload")}
      >
        edit upload
      </button>
    </div>
  ),
}));

vi.mock("./steps/CsvSubmitStep", () => ({
  CsvSubmitStep: (props: { onSubmitFailed?: () => void; onBack: () => void }) => (
    <div data-testid="mock-csv-submit">
      <button
        type="button"
        data-testid="submit-fail"
        onClick={() => props.onSubmitFailed?.()}
      >
        fail
      </button>
      <button type="button" data-testid="submit-back" onClick={props.onBack}>
        back
      </button>
    </div>
  ),
}));

let WizardClient: typeof import("./WizardClient").WizardClient;

beforeEach(async () => {
  searchParamsString = "source=csv";
  newWizardSessionIdMock.mockClear();
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

describe("WizardClient — CR-01 durable CSV session mint", () => {
  it("mints a FRESH wizard_session_id when the name changes after a failed submit", async () => {
    render(<WizardClient initialDraft={null} />);

    await advanceToSubmit();
    // A failed submit: the session id is now BURNED for this (name, series).
    fireEvent.click(screen.getByTestId("submit-fail"));
    const mintsAfterFailure = newWizardSessionIdMock.mock.calls.length;

    // User steps back to the upload step and resubmits a DIFFERENT submission.
    fireEvent.click(screen.getByTestId("submit-back")); // → csv_review
    fireEvent.click(await screen.findByTestId("review-edit-upload")); // → csv_upload
    uploadPayload = {
      ...uploadPayload,
      strategyName: "Alpha 2025",
      dailyReturnsSeries: [{ date: "2025-01-01", daily_return: 0.02 }],
    };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));

    // The material change made this a NEW submission — a fresh id was minted,
    // so the server 23505 arm can never resolve it to the first strategy.
    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterFailure,
      );
    });
  });

  it("does NOT mint when the resubmission is unchanged (same name, equal series)", async () => {
    const stableSeries = [{ date: "2024-01-01", daily_return: 0.01 }];
    uploadPayload = {
      fmt: "daily_returns",
      preview: PREVIEW,
      dailyReturnsSeries: stableSeries,
      validationPassed: true,
      strategyName: "Alpha 2024",
    };

    render(<WizardClient initialDraft={null} />);

    await advanceToSubmit();
    fireEvent.click(screen.getByTestId("submit-fail"));
    const mintsAfterFailure = newWizardSessionIdMock.mock.calls.length;

    // Step back and resubmit the SAME name with an EQUAL-but-new-reference
    // series array (the exact shape a re-upload of the same file produces).
    fireEvent.click(screen.getByTestId("submit-back"));
    fireEvent.click(await screen.findByTestId("review-edit-upload"));
    uploadPayload = {
      ...uploadPayload,
      dailyReturnsSeries: [{ date: "2024-01-01", daily_return: 0.01 }],
    };
    fireEvent.click(await screen.findByTestId("fire-upload-success"));
    await screen.findByTestId("mock-csv-preview");

    // No material change → the idempotent 200 arm must still serve this repeat,
    // so the session id is untouched.
    expect(newWizardSessionIdMock.mock.calls.length).toBe(mintsAfterFailure);
  });
});
