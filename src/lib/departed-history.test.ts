/**
 * Phase 167.1.2 plan 09 (D-05, D-09) — the overview's inclusion rule against the
 * ONE shared spec, analytics-service/tests/fixtures/departed_history_inclusion.json.
 *
 * The derive job (Python `departed_history_inclusion`) decides which departed
 * keys' history the book counts. The key card shows the owner what that
 * decision is. If the two read different inputs or apply different rules, the
 * card says "included until June 10" over a book that stops on June 14, or it
 * offers an "include" switch for an account the book already counts through a
 * live key. So both implementations are tested against every row of the same
 * file, read by path, never a copied table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  departedHistoryInclusion,
  isDepartedKey,
  type DepartedHistoryKey,
  type DepartedHistoryDecision,
} from "./departed-history";

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/departed_history_inclusion.json",
);

interface FixtureCase {
  name: string;
  keys: DepartedHistoryKey[];
  expected: Record<string, DepartedHistoryDecision>;
}

const spec = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: FixtureCase[];
};

describe("departedHistoryInclusion — the shared D-09 spec", () => {
  it("reads the plan's rows, including two departed keys on one known account", () => {
    expect(spec.cases.length).toBeGreaterThanOrEqual(9);
    expect(spec.cases.map((c) => c.name)).toContain(
      "03_two_departed_keys_on_one_account_never_count_on_the_same_day",
    );
  });

  for (const c of spec.cases) {
    it(c.name, () => {
      const departed = c.keys.filter(isDepartedKey);
      expect(departed.map((k) => k.id).sort()).toEqual(
        Object.keys(c.expected).sort(),
      );
      for (const key of departed) {
        expect(departedHistoryInclusion(key, c.keys), key.id).toEqual(
          c.expected[key.id],
        );
      }
    });
  }

  it("never reads created_at: a key's creation day does not move its end day", () => {
    const base = spec.cases.find((c) =>
      c.name.startsWith("02_same_account_as_a_live_key"),
    )!;
    const withCreated = base.keys.map((k) => ({
      ...k,
      created_at: "2026-06-17T00:00:00+00:00",
    }));
    const dep = withCreated.find((k) => k.id === "k-dep")!;
    expect(departedHistoryInclusion(dep, withCreated)).toEqual(
      base.expected["k-dep"],
    );
  });
});
