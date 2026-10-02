/**
 * Phase 167.1 AUMTRUST — unit pins on `summarizeLiveHoldings`, the ONE pass
 * that yields the composer's live-holdings total and the part of it sourced
 * from keys needing attention.
 *
 * WHY THESE PINS MATTER. The total is the PORTFOLIO AUM an allocator sizes a
 * scenario from, and the founder's decision (2026-09-22) is that a holding from
 * an untrusted key STAYS in it and is disclosed, never subtracted. So each pin
 * below guards a way the disclosure could lie about the money figure it sits
 * beside: an untrusted holding silently dropped from the total (pin 1), a
 * disclosed amount that is not the subset the total actually summed (pins 2
 * and 4), a membership test that is not the shared predicate (pin 5), and the
 * `revoked` exclusion the founder has still to rule on (the D-06 pin).
 *
 * ORACLE INDEPENDENCE: every expected figure is a hand-typed number over a
 * hand-listed subset of the fixture, never a re-run of the helper's own filter.
 * A test that computes its expectation with the code under test cannot fail
 * when that code drifts. `untrusted.amount <= total` is deliberately NOT
 * asserted as an invariant: a derivative leg with a negative contribution
 * breaks it by design (D-07).
 *
 * Every holding carries its own (venue, symbol, holding_type) triple.
 * `holdingByRef` keys on that triple, not on the key, so two holdings sharing
 * one would collapse into a single map entry and make a hand-typed oracle wrong
 * for a reason that has nothing to do with the helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES } from "@/lib/closed-sets";
import { buildHoldingRef } from "./holding-outcome-adapter";
import {
  buildKeyTrustClause,
  holdingEquityContributionLocal,
  holdingEquityIsReported,
  managerSideKeyIds,
  summarizeLiveHoldings,
} from "./live-holdings-summary";

// ---------------------------------------------------------------------------
// The shared-predicate double (D-15 pin 5)
// ---------------------------------------------------------------------------

// The double DELEGATES to the real `isUntrustedKeySyncStatus` unless the
// hoisted toggle is on, and only then also answers true for `error` — a status
// the real predicate calls trusted. So every other case in this file still
// exercises the REAL predicate, and the widened case proves the helper asks the
// shared predicate: a local equality on the status column would ignore the
// double and stay blind to `error`.
//
// It lives in this file and not in the composer suite on purpose. No other
// test in the repo mocks `@/lib/closed-sets`, and `vi.mock` is hoisted to the
// top of its file, so a double placed in the 336-test composer suite would
// apply to every one of those tests.
const WIDEN = vi.hoisted(() => ({ toError: false }));

vi.mock("@/lib/closed-sets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/closed-sets")>();
  return {
    ...real,
    isUntrustedKeySyncStatus: (status: string | null | undefined) =>
      real.isUntrustedKeySyncStatus(status) ||
      (WIDEN.toError && status === "error"),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

// Synthetic identifiers only — the repo and `.planning/` are public.
const KEY_TRUSTED = "aumtrust-key-a";
const KEY_SIGN_IN_FAILED = "aumtrust-key-b";
const KEY_SIGN_IN_FAILED_DERIV = "aumtrust-key-c";
const KEY_REVOKED = "aumtrust-key-d";
const KEY_ERROR = "aumtrust-key-e";
const KEY_SIGN_IN_FAILED_OUTSIDE = "aumtrust-key-f";
const KEY_SIGN_IN_FAILED_NO_PNL = "aumtrust-key-g";
/** Deliberately ABSENT from STATUS_BY_KEY_ID: a key the key list dropped. */
const KEY_MISSING_FROM_API_KEYS = "aumtrust-key-h";

const STATUS_BY_KEY_ID: ReadonlyMap<string, string | null> = new Map<
  string,
  string | null
>([
  [KEY_TRUSTED, null],
  [KEY_SIGN_IN_FAILED, "sign_in_failed"],
  [KEY_SIGN_IN_FAILED_DERIV, "sign_in_failed"],
  [KEY_REVOKED, "revoked"],
  [KEY_ERROR, "error"],
  [KEY_SIGN_IN_FAILED_OUTSIDE, "sign_in_failed"],
  [KEY_SIGN_IN_FAILED_NO_PNL, "sign_in_failed"],
]);

/** A SPOT holding: its equity contribution IS its `value_usd`. */
function buildHolding(
  overrides: Partial<DashboardHolding> = {},
): DashboardHolding {
  return {
    symbol: "AUMTRUST-SPOT",
    venue: "placeholder-venue",
    holding_type: "spot",
    value_usd: 0,
    quantity: 1,
    mark_price_usd: 0,
    api_key_id: KEY_TRUSTED,
    side: null,
    entry_price: null,
    unrealized_pnl_usd: null,
    ...overrides,
  };
}

const H_TRUSTED = buildHolding({
  venue: "venue-a",
  symbol: "AUMTRUST-A",
  value_usd: 480_000,
  api_key_id: KEY_TRUSTED,
});
const H_SIGN_IN_FAILED = buildHolding({
  venue: "venue-b",
  symbol: "AUMTRUST-B",
  value_usd: 12_345,
  api_key_id: KEY_SIGN_IN_FAILED,
});
/** A derivative: `value_usd` is the leveraged NOTIONAL (900,000), the equity
 *  at stake is `unrealized_pnl_usd` (-2,500). The notional must not leak. */
