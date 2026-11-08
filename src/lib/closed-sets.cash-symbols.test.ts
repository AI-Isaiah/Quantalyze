/**
 * Phase 198 / ROUTE-08, SC-3 — the cash set the Holdings views classify with.
 *
 * Why this test exists: the Python `STABLECOINS` literal in
 * analytics-service/services/closed_sets.py is the writer's "treat as cash,
 * mark at $1" set. `CASH_SYMBOLS` is its TypeScript copy. If the two drift, a
 * stablecoin the writer already treats as cash would be counted as Spot
 * exposure again by the table, the exposure strip and the over-time series,
 * and the book would read as more invested than it is. The parity case below
 * is the only link between the two runtimes, so it reads the Python literal
 * on every run and compares it member for member.
 *
 * The split-suffix symbols (USDE, PYUSD, USDB) are deliberately NOT cash: the
 * writer recognises them only to parse perp symbols, and its own comment says
 * a token like PYUSDETH must not be skipped as cash.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASH_SYMBOLS, isCashHolding } from "@/lib/closed-sets";

const pyLiteral = (name: string): string[] => {
  const src = readFileSync(
    join(process.cwd(), "analytics-service", "services/closed_sets.py"),
    "utf8",
  );
  const m = new RegExp(
    `^${name}: frozenset\\[str\\] = frozenset\\(\\s*\\{([^}]*)\\}\\s*\\)`,
    "m",
  ).exec(src);
  expect(m, `${name} literal not found in closed_sets.py`).not.toBeNull();
  const members = [...m![1].matchAll(/"([A-Z0-9]+)"/g)].map((x) => x[1]);
  expect(
    members.length,
    `${name} literal in closed_sets.py is empty`,
  ).toBeGreaterThan(0);
  return members;
};

describe("CASH_SYMBOLS parity with the analytics writer", () => {
  it("equals the STABLECOINS literal in analytics-service/services/closed_sets.py, member for member", () => {
    expect([...CASH_SYMBOLS].sort()).toEqual([...pyLiteral("STABLECOINS")].sort());
  });

  it("excludes every split-suffix symbol, which the writer parses but does not treat as cash", () => {
    for (const s of pyLiteral("STABLECOIN_SPLIT_SUFFIXES")) {
      expect(CASH_SYMBOLS.has(s), `${s} must not be cash`).toBe(false);
    }
  });
});

describe("isCashHolding", () => {
  it.each(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"])(
    "a spot %s row is cash",
    (symbol) => {
      expect(isCashHolding({ holding_type: "spot", symbol })).toBe(true);
    },
  );

  it("matches the symbol case-insensitively", () => {
    expect(isCashHolding({ holding_type: "spot", symbol: "usdt" })).toBe(true);
    expect(isCashHolding({ holding_type: "spot", symbol: "Usdc" })).toBe(true);
  });

  it.each(["USDE", "PYUSD", "USDB"])(
    "a spot %s row is not cash (split-suffix token)",
    (symbol) => {
      expect(isCashHolding({ holding_type: "spot", symbol })).toBe(false);
    },
  );

  it("a spot BTC row is not cash", () => {
    expect(isCashHolding({ holding_type: "spot", symbol: "BTC" })).toBe(false);
  });

  it("a derivative row is never cash, even on a stablecoin symbol", () => {
    expect(isCashHolding({ holding_type: "derivative", symbol: "USDT" })).toBe(false);
  });

  it("an MT5-style account-balance row is not cash unless its symbol is in the set", () => {
    expect(isCashHolding({ holding_type: "spot", symbol: "ACCOUNT-1a2b" })).toBe(false);
  });
});
