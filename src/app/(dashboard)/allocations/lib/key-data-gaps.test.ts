/**
 * Phase 198 / D-01 (ROUTE-07) — the per-key missing-data producer.
 *
 * Why this exists: the Overview message must name the key, the missing days
 * and what to do ("Binance key Main: no data for 3-11 Oct"). The payload only
 * carried a reason, so the days are derived on the server from data it already
 * reads. Three things these tests defend:
 *
 * - A dead key affects only itself (founder rule). An entry names only the keys
 *   the producer attributes the fault to; keys are grouped only when they really
 *   share a known exchange account.
 * - The account id never ships (T-186-18 precedent): only the owner's own key
 *   ids cross the server boundary, and a foreign id is dropped.
 * - No day is invented. The reference day is a server day (the curve's last day
 *   or yesterday UTC), never a browser clock, and a range the producer cannot
 *   derive ships as null.
 */
import { describe, expect, it } from "vitest";
import {
  accountGroups,
  keyDataGaps,
  nextUtcDay,
  previousUtcDay,
  tailRange,
  type KeyDataGapsInput,
} from "./key-data-gaps";

const YESTERDAY = "2026-10-11";

function input(over: Partial<KeyDataGapsInput> = {}): KeyDataGapsInput {
  return {
    ownKeyIds: ["K1", "K2", "K3", "K4"],
    reason: null,
    notSyncingKeyIds: [],
    identityPendingKeyIds: [],
    keyAccounts: [],
    failingKeyExits: [],
    lastSeriesDayByKey: {},
    curveLastDay: null,
    yesterdayUtc: YESTERDAY,
    ...over,
  };
}

describe("UTC day arithmetic", () => {
  it("steps across a month boundary", () => {
    expect(nextUtcDay("2026-10-31")).toBe("2026-11-01");
    expect(previousUtcDay("2026-11-01")).toBe("2026-10-31");
  });
  it("steps across a year boundary and a leap day", () => {
    expect(nextUtcDay("2026-12-31")).toBe("2027-01-01");
    expect(previousUtcDay("2027-01-01")).toBe("2026-12-31");
    expect(nextUtcDay("2028-02-28")).toBe("2028-02-29");
    expect(nextUtcDay("2028-02-29")).toBe("2028-03-01");
    expect(nextUtcDay("2026-02-28")).toBe("2026-03-01");
  });
  it("tailRange is the day after the last day through the reference day", () => {
    expect(tailRange("2026-10-02", "2026-10-11")).toEqual({
      from: "2026-10-03",
      to: "2026-10-11",
    });
  });
  it("tailRange is null with no last day, an empty tail, or a malformed day", () => {
    expect(tailRange(null, "2026-10-11")).toBeNull();
    expect(tailRange("2026-10-11", "2026-10-11")).toBeNull();
    expect(tailRange("2026-10-12", "2026-10-11")).toBeNull();
    expect(tailRange("not-a-day", "2026-10-11")).toBeNull();
    expect(tailRange("2026-10-02", "2026-10-11T00:00:00Z")).toBeNull();
  });
});

describe("accountGroups", () => {
  const keys = [
    { id: "K2", accountId: "va-1", shareKind: null, failing: false },
    { id: "K1", accountId: "va-1", shareKind: null, failing: false },
    { id: "K4", accountId: "va-2", shareKind: null, failing: false },
    { id: "K5", accountId: null, shareKind: null, failing: false },
    { id: "K6", accountId: null, shareKind: null, failing: false },
  ];
  it("groups keys on one known account, ids sorted, and never an unknown account", () => {
    expect(accountGroups(keys, { countedOnly: false })).toEqual([["K1", "K2"]]);
  });
  it("countedOnly drops a key the derive already counts once", () => {
    const marked = [
      { id: "K1", accountId: "va-1", shareKind: null, failing: false },
      { id: "K2", accountId: "va-1", shareKind: "duplicate", failing: false },
      { id: "K3", accountId: "va-1", shareKind: "composite_member", failing: false },
    ];
    expect(accountGroups(marked, { countedOnly: true })).toEqual([]);
    expect(accountGroups(marked, { countedOnly: false })).toEqual([["K1", "K2", "K3"]]);
  });
});