const H_SIGN_IN_FAILED_DERIV = buildHolding({
  venue: "venue-c",
  symbol: "AUMTRUST-C-PERP",
  holding_type: "derivative",
  value_usd: 900_000,
  unrealized_pnl_usd: -2_500,
  side: "long",
  entry_price: 100,
  api_key_id: KEY_SIGN_IN_FAILED_DERIV,
});
const H_REVOKED = buildHolding({
  venue: "venue-d",
  symbol: "AUMTRUST-D",
  value_usd: 3_210,
  api_key_id: KEY_REVOKED,
});
const H_ERROR = buildHolding({
  venue: "venue-e",
  symbol: "AUMTRUST-E",
  value_usd: 7_000,
  api_key_id: KEY_ERROR,
});
const H_SIGN_IN_FAILED_OUTSIDE = buildHolding({
  venue: "venue-f",
  symbol: "AUMTRUST-F",
  value_usd: 55_555,
  api_key_id: KEY_SIGN_IN_FAILED_OUTSIDE,
});

/** A derivative whose unrealized P&L the venue did not report: it sums as 0,
 *  and that 0 is not a known figure (review WR-03). */
const H_SIGN_IN_FAILED_NO_PNL = buildHolding({
  venue: "venue-g",
  symbol: "AUMTRUST-G-PERP",
  holding_type: "derivative",
  value_usd: 800_000,
  unrealized_pnl_usd: null,
  side: "short",
  entry_price: 100,
  api_key_id: KEY_SIGN_IN_FAILED_NO_PNL,
});

/** A holding whose key is not in `apiKeys` (e.g. dropped by the key list for
 *  an unsupported exchange). Its status is unknown, not trusted (WR-05). */
const H_MISSING_KEY = buildHolding({
  venue: "venue-h",
  symbol: "AUMTRUST-H",
  value_usd: 4_444,
  api_key_id: KEY_MISSING_FROM_API_KEYS,
});

const ALL_HOLDINGS = [
  H_TRUSTED,
  H_MISSING_KEY,
  H_SIGN_IN_FAILED,
  H_SIGN_IN_FAILED_DERIV,
  H_REVOKED,
  H_ERROR,
  H_SIGN_IN_FAILED_OUTSIDE,
  H_SIGN_IN_FAILED_NO_PNL,
];

const ref = (h: DashboardHolding) => buildHoldingRef(h);

function buildHoldingByRef(
  holdings: readonly DashboardHolding[],
): ReadonlyMap<string, DashboardHolding> {
  return new Map(holdings.map((h) => [ref(h), h]));
}

/** Every listed holding toggled ON, the composer's default draft. */
function allOn(holdings: readonly DashboardHolding[]): Record<string, boolean> {
  return Object.fromEntries(holdings.map((h) => [ref(h), true]));
}

function summarize(opts: {
  holdings: readonly DashboardHolding[];
  contributing: readonly string[];
  toggles?: Record<string, boolean>;
  /** Keys the payload identifies as manager-side: `eligibleApiKeyIds` minus
   *  `allocatorEligibleApiKeyIds`. Defaults to none. */
  managerSide?: readonly string[];
}) {
  return summarizeLiveHoldings({
    toggleByScopeRef: opts.toggles ?? allOn(opts.holdings),
    holdingByRef: buildHoldingByRef(opts.holdings),
    contributingApiKeyIds: opts.contributing,
    managerSideApiKeyIds: opts.managerSide ?? [],
    statusByKeyId: STATUS_BY_KEY_ID,
  });
}

beforeEach(() => {
  WIDEN.toError = false;
});

// ---------------------------------------------------------------------------
// Fixture self-proof
// ---------------------------------------------------------------------------

