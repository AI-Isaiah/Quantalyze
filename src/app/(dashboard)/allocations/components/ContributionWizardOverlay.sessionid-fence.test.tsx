/** @vitest-environment jsdom */
/**
 * Phase 164.2.1 / SESSIONID-FENCE — A PRESELECT FOR KEY B MAY NOT INHERIT KEY
 * A'S SESSION ID.
 *
 * The measured bug: an owner abandons a wizard draft over key A, then clicks
 * "Finish setup →" on key B. The abandoned localStorage payload still holds key
 * A's `wizardSessionId`, `deriveWizardResumeOverrides` restored it on `source`
 * alone, and the `create-with-key` POST carried it — taking 23505 on
 * `strategies_user_wizard_session_source_uniq`. The stored token is STABLE, so
 * pressing Continue again re-sends the same id: the refusal can never be
 * cleared by the user. Phase 164.2 made the sentence describing that dead end
 * honest; this file pins its removal.
 *
 * ⭐ THE WHOLE FILE RENDERS THE REAL WIZARD, and `@/lib/wizard/localStorage` is
 * NOT mocked anywhere in it. That is not a stylistic choice: two sibling
 * WizardClient specs replace `deriveWizardResumeOverrides` with a stub that
 * ignores its arguments, so a test written in that style passes with this entire
 * phase absent. The seed is written through the REAL `saveWizardState` (the
 * envelope is HMAC-signed against a per-tab nonce — a hand-built one would not
 * verify), and the oracle is the `wizard_session_id` actually POSTed.
 *
 * ⛔ THE THROWAWAY-ID TRAP, and why the positive control exists. `WizardClient`
 * seeds `wizardSessionId` from `newWizardSessionId()` on mount, so "the emitted
 * id is not key A's" is TRUE before any fix exists — a click that races the
 * async post-mount `loadWizardState` POSTs the throwaway id and the key-B case
 * passes vacuously. Two things make it honest: the `wizard_start` wait below,
 * and SC-1d, which mounts the SAME seed under key A's own preselect and demands
 * the id IS restored. A gate that declines unconditionally, or a test that never
 * awaited hydration, fails SC-1d.
 *
 * ⛔ THE HYDRATION WAIT IS A `toHaveBeenCalledWith`, NEVER A CALL COUNT.
 * MEASURED on this harness: `setHydrated(true)` commits the `wizard_start` and
 * `wizard_step_view_1` effects in the SAME React commit, so the mock goes 0 → 2
 * with no observable 1 and any `toHaveBeenCalledTimes(1)` wait times out
 * forever. The `mockClear()` in `beforeEach` is what makes the
 * `toHaveBeenCalledWith` wait non-stale: `vi.restoreAllMocks()` does not reset
 * call history on a `vi.fn()` from a module factory, so without it every `it`
 * after the first would resolve instantly on the PREVIOUS test's call and
 * re-enter the trap above.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  flushWizardStateSaves,
  loadWizardState,
  saveWizardState,
} from "@/lib/wizard/localStorage";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { installWizardStorageDoubles } from "@/test/helpers/wizard-storage-doubles";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContributionWizardOverlay } from "./ContributionWizardOverlay";
// Mounted DIRECTLY by the keyless-draft resume pin at the bottom of this file:
// the overlay refuses to OFFER a keyless draft under a live preselect, so the
// prop combination that pin needs cannot be produced through it. Every other
// `it` here goes through the overlay.
import { WizardClient } from "@/app/(dashboard)/strategies/new/wizard/WizardClient";

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

// The landing surface, stubbed exactly as the preselect spec stubs it: it is
// where the wizard arrives, never the subject. It echoes the wizard's OWN
// `apiKeyId` state, which is what the WIRE case reads.
vi.mock("@/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep", () => ({
  SyncPreviewStep: (props: { strategyId: string; apiKeyId: string | null }) => (
    <div data-testid="mock-sync-preview">
      <span data-testid="sync-strategy-id">{props.strategyId}</span>
      <span data-testid="sync-api-key-id">{props.apiKeyId ?? "null"}</span>
    </div>
  ),
}));

/**
 * ⭐ A WRAPPER, NOT A REPLACEMENT — the REAL `MultiKeyConnectStep` still renders,
 * so every `wizard-preselect-continue` assertion in this file keeps running
 * against the real connect UI. What is ADDED is one affordance that emits the
 * step's own `onSuccess` payload with an EMPTY `apiKeyId`.
 *
 * ⚠️ WHY THE PAYLOAD HAS TO BE INJECTED HERE rather than through the create
 * route this file already controls: BOTH `ConnectKeyStep` arms guard
 * `!data.api_key_id` before calling `onSuccess`, and `""` is falsy — so a
 * response carrying an empty key is refused there and never reaches
 * `handleConnectSuccess`. The ONE producer of `""` is this step's OWN success
 * shape, `apiKeyId: first.apiKeyId ?? ""` in its composite `handleContinue`
 * (a member panel whose key id is null coalesces to the empty string). This
 * button emits precisely that shape, so the value under test is the real
 * contract's, not a value invented for the test.
 */
