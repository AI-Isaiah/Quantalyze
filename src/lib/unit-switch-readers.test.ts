/**
 * Phase 256 plan 08 (D-05, SC-3; CONTEXT "Readers" bullet 3) - the TypeScript readers that decide
 * "is this strategy's series in a native unit I must convert?" keep reading a SWITCHED strategy as
 * plain USD.
 *
 * THE RULE, stated once: the stored headline series of a strategy that moved from USD into a coin is
 * already one all-USD series (the coin part was converted at the stored daily close by the derive), and
 * `native_unit` is absent. So a reader must take its unit ONLY from `native_unit` / `returns_unit`,
 * never from `unit_switch`: a unit read from the switch would convert an already-USD series a second time.
 *
 * HOW each reader is reached (RED on origin/main by an assertion, never an import error): the stored
 * flags go through the REAL list projection (`shapeRowAnalytics`), and every behavioural arm first asserts
 * `unit_switch_coin === "BTC"`, a field origin/main does not project, so it fails by assertion there.
 * Readers that take their unit from an input OTHER than the strategy's flags (a key's account currency,
 * a holding's quantity unit) or that live behind a server-only page are pinned statically: their source
 * must name no `unit_switch`. A static pin is NOT RED on origin/main (the reader is unchanged and already
 * correct there); it goes RED on a neutered copy that adds `unit_switch` as a unit source, which the
 * SUMMARY records. The scenario-share PAGE and the /returns ROUTE are pinned behaviourally in their own
 * files (`page.test.tsx`, `route.unit-switch.test.ts`).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render } from "@testing-library/react";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { shapeRowAnalytics } from "./queries";
import type { StrategyAnalytics } from "./types";
import { parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import { convertNativeReturnsToUsd } from "@/lib/factsheet/native-to-usd";
import { resolveSharedScenario } from "@/app/scenario-share/[token]/share-resolve";
import { SCENARIO_SCHEMA_VERSION, type ScenarioDraft } from "@/app/(dashboard)/allocations/lib/scenario-state";
import { ReturnsUnitChip } from "@/components/strategy/ReturnsUnitChip";
import type { DailyPoint } from "@/lib/scenario";

const SID = "5a000000-0000-4000-8000-000000000256";
const SWITCH = { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" };

/** The row a switched strategy stores: whole-history USD figures, the switch flag, NO native_unit. */
function stored(flags: Record<string, unknown>): StrategyAnalytics {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000256",
    strategy_id: SID,
    computed_at: "2026-11-20T10:00:00.000Z",
    computation_status: "complete",
    cumulative_return: 0.12,
    cagr: 0.05,
    sharpe: 0.6,
    max_drawdown: -0.1,
    series_end: "2026-11-19",
    data_quality_flags: flags,
  } as unknown as StrategyAnalytics;
}

const switched = shapeRowAnalytics(stored({ unit_switch: SWITCH, cumulative_method: "geometric" }), SID);
const unswitched = shapeRowAnalytics(stored({ cumulative_method: "geometric" }), SID);

function omitSwitchScalars(a: StrategyAnalytics): Record<string, unknown> {
  // An owner wildcard row carries the flags blob itself (existing behaviour, unchanged by this phase):
  // the blob is where the stored switch lives, so it is the one field set aside, beside the three scalars.
  const { unit_switch_coin, unit_switch_last_usd_day, unit_switch_first_coin_day, data_quality_flags, ...rest } = a;
  void data_quality_flags;
  void unit_switch_coin;
  void unit_switch_last_usd_day;
  void unit_switch_first_coin_day;
  return rest;
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("src/lib/queries.ts list projection (StrategyTable, strategies pages) reads a switched row as USD: every figure is the stored USD figure, the unit is none", () => {
  it("the projection names the switch and still derives NO native unit", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    expect(switched.native_unit ?? null).toBeNull();
  });

  it("every other field equals the same row with no unit_switch (no figure is converted, nothing else moves)", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    expect(omitSwitchScalars(switched)).toEqual(omitSwitchScalars(unswitched));
  });
});

describe("src/components/strategy/ReturnsUnitChip.tsx reads a switched row as USD: handed the projected unit it draws nothing (a switched row never says 'in BTC')", () => {
  it("the projected native unit of a switched row is null, so the chip renders zero nodes", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    const { container } = render(
      createElement(ReturnsUnitChip, { unit: parseReturnsUnit(switched.native_unit), variant: "compact" }),
    );
    expect(container.childNodes.length).toBe(0);
  });
});