describe("summarizeLiveHoldings — fixture self-proof", () => {
  it("every fixture holding has a distinct (venue, symbol, holding_type) triple, so none collapses out of holdingByRef", () => {
    expect(new Set(ALL_HOLDINGS.map(ref)).size).toBe(ALL_HOLDINGS.length);
    expect(buildHoldingByRef(ALL_HOLDINGS).size).toBe(ALL_HOLDINGS.length);
  });

  it("`error` is a status the REAL predicate calls trusted — the precondition that makes pin 5 non-vacuous", () => {
    expect(TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// The pins
// ---------------------------------------------------------------------------

describe("summarizeLiveHoldings — AUMTRUST (Phase 167.1)", () => {
  it("pin 1 (D-03): a sign_in_failed holding in the summed set STAYS in the total — 480,000 + 12,345 = 492,345, not 480,000", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED],
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED],
    });
    expect(s.total).toBe(492_345);
    // The rejected alternative (drop the untrusted holding) is a different
    // number, and must not be what the helper returns.
    expect(s.total).not.toBe(480_000);
    expect(s.untrusted).toEqual({ amount: 12_345, count: 1, unavailable: 0 });
    // A key that IS in apiKeys with a null status is trusted, not unknown.
    expect(s.unknownStatus).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("pin 2 (D-04 / D-07): the untrusted amount is exactly the untrusted subset on the EQUITY basis — a derivative adds its -2,500 P&L, never its 900,000 notional, and is COUNTED although its amount is <= 0", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, H_SIGN_IN_FAILED_DERIV],
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED, KEY_SIGN_IN_FAILED_DERIV],
    });
    // Hand-listed: 480,000 (trusted) + 12,345 (sign_in_failed spot)
    //              + (-2,500) (sign_in_failed derivative P&L) = 489,845.
    expect(s.total).toBe(489_845);
    // Hand-listed untrusted subset: 12,345 + (-2,500) = 9,845, two holdings.
    expect(s.untrusted).toEqual({ amount: 9_845, count: 2, unavailable: 0 });
  });

  it("pin 2 (D-07): a book whose ONLY untrusted holding is a losing derivative still counts it — the disclosure gate reads the count, and the amount is signed as it comes", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED_DERIV],
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED_DERIV],
    });
    expect(s.total).toBe(477_500);
    expect(s.untrusted).toEqual({ amount: -2_500, count: 1, unavailable: 0 });
  });

  it("pin 4: an untrusted holding that is toggled OFF, or whose key is outside a non-empty contributing set, adds nothing to the total or the untrusted amount; non-holding refs and refs missing from holdingByRef are ignored", () => {
    const holdings = [H_TRUSTED, H_SIGN_IN_FAILED, H_SIGN_IN_FAILED_OUTSIDE];
    const s = summarize({
      holdings,
      // KEY_SIGN_IN_FAILED_OUTSIDE is deliberately NOT in the set.
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED],
      toggles: {
        [ref(H_TRUSTED)]: true,
        [ref(H_SIGN_IN_FAILED)]: false,
        [ref(H_SIGN_IN_FAILED_OUTSIDE)]: true,
        "strategy:aumtrust-added-strategy": true,
        "holding:venue-z:AUMTRUST-MISSING:spot": true,
      },
    });
    expect(s.total).toBe(480_000);
    expect(s.untrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("pin 5 (D-05): the membership test is the SHARED predicate — an `error` key is trusted under the real module, and counted once the double widens the set", () => {
    const run = () =>
      summarize({
        holdings: [H_TRUSTED, H_ERROR],
        contributing: [KEY_TRUSTED, KEY_ERROR],
      });

    const real = run();
    expect(real.total).toBe(487_000);
    expect(real.untrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });

    WIDEN.toError = true;
    const widened = run();
    // The total never moves — the disclosure is not a subtraction.
    expect(widened.total).toBe(487_000);
    expect(widened.untrusted).toEqual({ amount: 7_000, count: 1, unavailable: 0 });
  });

  it("degrade branch (D-05 / Pitfall 5): with an EMPTY contributing set the whole book is summed, so a revoked holding is in the total AND flagged", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_REVOKED],
      contributing: [],
    });
    expect(s.total).toBe(483_210);
    expect(s.untrusted).toEqual({ amount: 3_210, count: 1, unavailable: 0 });
    // Nothing was narrowed away, so nothing is recorded as excluded.
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("D-06: a revoked key outside a non-empty contributing set is ABSENT from the total and from the untrusted amount, and is recorded in excludedUntrusted — pinned so the founder's D-06 answer changes it deliberately and visibly", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_REVOKED],
      contributing: [KEY_TRUSTED],
    });
    expect(s.total).toBe(480_000);
    expect(s.untrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 3_210, count: 1, unavailable: 0 });
  });

  it("review WR-03: an untrusted holding whose equity the venue did not report sums as 0 and is COUNTED as unavailable, so the disclosure never presents that 0 as a known figure", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, H_SIGN_IN_FAILED_NO_PNL],
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED, KEY_SIGN_IN_FAILED_NO_PNL],
    });
    // D-03: the total is unchanged — the null P&L still sums as 0, and the
    // 800,000 notional never leaks in.
    expect(s.total).toBe(492_345);
    expect(s.untrusted).toEqual({ amount: 12_345, count: 2, unavailable: 1 });
  });

  it("review WR-05: a summed holding whose key is missing from apiKeys is status UNKNOWN, not trusted — it stays in the total and is counted in unknownStatus, never in untrusted", () => {
    // Degrade branch (empty contributing set), where such a holding is summed.
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, H_MISSING_KEY],
      contributing: [],
    });
    // D-03: 480,000 + 12,345 + 4,444 = 496,789, unchanged.
    expect(s.total).toBe(496_789);
    expect(s.untrusted).toEqual({ amount: 12_345, count: 1, unavailable: 0 });
    expect(s.unknownStatus).toEqual({ amount: 4_444, count: 1, unavailable: 0 });
  });

  // ⛔ Review round 3 WR-01 (2026-09-24): this case used to pin the holding as
  // in NO part, so the "excludes" clause was silent about it. It is flipped
  // DELIBERATELY: the key list drops a key on an unsupported exchange, the
  // holdings still arrive, and in production the narrowing is always on, so
  // this is the one production-reachable missing-key path. D-06's intent is
  // that the composer says what it excludes.
  it("review round 3 WR-01: a missing-key holding the narrowing drops is in neither the total nor unknownStatus, and is recorded in excludedUnknownStatus, never in excludedUntrusted", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_MISSING_KEY],
      contributing: [KEY_TRUSTED],
    });
    // D-03: the total is the contributing book only, unchanged.
    expect(s.total).toBe(480_000);
    expect(s.unknownStatus).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUnknownStatus).toEqual({ amount: 4_444, count: 1, unavailable: 0 });
  });

  it("review round 3 WR-01: with the key list ABSENT (an empty status map) every dropped holding is unknown-status excluded — the excludes side no longer fails closed — and the total is unchanged", () => {
    const holdings = [H_TRUSTED, H_REVOKED, H_SIGN_IN_FAILED_OUTSIDE];
    const s = summarizeLiveHoldings({
      toggleByScopeRef: allOn(holdings),
      holdingByRef: buildHoldingByRef(holdings),
      contributingApiKeyIds: [KEY_TRUSTED],
      managerSideApiKeyIds: [],
      statusByKeyId: new Map(),
    });
    expect(s.total).toBe(480_000);
    // The summed trusted holding's key is unknown too, so it is disclosed on
    // the includes side, as before (WR-05).
    expect(s.unknownStatus).toEqual({ amount: 480_000, count: 1, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    // Hand-listed: 3,210 + 55,555 = 58,765, two holdings.
    expect(s.excludedUnknownStatus).toEqual({ amount: 58_765, count: 2, unavailable: 0 });
  });

  it("review round 3 WR-01: a key the payload names as manager-side is not the allocator's book, so a dropped holding on it is left out of excludedUnknownStatus as well (D-20)", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_MISSING_KEY],
      contributing: [KEY_TRUSTED],
      managerSide: [KEY_MISSING_FROM_API_KEYS],
    });
    expect(s.total).toBe(480_000);
    expect(s.excludedUnknownStatus).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("D-20 (review WR-01): excludedUntrusted is D-20's $Y — a sign_in_failed MANAGER-SIDE key outside the contributing set is not the allocator's book and is left out, while an allocator-eligible sign_in_failed key with no series and an indistinguishable revoked key stay in", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, H_REVOKED, H_SIGN_IN_FAILED_OUTSIDE],
      contributing: [KEY_TRUSTED],
      // KEY_SIGN_IN_FAILED_OUTSIDE is the manager-side key the payload names.
      // KEY_SIGN_IN_FAILED is allocator-eligible but not contributing.
      // KEY_REVOKED is in neither eligible set, so the payload cannot say
      // whose book it is (D-20: over-discloses, never hides).
      managerSide: [KEY_SIGN_IN_FAILED_OUTSIDE],
    });
    // The total is the contributing book only, unchanged by the narrowing.
    expect(s.total).toBe(480_000);
    expect(s.untrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    // Hand-listed: 12,345 (allocator-eligible sign_in_failed) + 3,210
    // (revoked) = 15,555, two holdings. NOT 71,110 = 15,555 + 55,555, which is
    // what counting the manager-side holding would give; the exact toEqual
    // already rules that out.
    expect(s.excludedUntrusted).toEqual({ amount: 15_555, count: 2, unavailable: 0 });
  });

  it("D-20 residual (review round 2 WR-03): a manager-side key OUTSIDE eligibleApiKeyIds (here soft-disconnected, so in neither eligible set) cannot be told apart, so its untrusted holdings ARE counted in excludedUntrusted — over-disclosed, never hidden", () => {
    // The payload's eligible sets both omit the manager key: a soft-disconnect
    // (like a revoke or an inactive key) fails `isPerKeyDailiesEligibleKey`,
    // so the difference that names manager-side keys cannot name it.
    const managerSide = managerSideKeyIds([KEY_TRUSTED], [KEY_TRUSTED]);
    expect(managerSide).toEqual([]);
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED_OUTSIDE],
      contributing: [KEY_TRUSTED],
      managerSide,
    });
    expect(s.total).toBe(480_000);
    expect(s.excludedUntrusted).toEqual({ amount: 55_555, count: 1, unavailable: 0 });
  });
});