vi.mock(
  "@/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep",
  async (importOriginal) => {
    const actual =
      (await importOriginal()) as typeof import("@/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep");
    const Real = actual.MultiKeyConnectStep;
    return {
      MultiKeyConnectStep: (props: Parameters<typeof Real>[0]) => (
        <>
          <Real {...props} />
          <button
            type="button"
            data-testid="emit-composite-success-empty-key"
            onClick={() =>
              props.onSuccess({
                strategyId: "ssssssss-0000-4000-8000-00000000000e",
                apiKeyId: "",
                exchange: "bybit",
              })
            }
          >
            composite continue with an empty member key
          </button>
        </>
      ),
    };
  },
);

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

/** A draft belonging to KEY_A — the abandoned draft this phase is about. */
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

/**
 * A KEYLESS draft — `api_key_id: null`, which is what a composite or a
 * CSV-sourced draft looks like. It is the input the resume pin below needs,
 * because it is the ONLY shape where "the draft's own key" and "the wizard's
 * `apiKeyId` state" can disagree.
 */
const KEYLESS_DRAFT = {
  ...DRAFT_ON_KEY_A,
  id: "dddddddd-0000-4000-8000-000000000002",
  api_key_id: null,
};

/**
 * The session id key A's abandoned payload holds. Hex-valid v4 SHAPE on purpose:
 * the only `isUuid(wizard_session_id)` guard today is server-side and `fetch` is
 * mocked here, but a client-side guard added later must refuse these ids for the
 * reason under test rather than turning both cases into a different failure.
 */
const A_SESSION = "aaaaaaaa-0000-4000-8000-000000000001";

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
/** What the next `create-with-key` POST answers. */
let createResponder: () => Promise<Response>;
/** What the draft read answers. */
let draftResponder: () => Promise<Response>;

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
    if (url.startsWith(MEMBERS_URL)) return jsonResponse({ members: [] });
    if (url.startsWith(CREATE_URL)) {
      createCalls.push(
        JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      );
      return createResponder();
    }
    // Anything else is a surprise, and a silent 200 would hide it.
    throw new Error(`unexpected fetch in sessionid-fence spec: ${url}`);
  }) as typeof fetch);
}