describe("keyDataGaps: the rebuilding arm", () => {
  it("key_not_syncing names the failing key with the tail to yesterday UTC, and not the healthy one", () => {
    const out = keyDataGaps(
      input({
        reason: "key_not_syncing",
        notSyncingKeyIds: ["K1"],
        lastSeriesDayByKey: { K1: "2026-10-02", K2: "2026-10-10" },
      }),
    );
    expect(out).toEqual([
      {
        apiKeyIds: ["K1"],
        cause: "not_syncing",
        firstMissingDay: "2026-10-03",
        ranges: [{ from: "2026-10-03", to: "2026-10-11" }],
      },
    ]);
  });

  it("a not-syncing key with no series ships null, never a guessed range", () => {
    const out = keyDataGaps(
      input({ reason: "key_not_syncing", notSyncingKeyIds: ["K1"] }),
    );
    expect(out).toEqual([
      { apiKeyIds: ["K1"], cause: "not_syncing", firstMissingDay: null, ranges: null },
    ]);
  });

  it("a not-syncing key whose series already reaches yesterday emits no entry, so the true fallback prints (R2-03)", () => {
    // Why: its history is complete through yesterday, so an entry (which the
    // message reads as "no complete history yet") would state a false fact about
    // the data and hide the true "is not syncing" sentence.
    const out = keyDataGaps(
      input({
        reason: "key_not_syncing",
        notSyncingKeyIds: ["K1", "K2"],
        lastSeriesDayByKey: { K1: "2026-10-02", K2: YESTERDAY },
      }),
    );
    expect(out.map((g) => g.apiKeyIds[0])).toEqual(["K1"]);
  });

  it("a shared-account group whose latest day is yesterday emits no entry (R2-03)", () => {
    const out = keyDataGaps(
      input({
        reason: "shared_account_no_working_key",
        keyAccounts: [
          { id: "K1", accountId: "A", failing: true, shareKind: null },
          { id: "K2", accountId: "A", failing: true, shareKind: null },
        ],
        lastSeriesDayByKey: { K1: "2026-10-02", K2: YESTERDAY },
      }),
    );
    expect(out).toEqual([]);
  });

  it("a malformed reference day with a valid last day claims no gap (R2-03)", () => {
    const out = keyDataGaps(
      input({
        reason: "key_not_syncing",
        notSyncingKeyIds: ["K1"],
        lastSeriesDayByKey: { K1: "2026-10-02" },
        yesterdayUtc: "not-a-day",
      }),
    );
    expect(out).toEqual([]);
  });

  it("a not-syncing key with a malformed last day is named with no range, not dropped (SFH-4)", () => {
    const out = keyDataGaps(
      input({
        reason: "key_not_syncing",
        notSyncingKeyIds: ["K1"],
        lastSeriesDayByKey: { K1: "not-a-day" },
      }),
    );
    expect(out).toEqual([
      { apiKeyIds: ["K1"], cause: "not_syncing", firstMissingDay: null, ranges: null },
    ]);
  });

  it("account_identity_pending names the pending key with no range", () => {
    const out = keyDataGaps(
      input({
        reason: "account_identity_pending",
        identityPendingKeyIds: ["K3"],
        lastSeriesDayByKey: { K3: "2026-10-01" },
      }),
    );
    expect(out).toEqual([
      { apiKeyIds: ["K3"], cause: "identity_pending", firstMissingDay: null, ranges: null },
    ]);
  });

  it("duplicate_account names the two counted keys on one account and not the key alone", () => {
    const out = keyDataGaps(
      input({
        reason: "duplicate_account",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: false },
          { id: "K2", accountId: "va-1", shareKind: null, failing: false },
          { id: "K4", accountId: "va-2", shareKind: null, failing: false },
        ],
      }),
    );
    expect(out).toEqual([
      { apiKeyIds: ["K1", "K2"], cause: "duplicate_account", firstMissingDay: null, ranges: null },
    ]);
  });

  it("a pair already marked duplicate or composite_member is not a counted collision", () => {
    for (const shareKind of ["duplicate", "composite_member"]) {
      const out = keyDataGaps(
        input({
          reason: "duplicate_account",
          keyAccounts: [
            { id: "K1", accountId: "va-1", shareKind: null, failing: false },
            { id: "K2", accountId: "va-1", shareKind, failing: false },
          ],
        }),
      );
      expect(out).toEqual([]);
    }
  });

  it("shared_account_no_working_key: a group whose every key fails starts after the latest last day", () => {
    const out = keyDataGaps(
      input({
        reason: "shared_account_no_working_key",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: true },
          { id: "K2", accountId: "va-1", shareKind: null, failing: true },
          { id: "K4", accountId: "va-2", shareKind: null, failing: true },
        ],
        lastSeriesDayByKey: { K1: "2026-10-01", K2: "2026-10-04" },
      }),
    );
    expect(out).toEqual([
      {
        apiKeyIds: ["K1", "K2"],
        cause: "shared_account_failing",
        firstMissingDay: "2026-10-05",
        ranges: [{ from: "2026-10-05", to: YESTERDAY }],
      },
    ]);
  });

  it("shared_account_no_working_key: a group where one key still works gives no entry (a dead key affects only itself)", () => {
    const out = keyDataGaps(
      input({
        reason: "shared_account_no_working_key",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: true },
          { id: "K2", accountId: "va-1", shareKind: null, failing: false },
        ],
        lastSeriesDayByKey: { K1: "2026-10-01", K2: "2026-10-10" },
      }),
    );
    expect(out).toEqual([]);
  });

  it("a reason with no per-key producer (awaiting_derivation) names no key", () => {
    const out = keyDataGaps(
      input({
        reason: "awaiting_derivation",
        notSyncingKeyIds: ["K1"],
        identityPendingKeyIds: ["K3"],
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: true },
          { id: "K2", accountId: "va-1", shareKind: null, failing: true },
        ],
      }),
    );
    expect(out).toEqual([]);
  });
});

