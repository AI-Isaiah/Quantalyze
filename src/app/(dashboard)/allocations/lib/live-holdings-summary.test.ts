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

  it("review WR-05: a missing-key holding the narrowing drops is in neither the total nor unknownStatus", () => {
    const s = summarize({
      holdings: [H_TRUSTED, H_MISSING_KEY],
      contributing: [KEY_TRUSTED],
    });
    expect(s.total).toBe(480_000);
    expect(s.unknownStatus).toEqual({ amount: 0, count: 0, unavailable: 0 });
    expect(s.excludedUntrusted).toEqual({ amount: 0, count: 0, unavailable: 0 });
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
    // what counting the manager-side holding would give.
    expect(s.excludedUntrusted).toEqual({ amount: 15_555, count: 2, unavailable: 0 });
    expect(s.excludedUntrusted.amount).not.toBe(71_110);
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