beforeEach(async () => {
  createCalls = [];
  createResponder = async () =>
    jsonResponse({
      ok: true,
      strategy_id: "ssssssss-0000-4000-8000-000000000009",
      api_key_id: KEY_B.id,
    });
  draftResponder = async () => jsonResponse({ draft: null, kind: null });
  // ⚠️ DRAIN BEFORE CLEARING — wizard saves are fire-and-forget and a straggler
  // from the previous test lands between the clear and the assertion (the
  // Node-22-only failure the sibling overlay spec records).
  await flushWizardStateSaves();
  // Fresh doubles per test — installing IS the reset. See the helper's docblock
  // for why explicit doubles are load-bearing here rather than cosmetic: without
  // them, on Node 25 the seed silently never lands and SC-1c passes for the
  // wrong reason while SC-1d fails.
  installWizardStorageDoubles();
  // ⛔ See the file header: without this every hydration wait after the first
  // resolves on the PREVIOUS test's `wizard_start` and the click races the
  // async localStorage read.
  vi.mocked(trackForQuantsEventClient).mockClear();
  installRoutes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Key A's abandoned payload, written through the REAL writer so the envelope
 * carries a verifiable HMAC. `apiKeyId` is omitted from the STORED BYTES when
 * `keyId` is undefined — that is the pre-164.2.1 payload shape, not a null one.
 *
 * ⚠️ The omission happens in `JSON.stringify`, not here. `WizardSaveInput` makes
 * the property REQUIRED (a save site that forgets it writes the legacy shape by
 * accident and silently declines forever), so the default `keyId === undefined`
 * is passed through EXPLICITLY and serialisation is what drops it. A caller that
 * means "this payload makes no key claim" has to say so; it cannot omit it.
 */
async function seedAbandonedDraftOnKeyA(keyId?: string) {
  await saveWizardState({
    strategyId: DRAFT_ON_KEY_A.id,
    wizardSessionId: A_SESSION,
    step: "sync_preview",
    source: "api",
    apiKeyId: keyId,
  });
  await flushWizardStateSaves();
  // ⛔ APPLIED-NESS PROBE, not decoration. `writeWizardState` SWALLOWS a storage
  // failure (it warns and returns), so a seed that never landed is invisible —
  // and every "the emitted id is not key A's" assertion in this file is then
  // true for the wrong reason. This is the exact failure the storage doubles
  // above exist for, measured once already. It names itself instead.
  expect(
    await loadWizardState(),
    "The seeded payload did not survive to loadWizardState, so nothing in this " +
      "file is testing the gate. Check the storage doubles above.",
  ).not.toBeNull();
}

/** The saved-key summary, once the deferred wizard mount has settled. */
const findSummary = () => screen.findByTestId("wizard-preselect-summary");

/**
 * The hydration signal. `wizard_start` fires only after `setHydrated(true)`,
 * which React commits in the same batch as `setWizardSessionId(restored)` — so a
 * `wizard_start` call is proof the post-mount `loadWizardState` has resolved AND
 * its overrides are applied. ⛔ Never a call-count wait (file header).
 */
async function awaitHydration(expectedSessionId?: string) {
  await waitFor(() =>
    expect(vi.mocked(trackForQuantsEventClient)).toHaveBeenCalledWith(
      "wizard_start",
      expectedSessionId === undefined
        ? expect.anything()
        : expect.objectContaining({ wizard_session_id: expectedSessionId }),
    ),
  );
}

describe("[164.2.1 / SESSIONID-FENCE] a preselect for key B never inherits key A's wizardSessionId", () => {
  it("SC-1c: does NOT POST key A's stored session id when the wizard is opened over key B", async () => {
    await seedAbandonedDraftOnKeyA(KEY_A.id);

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );
    await findSummary();
    await awaitHydration();

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    const emitted = createCalls[0].wizard_session_id;
    expect(
      emitted,
      "The wizard submitted under key B carrying key A's idempotency token. " +
        "That is the 23505 this phase removes, and because the stored token is " +
        "stable the owner can never clear it by pressing Continue again.",
    ).not.toBe(A_SESSION);
    // It still carries ONE — declining the restore must leave the fresh mint in
    // place, not strip the field and send an untokenised submission.
    expect(typeof emitted).toBe("string");
  });

  it("SC-1d POSITIVE CONTROL: DOES POST key A's stored session id when the same payload is met by key A's own preselect", async () => {
    // ⭐ This is the `it` that gives SC-1c its power. It fails if the gate
    // declines unconditionally (the fence would then be a blunt "never restore")
    // AND it fails if hydration was not really awaited — the wait below is on
    // the RESTORED id itself, so a green here cannot be the throwaway mint.
    await seedAbandonedDraftOnKeyA(KEY_A.id);
    createResponder = async () =>
      jsonResponse({
        ok: true,
        strategy_id: DRAFT_ON_KEY_A.id,
        api_key_id: KEY_A.id,
      });

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_A} />,
    );
    await findSummary();
    await awaitHydration(A_SESSION);

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(
      createCalls[0].wizard_session_id,
      "Same key, same draft — the stored token IS the right one to resend, and " +
        "a gate that drops it here is not a comparison but an unconditional " +
        "decline.",
    ).toBe(A_SESSION);
  });

  // ⭐ THE POPULATION THAT EXISTS TODAY. Every payload in a real browser right
  // now was written before this phase and carries NO `apiKeyId` at all. CONTEXT
  // D-02: absent means we cannot prove the same key, so it DECLINES — the
  // deliberate inversion of the `?? "api"` back-compat idiom, taken because the
  // defaulting population here is precisely the set of drafts carrying the dead
  // end. Cost, accepted on the record: one fresh token. The draft, the resume
  // banner and the user's work are untouched.
  it("SC-1e: does NOT POST a LEGACY payload's session id (no apiKeyId) under a key-B preselect", async () => {
    await seedAbandonedDraftOnKeyA();

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );
    await findSummary();
    await awaitHydration();

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(
      createCalls[0].wizard_session_id,
      "A pre-164.2.1 payload cannot prove which key it was minted under, and " +
        "assuming the common case is exactly the assumption that shipped this " +
        "dead end once already.",
    ).not.toBe(A_SESSION);
    expect(typeof createCalls[0].wizard_session_id).toBe("string");
  });
});

