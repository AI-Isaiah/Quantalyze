import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeWizardHmac,
  deriveWizardResumeOverrides,
  formatSavedAt,
  loadWizardState,
  newWizardSessionId,
  saveWizardState,
  type WizardLocalState,
} from "./localStorage";
import { UUID_RE } from "@/lib/utils";

// Regression coverage for the React #418 hydration mismatch on
// /strategies/new/wizard?source=csv. The previous WizardClient pattern
// read localStorage during render via a useRef + conditional assignment.
// `typeof window !== "undefined"` is false on SSR and true on the client
// first render, so the LS-derived `loaded` value drove different
// useState initial values per pass — and the CSV branch in particular
// rendered csv_preview on the client when SSR rendered csv_upload,
// which caused React to unmount the tree.
//
// The fix: extract the LS-derivation logic into this pure helper, call
// it ONLY from a post-mount useEffect (not during render), and apply
// the overrides via setState. SSR + first client render produce
// identical markup; the resumed step arrives on the next paint.
//
// These tests pin the helper's contract so a future patch cannot
// silently re-introduce the trap.

describe("deriveWizardResumeOverrides — pure LS-derivation helper", () => {
  it("returns no overrides when loaded is null (SSR + fresh client)", () => {
    expect(deriveWizardResumeOverrides(null, "csv", null)).toEqual({});
    expect(deriveWizardResumeOverrides(null, "api", "draft-1")).toEqual({});
  });

  describe("CSV branch", () => {
    it("restores csv_upload from LS but carries forward strategyName + sessionId", () => {
      const loaded: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "ls-session-id",
        step: "csv_upload",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(loaded, "csv", null);
      expect(out.step).toBe("csv_upload");
      expect(out.strategyName).toBe("Aurora Capital");
      expect(out.wizardSessionId).toBe("ls-session-id");
      // No server-side draft id on the CSV branch ⇒ banner stays hidden.
      expect(out.showResumeBanner).toBeUndefined();
    });

    it("does NOT restore csv_preview from LS (state-loss recovery)", () => {
      // Regression: WizardClient renders csv_preview conditional on
      // `csvFmt && csvPreview`, which are NOT persisted to LS (the
      // parsed dataset is too large). Restoring step=csv_preview from
      // LS without the dependent state would leave an empty preview
      // body with no recovery path. The fix forces the user back to
      // csv_upload to re-select their file; strategyName persists.
      const loaded: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "ls-session-id",
        step: "csv_preview",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(loaded, "csv", null);
      expect(out.step).toBeUndefined();
      // strategyName + sessionId still carry over so the user keeps
      // their place — they just re-select the file.
      expect(out.strategyName).toBe("Aurora Capital");
      expect(out.wizardSessionId).toBe("ls-session-id");
    });

    it("does NOT restore csv_submit from LS (state-loss recovery)", () => {
      // Same trap as csv_preview — csv_submit renders conditional on
      // `csvFmt && csvPreview`, neither persisted. Restoring it leaves
      // an empty body. The user re-uploads instead.
      const loaded: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "ls-session-id",
        step: "csv_submit",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(loaded, "csv", null);
      expect(out.step).toBeUndefined();
      expect(out.strategyName).toBe("Aurora Capital");
    });

    it("does NOT restore an API-branch step (e.g. sync_preview) on the CSV branch", () => {
      const apiLoaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
        source: "api",
      };
      const out = deriveWizardResumeOverrides(apiLoaded, "csv", null);
      expect(out.step).toBeUndefined();
      // strategyName is CSV-only ⇒ no override from an API payload.
      expect(out.strategyName).toBeUndefined();
    });

    it("does NOT bring strategyName forward when LS source is api", () => {
      const apiLoaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "metadata",
        savedAt: 1_700_000_000_000,
        source: "api",
        // A future writer that accidentally serializes a name on the
        // API branch must not leak it into the CSV input field.
        strategyName: "leaked-from-api-branch" as unknown as string,
      };
      const out = deriveWizardResumeOverrides(apiLoaded, "csv", null);
      expect(out.strategyName).toBeUndefined();
    });
  });

  describe("API branch", () => {
    it("restores connect_key from LS when strategyId matches the server draft", () => {
      const loaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "connect_key",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBe("connect_key");
      expect(out.showResumeBanner).toBeUndefined();
    });

    it("restores sync_preview from LS when strategyId matches the server draft", () => {
      const loaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBe("sync_preview");
    });

    // Regression: /qa 2026-05-21 — clicking "Review and submit" persisted
    // step="submit" to LS, but syncSnapshot + metadataDraft are React-only
    // state. On any resume (refresh, tab close, viewport change that
    // remounts), the wizard restored step="submit" with both deps null,
    // and the conditional `step==="submit" && strategyId && syncSnapshot
    // && metadataDraft && <SubmitStep/>` rendered nothing — leaving the
    // user staring at a blank wizard with no recovery affordance. Same
    // class of bug as the CSV csv_preview/csv_submit traps above. The fix
    // forces resume back to sync_preview so the poll rebuilds the
    // snapshot from the server-side draft + worker output.
    it("does NOT restore metadata step from LS (syncSnapshot is not persisted)", () => {
      const loaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "metadata",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBeUndefined();
      // wizardSessionId still carries so funnel correlation survives.
      expect(out.wizardSessionId).toBe("ls-session-id");
    });

    it("does NOT restore submit step from LS (syncSnapshot + metadataDraft are not persisted)", () => {
      const loaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "submit",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBeUndefined();
      expect(out.wizardSessionId).toBe("ls-session-id");
    });

    it("surfaces the resume banner when strategyId mismatches the server draft", () => {
      const loaded: WizardLocalState = {
        strategyId: "stale-uuid",
        wizardSessionId: "ls-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "fresh-uuid");
      expect(out.step).toBeUndefined();
      expect(out.showResumeBanner).toBe(true);
    });

    it("does NOT restore the LS step when the CSV-sentinel '' strategyId leaks onto the API branch", () => {
      const loaded: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "ls-session-id",
        step: "csv_preview",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora",
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBeUndefined();
      // Mismatch '' vs 'draft-uuid' ⇒ banner.
      expect(out.showResumeBanner).toBe(true);
    });
  });

  it("always carries the wizardSessionId forward so funnel correlation survives resume", () => {
    const loaded: WizardLocalState = {
      strategyId: "draft-uuid",
      wizardSessionId: "ls-session-id",
      step: "sync_preview",
      savedAt: 1_700_000_000_000,
    };
    expect(
      deriveWizardResumeOverrides(loaded, "api", "draft-uuid").wizardSessionId,
    ).toBe("ls-session-id");
    expect(
      deriveWizardResumeOverrides(loaded, "csv", null).wizardSessionId,
    ).toBe("ls-session-id");
  });
});

