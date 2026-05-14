/**
 * audit-2026-05-07 P2005: TS-side unit tests for assertTradeMixBucketCount.
 *
 * Mirrors the Python ``_resolve_has_maker_taker`` coverage in
 * analytics-service/tests/test_metrics_parity.py. Both sides MUST agree on
 * fixture-pin-vs-env reconciliation or the contract drifts silently across
 * runtimes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertTradeMixBucketCount } from "../lib/metrics-parity-helper";

const FOUR_BUCKET = {
  long_maker: { count: 1, total_notional: 100 },
  long_taker: { count: 1, total_notional: 100 },
  short_maker: { count: 1, total_notional: 100 },
  short_taker: { count: 1, total_notional: 100 },
};
const TWO_BUCKET = {
  long: { count: 1, total_notional: 100 },
  short: { count: 1, total_notional: 100 },
};

function buildExpected(
  mode: boolean | undefined,
  tradeMix: Record<string, unknown>,
): {
  metrics_json: Record<string, unknown>;
  _fixture_has_maker_taker?: unknown;
} {
  const expected: {
    metrics_json: Record<string, unknown>;
    _fixture_has_maker_taker?: unknown;
  } = {
    metrics_json: { trade_metrics: { trade_mix: tradeMix } },
  };
  if (mode !== undefined) {
    expected._fixture_has_maker_taker = mode;
  }
  return expected;
}

describe("assertTradeMixBucketCount (P2005 cross-runtime contract)", () => {
  const originalEnv = process.env.TRADE_MIX_HAS_MAKER_TAKER;

  beforeEach(() => {
    delete process.env.TRADE_MIX_HAS_MAKER_TAKER;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TRADE_MIX_HAS_MAKER_TAKER;
    } else {
      process.env.TRADE_MIX_HAS_MAKER_TAKER = originalEnv;
    }
  });

  it("fixture pin true + 4-bucket trade_mix passes (no env)", () => {
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).not.toThrow();
  });

  it("fixture pin false + 2-bucket trade_mix passes (no env)", () => {
    expect(() =>
      assertTradeMixBucketCount(buildExpected(false, TWO_BUCKET)),
    ).not.toThrow();
  });

  it("fixture pin true + 2-bucket trade_mix fails loud", () => {
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, TWO_BUCKET)),
    ).toThrow(/4-bucket Trade Mix missing key/);
  });

  it("fixture pin false + 4-bucket trade_mix fails loud", () => {
    expect(() =>
      assertTradeMixBucketCount(buildExpected(false, FOUR_BUCKET)),
    ).toThrow(/2-bucket fallback missing key/);
  });

  it("missing _fixture_has_maker_taker refuses to default-False (P2005)", () => {
    expect(() =>
      assertTradeMixBucketCount(buildExpected(undefined, TWO_BUCKET)),
    ).toThrow(/missing top-level '_fixture_has_maker_taker'/);
  });

  it("non-bool fixture pin (string 'true') refuses to coerce", () => {
    expect(() =>
      // @ts-expect-error — intentionally passing wrong type to test refusal
      assertTradeMixBucketCount(buildExpected("true", FOUR_BUCKET)),
    ).toThrow(/must be a JSON bool/);
  });

  it("env agrees with fixture pin (case-sensitive 'true')", () => {
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "true";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).not.toThrow();
  });

  it("env agrees with fixture pin via case-insensitive match (mirrors Python)", () => {
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "True";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).not.toThrow();
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "TRUE";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).not.toThrow();
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "False";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(false, TWO_BUCKET)),
    ).not.toThrow();
  });

  it("env contradicts fixture pin fails loud", () => {
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "false";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).toThrow(/contradicts fixture pinned mode/);
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "true";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(false, TWO_BUCKET)),
    ).toThrow(/contradicts fixture pinned mode/);
  });

  it("env set to garbage rejected as contradiction", () => {
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "yes";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(true, FOUR_BUCKET)),
    ).toThrow(/contradicts fixture pinned mode/);
    process.env.TRADE_MIX_HAS_MAKER_TAKER = "1";
    expect(() =>
      assertTradeMixBucketCount(buildExpected(false, TWO_BUCKET)),
    ).toThrow(/contradicts fixture pinned mode/);
  });

  it("missing trade_mix returns silently (upstream test covers this)", () => {
    expect(() =>
      assertTradeMixBucketCount({
        metrics_json: { trade_metrics: {} },
        _fixture_has_maker_taker: true,
      }),
    ).not.toThrow();
  });
});