/**
 * WIRE — the gate reads a field somebody has to WRITE, and writing the wrong one
 * is invisible from the fence's own tests.
 *
 * `persistPointer` is the ONE API-branch writer. `handleConnectSuccess` calls
 * `setApiKeyId(result.apiKeyId)` and `persistPointer(...)` in the same tick, so a
 * `persistPointer` that read `apiKeyId` from its closure would stamp the
 * PRE-connect key. ⛔ THE REASON THIS `it` USES A THIRD ID: on the reuse arm the
 * stale closure value is the PRESELECTED key — which is what a preselect test
 * would naturally have the server answer with, making the two indistinguishable.
 * Answering with an id that is NEITHER makes the difference observable.
 */
describe("[164.2.1 / SESSIONID-FENCE] WIRE — the persisted key is the one the connect RESOLVED", () => {
  /** Neither KEY_A nor KEY_B: the key the server says this submit landed on. */
  const RESOLVED_KEY_ID = "cccccccc-0000-4000-8000-00000000000c";

  it("stamps the RESOLVED key into the envelope, not the pre-connect closure value", async () => {
    createResponder = async () =>
      jsonResponse({
        ok: true,
        strategy_id: "ssssssss-0000-4000-8000-00000000000c",
        api_key_id: RESOLVED_KEY_ID,
      });

    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );
    await findSummary();
    await awaitHydration();

    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));

    // The wizard's own STATE moved to the resolved key…
    expect(await screen.findByTestId("mock-sync-preview")).toBeInTheDocument();
    expect(screen.getByTestId("sync-api-key-id")).toHaveTextContent(
      RESOLVED_KEY_ID,
    );

    // …and the ENVELOPE agrees with it. That agreement is the sentence a stale
    // closure violates: state says C, storage says B, and a later mount decides
    // whether to lend its token by reading storage.
    await waitFor(() => {
      const raw = window.localStorage.getItem("quantalyze_wizard_state_v1");
      expect(raw).not.toBeNull();
      const payload = JSON.parse(JSON.parse(raw!).p) as {
        apiKeyId?: string | null;
        step?: string;
      };
      expect(payload.step).toBe("sync_preview");
      expect(payload.apiKeyId).toBe(RESOLVED_KEY_ID);
      // NEGATIVE CONTROL — the preselected key is exactly what the stale
      // closure would have written here.
      expect(
        payload.apiKeyId,
        "The envelope carries the PRE-connect key. `persistPointer` is reading " +
          "`apiKeyId` from its closure instead of taking it as an argument.",
      ).not.toBe(KEY_B.id);
    });
  });

  /**
   * IN-02 — THE WRITER NORMALISES `""`, and this pins the WRITER, not the
   * load-time validator.
   *
   * `persistPointer` writes `apiKeyId: keyId || null`. The `|| null` collapses an
   * empty string, which is a REAL value arriving at this parameter: the composite
   * `MultiKeyConnectStep` coalesces a null member key to `""` in the very
   * `onSuccess` payload `handleConnectSuccess` receives (see the wrapper mock at
   * the top of this file for why the value has to enter there).
   *
   * ⚠️ TWO LAYERS NOW REJECT `""` AND THIS ONE DISCRIMINATES THE WRITER. The
   * load-time validator also refuses an empty `apiKeyId`, but it refuses the
   * WHOLE PAYLOAD at READ time — so it cannot keep `""` out of the stored bytes,
   * only out of a `loadWizardState` result. This assertion reads the ENVELOPE
   * that was just written and never calls `loadWizardState`, so reverting the
   * validator's empty-string arm leaves it green while reverting the writer's
   * `|| null` turns it red. The validator's own arm is pinned separately, at the
   * read layer, in `src/lib/wizard/localStorage.test.ts`.
   *
   * WHY IT MATTERS that `""` never lands: `""` is outside the field's documented
   * domain (an `api_keys.id` or `null`), and a stored `""` meeting a present
   * incoming key would be handed to `sessionKeyMatches` as if it were a key.
   */
  it("IN-02: an EMPTY key from the composite step is stored as null, never as an empty string", async () => {
    render(
      <ContributionWizardOverlay isOpen onClose={vi.fn()} preselectKey={KEY_B} />,
    );
    await findSummary();
    await awaitHydration();

    fireEvent.click(screen.getByTestId("emit-composite-success-empty-key"));

    await waitFor(() => {
      const raw = window.localStorage.getItem("quantalyze_wizard_state_v1");
      expect(raw).not.toBeNull();
      const payload = JSON.parse(JSON.parse(raw!).p) as {
        strategyId?: string;
        apiKeyId?: string | null;
      };
      // Names the writer: this envelope is the one the click caused, not some
      // earlier save. Nothing else in this `it` writes.
      expect(payload.strategyId).toBe("ssssssss-0000-4000-8000-00000000000e");
      expect(
        payload.apiKeyId,
        "The API-branch writer stored the empty string. `persistPointer` is " +
          "dropping its `|| null` normalisation, so a value outside the " +
          "field's documented domain (an `api_keys.id` or `null`) is now in " +
          "the signed envelope, where a later mount would compare it as a key.",
      ).toBeNull();
    });
  });
});

