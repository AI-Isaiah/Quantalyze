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
});