describe("src/app/scenario-share/[token]/share-resolve.ts (scenario share, the blend) reads a switched row as USD: the BTC part is already converted at the stored daily close", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const days = 40;
  const series = (offset: number): DailyPoint[] =>
    Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.parse("2026-02-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10),
      value: 0.001 + 0.002 * Math.sin((i + offset) / 3),
    }));
  const draft: ScenarioDraft = {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "BTC:okx:spot",
    toggleByScopeRef: { [A]: true, [B]: true },
    addedStrategies: [
      { id: A as never, name: "Switched", markets: ["BTC"], strategy_types: ["trend"] },
      { id: B as never, name: "Usd", markets: ["ETH"], strategy_types: ["mr"] },
    ],
    weightOverrides: { [A]: 0.5, [B]: 0.5 },
    memberKeyIds: [],
    lastEditedAt: "2026-11-20T00:00:00.000Z",
  };
  const row = {
    name: "Switch share",
    draft,
    schema_version: SCENARIO_SCHEMA_VERSION,
    series: [
      { strategy_id: A, daily_returns: series(0) },
      { strategy_id: B, daily_returns: series(7) },
    ],
  };
  const closes = {
    prices: series(0).map((p, i) => ({ date: p.date, close: i % 2 === 0 ? 60000 : 66000 })),
    dropped: [] as string[],
  };

  it("with the unit the projection yields (none), the blend equals the plain USD blend and no closes are applied", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    const unit = parseReturnsUnit(switched.native_unit);
    expect(unit).toBeNull();
    const shared = resolveSharedScenario(row, {}, {}, { [A]: unit, [B]: null }, closes);
    const plain = resolveSharedScenario(row);
    expect(shared.kind).toBe("ok");
    if (shared.kind !== "ok" || plain.kind !== "ok") throw new Error("expected ok");
    expect(shared.portfolioDaily).toEqual(plain.portfolioDaily);
    expect(shared.metrics.twr).toBe(plain.metrics.twr);
  });

  it("reading the switch coin AS a unit would change the blend, so the rule above is not vacuous", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    const wrong = resolveSharedScenario(row, {}, {}, { [A]: switched.unit_switch_coin ?? null, [B]: null }, closes);
    const plain = resolveSharedScenario(row);
    if (wrong.kind !== "ok" || plain.kind !== "ok") throw new Error("expected ok");
    expect(wrong.portfolioDaily).not.toEqual(plain.portfolioDaily);
  });

  it("convertNativeReturnsToUsd, handed the projected unit (none), returns the series untouched", () => {
    expect(switched.unit_switch_coin).toBe("BTC");
    const s = series(3);
    expect(convertNativeReturnsToUsd(s, parseReturnsUnit(switched.native_unit), closes)).toEqual(s);
  });
});

describe("static pins: readers whose unit comes from an input other than a strategy's flags name no unit_switch", () => {
  it.each([
    [
      "src/app/scenario-share/[token]/page.tsx (scenario share page) reads the leg unit from native_unit alone",
      "src/app/scenario-share/[token]/page.tsx",
      "native_unit",
    ],
    [
      "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (scenario composer) reads a leg's unit from the returns payload's returns_unit alone",
      "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
      "returns_unit",
    ],
    [
      "src/app/(dashboard)/allocations/components/HoldingsTable.tsx (allocator book view) reads a holding's unit from quantity_unit, not from any strategy flag",
      "src/app/(dashboard)/allocations/components/HoldingsTable.tsx",
      "quantity_unit",
    ],
    [
      "src/components/exchanges/AllocatorExchangeManager.tsx (allocator keys) reads a key's unit from account_currency, not from any strategy flag",
      "src/components/exchanges/AllocatorExchangeManager.tsx",
      "account_currency",
    ],
    [
      "src/lib/departed-history.ts (departed history) takes its not-in-USD reasons from the derive's stamp, never from unit_switch",
      "src/lib/departed-history.ts",
      "native_unit",
    ],
  ])("%s", (_title, path, unitSource) => {
    const text = source(path);
    expect(text, `${path} must keep reading its unit from ${unitSource}`).toContain(unitSource);
    expect(text, `${path} must not read unit_switch as a unit source`).not.toContain("unit_switch");
  });

  it("src/lib/queries.ts allocator book payload (getMyAllocationDashboard) reads a strategy's unit from native_unit alone", () => {
    const text = source("src/lib/queries.ts");
    // The book builds `returns_unit` from the effective flags' native_unit; the cast type that feeds it
    // never lists unit_switch, so a switched strategy's book leg is a USD leg.
    expect(text).toContain("const returns_unit = parseReturnsUnit(dqf?.native_unit);");
    const castStart = text.indexOf("const dqf = effectiveDataQualityFlags(analyticsObj).flags as");
    expect(castStart).toBeGreaterThan(0);
    expect(text.slice(castStart, castStart + 400)).not.toContain("unit_switch");
  });
});
