/**
 * Phase 138 / MT5UI-01 — NEXT_PUBLIC_MT5_ENABLED gates the MT5 wizard offer.
 *
 * MT5_UI_ENABLED is the client-build flag that shows/hides the MT5 add-key card
 * in ConnectKeyStep (mirror of SFOX_UI_ENABLED). This test pins the two
 * load-bearing invariants:
 *  - Flag UNSET (default) / any non-exact value → OFF (strict-equality
 *    fail-closed): "1" / "TRUE" / "True" / "on" / "yes" / "" all read OFF.
 *  - Flag === the EXACT string "true" → ON.
 *  - CRITICAL no-widening pin: even with the flag ON, `mt5` NEVER enters
 *    UI_EXCHANGE_CODES and `MT5` NEVER enters EXCHANGES. MT5 rides the local
 *    ConnectKeyStep card behind MT5_UI_ENABLED — it must NOT auto-widen the
 *    manager-surface `<Select>` (ApiKeyForm/StrategyForm derive from
 *    UI_EXCHANGE_CODES). Widening would ship an unlabeled MT5 option there
 *    (UI-SPEC §MT5-Manager-Parity, RESEARCH Pitfall 2).
 *
 * MT5_UI_ENABLED is a MODULE-SCOPE const read from process.env at import time,
 * so each case stubs the env, resets the module registry, and DYNAMIC-imports
 * closed-sets fresh. vi.unstubAllEnvs in afterEach prevents an env-stub leak
 * from bleeding into a sibling test (the Node22-vs-Node25 stub-leak lesson).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

async function loadClosedSets() {
  vi.resetModules();
  return import("./closed-sets");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[MT5UI-01] NEXT_PUBLIC_MT5_ENABLED gates the MT5 wizard offer", () => {
  it("flag UNSET (default) → MT5_UI_ENABLED is false", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const { MT5_UI_ENABLED } = await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(false);
  });

  it('flag === exact "true" → MT5_UI_ENABLED is true', async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED } = await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
  });

  it.each(["1", "TRUE", "True", "on", "yes", ""])(
    'value %j is NOT "true" → OFF (strict-equality fail-closed)',
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", value);
      const { MT5_UI_ENABLED } = await loadClosedSets();
      expect(MT5_UI_ENABLED).toBe(false);
    },
  );

  it("does NOT widen UI_EXCHANGE_CODES / EXCHANGES with mt5, even when the flag is ON", async () => {
    // MT5 is wizard-card-only this phase — the manager <Select> derives from
    // UI_EXCHANGE_CODES and must not silently gain an unlabeled MT5 option.
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
    const { MT5_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } =
      await loadClosedSets();
    expect(MT5_UI_ENABLED).toBe(true);
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
  });

  it("keeps UI_EXCHANGE_CODES mt5-free when the flag is OFF too", async () => {
    vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", undefined as unknown as string);
    const { UI_EXCHANGE_CODES, EXCHANGES } = await loadClosedSets();
    expect((UI_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(false);
    expect((EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
  });
});
