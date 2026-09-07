/** @vitest-environment jsdom */
/**
 * Phase 164.2.1 / SESSIONID-FENCE, review WR-02 — THE CSV BRANCH MUST NOT LOSE
 * ITS RT-3 BURN TO A KEY COMPARISON THAT CANNOT MEAN ANYTHING THERE.
 *
 * THE GAP THIS PINS. `deriveWizardResumeOverrides` declines a stored
 * `wizardSessionId` when the incoming key differs from the stored one, and it
 * declines the `failedCsvSubmitSig` burn WITH it — deliberately, since the two
 * are emitted as a pair (a burn identifies which submission spent THAT id).
 * Five comments shipped with plan 01 asserted that this can never bite the CSV
 * branch because "the CSV branch has no key at all". Nothing enforced that:
 *
 *   · the thirteen CSV save sites stamped the wizard's `apiKeyId` STATE, and
 *   · that state seeds from `initialDraft?.api_key_id ?? preselectKey?.id`, and
 *   · `ContributionWizardOverlay` passes `preselectKey` regardless of source
 *     while rendering its "CSV upload" pill under a live preselect.
 *
 * So: "Finish setup →" on key B, then "CSV upload", mounts the CSV wizard with
 * a key-B claim in hand. Meeting a stored CSV payload (which carries
 * `apiKeyId: null`) the gate declined the CSV session id and took the burn with
 * it — a fresh id with the fence disarmed, which is the exact RT-3 hazard:
 * content a failed attempt already spent gets resubmitted with nothing left to
 * retire the spent id. On the CSV branch a key comparison has no meaning
 * (a CSV submission carries no key), so stripping a burn is the ONLY thing it
 * could ever do there.
 *
 * THE FIX THIS FAILS WITHOUT, stated precisely rather than generously. The fix
 * has two halves and they are NOT equally load-bearing:
 *
 *   1. THE CALL SITE passes a LITERAL `null` for `incomingApiKeyId` when
 *      `source === "csv"`. This is the BEHAVIOURAL half. MEASURED: restoring
 *      the old `initialDraft?.api_key_id ?? preselectKey?.id ?? null`
 *      expression turns the first `it` below RED (the re-mint event never
 *      fires) while the hydration wait still passes, because `strategyName` is
 *      restored outside the key gate. That is the neuter proof for this file.
 *   2. THE THIRTEEN CSV SAVE SITES stamp a literal `null` instead of the
 *      wizard's `apiKeyId` state. ⚠️ MEASURED: putting the state back does NOT
 *      redden the two `it`s above — and the reason is worth writing down rather
 *      than papering over. With half 1 in place EVERY CSV mount claims no key,
 *      so a key stored on a CSV payload is never consulted by the gate, and an
 *      API mount cannot reach it either (the SOURCE gate declines first). Half
 *      2 is therefore not a second fence; it is what makes the field's
 *      DOCUMENTED DOMAIN ("`null` on the CSV branch") true, which is what the
 *      third `it` pins, and what lets the CSV hook dep arrays drop `apiKeyId`.
 *
 * Do not "strengthen" this header into claiming half 2 is independently
 * observable here. It is not, it was checked, and a test file that overstates
 * its own reach is the same defect class as the comments this file exists to
 * make true.
 *
 * ⭐ THE ORACLE IS AN OBSERVABLE OUTCOME, never "the ref holds a string".
 * `failedCsvSubmitSigRef` is private to `WizardClient`. What a live burn DOES
 * is re-mint the session id when the content changes past it, and the re-mint
 * reports the RETIRED id on `wizard_csv_session_reminted`. An event naming the
 * SEEDED session id can only happen if BOTH halves survived the gate: the id
 * (or the event would name a fresh mint) and the burn (or the effect
 * early-returns on `burned === null` and there is no event at all). The
 * negative control below is what proves the event tracks the burn comparison
 * rather than "any upload".
 *
 * ⛔ `@/lib/wizard/localStorage` IS NOT MOCKED. The seed is written through the
 * REAL `saveWizardState` (the envelope is HMAC-signed against a per-tab nonce,
 * so a hand-built one would not verify) and the burn is computed with the REAL
 * `csvSubmissionFingerprint`, so the comparison under test is the production
 * one. Same discipline as the sibling `ContributionWizardOverlay
 * .sessionid-fence.test.tsx`, and for the same reason.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  csvSubmissionFingerprint,
  flushWizardStateSaves,
  loadWizardState,
  saveWizardState,
} from "@/lib/wizard/localStorage";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContributionWizardOverlay } from "./ContributionWizardOverlay";

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

/**
 * The CSV steps are stubbed, not driven: this file is about what the PARENT
 * does with a restored burn. `restored-name` is the hydration signal — it is
 * empty on the SSR-default first paint and only becomes the seeded name once
 * the async `loadWizardState` has resolved AND its overrides are applied, which
 * is the same pass that re-seats the burn ref.
 */
let uploadPayload: {
  fmt: string;
  preview: unknown;
  dailyReturnsSeries: { date: string; daily_return: number }[];
  validationPassed: boolean;
  strategyName: string;
};

