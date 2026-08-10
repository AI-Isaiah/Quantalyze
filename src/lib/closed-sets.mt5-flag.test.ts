/**
 * Phase 138 / MT5UI-01 — NEXT_PUBLIC_MT5_ENABLED gates the MT5 wizard offer.
 *
 * MT5_UI_ENABLED is the client-build flag that shows/hides the MT5 add-key card
 * in ConnectKeyStep (mirror of SFOX_UI_ENABLED). This test pins the two
 * load-bearing invariants:
 *  - Flag UNSET (default) / any non-exact value → OFF (strict-equality
 *    fail-closed): "1" / "TRUE" / "True" / "on" / "yes" / "" all read OFF.
 *  - Flag === the EXACT string "true" → ON.
 *  - CRITICAL no-widening pin: even with the flag ON, `mt5` NEVER enters
 *    UI_EXCHANGE_CODES, EXCHANGES, FUNDING_EXCHANGES or CRYPTO_EXCHANGES.
 *
 * ── THE PIN NARROWED, DELIBERATELY (Phase 153.2 / MT5-14 / D-16 / D-20) ──────
 *
 * This pin used to be readable as "mt5 enters NO offered set, ever". That claim
 * was outgrown, and the re-cut happened in the SAME COMMIT as the widening it
 * guards — a widening that is unguarded for even one commit is the thing the pin
 * exists to prevent.
 *
 * WHAT NARROWED. A fifth set, `WIZARD_EXCHANGE_CODES` / `WIZARD_EXCHANGES`, now
 * admits mt5 when the flag is on. MT5-14: the strategy wizard must be able to
 * declare the venue of the key the strategy is literally built on. Refusing that
 * is not a safety property — it is a strategy that cannot say where it trades,
 * which is the HARD BLOCKER the founder hit.
 *
 * WHAT DID NOT NARROW, AND WHY THE PIN GOT WIDER INSTEAD. The four incumbent
 * sets stay mt5-free, and this file now asserts ALL FOUR rather than the two it
 * used to (RESEARCH Table D found the docblock named four sets while the test
 * asserted two — a pin whose prose over-claims its own coverage):
 *   · UI_EXCHANGE_CODES / EXCHANGES — the manager-surface `<Select>`
 *     (ApiKeyForm/StrategyForm/StrategyFilters/MandateForm/PreferencesPanel/
 *     VerificationForm) must not silently gain an unlabeled MT5 option, and the
 *     public "{EXCHANGES.length} exchanges supported" marketing count must not
 *     move (UI-SPEC §MT5-Manager-Parity, RESEARCH Pitfall 2).
 *   · FUNDING_EXCHANGES — enrolling mt5 would feed the sync-funding / reconcile
 *     crons a venue `funding_fetch.py` raises on.
 *   · CRYPTO_EXCHANGES — ⛔ NOT a UI question. Membership there selects √365 over
 *     √252, so an mt5 member would silently inflate Sharpe on every forex/CFD
 *     book (RESEARCH Pitfall 8). A money-math boundary, pinned as one.
 *
 * AND THE PIN GAINED A POSITIVE. D-20 makes Option B honest only if the new set
 * is guarded too: a pin that asserts nothing but ABSENCE cannot fail when the
 * flag turns on, which is the assertion-on-absence defect class this milestone
 * is auditing. So flag ON asserts mt5 IS in the wizard set, and flag OFF asserts
 * the wizard set deep-equals EXCHANGES — an equality, not two more absences.
 *
 * MT5_UI_ENABLED is a MODULE-SCOPE const read from process.env at import time,
 * so each case stubs the env, resets the module registry, and DYNAMIC-imports
 * closed-sets fresh. vi.unstubAllEnvs in afterEach prevents an env-stub leak
 * from bleeding into a sibling test (the Node22-vs-Node25 stub-leak lesson).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

async function loadClosedSets() {
  vi.resetModules();
  return import("./closed-sets");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[MT5UI-01] NEXT_PUBLIC_MT5_ENABLED gates the MT5 wizard offer", () => {
  it("flag UNSET (default) → MT5_UI_ENABLED is false", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const { MT5_UI_ENABLED } = await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(false);
  });

  it('flag === exact "true" → MT5_UI_ENABLED is true', async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED } = await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
  });

  it.each(["1", "TRUE", "True", "on", "yes", ""])(
    'value %j is NOT "true" → OFF (strict-equality fail-closed)',
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", value);
      const { MT5_UI_ENABLED } = await loadClosedSets();
      expect(MT5_UI_ENABLED).toBe(false);
    },
  );

  it("does NOT widen UI_EXCHANGE_CODES / EXCHANGES with mt5, even when the flag is ON", async () => {
    // The manager <Select> derives from UI_EXCHANGE_CODES and must not silently
    // gain an unlabeled MT5 option; EXCHANGES.length is the public marketing
    // count. MT5-14 gave the wizard its OWN set precisely so neither moves.
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
  });

  it("keeps UI_EXCHANGE_CODES mt5-free when the flag is OFF too", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const { UI_EXCHANGE_CODES, EXCHANGES } = await loadClosedSets();
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
  });

  // ── The two negatives the pin's PROSE always claimed and its CODE never
  // asserted (RESEARCH Table D). Added by 153.2-04 in the same commit that
  // widened the wizard set, because "mt5 enters exactly one new set" is only a
  // meaningful claim if the other four are actually checked.
  it("does NOT widen FUNDING_EXCHANGES with mt5, even when the flag is ON", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED, FUNDING_EXCHANGES } = await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
    expect(
      (FUNDING_EXCHANGES as readonly string[]).includes("mt5"),
      "FUNDING_EXCHANGES is the TS mirror of the SQL funding_fees_exchange_check " +
        "and funding_fetch.py's _FUNDING_BUCKET_HOURS. Enrolling mt5 would make " +
        "every sync-funding / reconcile cron run hit `funding_fetch.py raise " +
        "ValueError` for that key.",
    ).toBe(false);
  });

  it("does NOT widen CRYPTO_EXCHANGES with mt5, even when the flag is ON — the √365/√252 boundary", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED, CRYPTO_EXCHANGES, isCryptoExchange } =
      await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
    expect(
      (CRYPTO_EXCHANGES as readonly string[]).includes("mt5"),
      "⛔ MONEY MATH, not UI. CRYPTO_EXCHANGES membership selects √365 over √252 " +
        "for Sharpe / Sortino / volatility. mt5 is forex/CFD = traditional √252 " +
        "(MT5RECON-02), so admitting it here would inflate an MT5 book's Sharpe " +
        "~×1.20 against crypto peers on the allocator-facing ranking — a " +
        "trust-integrity defect that no UI requirement may cause.",
    ).toBe(false);
    // The predicate, not just the array: every risk-metric caller reads THIS.
    expect(isCryptoExchange("mt5")).toBe(false);
    expect(isCryptoExchange("MT5")).toBe(false);
  });

  // ── The POSITIVE (D-20). Without this the pin could only ever assert absence,
  // so flipping the flag on could not fail it — and a guard that cannot fail
  // when its subject changes is the defect this milestone is auditing.
  it("DOES widen the wizard-declarable set with mt5 when the flag is ON — MT5-14", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED, WIZARD_EXCHANGE_CODES, WIZARD_EXCHANGES, EXCHANGES } =
      await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
    expect(
      (WIZARD_EXCHANGE_CODES as readonly string[]).includes("mt5"),
      "MT5-14: the metadata step must be able to declare the venue of the key " +
        "the strategy is built on. Without this member no MT5 chip exists, so " +
        "the preselect from detectedExchange has nothing to select.",
    ).toBe(true);
    expect((WIZARD_EXCHANGES as readonly string[]).includes("MT5")).toBe(true);
    // …and it is EXACTLY one member more than the public set — the wizard set is
    // a narrow superset, never an independent list that could drift from it.
    expect(WIZARD_EXCHANGES.length).toBe(EXCHANGES.length + 1);
    expect([...WIZARD_EXCHANGES].slice(0, EXCHANGES.length)).toEqual([
      ...EXCHANGES,
    ]);
  });

  it("flag OFF ⇒ the wizard set is BYTE-IDENTICAL to EXCHANGES (an equality, not two absences)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const { WIZARD_EXCHANGE_CODES, WIZARD_EXCHANGES, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();
    expect((WIZARD_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(
      false,
    );
    expect((WIZARD_EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
    // Stated as an EQUALITY so a future third wizard-only venue that slipped in
    // behind some other flag reddens here, which two `includes(...) === false`
    // rows could never do.
    expect([...WIZARD_EXCHANGES]).toEqual([...EXCHANGES]);
    expect([...WIZARD_EXCHANGE_CODES]).toEqual([...UI_EXCHANGE_CODES]);
  });

  it("canonicalizeWizardExchange resolves mt5 → MT5 only when the flag is ON", async () => {
    // The preselect is `canonicalizeWizardExchange(detectedExchange)`, and the
    // chip group matches case-sensitively. This is the ONE line that makes the
    // venue of a connected MT5 key match its own chip (RESEARCH Finding 5).
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const on = await loadClosedSets();
    expect(on.canonicalizeWizardExchange("mt5")).toBe("MT5");
    expect(on.canonicalizeWizardExchange("okx")).toBe("OKX");

    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const off = await loadClosedSets();
    // Unknown name returned UNCHANGED — the constants.ts contract, preserved, so
    // a lowercase "mt5" is seeded into state and renders nowhere, exactly as it
    // does today.
    expect(off.canonicalizeWizardExchange("mt5")).toBe("mt5");
    expect(off.canonicalizeWizardExchange("okx")).toBe("OKX");
  });
});