// ---------------------------------------------------------------------------
// D-20's manager-side set (review round 2 WR-01)
// ---------------------------------------------------------------------------

describe("managerSideKeyIds — the keys the payload names as manager-side (D-20)", () => {
  it("is eligibleApiKeyIds MINUS allocatorEligibleApiKeyIds, in eligible order — never the reverse difference, never either set whole", () => {
    // The two sets differ in BOTH directions: m-1 and m-2 are eligible only,
    // z is allocator-eligible only. Hand-listed answer: m-1, m-2.
    expect(
      managerSideKeyIds(
        ["aumtrust-key-a", "aumtrust-key-m-1", "aumtrust-key-b", "aumtrust-key-m-2"],
        ["aumtrust-key-a", "aumtrust-key-b", "aumtrust-key-z"],
      ),
    ).toEqual(["aumtrust-key-m-1", "aumtrust-key-m-2"]);
  });

  it("is empty when every eligible key is allocator-eligible", () => {
    expect(
      managerSideKeyIds(
        ["aumtrust-key-a", "aumtrust-key-b"],
        ["aumtrust-key-b", "aumtrust-key-a"],
      ),
    ).toEqual([]);
  });

  it("review round 2 WR-06: a MISSING payload field yields NO manager-side key — it must not mark every eligible key manager-side and so hide their holdings from $Y (over-disclose, never hide)", () => {
    // allocatorEligibleApiKeyIds absent: reading it as [] would make EVERY
    // eligible key manager-side, which HIDES holdings from $Y.
    expect(
      managerSideKeyIds(["aumtrust-key-a", "aumtrust-key-b"], undefined),
    ).toEqual([]);
    expect(managerSideKeyIds(undefined, ["aumtrust-key-a"])).toEqual([]);
    expect(managerSideKeyIds(undefined, undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The reported-equity lockstep (review round 2 WR-02)
// ---------------------------------------------------------------------------

describe("holdingEquityIsReported — in lockstep with holdingEquityContributionLocal (review round 2 WR-02)", () => {
  // Hand-listed. `substituted` is true exactly where the contribution helper
  // puts its 0 in place of a figure the venue did not report. The lockstep
  // claim is that `holdingEquityIsReported` answers false on exactly those
  // rows, so a disclosure never presents a defaulted 0 as a known figure.
  const ROWS: Array<{
    label: string;
    holding: DashboardHolding;
    contribution: number;
    substituted: boolean;
  }> = [
    { label: "derivative, P&L 250", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: 250 }), contribution: 250, substituted: false },
    { label: "derivative, P&L 0 (a known zero)", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: 0 }), contribution: 0, substituted: false },
    { label: "derivative, P&L null", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: null }), contribution: 0, substituted: true },
    { label: "derivative, P&L NaN", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: Number.NaN }), contribution: 0, substituted: true },
    { label: "derivative, P&L +Infinity", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: Number.POSITIVE_INFINITY }), contribution: 0, substituted: true },
    { label: "derivative, P&L -Infinity", holding: buildHolding({ holding_type: "derivative", value_usd: 900_000, unrealized_pnl_usd: Number.NEGATIVE_INFINITY }), contribution: 0, substituted: true },
    { label: "spot, value 1,234", holding: buildHolding({ value_usd: 1_234 }), contribution: 1_234, substituted: false },
    { label: "spot, value 0 (a known zero)", holding: buildHolding({ value_usd: 0 }), contribution: 0, substituted: false },
    { label: "spot, value NaN", holding: buildHolding({ value_usd: Number.NaN }), contribution: 0, substituted: true },
    { label: "spot, value +Infinity", holding: buildHolding({ value_usd: Number.POSITIVE_INFINITY }), contribution: 0, substituted: true },
    { label: "spot, value -Infinity", holding: buildHolding({ value_usd: Number.NEGATIVE_INFINITY }), contribution: 0, substituted: true },
  ];

  it.each(ROWS)("$label", ({ holding, contribution, substituted }) => {
    expect(holdingEquityContributionLocal(holding)).toBe(contribution);
    expect(holdingEquityIsReported(holding)).toBe(!substituted);
  });

  it("summarizeLiveHoldings counts an untrusted derivative with a NaN P&L and an untrusted spot holding with a NaN value as unavailable, and the total is unchanged", () => {
    const nanDeriv = buildHolding({
      venue: "venue-n1",
      symbol: "AUMTRUST-N1-PERP",
      holding_type: "derivative",
      value_usd: 700_000,
      unrealized_pnl_usd: Number.NaN,
      api_key_id: KEY_SIGN_IN_FAILED_DERIV,
    });
    const nanSpot = buildHolding({
      venue: "venue-n2",
      symbol: "AUMTRUST-N2",
      value_usd: Number.NaN,
      api_key_id: KEY_SIGN_IN_FAILED,
    });
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, nanDeriv, nanSpot],
      contributing: [KEY_TRUSTED, KEY_SIGN_IN_FAILED, KEY_SIGN_IN_FAILED_DERIV],
    });
    // D-03: 480,000 + 12,345 + 0 + 0 = 492,345, and the 700,000 notional
    // never leaks in.
    expect(s.total).toBe(492_345);
    expect(s.untrusted).toEqual({ amount: 12_345, count: 3, unavailable: 2 });
  });
});