describe("keyDataGaps: the ready arm", () => {
  it("a sync_failing exit runs from the day after its last counted day to the curve's last day", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K1", reason: "sync_failing", day: "2026-10-03" }],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out).toEqual([
      {
        apiKeyIds: ["K1"],
        cause: "sync_failing",
        firstMissingDay: "2026-10-04",
        ranges: [{ from: "2026-10-04", to: "2026-10-09" }],
      },
    ]);
  });

  it("read_incomplete keeps its own cause", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K2", reason: "read_incomplete", day: "2026-10-07" }],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out.map((g) => g.cause)).toEqual(["read_incomplete"]);
    expect(out[0].ranges).toEqual([{ from: "2026-10-08", to: "2026-10-09" }]);
  });

  it("an exit that never counted (day null) ships null and null", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K1", reason: "sync_failing", day: null }],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out).toEqual([
      { apiKeyIds: ["K1"], cause: "sync_failing", firstMissingDay: null, ranges: null },
    ]);
  });

  it("an exit whose day equals the curve's last day has nothing missing and emits no entry", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K1", reason: "sync_failing", day: "2026-10-09" }],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out).toEqual([]);
  });

  it("the reference day is the curve's last day, not yesterday and not the exit's own day", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K1", reason: "sync_failing", day: "2026-06-03" }],
        curveLastDay: "2026-10-09",
        yesterdayUtc: "2026-10-30",
      }),
    );
    expect(out[0].ranges).toEqual([{ from: "2026-06-04", to: "2026-10-09" }]);
  });

  it("falls back to yesterday UTC when no curve is on screen", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [{ apiKeyId: "K1", reason: "sync_failing", day: "2026-10-03" }],
        curveLastDay: null,
      }),
    );
    expect(out[0].ranges).toEqual([{ from: "2026-10-04", to: YESTERDAY }]);
  });
});

describe("keyDataGaps: owner-only and no account identity", () => {
  it("drops an exit naming a key the owner does not hold", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [
          { apiKeyId: "KX", reason: "sync_failing", day: "2026-10-03" },
          { apiKeyId: "K1", reason: "sync_failing", day: "2026-10-03" },
        ],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out.map((g) => g.apiKeyIds)).toEqual([["K1"]]);
  });

  it("a duplicate group left with one owned key gives no entry", () => {
    const out = keyDataGaps(
      input({
        reason: "duplicate_account",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: false },
          { id: "KX", accountId: "va-1", shareKind: null, failing: false },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("a foreign id never survives into a group alongside owned ids", () => {
    const out = keyDataGaps(
      input({
        reason: "duplicate_account",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: false },
          { id: "K2", accountId: "va-1", shareKind: null, failing: false },
          { id: "KX", accountId: "va-1", shareKind: null, failing: false },
        ],
      }),
    );
    expect(out.map((g) => g.apiKeyIds)).toEqual([["K1", "K2"]]);
  });

  it("no output field holds an account id", () => {
    const out = keyDataGaps(
      input({
        reason: "shared_account_no_working_key",
        keyAccounts: [
          { id: "K1", accountId: "va-1", shareKind: null, failing: true },
          { id: "K2", accountId: "va-1", shareKind: null, failing: true },
        ],
        lastSeriesDayByKey: { K1: "2026-10-01" },
        failingKeyExits: [{ apiKeyId: "K4", reason: "sync_failing", day: "2026-10-03" }],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toContain("va-");
  });
});

describe("keyDataGaps: stable order", () => {
  it("sorts by cause, then first key id", () => {
    const out = keyDataGaps(
      input({
        failingKeyExits: [
          { apiKeyId: "K3", reason: "sync_failing", day: "2026-10-03" },
          { apiKeyId: "K2", reason: "sync_failing", day: "2026-10-03" },
          { apiKeyId: "K4", reason: "read_incomplete", day: "2026-10-03" },
        ],
        curveLastDay: "2026-10-09",
      }),
    );
    expect(out.map((g) => `${g.cause}:${g.apiKeyIds[0]}`)).toEqual([
      "read_incomplete:K4",
      "sync_failing:K2",
      "sync_failing:K3",
    ]);
  });
});
