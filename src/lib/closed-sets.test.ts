import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPORTED_EXCHANGES,
  UI_EXCHANGE_CODES,
  FUNDING_EXCHANGES,
  EXCHANGES,
  EXCHANGE_DISPLAY,
  exchangeEnum,
  isSupportedExchange,
  SIGNUP_ROLES,
  SELF_EDITABLE_PREFERENCE_FIELDS,
  ADMIN_ONLY_PREFERENCE_FIELDS,
  LIQUIDITY_PREFERENCES,
  MAGNITUDE_CAPS,
  STRATEGY_ANALYTICS_COMPUTATION_STATUSES,
  isComputedAnalytics,
  isRankableAnalyticsRow,
  PERCENTILE_GATE_COLUMN,
  isCryptoExchange,
  CRYPTO_EXCHANGES,
  VENUE_CAPABILITIES,
  venueSupportsScopeProbe,
  venueIsSubstitutable,
  venueIsSerialized,
  annualizationPeriods,
  blendPeriodsPerYear,
  calendarYears,
} from "./closed-sets";
import { ROLES } from "./types";

// B8 — closed-set registry. These tests pin the registry's contents and the
// derivations that other modules + the UI depend on. A drift here (re-widened
// set, wrong cap, casing mismatch) is exactly the class B8 closes.
describe("closed-sets registry", () => {
  describe("isComputedAnalytics (shared terminal-success gate)", () => {
    // Guards migration 20260707120000's surfacing: complete_with_warnings is a
    // terminal SUCCESS and must gate identically to complete everywhere, or a
    // warned strategy dead-ends (wizard poll hangs, admin 409s, panels blank).
    it("admits BOTH complete and complete_with_warnings", () => {
      expect(isComputedAnalytics("complete")).toBe(true);
      expect(isComputedAnalytics("complete_with_warnings")).toBe(true);
    });

    it("rejects every non-terminal / failed / absent status", () => {
      for (const s of ["pending", "computing", "failed"]) {
        expect(isComputedAnalytics(s)).toBe(false);
      }
      expect(isComputedAnalytics(null)).toBe(false);
      expect(isComputedAnalytics(undefined)).toBe(false);
      expect(isComputedAnalytics("")).toBe(false);
    });

    it("classifies exactly the two success members of the status closed set", () => {
      const computed = STRATEGY_ANALYTICS_COMPUTATION_STATUSES.filter(
        isComputedAnalytics,
      );
      expect(computed).toEqual(["complete", "complete_with_warnings"]);
    });
  });

  describe("isRankableAnalyticsRow (RANK-01 published-percentile gate)", () => {
    // Phase 159. The ONE gate both TS percentile callers use. It exists because
    // a `failed` analytics row can still HOLD KPI values from an earlier
    // attempt — 159-CENSUS.md measured 17 of 18 published PROD strategies in
    // exactly that state — so no `IS NOT NULL` predicate can exclude them. Only
    // the status can.
    it("pins the gate column name (the projection sites compose it)", () => {
      expect(PERCENTILE_GATE_COLUMN).toBe("computation_status");
    });

    it("admits BOTH terminal-success statuses", () => {
      expect(isRankableAnalyticsRow({ computation_status: "complete" })).toBe(true);
      expect(
        isRankableAnalyticsRow({ computation_status: "complete_with_warnings" }),
      ).toBe(true);
    });

    it("rejects every non-terminal and failed status", () => {
      for (const s of ["pending", "computing", "failed"]) {
        expect(isRankableAnalyticsRow({ computation_status: s })).toBe(false);
      }
    });

    it("rejects a null/undefined status and a null/undefined row", () => {
      expect(isRankableAnalyticsRow({ computation_status: null })).toBe(false);
      expect(isRankableAnalyticsRow({ computation_status: undefined })).toBe(false);
      expect(isRankableAnalyticsRow({})).toBe(false);
      expect(isRankableAnalyticsRow(null)).toBe(false);
      expect(isRankableAnalyticsRow(undefined)).toBe(false);
    });

    it("agrees with isComputedAnalytics on EVERY member of the status closed set", () => {
      // Parity-by-construction: the gate DELEGATES rather than re-deriving, so
      // widening the terminal-success set in one place cannot leave the rank
      // gate behind. This is also the SQL twin's contract — the
      // get_verified_cohort_rank cohort predicate lists exactly these members.
      const rankable = STRATEGY_ANALYTICS_COMPUTATION_STATUSES.filter((s) =>
        isRankableAnalyticsRow({ computation_status: s }),
      );
      expect(rankable).toEqual(
        STRATEGY_ANALYTICS_COMPUTATION_STATUSES.filter(isComputedAnalytics),
      );
      expect(rankable).toEqual(["complete", "complete_with_warnings"]);
    });
  });

  describe("asset-class annualization (#597)", () => {
    // The single TS mapping from asset class → periods/year, mirroring the
    // Python √365 crypto / √252 traditional. Every Sharpe/Sortino/vol surface
    // (OG card, sample-basis replica, scenario engine, rolling metrics) derives
    // its basis from here — a drift silently mis-annualizes every crypto card.
    it("annualizationPeriods: crypto → 365, everything else → 252", () => {
      expect(annualizationPeriods("crypto")).toBe(365);
      expect(annualizationPeriods("traditional")).toBe(252);
      // fail-safe: unknown / null / undefined → the conservative 252 default.
      expect(annualizationPeriods("equities")).toBe(252);
      expect(annualizationPeriods(null)).toBe(252);
      expect(annualizationPeriods(undefined)).toBe(252);
      expect(annualizationPeriods("")).toBe(252);
    });

    it("isCryptoExchange: the five crypto venues true, mt5 false (case-insensitive) — MT5RECON-02", () => {
      // The crypto signal is now membership in the EXPLICIT CRYPTO_EXCHANGES
      // subset, NOT the wider SUPPORTED_EXCHANGES allowlist — mt5 is a supported
      // venue but is forex/CFD = TRADITIONAL √252.
      for (const ex of CRYPTO_EXCHANGES) {
        expect(isCryptoExchange(ex)).toBe(true);
        expect(isCryptoExchange(ex.toUpperCase())).toBe(true);
      }
      // mt5 is traditional (forex/CFD √252), NOT crypto. This is the MT5RECON-02
      // narrowing + the DEFERRED unknown→crypto latent-bug guard: an MT5 series
      // annualized on √365 would inflate its Sharpe ~×1.20 vs peers.
      expect(isCryptoExchange("mt5")).toBe(false);
      expect(isCryptoExchange("MT5")).toBe(false);
      expect(isCryptoExchange("nyse")).toBe(false);
      expect(isCryptoExchange(null)).toBe(false);
      expect(isCryptoExchange(undefined)).toBe(false);
      expect(isCryptoExchange("")).toBe(false);
    });

    it("CRYPTO_EXCHANGES mirrors Python CRYPTO_VENUES member-for-member (no silent drift) — MT5RECON-02 / T-136-07", () => {
      // The TS crypto subset must equal analytics-service/services/closed_sets.py
      // CRYPTO_VENUES value-for-value; a venue admitted to one registry only would
      // split the √365/√252 clock silently. Literal pin on the TS side (the Python
      // literal is pinned by plan 136-01's registry test).
      expect([...CRYPTO_EXCHANGES].sort()).toEqual([
        "binance",
        "bybit",
        "deribit",
        "okx",
        "sfox",
      ]);
      // CRYPTO_EXCHANGES ⊂ SUPPORTED_EXCHANGES (compile-time via `satisfies`,
      // asserted at runtime too): every crypto venue is a supported venue…
      for (const ex of CRYPTO_EXCHANGES) {
        expect((SUPPORTED_EXCHANGES as readonly string[]).includes(ex)).toBe(
          true,
        );
      }
      // …but mt5 is a SUPPORTED venue deliberately EXCLUDED from the crypto subset.
      expect((SUPPORTED_EXCHANGES as readonly string[]).includes("mt5")).toBe(
        true,
      );
      expect((CRYPTO_EXCHANGES as readonly string[]).includes("mt5")).toBe(
        false,
      );
    });

    it("wizard default: a detected crypto exchange annualizes √365, mt5/CSV/unknown √252", () => {
      // The MetadataStep default (isCryptoExchange(detectedExchange) → 'crypto'
      // else 'traditional') composed with annualizationPeriods must give 365 for
      // a crypto exchange and 252 for mt5 and the CSV/no-exchange path.
      const fromExchange = (ex: string | null) =>
        annualizationPeriods(isCryptoExchange(ex) ? "crypto" : "traditional");
      expect(fromExchange("binance")).toBe(365);
      expect(fromExchange("deribit")).toBe(365);
      expect(fromExchange("mt5")).toBe(252); // MT5 = forex/CFD = traditional √252
      expect(fromExchange(null)).toBe(252); // CSV upload, no exchange
    });

    it("blendPeriodsPerYear: √365 if ANY leg is crypto OR unknown-class, else √252 (#597 blend rule as revised by RANK-06)", () => {
      // A blended daily return series is calendar-daily (7-day) the moment ANY
      // crypto leg is present, so it has ~365 obs/year; a pure-tradfi blend
      // stays √252.
      //
      // RANK-06 (2026-08-21) DELIBERATELY CHANGES the unknown-leg economics of
      // this pin: `strategies.asset_class` is NOT NULL in the DB, so a leg whose
      // `asset_class` is absent/null/undefined is never an honest "traditional"
      // answer — it is a CALLER PROJECTION GAP. Resolving that gap to 252
      // understates a crypto blend's vol by ~17% and inflates its Sharpe ~×1.20
      // on the allocator-facing ranking, so the unknown leg now fails toward the
      // conservative (crypto) clock.
      expect(
        blendPeriodsPerYear([
          { asset_class: "crypto" },
          { asset_class: "traditional" },
        ]),
      ).toBe(365);
      expect(
        blendPeriodsPerYear([
          { asset_class: "traditional" },
          { asset_class: "traditional" },
        ]),
      ).toBe(252);
      // Empty blend → the conservative pre-#597 252 default (byte-identical).
      // UNCHANGED by RANK-06: "no legs at all" is not a projection gap, there is
      // nothing whose class could have been dropped.
      expect(blendPeriodsPerYear([])).toBe(252);
      // RANK-06 (Test 1 — the defect): a leg object that OMITS asset_class is
      // the exact shape a lossy caller projection produces → 365, not 252.
      expect(blendPeriodsPerYear([{}])).toBe(365);
      // RANK-06 (Test 2): null and undefined are the same projection gap.
      expect(blendPeriodsPerYear([{ asset_class: null }])).toBe(365);
      expect(blendPeriodsPerYear([{ asset_class: undefined }])).toBe(365);
      expect(
        blendPeriodsPerYear([
          { asset_class: null },
          { asset_class: undefined },
          {},
        ]),
      ).toBe(365);
      // A known-traditional leg beside an unknown one still rides 365 — the rule
      // is ANY-crypto-or-unknown, matching the any-crypto flip below.
      expect(
        blendPeriodsPerYear([{ asset_class: "traditional" }, {}]),
      ).toBe(365);
      // One crypto leg flips the whole blend to 365 even beside null legs.
      expect(
        blendPeriodsPerYear([{ asset_class: null }, { asset_class: "crypto" }]),
      ).toBe(365);
      // Exact-match closed set — DB stores lowercase 'crypto'; no case widening.
      // A NON-NULL unrecognized string is NOT a projection gap (the caller did
      // supply a class), so it stays traditional √252: RANK-06 widened nullish,
      // NOT the string matching.
      expect(blendPeriodsPerYear([{ asset_class: "CRYPTO" }])).toBe(252);
    });

    it("blendPeriodsPerYear economics (RANK-06): an unknown-class blend annualizes vol at √(365/252) ≈ 1.204× the traditional blend on the SAME series", () => {
      // ECONOMIC-INVARIANT ORACLE (house testing law): the oracle is the ratio
      // between two annualization clocks — √(365/252), a market-structure
      // constant — plus the textbook definition annual_vol = daily_sd × √periods.
      // Neither is re-derived from blendPeriodsPerYear's own formula, so this pin
      // fails whenever the helper picks the wrong clock for an unknown leg.
      const daily = [0.012, -0.008, 0.02, -0.006, 0.014, -0.011, 0.009, 0.004];
      const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
      // Sample standard deviation (n-1) — the textbook daily-vol estimator.
      const dailySd = Math.sqrt(
        daily.reduce((a, r) => a + (r - mean) ** 2, 0) / (daily.length - 1),
      );
      expect(dailySd).toBeGreaterThan(0); // non-vacuous fixture

      // The SAME series, annualized on the clock each leg-set selects.
      const annualVol = (legs: ReadonlyArray<{ asset_class?: string | null }>) =>
        dailySd * Math.sqrt(blendPeriodsPerYear(legs));

      const unknownLegVol = annualVol([{}]); // projection gap → crypto clock
      const traditionalVol = annualVol([{ asset_class: "traditional" }]);
      const cryptoVol = annualVol([{ asset_class: "crypto" }]);

      // The invariant: the unknown-leg blend rides the SAME clock as an explicit
      // crypto blend, which is √(365/252) louder than the traditional clock.
      expect(unknownLegVol / traditionalVol).toBeCloseTo(
        Math.sqrt(365 / 252),
        12,
      );
      expect(unknownLegVol).toBeCloseTo(cryptoVol, 12);
      // Non-vacuous magnitude check: the defect this closes was a ~17% vol
      // UNDERSTATEMENT (equivalently a ~20% Sharpe inflation), not a rounding
      // nuance — a ratio of 1 (both clocks equal) is the pre-fix state.
      expect(unknownLegVol / traditionalVol).toBeGreaterThan(1.2);
      expect(traditionalVol / unknownLegVol).toBeLessThan(0.84);
    });

    it("calendarYears: elapsed span on the 365.25-day civil clock (the CAGR clock)", () => {
      const DAY = 86_400_000;
      const start = Date.UTC(2024, 0, 1);
      // Exactly 365.25 days → 1.0 calendar years.
      expect(calendarYears(start, start + 365.25 * DAY)).toBeCloseTo(1, 12);
      // Half a civil year.
      expect(calendarYears(start, start + (365.25 / 2) * DAY)).toBeCloseTo(0.5, 12);
      // The OG-card CAGR eligibility boundary: ~347 days is < 0.95y (blocked),
      // ~348 days clears it — proving the gate is calendar- not count-based.
      expect(calendarYears(start, start + 346 * DAY)).toBeLessThan(0.95);
      expect(calendarYears(start, start + 348 * DAY)).toBeGreaterThanOrEqual(0.95);
      // Non-positive / non-finite spans collapse to 0 so callers gate on `> 0`.
      expect(calendarYears(start, start)).toBe(0);
      expect(calendarYears(start, start - DAY)).toBe(0);
      expect(calendarYears(NaN, start)).toBe(0);
    });
  });

  describe("exchanges (value-space A)", () => {
    it("SUPPORTED_EXCHANGES is the canonical lowercase wire form (key-save boundary)", () => {
      // Phase 68 (DRB-02): the key-save boundary admits deribit. Phase 119
      // (SFOX) widened it to admit sfox; Phase 135 (MT5SRC-03) widened it to
      // admit mt5 — all at the TS layer, in lockstep with the pydantic Literals
      // + the SQL CHECK. This is the widened allowlist a key-save request clears
      // at the TS layer. NOTE: the USER-FACING offer (UI_EXCHANGE_CODES /
      // EXCHANGES) stays decoupled — sfox is flag-gated there (SFOX_UI_ENABLED)
      // and mt5 is OUT of the offered set entirely this phase (UI is Phase 138).
      expect(SUPPORTED_EXCHANGES).toEqual([
        "binance",
        "okx",
        "bybit",
        "deribit",
        "sfox",
        "mt5",
      ]);
    });

    it("EXCHANGES (display) is the 4-value UI-offered set — post-Phase-69 flip pin", () => {
      // Phase 69 flipped UI_EXCHANGE_CODES to offer Deribit; EXCHANGES derives
      // from it (NOT the widened SUPPORTED_EXCHANGES), so the marketing count +
      // chips now render 4 exchanges incl. "Deribit". Reverting the flip fails here.
      expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit", "Deribit"]);
    });

    it("UI_EXCHANGE_CODES offers deribit (Phase-69 flip DONE) while FUNDING_EXCHANGES stays 3-value (Phase-70 gate)", () => {
      // Phase 69 consciously flipped UI_EXCHANGE_CODES to 4-value: the public
      // dropdown/marketing now OFFER deribit (with its scope guide). This is the
      // inverse of the Phase-68 pin — reverting the flip turns these red.
      expect(UI_EXCHANGE_CODES).toEqual(["binance", "okx", "bybit", "deribit"]);
      expect((UI_EXCHANGE_CODES as readonly string[]).includes("deribit")).toBe(true);
      // FUNDING_EXCHANGES gates the sync-funding/reconcile crons and stays
      // DECOUPLED at 3-value until Phase 70 (funding_fetch.py + SQL CHECK +
      // native-id dedup land together). A deribit leak into funding is exactly
      // what this remaining pin guards.
      expect(FUNDING_EXCHANGES).toEqual(["binance", "okx", "bybit"]);
      expect((FUNDING_EXCHANGES as readonly string[]).includes("deribit")).toBe(false);
    });

    // OQ4 chip-surface guard (Phase 68 code-review H1): the value-space pins
    // above catch a re-widened CONST, but not a COMPONENT that imports the
    // widened `SUPPORTED_EXCHANGES` to build rendered exchange chips/options.
    // That is exactly how RequestIntroButton leaked a selectable "Deribit"
    // chip. Pin every user-facing exchange-selection surface to the decoupled
    // UI set: they must NOT import SUPPORTED_EXCHANGES (they use
    // UI_EXCHANGE_CODES or the display EXCHANGES). A new chip surface added to
    // this list, or an old one reverted to SUPPORTED_EXCHANGES, fails here.
    it("user-facing exchange-chip components never import the widened SUPPORTED_EXCHANGES (OQ4)", () => {
      const CHIP_SURFACES = [
        "components/strategy/RequestIntroButton.tsx",
        "components/landing/VerificationForm.tsx",
      ];
      for (const rel of CHIP_SURFACES) {
        const src = readFileSync(join(__dirname, "..", rel), "utf8");
        const importsWidened =
          /import\s*\{[^}]*\bSUPPORTED_EXCHANGES\b[^}]*\}/.test(src);
        expect(
          importsWidened,
          `${rel} imports SUPPORTED_EXCHANGES — a user-facing chip surface must ` +
            `use UI_EXCHANGE_CODES so Deribit is not offered until Phase 69`,
        ).toBe(false);
        expect(/\bUI_EXCHANGE_CODES\b/.test(src)).toBe(true);
      }
    });

    it("EXCHANGE_DISPLAY has a label for every supported code (satisfies guarantee, checked at runtime too)", () => {
      for (const code of SUPPORTED_EXCHANGES) {
        expect(EXCHANGE_DISPLAY[code]).toBeTruthy();
        expect(EXCHANGE_DISPLAY[code].toLowerCase()).toBe(code);
      }
      expect(Object.keys(EXCHANGE_DISPLAY).sort()).toEqual(
        [...SUPPORTED_EXCHANGES].sort(),
      );
    });

    it("exchangeEnum parses lowercase codes and rejects anything else", () => {
      expect(exchangeEnum.safeParse("binance").success).toBe(true);
      expect(exchangeEnum.safeParse("Binance").success).toBe(false);
      expect(exchangeEnum.safeParse("ftx").success).toBe(false);
    });

    it("isSupportedExchange is case-insensitive membership", () => {
      expect(isSupportedExchange("binance")).toBe(true);
      expect(isSupportedExchange("Binance")).toBe(true);
      expect(isSupportedExchange("BYBIT")).toBe(true);
      expect(isSupportedExchange("ftx")).toBe(false);
      expect(isSupportedExchange("deribit")).toBe(true); // Phase 68: deribit is in the key-save allowlist
      expect(isSupportedExchange("")).toBe(false);
    });
  });

  // Phase 153.1 / D-17, D-22. These assert the record's PROPERTIES, never the
  // record read back at itself: the oracle for totality is SUPPORTED_EXCHANGES and
  // the oracle for "only one opt-out" is a hand-typed 1. A count derived from the
  // same filter it is checking would stay green the day a second venue opts out,
  // which is exactly the class-vs-instance mutation the falsifiability ledger
  // (SC-3, second non-probing venue) is watching for.
  describe("venue capabilities (class, not instance)", () => {
    it("every SUPPORTED_EXCHANGES member has a capability row", () => {
      // Iterate the ORACLE (the allowlist) and index the SUBJECT (the record).
      // Object.keys(VENUE_CAPABILITIES).length compared to itself would pass for
      // any record whatsoever.
      const record: Record<string, unknown> = VENUE_CAPABILITIES;
      for (const venue of SUPPORTED_EXCHANGES) {
        expect(
          Object.prototype.hasOwnProperty.call(record, venue),
          `${venue} is a SUPPORTED exchange with no VENUE_CAPABILITIES row — the ` +
            `satisfies clause makes this a compile error too, but a runtime hole ` +
            `(a deleted row behind a cast) would otherwise read as "all defaults"`,
        ).toBe(true);
        expect(typeof record[venue]).toBe("object");
      }
    });

    it("sFOX asserts NO capability at all — its submit path is byte-unchanged (D-22)", () => {
      // Structural, not behavioural: the KEY must be absent, so sFOX inherits the
      // default rather than restating it. If someone opts sFOX out of the scope
      // probe later, that is a DECISION (RESEARCH Q2, logged in TODOS.md) and this
      // is where it gets made — deliberately, with the reasoning written down.
      expect(
        "scopeProbeSupported" in VENUE_CAPABILITIES.sfox,
        "D-22 pins sFOX byte-unchanged in this phase. RESEARCH Q2 asks whether " +
          "sFOX should also opt out (it asserts read_only structurally for the same " +
          "reason MT5 does) — but it is unknown whether the ccxt probe currently " +
          "succeeds for sFOX, so the question is logged, not answered.",
      ).toBe(false);
      expect(venueSupportsScopeProbe("sfox")).toBe(true);
      expect(venueIsSubstitutable("sfox")).toBe(true);
      expect(venueIsSerialized("sfox")).toBe(false);
    });

    it("EXACTLY ONE venue opts out of the scope probe, and it is mt5", () => {
      const nonProbing = SUPPORTED_EXCHANGES.filter(
        (venue) => !venueSupportsScopeProbe(venue),
      );
      expect(
        nonProbing.length,
        "A SECOND non-probing venue arrived. That is a security decision (the " +
          "scope-broadening probe is ASVS V4) and it must be made explicitly here, " +
          "not inherited from a copied row.",
      ).toBe(1);
      expect(nonProbing).toEqual(["mt5"]);
    });

    it("EXACTLY ONE venue is non-substitutable, and it is mt5", () => {
      const nonSubstitutable = SUPPORTED_EXCHANGES.filter(
        (venue) => !venueIsSubstitutable(venue),
      );
      expect(
        nonSubstitutable.length,
        "A second non-substitutable venue means the copy layer now suppresses the " +
          '"switch exchange" remedy somewhere it used to render. D-17 asks for that ' +
          "only where the account IS the venue.",
      ).toBe(1);
      expect(nonSubstitutable).toEqual(["mt5"]);
    });

    it("EXACTLY ONE venue is serialized, and it is mt5", () => {
      const serialized = SUPPORTED_EXCHANGES.filter((venue) =>
        venueIsSerialized(venue),
      );
      expect(
        serialized.length,
        "Claiming a venue queues is a specific factual claim about why the user is " +
          "waiting. Only mt5 funnels every call through one terminal lease.",
      ).toBe(1);
      expect(serialized).toEqual(["mt5"]);
    });

    it("an UNRESOLVED venue is still scope-probed — the control fails TOWARD probing", () => {
      // ⭐ SC-3. This is the assertion the falsifiability ledger targets: flipping
      // the default from true to false silently disables the scope-broadening
      // defense for every venue the resolver could not name, promoting a key
      // broadened to trade/withdraw between Connect and Submit. ASVS V4.
      // ⚠️ Note this is the OPPOSITE direction from isCryptoExchange(null) === false.
      const reason =
        "an unresolved venue must still be probed (ASVS V4) — a false answer here " +
        "would disable a security control for every unnamed venue";
      expect(venueSupportsScopeProbe(null), reason).toBe(true);
      expect(venueSupportsScopeProbe(undefined), reason).toBe(true);
      expect(venueSupportsScopeProbe(""), reason).toBe(true);
      expect(venueSupportsScopeProbe("kraken"), reason).toBe(true);
    });

    it("an UNRESOLVED venue keeps the incumbent substitution copy", () => {
      const reason =
        "when the caller did not name a venue the incumbent copy stands — " +
        "suppressing venue-shaped remedies everywhere would be a repo-wide copy " +
        "regression D-17 did not ask for";
      expect(venueIsSubstitutable(null), reason).toBe(true);
      expect(venueIsSubstitutable(undefined), reason).toBe(true);
      expect(venueIsSubstitutable(""), reason).toBe(true);
      expect(venueIsSubstitutable("kraken"), reason).toBe(true);
    });

    it("an UNRESOLVED venue is NOT claimed to be queueing", () => {
      const reason =
        "never invent a specific fact about why the user is waiting — a venue we " +
        "could not resolve is not known to queue";
      expect(venueIsSerialized(null), reason).toBe(false);
      expect(venueIsSerialized(undefined), reason).toBe(false);
      expect(venueIsSerialized(""), reason).toBe(false);
      expect(venueIsSerialized("kraken"), reason).toBe(false);
    });

    it("the predicates are case-insensitive, like isCryptoExchange", () => {
      // canonicalizeExchange hands back the DISPLAY form ("MT5") for an MT5 key, so
      // a case-sensitive lookup would silently fall to every default — i.e. MT5
      // would be probed, called substitutable and called unqueued, undoing all
      // three capabilities at once.
      expect(venueIsSubstitutable("MT5")).toBe(false);
      expect(venueIsSubstitutable("Mt5")).toBe(false);
      expect(venueSupportsScopeProbe("MT5")).toBe(false);
      expect(venueIsSerialized("MT5")).toBe(true);
    });
  });

  describe("signup roles (security boundary)", () => {
    it("SIGNUP_ROLES mirrors the handle_new_user trigger allowlist exactly", () => {
      expect(SIGNUP_ROLES).toEqual(["manager", "allocator", "both"]);
    });

    it("does NOT contain an elevated/internal role", () => {
      expect((SIGNUP_ROLES as readonly string[]).includes("admin")).toBe(false);
      expect((SIGNUP_ROLES as readonly string[]).includes("service_role")).toBe(false);
    });

    it("the types.ts ROLES UI list cannot drift from SIGNUP_ROLES", () => {
      // ROLES drives the role picker; its value set must equal SIGNUP_ROLES so
      // the closed set is single-sourced.
      expect(ROLES.map((r) => r.value).sort()).toEqual([...SIGNUP_ROLES].sort());
    });
  });

  describe("preference field sets (re-exported from preferences.ts)", () => {
    it("SELF_EDITABLE_PREFERENCE_FIELDS is the 9-key allocator-writable set", () => {
      expect(SELF_EDITABLE_PREFERENCE_FIELDS).toEqual([
        "mandate_archetype",
        "target_ticket_size_usd",
        "excluded_exchanges",
        "max_weight",
        "preferred_strategy_types",
        "correlation_ceiling",
        "max_drawdown_tolerance",
        "liquidity_preference",
        "style_exclusions",
      ]);
    });

    it("self-editable and admin-only field sets are disjoint", () => {
      const self = new Set<string>(SELF_EDITABLE_PREFERENCE_FIELDS);
      for (const f of ADMIN_ONLY_PREFERENCE_FIELDS) {
        expect(self.has(f)).toBe(false);
      }
    });

    it("LIQUIDITY_PREFERENCES is the closed liquidity set", () => {
      expect(LIQUIDITY_PREFERENCES).toEqual(["high", "medium", "low"]);
    });
  });

  describe("magnitude caps", () => {
    it("pins the cap boundary values that the routes + validators consume", () => {
      expect(MAGNITUDE_CAPS.MAX_NAME_CHARS).toBe(80);
      expect(MAGNITUDE_CAPS.MAX_MANDATE_CHARS).toBe(500);
      expect(MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS).toBe(10);
      expect(MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS).toBe(5000);
      expect(MAGNITUDE_CAPS.MAX_FOUNDER_NOTES_CHARS).toBe(10_000);
      expect(MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD).toBe(1_000_000_000);
      expect(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD).toBe(1_000_000_000_000);
      expect(MAGNITUDE_CAPS.MAX_EXCLUDED_EXCHANGES_COUNT).toBe(100);
      expect(MAGNITUDE_CAPS.MAX_EXCLUDED_EXCHANGE_LENGTH).toBe(100);
    });

    it("the AUM dollar cap is strictly larger than the ticket-size cap (distinct semantics)", () => {
      expect(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD).toBeGreaterThan(
        MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD,
      );
    });

    it("the description bound PAIR is ordered min < max (D-23)", () => {
      // An inverted pair admits no description at all: the server would refuse
      // every string (too short AND too long simultaneously) while the client
      // field guard — reading the same two constants — believes the field is
      // valid. That is the 3-failed-submit shape D-23 exists to prevent, now
      // between two constants instead of between a constant and a literal.
      expect(MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS).toBeLessThan(
        MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS,
      );
    });
  });
});