// ---------------------------------------------------------------------------
// D-06 (b) — the "excludes" clause (founder answer 2026-09-24)
// ---------------------------------------------------------------------------

describe("buildKeyTrustClause — D-06 (b) excludes $Y from keys needing attention", () => {
  // A deliberately plain renderer, so each oracle below is the reader's own
  // arithmetic. The composer passes `formatUsd`; that wiring is pinned in the
  // composer suite with the real renderer's output typed out.
  const RENDER = {
    amount: (n: number) => `$${n}`,
    missing: "value",
    unit: ["holding", "holdings"] as const,
  };
  const part = (amount: number, count: number, unavailable = 0) => ({
    amount,
    count,
    unavailable,
  });
  const NONE = part(0, 0);

  it("D-06 (b): with no excluded part the clause is byte-identical to the includes-only wording — Open Positions and every pre-D-06 composer string are untouched", () => {
    expect(buildKeyTrustClause(part(12_345, 1), NONE, RENDER)).toBe(
      "includes $12345 from keys needing attention",
    );
    expect(buildKeyTrustClause(part(12_345, 1), NONE, RENDER, NONE)).toBe(
      "includes $12345 from keys needing attention",
    );
  });

  it("D-06 (b): excludes only — the UI-SPEC § 3 row 'excludes $Y from keys needing attention'", () => {
    expect(buildKeyTrustClause(NONE, NONE, RENDER, part(8_000, 1))).toBe(
      "excludes $8000 from keys needing attention",
    );
  });

  it("D-06 (b): includes and excludes — the noun is said ONCE, at the end (UI-SPEC § 3)", () => {
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, part(8_000, 2)),
    ).toBe("includes $12345 and excludes $8000 from keys needing attention");
  });

  it("D-06 (b) / D-07: the excluded part renders on its COUNT — a counted $0 still reads 'excludes $0', never nothing", () => {
    expect(buildKeyTrustClause(NONE, NONE, RENDER, part(0, 1))).toBe(
      "excludes $0 from keys needing attention",
    );
  });

  it("D-06 (b) / review WR-03: an excluded holding whose value was not reported says so after the excludes part, never after the includes part", () => {
    // 169 review round 2 IN-R2-05 / SFH R2-5: a part whose every row is unavailable has
    // no known amount (the 0 is the sum of nothing), so it names its count, never
    // "$0". The "(… unavailable for N …)" count is unchanged.
    expect(buildKeyTrustClause(NONE, NONE, RENDER, part(0, 1, 1))).toBe(
      "excludes 1 holding from keys needing attention (value unavailable for 1 holding)",
    );
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, part(8_000, 3, 2)),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $8000 from keys needing attention (value unavailable for 2 holdings)",
    );
  });

  it("review round 3 WR-02: an unreported INCLUDES part rules out the shared-noun form, so its '(value unavailable …)' count is never dropped and a defaulted $0 never reads as a known figure", () => {
    // 169 review round 2 IN-R2-05 / SFH R2-5: a part whose every row is unavailable has
    // no known amount (the 0 is the sum of nothing), so it names its count, never
    // "$0". The "(… unavailable for N …)" count is unchanged.
    expect(buildKeyTrustClause(part(0, 1, 1), NONE, RENDER, part(8_000, 1))).toBe(
      "includes 1 holding from keys needing attention (value unavailable for 1 holding), and excludes $8000 from keys needing attention",
    );
  });

  it("D-06 (b) / review WR-05: with an unknown-status part the includes side keeps each part's own noun, and the excludes part follows with its own", () => {
    expect(
      buildKeyTrustClause(part(12_345, 1), part(4_444, 1), RENDER, part(8_000, 1)),
    ).toBe(
      "includes $12345 from keys needing attention and $4444 from keys with an unknown sync status, and excludes $8000 from keys needing attention",
    );
    expect(
      buildKeyTrustClause(NONE, part(4_444, 1), RENDER, part(8_000, 1)),
    ).toBe(
      "includes $4444 from keys with an unknown sync status, and excludes $8000 from keys needing attention",
    );
  });

  // Review round 3 WR-01: the fifth argument is `excludedUnknownStatus`,
  // dollars the narrowing dropped whose key the key list does not carry.
  it("review round 3 WR-01: an excluded unknown-status part is named with the unknown-status noun, never folded into 'keys needing attention'", () => {
    expect(buildKeyTrustClause(NONE, NONE, RENDER, NONE, part(4_444, 1))).toBe(
      "excludes $4444 from keys with an unknown sync status",
    );
    expect(buildKeyTrustClause(NONE, NONE, RENDER, undefined, part(4_444, 1))).toBe(
      "excludes $4444 from keys with an unknown sync status",
    );
  });

  it("review round 3 WR-01: beside an includes part, the unknown-status exclusion keeps its own noun, and the shared-noun form is not used", () => {
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, NONE, part(4_444, 1)),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $4444 from keys with an unknown sync status",
    );
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, part(8_000, 1), part(4_444, 1)),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $8000 from keys needing attention and $4444 from keys with an unknown sync status",
    );
    expect(
      buildKeyTrustClause(NONE, NONE, RENDER, part(8_000, 1), part(4_444, 1)),
    ).toBe(
      "excludes $8000 from keys needing attention and $4444 from keys with an unknown sync status",
    );
  });

  it("review round 3 WR-01 / D-07 / WR-03: the unknown-status exclusion renders on its COUNT, and says when its value was not reported; a zero count adds nothing", () => {
    // 169 review round 2 IN-R2-05 / SFH R2-5: a part whose every row is unavailable has
    // no known amount (the 0 is the sum of nothing), so it names its count, never
    // "$0". The "(… unavailable for N …)" count is unchanged.
    expect(buildKeyTrustClause(NONE, NONE, RENDER, NONE, part(0, 1, 1))).toBe(
      "excludes 1 holding from keys with an unknown sync status (value unavailable for 1 holding)",
    );
    expect(buildKeyTrustClause(part(12_345, 1), NONE, RENDER, NONE, NONE)).toBe(
      "includes $12345 from keys needing attention",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.2 SC-4 — no trusted dollar disappears from the live-holdings total
// ---------------------------------------------------------------------------
//
// WHY: inside the modelled-book narrowing, a holding whose key is TRUSTED,
// present in the status map, not contributing and not manager-side fell
// through every branch to `continue`: it was in neither the total nor any
// excluded part, so the composer said nothing about it. On the founder's book
// that is exactly where the shared account's dollars sat (attributed to a key
// with no return history yet). Every toggled-on dollar must now be either in
// the total or in a NAMED excluded part. A manager-side key's dollars get their
// own part too: still undisclosed in copy (D-20: not the allocator's book), but
// counted, so the conservation invariant below can be stated over every dollar.

describe("summarizeLiveHoldings — [167.1.2 SC-4] excludedTrusted and excludedManagerSide", () => {
  it("a trusted key outside a non-empty contributing set lands in excludedTrusted (today: in no part at all)", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED],
      contributing: [KEY_SIGN_IN_FAILED],
    });
    // The total is the contributing book only, unchanged by this plan.
    expect(s.total).toBe(12_345);
    expect(s.excludedTrusted).toEqual({ amount: 480_000, count: 1, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUnknownStatus).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedManagerSide).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("a status the REAL predicate calls trusted (`error`) is excludedTrusted too, not excludedUntrusted", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_ERROR],
      contributing: [KEY_TRUSTED],
    });
    expect(s.total).toBe(480_000);
    expect(s.excludedTrusted).toEqual({ amount: 7_000, count: 1, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("a manager-side key's dropped holdings land in excludedManagerSide, trusted and untrusted alike — never in a disclosed excluded part", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_SIGN_IN_FAILED, H_ERROR],
      contributing: [KEY_TRUSTED],
      managerSide: [KEY_SIGN_IN_FAILED, KEY_ERROR],
    });
    expect(s.total).toBe(480_000);
    // Hand-listed: 12,345 (sign_in_failed) + 7,000 (error, trusted) = 19,345.
    expect(s.excludedManagerSide).toEqual({ amount: 19_345, count: 2, unavailable: 0 });
    expect(s.excludedTrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("an unreported trusted excluded holding is COUNTED as unavailable (WR-03 rule, same addTo)", () => {
    const H_TRUSTED_NO_PNL = buildHolding({
      venue: "venue-i",
      symbol: "AUMTRUST-I-PERP",
      holding_type: "derivative",
      value_usd: 700_000,
      unrealized_pnl_usd: null,
      side: "long",
      entry_price: 100,
      api_key_id: KEY_TRUSTED,
    });
    const s = summarize({
      holdings: [H_TRUSTED_NO_PNL, H_SIGN_IN_FAILED],
      contributing: [KEY_SIGN_IN_FAILED],
    });
    expect(s.excludedTrusted).toEqual({ amount: 0, count: 1, unavailable: 1 });
  });

  it("the degrade branch (EMPTY contributing set) sums the whole book, so nothing is excluded", () => {
    const s = summarize({ holdings: ALL_HOLDINGS, contributing: [] });
    expect(s.excludedTrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedManagerSide).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });
});

