/**
 * Phase 122 / SFOX-08 — NEXT_PUBLIC_SFOX_ENABLED flag gate on the sFOX offer.
 *
 * The public sFOX offer (UI_EXCHANGE_CODES → every chip surface via EXCHANGES,
 * OQ4) is gated behind the `NEXT_PUBLIC_SFOX_ENABLED` env flag, DEFAULT OFF, so
 * the card/badge/e2e ship READY and the founder flips it live only after the
 * backend is unblocked end-to-end (121-03 egress deploy + SFOX-06 validation +
 * phase-123 for active accounts).
 *
 * The load-bearing pins:
 *  - Flag UNSET (default) → UI_EXCHANGE_CODES deep-equals the current 4-tuple and
 *    EXCHANGES deep-equals the current 4 labels — BYTE-IDENTICAL to today.
 *  - Flag === the EXACT string "true" → sfox is appended (5-tuple; EXCHANGES gains
 *    "sFOX").
 *  - Any other value ("1", "TRUE", "on", "") → OFF (strict-equality fail-closed).
 *
 * Because SFOX_UI_ENABLED is a MODULE-SCOPE const read from process.env at import
 * time, each case stubs the env, resets the module registry, and DYNAMIC-imports
 * closed-sets fresh. vi.unstubAllEnvs in afterEach prevents an env-stub leak from
 * bleeding into a sibling test (the Node22 stub-leak lesson).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

async function loadClosedSets() {
  vi.resetModules();
  return import("./closed-sets");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[SFOX-08] NEXT_PUBLIC_SFOX_ENABLED gates the sFOX offer", () => {
  it("flag UNSET (default) → byte-identical to today's 4-tuple offer", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", undefined as unknown as string);
    const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();

    expect(SFOX_UI_ENABLED).toBe(false);
    expect(UI_EXCHANGE_CODES).toEqual(["binance", "okx", "bybit", "deribit"]);
    expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit", "Deribit"]);
    // sfox is NOT offered on any UI-derived surface.
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("sfox")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("sFOX")).toBe(false);
  });

  it('flag === exact "true" → sfox appended; UI_EXCHANGE_CODES + EXCHANGES widen', async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();

    expect(SFOX_UI_ENABLED).toBe(true);
    expect(UI_EXCHANGE_CODES).toEqual([
      "binance",
      "okx",
      "bybit",
      "deribit",
      "sfox",
    ]);
    expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit", "Deribit", "sFOX"]);
  });

  it.each(["1", "TRUE", "True", "on", "yes", ""])(
    'value %j is NOT "true" → OFF (strict-equality fail-closed)',
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", value);
      const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES } = await loadClosedSets();
      expect(SFOX_UI_ENABLED).toBe(false);
      expect((UI_EXCHANGE_CODES as readonly string[]).includes("sfox")).toBe(
        false,
      );
    },
  );

  it("EXCHANGES stays derived from UI_EXCHANGE_CODES through EXCHANGE_DISPLAY (casing cannot drift)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { UI_EXCHANGE_CODES, EXCHANGES, EXCHANGE_DISPLAY } =
      await loadClosedSets();
    expect(EXCHANGES).toEqual(
      UI_EXCHANGE_CODES.map((code) => EXCHANGE_DISPLAY[code]),
    );
  });

  it("FUNDING_EXCHANGES stays 3-value regardless of the sfox flag (Pitfall 2 — untouched)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { FUNDING_EXCHANGES } = await loadClosedSets();
    expect(FUNDING_EXCHANGES).toEqual(["binance", "okx", "bybit"]);
  });
});

/**
 * Phase 153.6-04 / PARITY-04 / OQ-3 — a venue offered on a CLIENT-INSERT surface
 * must be probeable.
 *
 * ── THE HOLE THIS CLOSES BEFORE IT OPENS ────────────────────────────────────
 *
 * `UI_EXCHANGE_CODES` is the offered set behind every client-facing picker —
 * ApiKeyForm, StrategyForm, VerificationForm and the rest — and those surfaces
 * reach the database through a NON-privileged INSERT. A non-privileged INSERT has
 * its `api_keys.attested_venue` NULLed by the BEFORE INSERT trigger, so every key
 * they mint is UNATTESTED, and by finalize-wizard's fail-toward gate an
 * unattested key is PROBED.
 *
 * That composition is correct for every venue that CAN answer a per-key
 * permissions probe, and permanently broken for one that cannot: such a key would
 * be unattested (so always probed) and unprobeable (so the probe always fails
 * permanently) — undeclarable and unsubmittable at once, which is the exact
 * WIZFORM-04 outage, re-created by a one-line edit to a picker's set.
 *
 * ⛔ IT IS A CLASS GUARD, NOT A PIN ON TODAY'S MEMBERS. It names no venue and
 * asserts no tuple; it asserts the INTERSECTION of "client-offered" and
 * "probe-exempt" is empty, so it fires for the SECOND non-probing venue as
 * readily as the first, and it fires whichever side moved.
 *
 * ⚠️ Both flag states are swept. `UI_EXCHANGE_CODES` is chosen at module load
 * from an env flag, so a guard run under one value says nothing about the other —
 * and the sFOX row is precisely the venue RESEARCH Q2 flags as the plausible next
 * member of the opt-out set.
 *
 * Falsified by adding `mt5` to `UI_EXCHANGE_CODES` (measured — see the plan's
 * mutation ledger).
 */
