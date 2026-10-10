/**
 * audit-2026-05-07 M-0583 regression test — ApiKey runtime guard at
 * the storage→TS boundary. The DB `api_keys.exchange` column is plain
 * TEXT (no CHECK constraint); a typo from any insert path would land
 * silently and break downstream EXCHANGE_LABELS lookups with
 * `undefined`. `parseApiKeyRows()` validates the row's exchange against
 * the narrow Zod enum and drops violators with a redacted warn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseApiKeyRows, ApiKeyRowSchema } from "@/lib/types";

// audit-2026-05-07 type-design HIGH (red-team apply): `disconnected_at`
// added to `ApiKeyRowSchema` and `ApiKey` to match the
// `API_KEY_USER_COLUMNS` projection (migration 075). The test fixture
// now includes it so the schema's `.strict()` accepts the row.
const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  user_id: "11111111-1111-1111-1111-111111111111",
  exchange: "binance",
  label: "Main",
  is_active: true,
  sync_status: "complete",
  last_sync_at: "2026-01-01T00:00:00Z",
  account_balance_usdt: 1000,
  created_at: "2026-01-01T00:00:00Z",
  sync_error: null,
  last_429_at: null,
  disconnected_at: null,
  // Phase 164.5.3 / MT5CREDS — `venue_account_id` joined the
  // `API_KEY_USER_COLUMNS` projection (migration 20260920120000 extends
  // the SEC-005 GRANT allowlist to it; the column itself has existed
  // since 20260812083206). Same three-way sync as 066/068/075, so the
  // fixture carries it for `.strict()` to accept the row.
  venue_account_id: null,
  // Phase 167.1.2 plan 04 — the account-share marker and the departed-history
  // flag joined the projection (migration 20260925120000 GRANTs them), so the
  // fixture carries them for `.strict()` to accept the row.
  account_shared_with_api_key_id: null,
  account_share_kind: null,
  history_inclusion: null,
  // Phase 164.6.6.2.1 plan 15 (D-07 / D-17) — the account's native unit, its
  // balance in that unit and the stored close day joined the projection
  // (migration 20261010120000 GRANTs them), so the fixture carries them for
  // `.strict()` to accept the row.
  account_currency: null,
  account_balance_native: null,
  account_balance_usdt_close_date: null,
};

describe("ApiKeyRowSchema — M-0583 trust-boundary guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("accepts a valid api_keys row", () => {
    const out = parseApiKeyRows([baseRow]);
    expect(out).toHaveLength(1);
    expect(out[0].exchange).toBe("binance");
  });

  it("rejects an exchange typo at the boundary", () => {
    const out = parseApiKeyRows([{ ...baseRow, exchange: "binnance" }]);
    expect(out).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("coerces NUMERIC-as-string account_balance_usdt", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_balance_usdt: "1234.56" }]);
    expect(out).toHaveLength(1);
    expect(out[0].account_balance_usdt).toBeCloseTo(1234.56);
  });

  it("strict rejects unexpected column drift", () => {
    const out = parseApiKeyRows([{ ...baseRow, mystery_field: "drift" }]);
    expect(out).toHaveLength(0);
  });

  it("schema-direct safeParse exposes the failing path on drift", () => {
    const result = ApiKeyRowSchema.safeParse({ ...baseRow, exchange: "kraken" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("exchange"))).toBe(
        true,
      );
    }
  });

  it("redacts row contents in warn output", () => {
    parseApiKeyRows([{ ...baseRow, label: "SECRET-LABEL-CONTENTS", exchange: "kraken" }]);
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain("SECRET-LABEL-CONTENTS");
  });

  // audit-2026-05-07 RT-0005 (red-team apply): pin behaviour of the
  // newly-required `disconnected_at` field on ApiKeyRowSchema. Without
  // these tests, a future refactor that drops the field from .strict()
  // wouldn't be caught.
  it("preserves disconnected_at (null) in the parsed output", () => {
    const out = parseApiKeyRows([baseRow]);
    expect(out).toHaveLength(1);
    expect(out[0].disconnected_at).toBeNull();
  });

  it("preserves disconnected_at (timestamp) in the parsed output", () => {
    const ts = "2026-04-22T09:00:00Z";
    const out = parseApiKeyRows([{ ...baseRow, disconnected_at: ts }]);
    expect(out).toHaveLength(1);
    expect(out[0].disconnected_at).toBe(ts);
  });

  it("rejects rows missing disconnected_at (strict schema)", () => {
    const { disconnected_at: _omit, ...rowWithoutDisconnected } = baseRow;
    const out = parseApiKeyRows([rowWithoutDisconnected]);
    expect(out).toHaveLength(0);
  });

  // Phase 164.5.3 / MT5CREDS — the same three pins RT-0005 wrote for
  // `disconnected_at`, for the same reason: without them a future refactor
  // that drops `venue_account_id` from `.strict()` would not be caught, and
  // the field the whole phase exists to surface would be pinned by nothing.
  // NOTE the value is the non-secret MT5 login. It is a caller-supplied
  // parameter stored WITHOUT validation (see the column COMMENT on
  // 20260812083206) — "what the server passed", never "what the venue
  // confirmed" — so these pin PRESERVATION only, never provenance.
  it("preserves venue_account_id (null) in the parsed output", () => {
    const out = parseApiKeyRows([baseRow]);
    expect(out).toHaveLength(1);
    expect(out[0].venue_account_id).toBeNull();
  });

  it("preserves venue_account_id (identifier) in the parsed output", () => {
    const out = parseApiKeyRows([{ ...baseRow, venue_account_id: "000000" }]);
    expect(out).toHaveLength(1);
    expect(out[0].venue_account_id).toBe("000000");
  });

  it("rejects rows missing venue_account_id (strict schema)", () => {
    const { venue_account_id: _omit, ...rowWithoutVenueAccountId } = baseRow;
    const out = parseApiKeyRows([rowWithoutVenueAccountId]);
    expect(out).toHaveLength(0);
  });

  // audit-2026-05-07 RT silent-failure HIGH regression: account_balance_usdt
  // must NOT silently coerce empty string / false / null to 0. These tests
  // pin the new explicit pre-validator behaviour.
  it("rejects empty-string account_balance_usdt (no silent coerce-to-zero)", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_balance_usdt: "" }]);
    expect(out).toHaveLength(0);
  });

  it("rejects boolean account_balance_usdt (no silent coerce-to-zero)", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_balance_usdt: false }]);
    expect(out).toHaveLength(0);
  });

  it("accepts null account_balance_usdt (legitimate absence)", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_balance_usdt: null }]);
    expect(out).toHaveLength(1);
    expect(out[0].account_balance_usdt).toBeNull();
  });

  it("accepts real zero account_balance_usdt (distinct from coercion)", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_balance_usdt: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].account_balance_usdt).toBe(0);
  });

  // Phase 164.6.6.2.1 plan 15 (D-07, D-17; T-164.6.6.2.1-37). The three native
  // fields are rendered as text on the key card, so a malformed unit or date
  // must be dropped at this boundary rather than printed.
  it("preserves a priced native row (unit, balance, stored close day)", () => {
    const out = parseApiKeyRows([
      {
        ...baseRow,
        account_currency: "BTC",
        account_balance_native: 0.4213,
        account_balance_usdt_close_date: "2026-10-08",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].account_currency).toBe("BTC");
    expect(out[0].account_balance_native).toBe(0.4213);
    expect(out[0].account_balance_usdt_close_date).toBe("2026-10-08");
  });

  it("coerces NUMERIC-as-string account_balance_native", () => {
    const out = parseApiKeyRows([{ ...baseRow, account_currency: "BTC", account_balance_native: "0.4213" }]);
    expect(out).toHaveLength(1);
    expect(out[0].account_balance_native).toBe(0.4213);
  });

  it("rejects empty-string account_balance_native (no silent coerce-to-zero)", () => {
    expect(parseApiKeyRows([{ ...baseRow, account_balance_native: "" }])).toHaveLength(0);
  });

  it.each([
    ["a lower-case unit code", { account_currency: "btc" }],
    ["a one-letter unit code", { account_currency: "B" }],
    ["an eleven-letter unit code", { account_currency: "ABCDEFGHIJK" }],
    ["a unit with markup", { account_currency: "BT<C" }],
    ["a prose close date", { account_balance_usdt_close_date: "Oct 8" }],
    ["a timestamp as the close date", { account_balance_usdt_close_date: "2026-10-08T00:00:00Z" }],
  ])("rejects %s at the boundary", (_name, bad) => {
    expect(parseApiKeyRows([{ ...baseRow, ...bad }])).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  // `account_balance_native` is deliberately NOT in this list: it shares
  // `_strictNumberOrStringNumericNullable` with `account_balance_usdt`, which
  // reads an absent key as null, so a row without it is a row with no native
  // balance, not drift. The two text fields have no such preprocess.
  it.each(["account_currency", "account_balance_usdt_close_date"] as const)(
    "rejects rows missing %s (strict schema)",
    (field) => {
      const row: Record<string, unknown> = { ...baseRow };
      delete row[field];
      expect(parseApiKeyRows([row])).toHaveLength(0);
    },
  );
});