// ---------------------------------------------------------------------------
// Review C2 WR-03 — a dropped holding from a key that is not connected is not
// "from connected keys with no return history yet"
// ---------------------------------------------------------------------------
//
// WHY: `holdingsSummary` is not filtered by key eligibility, so a
// soft-disconnected or inactive key's last holdings still arrive. Its status
// can be `complete`, `error` or null, so it is not untrusted, and it is not
// contributing or manager-side. It landed in `excludedTrusted`, whose copy
// says the dollars come from CONNECTED keys with no history YET: both halves
// false for a disconnected key that has history. The payload's own
// `eligibleApiKeyIds` (built by isPerKeyDailiesEligibleKey on the server)
// tells the two apart, so no predicate is re-derived here.
describe("summarizeLiveHoldings — [review C2 WR-03] excludedNotConnected", () => {
  const KEY_GONE = "wr03-key-disconnected";
  const H_GONE = buildHolding({
    venue: "venue-wr03",
    symbol: "WR03-SPOT",
    value_usd: 3_300,
    api_key_id: KEY_GONE,
  });
  const statusWithGone = new Map<string, string | null>([
    ...STATUS_BY_KEY_ID,
    [KEY_GONE, "complete"],
  ]);
  const run = (eligible: readonly string[] | undefined) =>
    summarizeLiveHoldings({
      toggleByScopeRef: allOn([H_TRUSTED, H_GONE, H_REVOKED]),
      holdingByRef: buildHoldingByRef([H_TRUSTED, H_GONE, H_REVOKED]),
      contributingApiKeyIds: [KEY_TRUSTED],
      managerSideApiKeyIds: [],
      statusByKeyId: statusWithGone,
      eligibleApiKeyIds: eligible,
    });

  it("a trusted-status key outside the payload's eligible set lands in excludedNotConnected, not excludedTrusted", () => {
    const s = run([KEY_TRUSTED]);
    expect(s.total).toBe(480_000);
    expect(s.excludedNotConnected).toEqual({ amount: 3_300, count: 1, unavailable: 0 });
    expect(s.excludedTrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
    // A revoked key is ineligible too, but it stays with the untrusted part.
    expect(s.excludedUntrusted.count).toBe(1);
  });

  it("an eligible, non-contributing key is still excludedTrusted (the case the SC-4 noun is true for)", () => {
    const s = run([KEY_TRUSTED, KEY_GONE]);
    expect(s.excludedTrusted).toEqual({ amount: 3_300, count: 1, unavailable: 0 });
    expect(s.excludedNotConnected).toEqual({ amount: 0, count: 0, unavailable: 0 });
  });

  it("an absent eligible set cannot tell the two apart, so nothing is called not-connected", () => {
    const s = run(undefined);
    expect(s.excludedNotConnected).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedTrusted.count).toBe(1);
  });
});

