/**
 * Phase 170.4 plan 11 (D-10, D-08). The TS half of the one-key-per-account-day
 * rule, replayed against the case table the Python twin reads too
 * (`analytics-service/tests/fixtures/one_key_per_account_day_cases.json`, the
 * `one_key_per_account_day_cases` oracle). The figures in that file are
 * hand-typed; nothing here derives an expectation from the code under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HoldingsUpdatedAtError,
  oneKeyPerAccountDay,
  writtenAtMicros,
} from "./holdings-account-day";

type CaseRow = {
  api_key_id: string;
  account: string;
  asof: string;
  updated_at?: string | null;
  holding_type: string;
  symbol: string;
  value_usd: number;
};

type Case = {
  name: string;
  rows: CaseRow[];
  expected?: Record<string, string[]>;
  expected_sum_usd?: number;
  expect_error?: string;
};

const spec = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "analytics-service/tests/fixtures/one_key_per_account_day_cases.json",
    ),
    "utf8",
  ),
) as {
  micros: Array<{ ts: string; micros: number }>;
  micros_errors: string[];
  cases: Case[];
};

describe("writtenAtMicros (the shared case file's timestamps)", () => {
  it.each(spec.micros)("$ts parses to $micros microseconds", ({ ts, micros }) => {
    expect(writtenAtMicros(ts)).toBe(micros);
  });

  it.each(spec.micros_errors)("%j is rejected with the named error", (ts) => {
    expect(() => writtenAtMicros(ts)).toThrow(HoldingsUpdatedAtError);
  });

  it.each([null, undefined, 20261011, {}])(
    "a non-string (%j) is rejected with the named error",
    (value) => {
      expect(() => writtenAtMicros(value as unknown as string)).toThrow(
        HoldingsUpdatedAtError,
      );
    },
  );

  it("returns a plain integer number far below 2^53", () => {
    const v = writtenAtMicros("2026-10-11T04:00:05.123456+00:00");
    expect(Number.isSafeInteger(v)).toBe(true);
    expect(typeof v).toBe("number");
  });
});

describe("oneKeyPerAccountDay (D-10, one rule for both runtimes)", () => {
  it("the shared case table is not empty", () => {
    expect(spec.cases.length).toBeGreaterThan(10);
  });

  for (const c of spec.cases) {
    it(c.name, () => {
      const accountByKey = new Map(c.rows.map((r) => [r.api_key_id, r.account]));
      const accountOf = (keyId: string): string =>
        accountByKey.get(keyId) ?? `key:${keyId}`;
      const rows = c.rows as unknown as Array<
        CaseRow & { updated_at: string }
      >;
      if (c.expect_error !== undefined) {
        expect(() => oneKeyPerAccountDay(rows, accountOf)).toThrow(
          HoldingsUpdatedAtError,
        );
        expect(c.expect_error).toBe("HoldingsUpdatedAtError");
        return;
      }
      const survivors = oneKeyPerAccountDay(rows, accountOf);
      const byAccount: Record<string, string[]> = {};
      for (const row of survivors) {
        const keys = (byAccount[row.account] ??= []);
        if (!keys.includes(row.api_key_id)) keys.push(row.api_key_id);
      }
      expect(byAccount).toEqual(c.expected);
      expect(survivors.reduce((s, r) => s + r.value_usd, 0)).toBe(
        c.expected_sum_usd,
      );
    });
  }

  it("keeps the winner's rows in input order and never mutates the input", () => {
    const input = [
      {
        api_key_id: "a",
        asof: "2026-10-11",
        updated_at: "2026-10-11T04:00:00Z",
        holding_type: "spot",
        symbol: "ETH",
      },
      {
        api_key_id: "b",
        asof: "2026-10-11",
        updated_at: "2026-10-11T05:00:00Z",
        holding_type: "spot",
        symbol: "SOL",
      },
      {
        api_key_id: "b",
        asof: "2026-10-11",
        updated_at: "2026-10-11T05:00:00Z",
        holding_type: "spot",
        symbol: "BTC",
      },
    ];
    const copy = structuredClone(input);
    const out = oneKeyPerAccountDay(input, () => "acct");
    expect(out.map((r) => r.symbol)).toEqual(["SOL", "BTC"]);
    expect(input).toEqual(copy);
  });

  it("an empty input is an empty output", () => {
    expect(oneKeyPerAccountDay([], () => "acct")).toEqual([]);
  });
});