/**
 * P473 — localStorage tamper / replay defense.
 *
 * Before the fix the wizard wrote plain JSON to localStorage. An
 * attacker (or a curious user via DevTools) could craft an entry
 * pointing at any strategyId and the wizard would happily resume
 * against it — replay + ID-swap surface.
 *
 * The fix is an HMAC-SHA256 envelope `{v, p, h}` where the HMAC key is
 * a per-tab nonce stored in sessionStorage. Verify-on-read drops
 * tampered or cross-tab entries as cold-start. These tests pin:
 *
 *   - Round-trip: save then load returns the same payload.
 *   - Tamper detection: editing the payload after a save invalidates h.
 *   - Cross-tab replay: clearing the sessionStorage nonce invalidates h.
 *   - v1 (unsigned) legacy payloads are rejected as cold-start.
 *   - Malformed envelope (missing fields) returns null.
 */
describe("P473 — HMAC envelope tamper / replay defense", () => {
  // jsdom provides crypto.subtle, but we still wire a minimal
  // localStorage/sessionStorage mock so each test starts clean and the
  // STORAGE_KEY + NONCE_KEY constants don't leak across tests.
  let localStore: Record<string, string>;
  let sessionStore: Record<string, string>;

  beforeEach(() => {
    localStore = {};
    sessionStore = {};
    const localMock = {
      getItem: (k: string) => (k in localStore ? localStore[k] : null),
      setItem: (k: string, v: string) => {
        localStore[k] = v;
      },
      removeItem: (k: string) => {
        delete localStore[k];
      },
      clear: () => {
        localStore = {};
      },
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const sessionMock = {
      getItem: (k: string) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k: string, v: string) => {
        sessionStore[k] = v;
      },
      removeItem: (k: string) => {
        delete sessionStore[k];
      },
      clear: () => {
        sessionStore = {};
      },
      key: () => null,
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
    });
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
    });
  });

  it("saveWizardState then loadWizardState round-trips the payload (signed envelope)", async () => {
    await saveWizardState({
      strategyId: "00000000-0000-4000-8000-000000000001",
      wizardSessionId: "session-1",
      step: "sync_preview",
    });

    // Envelope-shape sanity: stored payload is an object with v/p/h.
    const stored = JSON.parse(localStore["quantalyze_wizard_state_v1"]);
    expect(stored.v).toBe(2);
    expect(typeof stored.p).toBe("string");
    expect(typeof stored.h).toBe("string");
    expect(stored.h.length).toBe(16);

    const loaded = await loadWizardState();
    expect(loaded).not.toBeNull();
    expect(loaded?.strategyId).toBe("00000000-0000-4000-8000-000000000001");
    expect(loaded?.wizardSessionId).toBe("session-1");
    expect(loaded?.step).toBe("sync_preview");
    // savedAt was stamped by saveWizardState — should be present.
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("returns null + warns when the payload is tampered after save (HMAC mismatch)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveWizardState({
      strategyId: "00000000-0000-4000-8000-000000000aaa",
      wizardSessionId: "session-aaa",
      step: "sync_preview",
    });

    // Tamper: rewrite p to point at a different strategyId, keep h.
    const envelope = JSON.parse(localStore["quantalyze_wizard_state_v1"]);
    const tamperedPayload = JSON.stringify({
      ...JSON.parse(envelope.p),
      strategyId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
      ...envelope,
      p: tamperedPayload,
    });

    const loaded = await loadWizardState();
    expect(loaded).toBeNull();
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("localStorage_signature_mismatch"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("rejects a payload signed under a different tab nonce (cross-tab replay)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveWizardState({
      strategyId: "00000000-0000-4000-8000-000000000bbb",
      wizardSessionId: "session-bbb",
      step: "metadata",
    });

    // Simulate a new tab: a fresh sessionStorage nonce.
    sessionStore["quantalyze_wizard_signing_nonce_v1"] =
      "f".repeat(64);

    const loaded = await loadWizardState();
    expect(loaded).toBeNull();
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("localStorage_signature_mismatch"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("rejects pre-fix v1 (unsigned plain JSON) payloads as cold-start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The pre-fix shape: a plain WizardLocalState JSON object stored at
    // STORAGE_KEY. A half-deployed environment must NOT pick this up.
    localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
      strategyId: "00000000-0000-4000-8000-0000000000cc",
      wizardSessionId: "legacy",
      step: "sync_preview",
      savedAt: 1_700_000_000_000,
    });

    const loaded = await loadWizardState();
    expect(loaded).toBeNull();
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("localStorage_signature_mismatch"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("rejects an envelope missing the hmac field as cold-start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
      v: 2,
      p: JSON.stringify({
        strategyId: "00000000-0000-4000-8000-0000000000dd",
        wizardSessionId: "no-hmac",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
      }),
      // h: intentionally missing
    });

    const loaded = await loadWizardState();
    expect(loaded).toBeNull();
    warn.mockRestore();
  });

  // Phase 53 / APPLY-02 — the review steps were added to WizardStepKey +
  // validSteps. A signed envelope pointing at `review` / `csv_review` must
  // round-trip (the recap step resumes), while a step value outside the
  // enum still safe-degrades to cold-start (the includes-guard).
  it("round-trips a 'review' step pointer (APPLY-02 enum extension)", async () => {
    await saveWizardState({
      strategyId: "00000000-0000-4000-8000-000000000eee",
      wizardSessionId: "session-review",
      step: "review",
    });
    const loaded = await loadWizardState();
    expect(loaded).not.toBeNull();
    expect(loaded?.step).toBe("review");
  });

  it("round-trips a 'csv_review' step pointer (APPLY-02 enum extension)", async () => {
    await saveWizardState({
      strategyId: "",
      wizardSessionId: "session-csv-review",
      step: "csv_review",
      source: "csv",
      strategyName: "Aurora Capital",
    });
    const loaded = await loadWizardState();
    expect(loaded).not.toBeNull();
    expect(loaded?.step).toBe("csv_review");
    expect(loaded?.strategyName).toBe("Aurora Capital");
  });

  it("safe-degrades an unknown stored step to cold-start (validSteps guard)", async () => {
    // A future-tab / corrupted payload carrying a step value outside the
    // WizardStepKey enum must be rejected (returns null) rather than
    // resumed — the SSR default then takes over. We forge a VALID HMAC
    // envelope (via the real signing path) so this proves the validSteps
    // includes-guard, not the HMAC check.
    await saveWizardState({
      strategyId: "00000000-0000-4000-8000-000000000fff",
      wizardSessionId: "session-unknown",
      // Cast through unknown: an attacker/old-code-written value the enum
      // does not know about.
      step: "not_a_real_step" as unknown as WizardLocalState["step"],
    });
    const loaded = await loadWizardState();
    expect(loaded).toBeNull();
  });

  it("computeWizardHmac is deterministic for the same (payload, key) pair", async () => {
    const a = await computeWizardHmac("the-payload", "the-key");
    const b = await computeWizardHmac("the-payload", "the-key");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
    expect(a?.length).toBe(16);
  });

  it("computeWizardHmac differs when payload differs (basic tamper-detection invariant)", async () => {
    const a = await computeWizardHmac("payload-A", "the-key");
    const b = await computeWizardHmac("payload-B", "the-key");
    expect(a).not.toBe(b);
  });

  it("computeWizardHmac differs when key differs (per-tab binding invariant)", async () => {
    const a = await computeWizardHmac("the-payload", "key-1");
    const b = await computeWizardHmac("the-payload", "key-2");
    expect(a).not.toBe(b);
  });
});