describe("summarizeLiveHoldings — [167.1.2 SC-4] conservation over generated books", () => {
  // A seeded LCG, so a failure names a reproducible case. 256 cases mixing
  // every status the fixture knows (trusted, untrusted, absent from the status
  // map), contributing / manager-side / neither, spot and derivative holdings,
  // unreported values, negative P&L, toggles on and off, stray refs that are
  // not in holdingByRef and non-holding refs, and the empty-contributing
  // degrade branch.
  function lcg(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 0x1_0000_0000;
    };
  }
  const KEYS = [
    KEY_TRUSTED,
    KEY_SIGN_IN_FAILED,
    KEY_REVOKED,
    KEY_ERROR,
    KEY_MISSING_FROM_API_KEYS,
    "conservation-key-x",
    // Review C2 WR-03: a key the status map carries but the payload's
    // eligible set does not (soft-disconnected or inactive).
    "conservation-key-disconnected",
  ];
  const GEN_STATUS = new Map<string, string | null>([
    ...STATUS_BY_KEY_ID,
    ["conservation-key-disconnected", "complete"],
  ]);
  const partAmount = (p: { amount: number } | undefined) => p?.amount ?? 0;

  it("for every generated book: Σ toggled-on equity = total + excludedUntrusted + excludedUnknownStatus + excludedTrusted + excludedManagerSide", () => {
    const rand = lcg(1672);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    let casesWithTrustedExclusion = 0;
    let casesWithNotConnectedExclusion = 0;
    for (let c = 0; c < 256; c += 1) {
      const nHoldings = 1 + Math.floor(rand() * 8);
      const holdings: DashboardHolding[] = [];
      for (let i = 0; i < nHoldings; i += 1) {
        const deriv = rand() < 0.4;
        const missing = rand() < 0.15;
        holdings.push(
          buildHolding({
            venue: `gen-venue-${c}-${i}`,
            symbol: `GEN-${i}`,
            holding_type: deriv ? "derivative" : "spot",
            value_usd: missing && !deriv ? Number.NaN : Math.round(rand() * 100_000),
            unrealized_pnl_usd: deriv
              ? missing
                ? null
                : Math.round((rand() - 0.5) * 20_000)
              : null,
            api_key_id: pick(KEYS),
          }),
        );
      }
      const toggles: Record<string, boolean> = {};
      for (const h of holdings) toggles[ref(h)] = rand() < 0.8;
      // Stray refs the loop must ignore: one not in holdingByRef, one not a
      // holding ref at all.
      toggles[`holding:stray-${c}:X:spot`] = true;
      toggles[`strategy-${c}`] = true;
      const contributing =
        rand() < 0.15 ? [] : KEYS.filter(() => rand() < 0.4);
      const managerSide = KEYS.filter(
        (k) => !contributing.includes(k) && rand() < 0.25,
      );
      // The payload's eligible set: every key but the disconnected one and
      // the one the key list does not carry (contributing and manager-side
      // keys are eligible by construction on the server).
      const eligible = KEYS.filter(
        (k) =>
          k !== "conservation-key-disconnected" && k !== KEY_MISSING_FROM_API_KEYS,
      );
      const s = summarizeLiveHoldings({
        toggleByScopeRef: toggles,
        holdingByRef: buildHoldingByRef(holdings),
        contributingApiKeyIds: contributing,
        managerSideApiKeyIds: managerSide,
        statusByKeyId: GEN_STATUS,
        eligibleApiKeyIds: eligible,
      });
      if (s.excludedNotConnected.count > 0) casesWithNotConnectedExclusion += 1;
      // The oracle is the plain sum of the equity of every toggled-on holding,
      // with the equity definition the total itself uses.
      let expected = 0;
      for (const h of holdings) {
        if (toggles[ref(h)]) expected += holdingEquityContributionLocal(h);
      }
      const accounted =
        s.total +
        partAmount(s.excludedUntrusted) +
        partAmount(s.excludedUnknownStatus) +
        partAmount((s as { excludedTrusted?: { amount: number } }).excludedTrusted) +
        partAmount(s.excludedNotConnected) +
        partAmount(
          (s as { excludedManagerSide?: { amount: number } }).excludedManagerSide,
        );
      expect(
        accounted,
        `case ${c}: ${JSON.stringify({ contributing, managerSide })}`,
      ).toBeCloseTo(expected, 6);
      if (
        holdings.some(
          (h) =>
            toggles[ref(h)] &&
            contributing.length > 0 &&
            !contributing.includes(h.api_key_id) &&
            !managerSide.includes(h.api_key_id) &&
            (h.api_key_id === KEY_TRUSTED || h.api_key_id === KEY_ERROR) &&
            holdingEquityContributionLocal(h) !== 0,
        )
      ) {
        casesWithTrustedExclusion += 1;
      }
    }
    // Non-vacuity: the generator really produced the case this plan closes.
    expect(casesWithTrustedExclusion).toBeGreaterThan(20);
    // ...and the not-connected case review C2 WR-03 closes.
    expect(casesWithNotConnectedExclusion).toBeGreaterThan(20);
  });
});