describe("[153.6-04 / OQ-3] no client-offered venue may opt out of the scope probe", () => {
  it.each([undefined, "true"])(
    "NEXT_PUBLIC_SFOX_ENABLED=%s — UI_EXCHANGE_CODES ∩ probe-exempt is EMPTY",
    async (flag) => {
      vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", flag as unknown as string);
      const { UI_EXCHANGE_CODES, venueSupportsScopeProbe } =
        await loadClosedSets();

      // ⛔ ANTI-VACUITY, AND IT IS NOT CEREMONY. An empty offered set satisfies
      // the assertion below for free, and this const is built by a flag-driven
      // ternary — the one shape that can collapse to `[]` from a typo rather
      // than from a decision.
      expect(
        UI_EXCHANGE_CODES.length,
        "UI_EXCHANGE_CODES is empty, so the guard below proves nothing.",
      ).toBeGreaterThan(0);

      const exempt = UI_EXCHANGE_CODES.filter((v) => !venueSupportsScopeProbe(v));
      expect(
        exempt,
        `Venue(s) ${JSON.stringify(exempt)} are offered on a client-facing ` +
          "picker AND opted out of the submit-time scope probe. Keys minted " +
          "from those surfaces are INSERTed by a non-privileged caller, so the " +
          "BEFORE INSERT trigger NULLs their attested_venue and finalize-wizard " +
          "probes them by the fail-toward rule — a probe the venue cannot " +
          "answer. The result is a key that can be connected and never " +
          "submitted. Either give the venue a wizard-only surface (the " +
          "WIZARD_ONLY_EXCHANGE_CODES pattern) or a way to be attested; do NOT " +
          "delete this guard.",
      ).toEqual([]);
    },
  );

  it("the guard reads the CAPABILITY predicate, and the predicate has an opt-out to find", async () => {
    // ⛔ THE SECOND HALF OF THE ANTI-VACUITY FENCE, and the one that matters
    // more. If `scopeProbeSupported` were removed from every capability row —
    // i.e. WIZFORM-04 reverted — `venueSupportsScopeProbe` would answer `true`
    // for everything, the intersection above would be empty forever, and this
    // whole block would pass while asserting nothing at all. The opt-out must
    // EXIST somewhere in the supported set for "it is not in the offered set" to
    // be a claim.
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { SUPPORTED_EXCHANGES, UI_EXCHANGE_CODES, venueSupportsScopeProbe } =
      await loadClosedSets();

    const exemptSomewhere = SUPPORTED_EXCHANGES.filter(
      (v) => !venueSupportsScopeProbe(v),
    );
    expect(
      exemptSomewhere.length,
      "No supported venue opts out of the scope probe, so the emptiness " +
        "asserted above is free. If the capability was removed, WIZFORM-04 was " +
        "reverted.",
    ).toBeGreaterThan(0);
    // …and the offered set is a STRICT subset of the supported one, which is why
    // the two can differ at all. Derived on both sides from the same module, so
    // this is a structural statement about the sets, not a pin on their members.
    expect(UI_EXCHANGE_CODES.length).toBeLessThan(SUPPORTED_EXCHANGES.length);
  });
});