// M-0590 — formatSavedAt + newWizardSessionId had no colocated coverage.
describe("formatSavedAt — Resume banner relative-time label", () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '' for a non-finite timestamp", () => {
    expect(formatSavedAt(Number.NaN)).toBe("");
    expect(formatSavedAt(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("returns 'just now' for a future timestamp (clock skew) and for <1 minute", () => {
    expect(formatSavedAt(NOW + 60_000)).toBe("just now");
    expect(formatSavedAt(NOW - 30_000)).toBe("just now");
  });

  it("pluralizes minutes correctly (singular at exactly 1)", () => {
    expect(formatSavedAt(NOW - 60_000)).toBe("1 minute ago");
    expect(formatSavedAt(NOW - 5 * 60_000)).toBe("5 minutes ago");
    expect(formatSavedAt(NOW - 59 * 60_000)).toBe("59 minutes ago");
  });

  it("rolls over to hours then days with correct pluralization", () => {
    expect(formatSavedAt(NOW - 60 * 60_000)).toBe("1 hour ago");
    expect(formatSavedAt(NOW - 23 * 60 * 60_000)).toBe("23 hours ago");
    expect(formatSavedAt(NOW - 24 * 60 * 60_000)).toBe("1 day ago");
    expect(formatSavedAt(NOW - 3 * 24 * 60 * 60_000)).toBe("3 days ago");
  });
});

describe("newWizardSessionId — server-side UUID_RE compatibility (M-0590)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a value matching the server-side UUID_RE when crypto.randomUUID is available", () => {
    // The modern path delegates to crypto.randomUUID(), which the
    // /api/strategies/create-with-key route validates via isUuid(UUID_RE).
    const id = newWizardSessionId();
    expect(UUID_RE.test(id)).toBe(true);
  });

  // M-0590: when crypto.randomUUID is undefined (older browsers / restricted
  // environments) the fallback must still emit a canonical 8-4-4-4-12 UUID-v4
  // shape that passes the server-side UUID_RE in
  // /api/strategies/create-with-key. The prior fallback yielded `${ts}-${rnd}`
  // — hex with a SINGLE dash — which FAILED that regex and silently 400'd
  // wizard sessions on those browsers. This guards against regressing back to
  // a non-UUID fallback.
  it("M-0590: crypto.randomUUID-unavailable fallback emits a UUID-v4-shaped id that passes UUID_RE", () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      ...realCrypto,
      randomUUID: undefined,
    } as unknown as Crypto);

    const id = newWizardSessionId();
    expect(UUID_RE.test(id)).toBe(true);
    // Version nibble is 4; variant nibble ∈ {8,9,a,b}.
    expect(id[14]).toBe("4");
    expect(id[19]).toMatch(/[89ab]/);

    vi.unstubAllGlobals();
  });
});