describe("buildKeyTrustClause — [167.1.2 SC-4] the excludedTrusted part", () => {
  const RENDER = {
    amount: (n: number) => `$${n}`,
    missing: "value",
    unit: ["holding", "holdings"] as const,
  };
  const part = (amount: number, count: number, unavailable = 0) => ({
    amount,
    count,
    unavailable,
  });
  const NONE = part(0, 0);

  it("excludedTrusted only → 'excludes $X from connected keys with no return history yet'", () => {
    expect(
      buildKeyTrustClause(NONE, NONE, RENDER, NONE, NONE, part(480_000, 1)),
    ).toBe("excludes $480000 from connected keys with no return history yet");
  });

  it("the shared-noun form must not swallow it: includes + excluded untrusted + excluded trusted names all three", () => {
    expect(
      buildKeyTrustClause(
        part(12_345, 1),
        NONE,
        RENDER,
        part(8_000, 1),
        NONE,
        part(5_000, 1),
      ),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $8000 from keys needing attention and $5000 from connected keys with no return history yet",
    );
  });

  it("it comes after the other excluded parts, and says when its value was not reported", () => {
    // 169 review round 2 IN-R2-05 / SFH R2-5: a part whose every row is unavailable has
    // no known amount (the 0 is the sum of nothing), so it names its count, never
    // "$0". The "(… unavailable for N …)" count is unchanged.
    expect(
      buildKeyTrustClause(NONE, NONE, RENDER, NONE, part(4_444, 1), part(0, 2, 2)),
    ).toBe(
      "excludes $4444 from keys with an unknown sync status and 2 holdings from connected keys with no return history yet (value unavailable for 2 holdings)",
    );
  });

  // Review C2 WR-03: the not-connected part has its own noun, never the
  // "connected keys" one, and it cannot be folded into the shared-noun form.
  it("excludedNotConnected is named 'from keys that are not connected', before the no-history part", () => {
    expect(
      buildKeyTrustClause(NONE, NONE, RENDER, NONE, NONE, NONE, part(3_300, 1)),
    ).toBe("excludes $3300 from keys that are not connected");
    expect(
      buildKeyTrustClause(
        part(12_345, 1),
        NONE,
        RENDER,
        part(8_000, 1),
        NONE,
        part(5_000, 1),
        part(3_300, 1),
      ),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $8000 from keys needing attention and $3300 from keys that are not connected and $5000 from connected keys with no return history yet",
    );
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, part(8_000, 1), NONE, NONE, part(3_300, 1)),
    ).toBe(
      "includes $12345 from keys needing attention, and excludes $8000 from keys needing attention and $3300 from keys that are not connected",
    );
  });

  it("a zero-count excludedTrusted adds nothing: the clause is byte-identical to before", () => {
    expect(
      buildKeyTrustClause(part(12_345, 1), NONE, RENDER, part(8_000, 2), NONE, NONE),
    ).toBe("includes $12345 and excludes $8000 from keys needing attention");
  });
});