vi.mock("@/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep", () => ({
  CsvUploadStep: (props: {
    onSuccess: (p: typeof uploadPayload) => void;
    initialStrategyName?: string;
  }) => (
    <div data-testid="mock-csv-upload">
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

vi.mock("@/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep", () => ({
  CsvPreviewStep: () => <div data-testid="mock-csv-preview" />,
}));

// --- Fixtures --------------------------------------------------------------

/** The key the owner clicked "Finish setup →" on. The CSV branch never submits it. */
const KEY_B = {
  id: "bbbbbbbb-0000-4000-8000-00000000000b",
  exchange: "deribit" as const,
  exchangeLabel: "Deribit",
  keyLabel: "Helios options",
};

const CSV_SESSION = "cccccccc-0000-4000-8000-000000000001";
const SEEDED_NAME = "Alpha 2024";
const SERIES_SPENT = [{ date: "2024-01-01", daily_return: 0.01 }];
const SERIES_CORRECTED = [{ date: "2024-01-01", daily_return: 0.09 }];

const PREVIEW = {
  row_count: 12,
  date_range: { start: "2024-01-01", end: "2024-12-31" },
  columns_detected: ["date", "daily_return"],
};

/**
 * The burn the failed CSV submit left behind, computed with the REAL
 * fingerprint over the content that submit spent. Classification is `null`
 * because `csvMetadataDraft` is unset at `csv_upload` — the state the wizard is
 * actually in when it re-arms this fence after a resume.
 */
const SPENT_BURN = csvSubmissionFingerprint(
  SEEDED_NAME,
  SERIES_SPENT,
  null,
  null,
);

let localStore: Record<string, string>;
let sessionStore: Record<string, string>;

/**
 * ⛔ Explicit storage doubles, copied from the sibling sessionid-fence spec.
 * Node 25 shadows jsdom's `window.localStorage` with an implementation whose
 * `setItem` is not a function; `writeWizardState` SWALLOWS that, so the seed
 * would silently never exist and every assertion here would be vacuous. CI is
 * Node 22, where jsdom's own implementation works — these make both boxes read
 * the same.
 */
function installStorage() {
  const mk = (
    get: () => Record<string, string>,
    set: (v: Record<string, string>) => void,
  ) =>
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

/** The overlay's own draft read. `draft: null` — no draft is offered here. */
function installRoutes() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith("/api/strategies/wizard-draft")) {
      return new Response(JSON.stringify({ draft: null, kind: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // A silent 200 would hide a surprise; nothing else should be called.
    throw new Error(`unexpected fetch in csv-preselect-burn spec: ${url}`);
  }) as typeof fetch);
}

beforeEach(async () => {
  // ⚠️ DRAIN BEFORE CLEARING — wizard saves are fire-and-forget, and a
  // straggler from the previous test lands between the clear and the seed.
  await flushWizardStateSaves();
  localStore = {};
  sessionStore = {};
  installStorage();
  uploadPayload = {
    fmt: "daily_returns",
    preview: PREVIEW,
    dailyReturnsSeries: SERIES_CORRECTED,
    validationPassed: true,
    strategyName: SEEDED_NAME,
  };
  vi.mocked(trackForQuantsEventClient).mockClear();
  installRoutes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The abandoned CSV payload: a failed submit spent `CSV_SESSION` on
 * `SERIES_SPENT`, and the burn recording that is still in storage.
 * `apiKeyId: null` is what the CSV branch writes — that is the whole point.
 */
async function seedBurnedCsvSession() {
  await saveWizardState({
    strategyId: "",
    wizardSessionId: CSV_SESSION,
    step: "csv_upload",
    source: "csv",
    strategyName: SEEDED_NAME,
    failedCsvSubmitSig: SPENT_BURN,
    apiKeyId: null,
  });
  await flushWizardStateSaves();
  // ⛔ APPLIED-NESS PROBE. `writeWizardState` warns and returns on a storage
  // failure, so a seed that never landed is invisible and every assertion below
  // would be true for the wrong reason.
  const probe = await loadWizardState();
  expect(
    probe?.failedCsvSubmitSig,
    "The seeded burn did not survive to loadWizardState, so nothing in this " +
      "file is testing the fence. Check the storage doubles above.",
  ).toBe(SPENT_BURN);
  expect(probe?.apiKeyId).toBeNull();
}

/**
 * Open the overlay over a key-B preselect and toggle to "CSV upload" — the
 * user-reachable sequence WR-02 traced. The toggle remounts `WizardClient`
 * (the overlay's `key` carries the source), so the CSV mount is the one that
 * reads localStorage, and it reads it holding a preselect for key B.
 */
async function openOverlayOnCsvUnderPreselectB() {
  render(
    <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
  );
  fireEvent.click(await screen.findByTestId("overlay-source-csv"));
  await screen.findByTestId("mock-csv-upload");
  // Hydration: the restored name only appears once the post-mount
  // `loadWizardState` has resolved and its overrides are applied — the same
  // pass that re-seats the burn. Clicking before it would race the fence being
  // armed, which is a flaky green rather than a pass.
  await waitFor(() => {
    expect(screen.getByTestId("restored-name").textContent).toBe(SEEDED_NAME);
  });
}

describe("[164.2.1 / WR-02] a key preselect must not strip the CSV branch's RT-3 burn", () => {
  it("keeps the burn armed: a CORRECTED file re-mints and retires the SEEDED session id", async () => {
    await seedBurnedCsvSession();
    await openOverlayOnCsvUnderPreselectB();

    // The user comes back with a corrected file — the resume path RT-3 exists
    // for. `uploadPayload` already carries SERIES_CORRECTED.
    fireEvent.click(screen.getByTestId("fire-upload-success"));

    await waitFor(() => {
      expect(vi.mocked(trackForQuantsEventClient)).toHaveBeenCalledWith(
        "wizard_csv_session_reminted",
        expect.objectContaining({ wizard_session_id: CSV_SESSION }),
      );
    });
    // Spelled out because the failure mode is silent: no event at all reads as
    // "nothing changed" rather than as "the fence was disarmed".
    const reminted = vi
      .mocked(trackForQuantsEventClient)
      .mock.calls.filter((c) => c[0] === "wizard_csv_session_reminted");
    expect(
      reminted,
      "The CSV wizard re-mounted under a key preselect did not retire the " +
        "seeded session id. Either the id or its burn was declined by the " +
        "key gate — and on the CSV branch, which submits no key, that " +
        "comparison can only ever strip a live burn.",
    ).toHaveLength(1);
    expect(reminted[0][1]).toMatchObject({ wizard_session_id: CSV_SESSION });
  });

  /**
   * NEGATIVE CONTROL — without it, the assertion above would also pass for a
   * wizard that re-minted on every upload, which would turn every honest retry
   * into a second strategy (strictly worse than the pre-RT-3 behaviour). The
   * burn must be a COMPARISON, not a trigger.
   */
  it("does NOT re-mint when the IDENTICAL spent content is re-uploaded", async () => {
    await seedBurnedCsvSession();
    // Equal-but-new-reference series: exactly what a re-upload of the same file
    // produces, and what the server's idempotent 200 arm is there to serve.
    uploadPayload = {
      ...uploadPayload,
      dailyReturnsSeries: [{ date: "2024-01-01", daily_return: 0.01 }],
    };
    await openOverlayOnCsvUnderPreselectB();

    fireEvent.click(screen.getByTestId("fire-upload-success"));
    await screen.findByTestId("mock-csv-preview");
    await Promise.resolve();

    expect(
      vi
        .mocked(trackForQuantsEventClient)
        .mock.calls.filter((c) => c[0] === "wizard_csv_session_reminted"),
    ).toHaveLength(0);
  });

  /**
   * THE DOMAIN PIN — half 2 of the fix (see the header), and it is honestly
   * labelled as a domain assertion rather than dressed up as a second fence.
   *
   * `WizardLocalState.apiKeyId` is documented as "the `api_keys.id` this draft
   * was being built over, or `null` on the CSV branch". Before WR-02 that
   * sentence was false on exactly this mount: the thirteen CSV save sites
   * stamped the wizard's `apiKeyId` STATE, which seeds from `preselectKey?.id`,
   * so the debounced name autosave wrote a KEY onto a CSV payload. Nothing
   * reads it today (half 1 makes every CSV mount claim no key, and the SOURCE
   * gate keeps API mounts away from a `source: "csv"` payload) — which is
   * precisely why a test is worth having: a field whose stored value contradicts
   * its own docblock is one call-site change away from being read.
   *
   * ⛔ This `it` is the only thing that fails if the literal `null` stamps are
   * reverted. It is a STORAGE-SHAPE assertion by design; the behavioural oracle
   * lives in the two `it`s above.
   */
  it("DOMAIN: the CSV autosave stamps a literal null, never the preselected key", async () => {
    await seedBurnedCsvSession();
    await openOverlayOnCsvUnderPreselectB();

    // Drive the debounced name autosave: it is gated on `hydrated`, `step ===
    // "csv_upload"` and a non-empty name, all of which hold right now. The
    // restored name re-renders CsvUploadStep, which echoes it back through
    // `onNameChange` in the real step; here we fire the change ourselves, which
    // is the same input the effect sees.
    fireEvent.click(screen.getByTestId("fire-upload-success"));
    await screen.findByTestId("mock-csv-preview");
    await flushWizardStateSaves();

    const raw = localStore["quantalyze_wizard_state_v1"];
    expect(raw).toBeTruthy();
    const payload = JSON.parse(JSON.parse(raw).p) as {
      source?: string;
      apiKeyId?: string | null;
    };
    expect(payload.source).toBe("csv");
    expect(
      payload.apiKeyId,
      "A CSV payload is carrying the PRESELECTED key. The CSV save sites are " +
        "stamping the `apiKeyId` state instead of the literal `null` the " +
        "field's docblock promises, and a CSV submission carries no key.",
    ).toBeNull();
  });
});
