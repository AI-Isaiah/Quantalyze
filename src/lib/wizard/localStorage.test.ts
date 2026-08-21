import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeWizardHmac,
  csvSubmissionFingerprint,
  csvSubmissionSignature,
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
  it("returns no overrides when loaded is null AND there is no draft (SSR + fresh client)", () => {
    expect(deriveWizardResumeOverrides(null, "csv", null)).toEqual({});
    expect(deriveWizardResumeOverrides(null, "api", null)).toEqual({});
  });

  // Phase 154 / WIZCONT-01. Previously this answered `{}`, so a server draft
  // reached by a client with NO stored pointer — the ContributionWizardOverlay
  // opening fresh, a second device, cleared storage, an expired tab nonce —
  // mounted straight onto the draft's step with no banner: a silent resume.
  // "The founder always chooses" is the CONTEXT.md lock, so an unpointed draft
  // is offered exactly like a mismatched pointer.
  it("offers the banner when a draft exists and there is NO local pointer at all", () => {
    expect(deriveWizardResumeOverrides(null, "api", "draft-1")).toEqual({
      showResumeBanner: true,
    });
    expect(deriveWizardResumeOverrides(null, "csv", "draft-1")).toEqual({
      showResumeBanner: true,
    });
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

  // ⚠️ RE-SCOPED in Phase 140.4 / SEAMRIM-03, and the reason is recorded here
  // because the old version of this test PINNED THE DEFECT.
  //
  // It used to be `"always carries the wizardSessionId forward so funnel
  // correlation survives resume"` and asserted the carry on BOTH branches from a
  // single source-less (⇒ 'api') payload. Its api→api half was and is correct.
  // Its api→csv half asserted exactly the cross-source leak that made review
  // finding C-2's fix dangerous: an abandoned API draft's idempotency token
  // being replayed into a CSV submission. Deleting the test would have deleted
  // the correct half with it, so it is re-scoped — the true assertion stays, the
  // one that encoded the leak is INVERTED, and the property is named.
  //
  // Funnel correlation is not lost: WizardClient seeds wizardSessionId from
  // newWizardSessionId() on mount, so a declined restore means the CSV wizard
  // correlates under its own fresh token — which is what a distinct submission
  // should carry.
  it("carries the wizardSessionId forward WITHIN a source, and not across one", () => {
    const loaded: WizardLocalState = {
      strategyId: "draft-uuid",
      wizardSessionId: "ls-session-id",
      step: "sync_preview",
      savedAt: 1_700_000_000_000,
    };
    // Same source (absent ⇒ 'api') — unchanged behaviour, resume still works.
    expect(
      deriveWizardResumeOverrides(loaded, "api", "draft-uuid").wizardSessionId,
    ).toBe("ls-session-id");
    // Across the boundary — the leak, now closed.
    expect(
      deriveWizardResumeOverrides(loaded, "csv", null).wizardSessionId,
    ).toBeUndefined();
  });

  // ==========================================================================
  // Phase 140.4 / SEAMRIM-03 — the cross-source session-id gate.
  //
  // One shared STORAGE_KEY serves both wizards and clearWizardState fires only
  // on submit / delete-draft / start-fresh, so an ABANDONED API draft is still
  // sitting there when the user opens the CSV wizard. Carrying its session id
  // across is what made the naive C-2 fix — a two-column
  // (user_id, wizard_session_id) index — break the user's FIRST legitimate CSV
  // submit, permanently, because every retry reuses the same id.
  //
  // This gate is TRIGGER REMOVAL. The guarantee is the three-column index; these
  // cases pin the client half only.
  // ==========================================================================
  describe("cross-source wizardSessionId gate (SEAMRIM-03)", () => {
    it("does NOT leak an abandoned API draft's session id into a CSV resume", () => {
      const abandonedApiDraft: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "api-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
        source: "api",
      };
      const out = deriveWizardResumeOverrides(abandonedApiDraft, "csv", null);
      expect(out.wizardSessionId).toBeUndefined();
    });

    it("does NOT leak a CSV draft's session id into an API resume", () => {
      const abandonedCsvDraft: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "csv-session-id",
        step: "csv_upload",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(
        abandonedCsvDraft,
        "api",
        "draft-uuid",
      );
      expect(out.wizardSessionId).toBeUndefined();
    });

    it("DOES restore a CSV payload's session id on the CSV branch", () => {
      const csvDraft: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "csv-session-id",
        step: "csv_upload",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(csvDraft, "csv", null);
      expect(out.wizardSessionId).toBe("csv-session-id");
    });

    // `source` is optional and documented as meaning 'api' when absent (v1
    // payloads predate the CSV branch). A bare `loaded.source === source` gate
    // would silently stop restoring for every legacy payload on the API branch —
    // a resume regression with no error message. This is the case that catches
    // the missing `?? "api"`.
    it("treats a source-less legacy payload as 'api' and still restores on the API branch", () => {
      const legacyPayload: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "legacy-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(
        legacyPayload,
        "api",
        "draft-uuid",
      );
      expect(out.wizardSessionId).toBe("legacy-session-id");
    });

    // The gate must touch ONLY wizardSessionId. `step` and `strategyName` have
    // their own independent rules directly below it in the source, and a gate
    // written one line too high would silently swallow both.
    it("leaves the existing step and strategyName rules untouched", () => {
      const csvDraft: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "csv-session-id",
        step: "csv_upload",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora Capital",
      };
      const out = deriveWizardResumeOverrides(csvDraft, "csv", null);
      expect(out.step).toBe("csv_upload");
      expect(out.strategyName).toBe("Aurora Capital");
    });
  });

  /**
   * RT-3 — the burn is restored WITH the session id it retired, or not at all.
   * A burn without its session id would arm the re-mint against an id the burn
   * never applied to; a session id without its burn is the pre-RT-3 hole.
   */
  describe("RT-3 burned csv-submit fingerprint", () => {
    const burnedCsvDraft: WizardLocalState = {
      strategyId: "",
      wizardSessionId: "csv-session-id",
      step: "csv_upload",
      savedAt: 1_700_000_000_000,
      source: "csv",
      strategyName: "Aurora Capital",
      failedCsvSubmitSig: "1k.deadbeefcafef00d",
    };

    it("restores the burn together with the CSV session id", () => {
      const out = deriveWizardResumeOverrides(burnedCsvDraft, "csv", null);
      expect(out.wizardSessionId).toBe("csv-session-id");
      expect(out.failedCsvSubmitSig).toBe("1k.deadbeefcafef00d");
    });

    it("does NOT restore the burn when the session id is refused (cross-source)", () => {
      // The CSV payload reaching the API wizard through the ONE shared storage
      // key. The session id is already refused here; the burn must not sneak
      // past on its own.
      const out = deriveWizardResumeOverrides(burnedCsvDraft, "api", "draft-1");
      expect(out.wizardSessionId).toBeUndefined();
      expect(out.failedCsvSubmitSig).toBeUndefined();
    });

    it("does NOT emit a burn override when the payload carries none", () => {
      const out = deriveWizardResumeOverrides(
        { ...burnedCsvDraft, failedCsvSubmitSig: null },
        "csv",
        null,
      );
      expect(out.wizardSessionId).toBe("csv-session-id");
      // Absence, not a falsy placeholder — WizardClient only re-seats its ref
      // on a truthy override, and a "" would be indistinguishable from a burn
      // of the empty submission.
      expect("failedCsvSubmitSig" in out).toBe(false);
    });
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

  // Phase 53 / APPLY-02 — the review steps were added to the WIZARD_STEP_KEYS
  // single source (both the type and the load guard derive from it). A signed
  // envelope pointing at `review` / `csv_review` must round-trip (the recap step
  // resumes), while a step value outside the enum still safe-degrades to
  // cold-start (the includes-guard).
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

  it("safe-degrades an unknown stored step to cold-start (WIZARD_STEP_KEYS guard)", async () => {
    // A future-tab / corrupted payload carrying a step value outside the
    // WizardStepKey enum must be rejected (returns null) rather than
    // resumed — the SSR default then takes over. We forge a VALID HMAC
    // envelope (via the real signing path) so this proves the WIZARD_STEP_KEYS
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

  /**
   * RT-3 (v1.19 red team, Phase 146.1-07) — the burned CSV-submit fingerprint
   * rides INSIDE the signed envelope.
   *
   * ⚠️ These pin the STORAGE CONTRACT only. The behavioural oracle — "after a
   * reload, does a changed submission still re-mint?" — lives in
   * `WizardClient.csv-burn-persistence.test.tsx`, because a field that
   * round-trips but is read by nothing is a helper, not wiring.
   *
   * ⚠️ RT-3 is DEFENSE IN DEPTH. The operative fence is the server-side
   * equality refusal at `csv-finalize/route.ts:820-863`.
   */
  describe("RT-3 — burned csv-submit fingerprint in the signed envelope", () => {
    const BURN = "1k.deadbeefcafef00d";

    it("round-trips the burn inside the signed payload (not a second key)", async () => {
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        source: "csv",
        strategyName: "Alpha 2024",
        failedCsvSubmitSig: BURN,
      });

      // ABSENCE assertion: exactly ONE localStorage key exists, and it is the
      // signed envelope. A second, unsigned key would be tamperable — the whole
      // reason the envelope is signed is that its contents steer behaviour.
      expect(Object.keys(localStore)).toEqual(["quantalyze_wizard_state_v1"]);
      // ...and the burn is not sitting at the envelope's top level either: it
      // must be inside `p`, the string the HMAC actually covers.
      const stored = JSON.parse(localStore["quantalyze_wizard_state_v1"]);
      expect(Object.keys(stored).sort()).toEqual(["h", "p", "v"]);
      expect(JSON.parse(stored.p).failedCsvSubmitSig).toBe(BURN);

      const loaded = await loadWizardState();
      expect(loaded?.failedCsvSubmitSig).toBe(BURN);
    });

    it("loads as null/absent when nothing was ever burned", async () => {
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-clean",
        step: "csv_upload",
        source: "csv",
        strategyName: "Alpha 2024",
      });
      const loaded = await loadWizardState();
      // Absence must be falsy so no downstream reader can mistake it for a burn.
      expect(loaded?.failedCsvSubmitSig ?? null).toBeNull();
    });

    it("STICKY: a save that OMITS the field carries a live burn forward", async () => {
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        source: "csv",
        strategyName: "Alpha 2024",
        failedCsvSubmitSig: BURN,
      });

      // The shape of the eight CSV step-transition saves in WizardClient: they
      // know nothing about the burn. Stepping back from csv_submit to change
      // the file fires one of these — if it clobbered the burn, the fence would
      // be disarmed by the very navigation that precedes the re-upload.
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_review",
        source: "csv",
        strategyName: "Alpha 2024",
      });

      const loaded = await loadWizardState();
      expect(loaded?.step).toBe("csv_review");
      expect(loaded?.failedCsvSubmitSig).toBe(BURN);
    });

    it("an EXPLICIT null clears the burn (a resubmit is not blocked forever)", async () => {
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        source: "csv",
        strategyName: "Alpha 2024",
        failedCsvSubmitSig: BURN,
      });
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-fresh",
        step: "csv_preview",
        source: "csv",
        strategyName: "Alpha 2025",
        failedCsvSubmitSig: null,
      });

      const loaded = await loadWizardState();
      expect(loaded?.failedCsvSubmitSig ?? null).toBeNull();
    });

    it("a TAMPERED burn fails verification instead of taking effect", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await saveWizardState({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        source: "csv",
        strategyName: "Alpha 2024",
        failedCsvSubmitSig: BURN,
      });

      // Rewrite the burn in place, keeping the original h.
      const envelope = JSON.parse(localStore["quantalyze_wizard_state_v1"]);
      localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
        ...envelope,
        p: JSON.stringify({
          ...JSON.parse(envelope.p),
          failedCsvSubmitSig: "1k.0000000000000000",
        }),
      });

      // Not "the tampered burn is ignored" — the WHOLE payload is refused.
      expect(await loadWizardState()).toBeNull();
      expect(
        warn.mock.calls.some((args) =>
          String(args[0]).includes("localStorage_signature_mismatch"),
        ),
      ).toBe(true);
      warn.mockRestore();
    });

    it("refuses a payload whose burn exceeds the length bound", async () => {
      // A validly-SIGNED envelope carrying an over-long burn — the shape a
      // same-tab script could write. The bound is what keeps the megabyte-scale
      // series (deliberately never persisted) out of this envelope.
      const payloadJson = JSON.stringify({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        savedAt: Date.now(),
        source: "csv",
        failedCsvSubmitSig: "x".repeat(65),
      });
      const nonce = sessionStore["quantalyze_wizard_signing_nonce_v1"] ?? "n";
      sessionStore["quantalyze_wizard_signing_nonce_v1"] = nonce.padEnd(32, "0");
      const h = await computeWizardHmac(
        payloadJson,
        sessionStore["quantalyze_wizard_signing_nonce_v1"],
      );
      localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
        v: 2,
        p: payloadJson,
        h,
      });

      expect(await loadWizardState()).toBeNull();
    });

    it("a burn just inside the bound is accepted (the guard is not blanket)", async () => {
      const payloadJson = JSON.stringify({
        strategyId: "",
        wizardSessionId: "session-burn",
        step: "csv_submit",
        savedAt: Date.now(),
        source: "csv",
        failedCsvSubmitSig: "x".repeat(64),
      });
      const nonce = sessionStore["quantalyze_wizard_signing_nonce_v1"] ?? "n";
      sessionStore["quantalyze_wizard_signing_nonce_v1"] = nonce.padEnd(32, "0");
      const h = await computeWizardHmac(
        payloadJson,
        sessionStore["quantalyze_wizard_signing_nonce_v1"],
      );
      localStore["quantalyze_wizard_state_v1"] = JSON.stringify({
        v: 2,
        p: payloadJson,
        h,
      });

      expect((await loadWizardState())?.failedCsvSubmitSig).toBe("x".repeat(64));
    });
  });
});

