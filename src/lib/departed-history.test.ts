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
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  departedHistoryInclusion,
  departedHistorySentence,
  isDepartedKey,
  isLiveKey,
  type DepartedHistoryKey,
  type DepartedHistoryDecision,
} from "./departed-history";
import { isPerKeyDailiesEligibleKey } from "./queries";

// queries.ts builds Supabase clients at call time only; stub the modules so the
// pure predicate imports without environment.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

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

describe("departedHistorySentence — the card never states a false reason", () => {
  function decisionFor(caseName: string, keyId: string): DepartedHistoryDecision {
    const c = spec.cases.find((row) => row.name.startsWith(caseName))!;
    return departedHistoryInclusion(c.keys.find((k) => k.id === keyId)!, c.keys);
  }

  it("WR-04: a connected key with no history yet is not said to read these days", () => {
    // Rotation: the new key on the same account has no daily returns yet, so it
    // reads none of the departed key's days. Saying it does tells the owner a
    // falsehood about why their history vanished.
    const line = departedHistorySentence(
      decisionFor("13_", "k-dep"),
      true,
    );
    expect(line).not.toContain("over these days");
    expect(line).toBe(
      "History not included yet: a key you still have connected reads the same exchange account and has no history yet. Once it has, this key counts for the days before that key's history starts.",
    );
  });

  it("SFH-C4-07: a covered key names the earlier key that counts its days", () => {
    expect(departedHistorySentence(decisionFor("18_", "k-b"), true)).toBe(
      "History not included: an earlier key read the same exchange account over all of these days.",
    );
  });
});

describe("isLiveKey — the reader's eligible-key predicate, never a drifting copy (IN-02)", () => {
  // The card calls a key live exactly when the My Allocation reader counts it.
  // If they drift, the card bounds a departed key by a key the book does not
  // count, or offers a history switch on a key the book already counts.
  const cases = [true, false].flatMap((is_active) =>
    [null, "complete", "error", "sign_in_failed", "revoked"].flatMap((sync_status) =>
      [null, "2026-06-10T00:00:00Z"].map((disconnected_at) => ({
        is_active,
        sync_status,
        disconnected_at,
      })),
    ),
  );
  it.each(cases)("%o", (key) => {
    expect(isLiveKey(key)).toBe(isPerKeyDailiesEligibleKey(key));
  });
});
