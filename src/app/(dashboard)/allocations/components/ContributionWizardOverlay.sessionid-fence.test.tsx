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

/**
 * Explicit storage doubles, copied from `WizardClient.csv-burn-persistence
 * .test.tsx` — the sibling that also seeds and reads back through the REAL
 * writer. ⛔ NOT optional here and NOT stylistic: MEASURED on this box (Node
 * 25.8.1), the guarded `window.localStorage?.clear?.()` the preselect spec uses
 * is enough for a file that only WRITES, but Node 25 shadows jsdom's
 * `window.localStorage` with an implementation whose `setItem` IS NOT A
 * FUNCTION. `writeWizardState` catches that, warns, and stores nothing — so the
 * seed silently never existed, `loadWizardState` answered null, and SC-1c
 * passed for the wrong reason while SC-1d failed. CI is Node 22, where jsdom's
 * own implementation works; these doubles make both boxes read the same.
 */
let localStore: Record<string, string>;
let sessionStore: Record<string, string>;

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
  localStore = {};
  sessionStore = {};
  installStorage();
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
 * carries a verifiable HMAC. `apiKeyId` is omitted when `keyId` is undefined —
 * that is the pre-164.2.1 payload shape, not a null one.
 */
async function seedAbandonedDraftOnKeyA(keyId?: string) {
  await saveWizardState({
    strategyId: DRAFT_ON_KEY_A.id,
    wizardSessionId: A_SESSION,
    step: "sync_preview",
    source: "api",
    ...(keyId === undefined ? {} : { apiKeyId: keyId }),
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
});