/**
 * RT-3 — `csvSubmissionFingerprint` is what the fence compares. It must be
 * SENSITIVE to any real edit and INSENSITIVE to array identity, and it must
 * stay bounded no matter how large the series is (the raw signature it digests
 * serialises the whole return series, which this envelope must never carry).
 */
describe("csvSubmissionFingerprint — bounded CSV submission fingerprint", () => {
  const SERIES_A = [
    { date: "2024-01-01", daily_return: 0.01 },
    { date: "2024-01-02", daily_return: -0.02 },
  ];
  // RANK-08 — classification is held CONSTANT across every pair below so each
  // test still isolates the field it names (name / series / boundedness).
  const CAT = "11111111-1111-4111-8111-111111111111";
  const ASSET = "traditional";

  it("is stable for an equal-but-new-reference series (a re-upload must not mint)", () => {
    expect(csvSubmissionFingerprint("Alpha", SERIES_A, CAT, ASSET)).toBe(
      csvSubmissionFingerprint(
        "Alpha",
        [
          { date: "2024-01-01", daily_return: 0.01 },
          { date: "2024-01-02", daily_return: -0.02 },
        ],
        CAT,
        ASSET,
      ),
    );
  });

  it("changes when the name changes", () => {
    expect(csvSubmissionFingerprint("Alpha", SERIES_A, CAT, ASSET)).not.toBe(
      csvSubmissionFingerprint("Alpha 2025", SERIES_A, CAT, ASSET),
    );
  });

  it("changes on an INTERIOR edit that leaves count and boundary dates equal", () => {
    // The exact case the server's boundary-only echo cannot see (C1 residual) —
    // the client fence must at least not be blind to it as well.
    const interiorEdit = [
      { date: "2024-01-01", daily_return: 0.01 },
      { date: "2024-01-02", daily_return: -0.03 },
    ];
    expect(csvSubmissionFingerprint("Alpha", SERIES_A, CAT, ASSET)).not.toBe(
      csvSubmissionFingerprint("Alpha", interiorEdit, CAT, ASSET),
    );
  });

  it("changes when a row is appended", () => {
    expect(csvSubmissionFingerprint("Alpha", SERIES_A, CAT, ASSET)).not.toBe(
      csvSubmissionFingerprint(
        "Alpha",
        [...SERIES_A, { date: "2024-01-03", daily_return: 0.03 }],
        CAT,
        ASSET,
      ),
    );
  });

  it("distinguishes an undefined series from an empty one only via the raw signature's shape", () => {
    // Both serialise to the same rows string by design (`series ?? []`), so the
    // fingerprint agreeing here is the DOCUMENTED behaviour, not a collision.
    expect(csvSubmissionFingerprint("Alpha", undefined, CAT, ASSET)).toBe(
      csvSubmissionFingerprint("Alpha", [], CAT, ASSET),
    );
  });

  it("stays inside the persisted length bound for a 20-year daily series", () => {
    // ~5,000 rows — a raw signature of ~130KB. The persisted field must not
    // grow with the series; that is the whole reason a fingerprint exists.
    const big = Array.from({ length: 5000 }, (_, i) => ({
      date: `20${String(10 + Math.floor(i / 365)).padStart(2, "0")}-01-01`,
      daily_return: i / 100000,
    }));
    const fingerprint = csvSubmissionFingerprint("Alpha", big, CAT, ASSET);
    expect(fingerprint.length).toBeLessThanOrEqual(64);
    // And it is not vacuously constant: a one-row change still moves it.
    const nudged = [...big.slice(0, 4999), { date: "2029-01-01", daily_return: 9.9 }];
    expect(csvSubmissionFingerprint("Alpha", nudged, CAT, ASSET)).not.toBe(
      fingerprint,
    );
  });
});