/**
 * WIRE — RESUMING A KEYLESS DRAFT MAY NOT FABRICATE A KEY CLAIM.
 *
 * `handleResume` persists the pointer for the draft the user chose to resume.
 * It used to write `initialDraft.api_key_id ?? apiKeyId`, and the `??` fallback
 * is a FABRICATION on a keyless draft: the state it falls back to seeds from
 * `initialDraft?.api_key_id ?? preselectKey?.id`, so a draft that was never
 * built over a key got the PRESELECTED key stamped onto its payload. The fence
 * downstream compares against exactly what is written here, so a fabricated
 * claim makes a later mount believe the draft belongs to a key it does not.
 *
 * ⚠️ HONEST SCOPE — this is a CONTRACT pin on `handleResume`, not a
 * user-reachable regression today, and the difference is worth stating rather
 * than implying. `ContributionWizardOverlay` only offers a draft when
 * `draft.api_key_id === activePreselect.id`, so a keyless draft is never offered
 * under a live preselect there; the manager route passes no preselect at all. The
 * combination is therefore mounted DIRECTLY here. What it guards is the moment
 * that overlay predicate is relaxed — at which point the wrong expression in
 * `handleResume` becomes reachable with nothing else in the suite noticing.
 *
 * ⛔ AND IT IS NOT VACUOUS: restoring the `?? apiKeyId` fallback turns this `it`
 * red with the preselected key in the message, which is the whole point of
 * mounting the combination rather than waiting for it to become reachable.
 */
describe("[164.2.1 / SESSIONID-FENCE] WIRE — a keyless draft's resume stamps the DRAFT's key, never the preselect", () => {
  it("persists apiKeyId: null when a draft with api_key_id === null is resumed under a live preselect", async () => {
    render(
      <WizardClient
        entryContext="contribution"
        initialDraft={KEYLESS_DRAFT}
        initialDraftKind="api"
        preselectKey={KEY_B}
        onSuccess={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // The banner is what makes `handleResume` reachable at all: with nothing in
    // localStorage, `deriveWizardResumeOverrides` answers `{showResumeBanner:
    // true}` for a draft with no pointer, which is the "the founder always
    // chooses" path rather than a silent resume.
    fireEvent.click(await screen.findByTestId("wizard-resume"));

    await waitFor(() => {
      const raw = window.localStorage.getItem("quantalyze_wizard_state_v1");
      expect(raw).not.toBeNull();
      const payload = JSON.parse(JSON.parse(raw!).p) as {
        strategyId?: string;
        apiKeyId?: string | null;
      };
      // Names the writer: the pointer this resume persisted, for this draft.
      expect(payload.strategyId).toBe(KEYLESS_DRAFT.id);
      expect(
        payload.apiKeyId,
        "The resume stamped a key the draft was never built over — on this " +
          "mount, the PRESELECTED one. `handleResume` is falling back to the " +
          "`apiKeyId` state instead of writing `initialDraft.api_key_id`, and " +
          "the fence downstream compares against exactly what is written here.",
      ).toBeNull();
    });
    // Spelled out separately so a future `null`-vs-preselect regression reports
    // WHICH wrong value was written rather than only that it was not null.
    const payload = JSON.parse(
      JSON.parse(window.localStorage.getItem("quantalyze_wizard_state_v1")!).p,
    ) as { apiKeyId?: string | null };
    expect(payload.apiKeyId).not.toBe(KEY_B.id);
  });
});

