/**
 * Phase 122 / SFOX-08 — NEXT_PUBLIC_SFOX_ENABLED flag gate on the sFOX offer.
 *
 * The public sFOX offer (UI_EXCHANGE_CODES → every chip surface via EXCHANGES,
 * OQ4) is gated behind the `NEXT_PUBLIC_SFOX_ENABLED` env flag, DEFAULT OFF, so
 * the card/badge/e2e ship READY and the founder flips it live only after the
 * backend is unblocked end-to-end (121-03 egress deploy + SFOX-06 validation +
 * phase-123 for active accounts).
 *
 * The load-bearing pins:
 *  - Flag UNSET (default) → UI_EXCHANGE_CODES deep-equals the current 4-tuple and
 *    EXCHANGES deep-equals the current 4 labels — BYTE-IDENTICAL to today.
 *  - Flag === the EXACT string "true" → sfox is appended (5-tuple; EXCHANGES gains
 *    "sFOX").
 *  - Any other value ("1", "TRUE", "on", "") → OFF (strict-equality fail-closed).
 *
 * Because SFOX_UI_ENABLED is a MODULE-SCOPE const read from process.env at import
 * time, each case stubs the env, resets the module registry, and DYNAMIC-imports
 * closed-sets fresh. vi.unstubAllEnvs in afterEach prevents an env-stub leak from
 * bleeding into a sibling test (the Node22 stub-leak lesson).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

async function loadClosedSets() {
  vi.resetModules();
  return import("./closed-sets");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[SFOX-08] NEXT_PUBLIC_SFOX_ENABLED gates the sFOX offer", () => {
  it("flag UNSET (default) → byte-identical to today's 4-tuple offer", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", undefined as unknown as string);
    const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();

    expect(SFOX_UI_ENABLED).toBe(false);
    expect(UI_EXCHANGE_CODES).toEqual(["binance", "okx", "bybit", "deribit"]);
    expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit", "Deribit"]);
    // sfox is NOT offered on any UI-derived surface.
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("sfox")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("sFOX")).toBe(false);
  });

  it('flag === exact "true" → sfox appended; UI_EXCHANGE_CODES + EXCHANGES widen', async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();

    expect(SFOX_UI_ENABLED).toBe(true);
    expect(UI_EXCHANGE_CODES).toEqual([
      "binance",
      "okx",
      "bybit",
      "deribit",
      "sfox",
    ]);
    expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit", "Deribit", "sFOX"]);
  });

  it.each(["1", "TRUE", "True", "on", "yes", ""])(
    'value %j is NOT "true" → OFF (strict-equality fail-closed)',
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", value);
      const { SFOX_UI_ENABLED, UI_EXCHANGE_CODES } = await loadClosedSets();
      expect(SFOX_UI_ENABLED).toBe(false);
      expect((UI_EXCHANGE_CODES as readonly string[]).includes("sfox")).toBe(
        false,
      );
    },
  );

  it("EXCHANGES stays derived from UI_EXCHANGE_CODES through EXCHANGE_DISPLAY (casing cannot drift)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { UI_EXCHANGE_CODES, EXCHANGES, EXCHANGE_DISPLAY } =
      await loadClosedSets();
    expect(EXCHANGES).toEqual(
      UI_EXCHANGE_CODES.map((code) => EXCHANGE_DISPLAY[code]),
    );
  });

  it("FUNDING_EXCHANGES stays 3-value regardless of the sfox flag (Pitfall 2 — untouched)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SFOX_ENABLED", "true");
    const { FUNDING_EXCHANGES } = await loadClosedSets();
    expect(FUNDING_EXCHANGES).toEqual(["binance", "okx", "bybit"]);
  });
});