/**
 * RANK-08 (Phase 159-07, decision D-05 default arm) — CLASSIFICATION IS PART OF
 * THE SUBMISSION'S IDENTITY.
 *
 * The 146.2 classification-conflict 409 refuses a resubmit whose classification
 * disagrees with the one already committed against this `wizard_session_id`.
 * Its remedy is "change the classification and resubmit" — but a fingerprint
 * blind to classification reports NO material change, so the burn is never
 * retired, the spent session id is replayed, and the user takes the same 409
 * forever. Including `category_id` / `asset_class` in the signature is what
 * makes that remedy reachable.
 *
 * The other half of the invariant is the negative control: a TRUE duplicate
 * (same name, same series, same classification) must still produce the SAME
 * fingerprint, so the widening cannot free real duplicates past the fence.
 */
describe("csvSubmissionSignature/Fingerprint — classification (RANK-08)", () => {
  const SERIES = [
    { date: "2024-01-01", daily_return: 0.01 },
    { date: "2024-01-02", daily_return: -0.02 },
  ];
  const CAT_A = "11111111-1111-4111-8111-111111111111";
  const CAT_B = "22222222-2222-4222-8222-222222222222";

  it("changes when ONLY the category changes (the 409's remedy re-mints)", () => {
    expect(
      csvSubmissionFingerprint("Alpha", SERIES, CAT_A, "traditional"),
    ).not.toBe(csvSubmissionFingerprint("Alpha", SERIES, CAT_B, "traditional"));
  });

  it("is IDENTICAL for a true duplicate — same name, series AND classification", () => {
    // The burn fence still blocks the genuine repeat the idempotent 200 arm
    // serves: widening the signature must not free real duplicates.
    expect(csvSubmissionFingerprint("Alpha", SERIES, CAT_A, "crypto")).toBe(
      csvSubmissionFingerprint(
        "Alpha",
        [
          { date: "2024-01-01", daily_return: 0.01 },
          { date: "2024-01-02", daily_return: -0.02 },
        ],
        CAT_A,
        "crypto",
      ),
    );
  });

  it("changes when ONLY the asset class changes", () => {
    // #597 — asset_class drives annualization (√365 crypto / √252 traditional),
    // so it is a genuinely different submission, not a cosmetic edit.
    expect(csvSubmissionFingerprint("Alpha", SERIES, CAT_A, "traditional")).not.toBe(
      csvSubmissionFingerprint("Alpha", SERIES, CAT_A, "crypto"),
    );
  });

  it("keeps every field boundary unambiguous across the two NEW fields", () => {
    // Without the NUL separators these pairs would concatenate identically —
    // the same guarantee the original name/rows boundary already carries.
    expect(csvSubmissionSignature("N", [], "a", "bc")).not.toBe(
      csvSubmissionSignature("N", [], "ab", "c"),
    );
    expect(csvSubmissionSignature("N", [], "", "a")).not.toBe(
      csvSubmissionSignature("N", [], "a", ""),
    );
    // ...and a name that ends where the rows field begins still cannot collide.
    expect(csvSubmissionSignature("N", [], "a", null)).not.toBe(
      csvSubmissionSignature("N\u0000", [], "a", null),
    );
  });

  it("serialises a null classification to a PINNED sentinel, distinct from '' and from 'null'", () => {
    // The exact serialisation is pinned so a future edit cannot silently swap
    // the sentinel and invalidate every persisted burn.
    expect(csvSubmissionSignature("N", [], null, null)).toBe(
      "N\u0000\u0000\u0001\u0000\u0001",
    );
    // Deterministic across calls.
    expect(csvSubmissionFingerprint("N", [], null, null)).toBe(
      csvSubmissionFingerprint("N", [], null, null),
    );
    // A real value that merely LOOKS empty/null is a DIFFERENT submission —
    // the sentinel must not be reachable by user input.
    expect(csvSubmissionFingerprint("N", [], null, null)).not.toBe(
      csvSubmissionFingerprint("N", [], "", ""),
    );
    expect(csvSubmissionFingerprint("N", [], null, null)).not.toBe(
      csvSubmissionFingerprint("N", [], "null", "null"),
    );
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
