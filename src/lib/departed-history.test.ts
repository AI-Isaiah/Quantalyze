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
  departedAnchorOf,
  departedHistoryCard,
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
    const line = departedHistorySentence(decisionFor("13_", "k-dep"));
    expect(line).not.toContain("over these days");
    expect(line).toBe(
      "History not included yet: a key you still have connected reads the same exchange account and has no history yet. Once it has, this key counts for the days before that key's history starts.",
    );
  });

  it("SFH-C4-07: a covered key names the earlier key that counts its days", () => {
    expect(departedHistorySentence(decisionFor("18_", "k-b"))).toBe(
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

describe("departedHistoryCard — the switch and the line never disagree (SFH-C4-05, SFH-C4-06)", () => {
  const knownCase = spec.cases.find((c) => c.name.startsWith("01_"))!;
  const knownKey = knownCase.keys.find((k) => k.id === "k-dep")!;
  const unknownCase = spec.cases.find((c) => c.name.startsWith("05_"))!;
  const unknownKey = unknownCase.keys.find((k) => isDepartedKey(k))!;

  it("reads a key_inputs payload: a finite anchor, a missing row, a stamped null", () => {
    expect(departedAnchorOf({ payload: { anchor_usd: 1000 } })).toEqual({ state: "anchored" });
    expect(departedAnchorOf(undefined)).toEqual({ state: "missing" });
    expect(
      departedAnchorOf({ payload: { anchor_usd: null, anchor_null_reason: "balance_error" } }),
    ).toEqual({ state: "unusable", reason: "balance_error" });
    expect(departedAnchorOf({ payload: { anchor_usd: null } })).toEqual({
      state: "unusable",
      reason: null,
    });
  });

  it("an anchored included key: switch on, and it can be excluded", () => {
    const card = departedHistoryCard(knownKey, knownCase.keys, { state: "anchored" });
    expect(card).toEqual({
      sentence: "History included until 2026-06-10.",
      checked: true,
      toggleTo: "exclude",
    });
  });

  it("SFH-C4-05: an included key with no anchor reads OFF and cannot be flipped", () => {
    // The derive leaves it out (departed_history_unavailable). A switch shown
    // ON beside "not available" tells the owner two opposite things.
    const card = departedHistoryCard(knownKey, knownCase.keys, { state: "missing" });
    expect(card.checked).toBe(false);
    expect(card.toggleTo).toBeNull();
    expect(card.sentence).toBe(
      "History not available: the balance it is measured from was deleted before departed history was kept.",
    );
  });

  it("SFH-C4-05: an unknown-account key with no anchor never invites an include that cannot take effect", () => {
    const card = departedHistoryCard(unknownKey, unknownCase.keys, { state: "missing" });
    expect(card.toggleTo).toBeNull();
    expect(card.checked).toBe(false);
    expect(card.sentence).not.toContain("Include it");
    expect(card.sentence.startsWith("History not available:")).toBe(true);
  });

  it("SFH-C4-06: a row whose last balance read failed is not said to be deleted", () => {
    const card = departedHistoryCard(knownKey, knownCase.keys, {
      state: "unusable",
      reason: "balance_error",
    });
    expect(card.sentence).not.toContain("deleted");
    expect(card.sentence).toBe(
      "History not available: the last balance read before this key stopped failed, so there is no balance to measure its history from.",
    );
    for (const reason of ["nonfinite", "nonpositive", "dust", "flow_drop", null]) {
      const line = departedHistoryCard(knownKey, knownCase.keys, {
        state: "unusable",
        reason,
      }).sentence;
      expect(line.startsWith("History not available:"), String(reason)).toBe(true);
      expect(line, String(reason)).not.toContain("deleted");
    }
  });

  it("164.6.6.2 D-13: a native-unit key names its real cause, and every other reason keeps its sentence", () => {
    // The python derive stamps anchor_null_reason "native_unit" for an account measured in
    // its own currency (a BTC MT5 account). Without its own case it fell through to
    // "the last balance read ... gave no usable balance", which is false: the read worked.
    const anchor = departedAnchorOf({
      payload: { anchor_usd: null, anchor_null_reason: "native_unit" },
    });
    expect(anchor).toEqual({ state: "unusable", reason: "native_unit" });
    const card = departedHistoryCard(knownKey, knownCase.keys, anchor);
    expect(card.sentence).toBe(
      "History not available: this account is measured in its own currency, not USD, so it cannot be added to a USD history.",
    );
    expect(card.checked).toBe(false);
    expect(card.toggleTo).toBeNull();
    const fallback = departedHistoryCard(knownKey, knownCase.keys, {
      state: "unusable",
      reason: "something_else",
    }).sentence;
    expect(fallback).toBe(
      "History not available: the last balance read before this key stopped gave no usable balance to measure its history from.",
    );
  });

  it("164.6.6.2.1 D-09: a native key whose last day has no stored close names that cause, and native_unit keeps its sentence", () => {
    // The derive stamps anchor_null_reason "native_unpriced" when a native-unit
    // account's last balance has no stored BTC close. The read worked and the
    // account is supported; what is missing is a price for one day.
    const anchor = departedAnchorOf({
      payload: { anchor_usd: null, anchor_null_reason: "native_unpriced" },
    });
    expect(anchor).toEqual({ state: "unusable", reason: "native_unpriced" });
    const card = departedHistoryCard(knownKey, knownCase.keys, anchor);
    expect(card.sentence).toBe(
      "History not available: no BTC close is stored for this account's last day, so its last balance cannot be priced in USD.",
    );
    expect(card.checked).toBe(false);
    expect(card.toggleTo).toBeNull();
    // The unsupported-currency sentence is a different cause and stays.
    expect(
      departedHistoryCard(knownKey, knownCase.keys, { state: "unusable", reason: "native_unit" })
        .sentence,
    ).toBe(
      "History not available: this account is measured in its own currency, not USD, so it cannot be added to a USD history.",
    );
  });

  it("a bounded key with no anchor keeps its bound's own reason", () => {
    const c = spec.cases.find((row) => row.name.startsWith("13_"))!;
    const card = departedHistoryCard(c.keys.find((k) => k.id === "k-dep")!, c.keys, {
      state: "missing",
    });
    expect(card.sentence.startsWith("History not included yet:")).toBe(true);
    expect(card.toggleTo).toBeNull();
  });
});
