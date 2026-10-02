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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// RANK-08 (159-07) — the classification the metadata step reports. A
// module-level knob, exactly like `uploadPayload` above, so ONE stub can hand
// back DIFFERENT classifications across the two passes a test drives — the
// shape the real MetadataStep produces when the user edits the category or
// asset-class picker and re-continues.
const CAT_A = "11111111-1111-4111-8111-111111111111";
const CAT_B = "22222222-2222-4222-8222-222222222222";
const DEFAULT_METADATA = {
  name: "x",
  categoryId: CAT_A,
  assetClass: "traditional",
};
let metadataPayload: Record<string, unknown> = { ...DEFAULT_METADATA };

vi.mock("./steps/MetadataStep", () => ({
  MetadataStep: (props: { onComplete: (d: unknown) => void }) => (
    <div data-testid="mock-metadata">
      <button
        type="button"
        data-testid="metadata-complete"
        onClick={() => props.onComplete(metadataPayload)}
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
      {/* RANK-08 — the route back to the classification step, which is how a
          user acts on the 146.2 classification-conflict 409's own remedy. */}
      <button
        type="button"
        data-testid="review-edit-metadata"
        onClick={() => props.onEdit("csv_metadata")}
      >
        edit metadata
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
  metadataPayload = { ...DEFAULT_METADATA };
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

/**
 * RANK-08 (Phase 159-07, decision D-05) — THE 409'S REMEDY MUST BE REACHABLE.
 *
 * The 146.2 classification-conflict 409 refuses a resubmit whose classification
 * disagrees with the one already committed against this `wizard_session_id`,
 * and tells the user to change the classification and resubmit. Before this
 * phase the re-mint fingerprint covered only (name, series), so acting on that
 * instruction produced NO material change: the burn was never retired, the
 * spent session id was replayed, and the same 409 came back forever.
 *
 * These drive the change through the component's REAL state flow (the metadata
 * step's own onComplete), not by calling the fingerprint helper directly — the
 * fence has to work in the component, not merely in the pure function.
 */
describe("WizardClient — RANK-08 classification re-mint", () => {
  const STABLE_SERIES = [{ date: "2024-01-01", daily_return: 0.01 }];

  /** Submit → FAIL → step back to the classification step. Returns the mint
   *  count at the moment of the burn. Name and series are held CONSTANT so the
   *  only thing a test can change afterwards is the classification. */
  async function failThenReturnToMetadata(): Promise<number> {
    uploadPayload = {
      fmt: "daily_returns",
      preview: PREVIEW,
      dailyReturnsSeries: STABLE_SERIES,
      validationPassed: true,
      strategyName: "Alpha 2024",
    };
    render(<WizardClient initialDraft={null} />);
    await advanceToSubmit();
    fireEvent.click(screen.getByTestId("submit-fail"));
    const mintsAfterFailure = newWizardSessionIdMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("submit-back")); // → csv_review
    fireEvent.click(await screen.findByTestId("review-edit-metadata")); // → csv_metadata
    await screen.findByTestId("mock-metadata");
    return mintsAfterFailure;
  }

  it("mints a FRESH session id when ONLY the category changes after a failed submit", async () => {
    const mintsAfterFailure = await failThenReturnToMetadata();

    // The user does exactly what the 409 told them to: re-classify.
    metadataPayload = { ...metadataPayload, categoryId: CAT_B };
    fireEvent.click(screen.getByTestId("metadata-complete"));

    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterFailure,
      );
    });
  });

  it("mints a FRESH session id when ONLY the asset class changes", async () => {
    // #597 — asset_class drives annualization (√365 crypto / √252 traditional),
    // so it is a materially different submission, not a cosmetic edit.
    const mintsAfterFailure = await failThenReturnToMetadata();

    metadataPayload = { ...metadataPayload, assetClass: "crypto" };
    fireEvent.click(screen.getByTestId("metadata-complete"));

    await waitFor(() => {
      expect(newWizardSessionIdMock.mock.calls.length).toBeGreaterThan(
        mintsAfterFailure,
      );
    });
  });

  it("does NOT mint when name, series AND classification are all unchanged", async () => {
    // The control that keeps the widening honest: a TRUE duplicate must still
    // fence, so the idempotent 200 arm keeps serving the genuine repeat.
    const mintsAfterFailure = await failThenReturnToMetadata();

    // Re-continue past the classification step having changed nothing.
    fireEvent.click(screen.getByTestId("metadata-complete"));
    await screen.findByTestId("mock-review");

    expect(newWizardSessionIdMock.mock.calls.length).toBe(mintsAfterFailure);
  });
});

/**
 * RANK-08 wiring pin (Pitfall 7). The behavioural tests above pass whenever the
 * fingerprint FUNCTION is right, because every classification edit reachable in
 * today's UI also moves `step` (csv_metadata → csv_review) — and `step` is
 * already a dependency of both hooks, so the effect/callback would refresh even
 * with the classification deps missing. That accident is not a guarantee: a
 * future in-place classification control (or any flow that edits metadata
 * without a step change) would silently resurrect the stale-state failure mode.
 *
 * So the deps get their OWN pin. Removing either name from either array turns
 * this test RED, which is what makes the dep edit non-vacuous.
 */
describe("WizardClient — RANK-08 dep-array wiring", () => {
  it("both csvSubmissionFingerprint hooks list csvCategoryId and csvAssetClass", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx",
      ),
      "utf8",
    );

    const callSites = [...src.matchAll(/csvSubmissionFingerprint\(/g)].map(
      (m) => m.index as number,
    );
    // Non-vacuity: if a call site is ever added or removed, this pin must be
    // revisited rather than silently covering fewer sites than it claims.
    expect(callSites).toHaveLength(2);

    for (const at of callSites) {
      const depStart = src.indexOf("}, [", at);
      const depEnd = src.indexOf("]);", depStart);
      expect(depStart).toBeGreaterThan(at);
      const deps = src.slice(depStart, depEnd);
      // Anchor: we grabbed a dependency array, not an arbitrary slab of file.
      expect(deps.length).toBeLessThan(400);
      expect(deps).toContain("strategyName");
      expect(deps).toContain("csvDailyReturnsSeries");
      // The RANK-08 additions.
      expect(deps).toContain("csvCategoryId");
      expect(deps).toContain("csvAssetClass");
    }
  });
});
