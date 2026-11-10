import { describe, it, expect } from "vitest";
import {
  HEALTH_TONE,
  healthWord,
  rowChipStatus,
  strategyHealthOf,
  type StrategyHealthInput,
} from "./strategy-health";

// 199-02 (D-03, CD-04, R-05) — the Health word is ONE pure function over signals
// the page already reads. `now` is injected so every case is deterministic.
const NOW = Date.parse("2026-11-09T12:00:00Z");

/** A published, computed, trusted crypto row. Each case overrides what it tests. */
function input(over: Partial<StrategyHealthInput> = {}): StrategyHealthInput {
  return {
    status: "published",
    createdAt: "2026-06-01T00:00:00Z",
    chipStatus: "complete",
    analyticsUpdating: false,
    seriesEnd: "2026-11-02",
    assetClass: "crypto",
    feedingKeySyncStatuses: ["ok"],
    keyStatusUnreadable: false,
    nowMs: NOW,
    ...over,
  };
}

describe("strategyHealthOf — tracer", () => {
  it("reads a stale row through the Phase 197 list verdict, dated by the series end", () => {
    const health = strategyHealthOf(input({ seriesEnd: "2026-10-03" }));
    expect(health).toEqual({ kind: "stale", staleSince: "2026-10-03" });
    expect(healthWord(health)).toBe("Stale (no data since Oct 3, 2026)");
    expect(HEALTH_TONE[health.kind]).toBe("text-warning");
  });

  it("reads a fresh row as Healthy", () => {
    const health = strategyHealthOf(input({ seriesEnd: "2026-11-02" }));
    expect(health).toEqual({ kind: "healthy", staleSince: null });
    expect(healthWord(health)).toBe("Healthy");
  });
});

describe("rowChipStatus", () => {
  it("an absent analytics row coerces to null, never the shaper's hardcoded pending", () => {
    expect(
      rowChipStatus({ analyticsPresent: false, analytics: { computation_status: "pending" } }),
    ).toBeNull();
  });
  it("an omitted analyticsPresent trusts the raw status", () => {
    expect(rowChipStatus({ analytics: { computation_status: "failed" } })).toBe("failed");
  });
});

describe("strategyHealthOf — first-match order (D-03)", () => {
  const kind = (over: Partial<StrategyHealthInput>) => strategyHealthOf(input(over)).kind;

  it("archived beats everything, including a revoked key and a failed run", () => {
    expect(
      kind({ status: "archived", feedingKeySyncStatuses: ["revoked"], chipStatus: "failed" }),
    ).toBe("not_judged");
    expect(healthWord(strategyHealthOf(input({ status: "archived" })))).toBe("—");
  });

  it("a revoked or sign_in_failed feeding key beats a failed run", () => {
    expect(kind({ feedingKeySyncStatuses: ["revoked"], chipStatus: "failed" })).toBe("key_problem");
    expect(kind({ feedingKeySyncStatuses: ["ok", "sign_in_failed"], chipStatus: "failed" })).toBe(
      "key_problem",
    );
  });

  it("a trusted key set does not trigger Key problem", () => {
    expect(kind({ feedingKeySyncStatuses: [] })).toBe("healthy");
    expect(kind({ feedingKeySyncStatuses: [null, "ok"] })).toBe("healthy");
  });

  it("failed beats updating, and a failed row with a stored earlier result still reads Analytics failed", () => {
    expect(kind({ chipStatus: "failed", analyticsUpdating: true })).toBe("analytics_failed");
    expect(kind({ chipStatus: "failed", seriesEnd: "2026-11-08" })).toBe("analytics_failed");
    expect(healthWord(strategyHealthOf(input({ chipStatus: "failed" })))).toBe("Analytics failed");
  });
});

describe("strategyHealthOf — Updating and Stale (no data yet)", () => {
  const kind = (over: Partial<StrategyHealthInput>) => strategyHealthOf(input(over)).kind;
  const hoursAfterCreate = (h: number) => ({
    createdAt: new Date(NOW - h * 60 * 60 * 1000).toISOString(),
  });

  it("a queued or computing run reads Updating", () => {
    expect(kind({ chipStatus: "pending", seriesEnd: null })).toBe("updating");
    expect(kind({ chipStatus: "computing", seriesEnd: null })).toBe("updating");
  });

  it("a missing analytics row within 16 hours of creation reads Updating", () => {
    expect(kind({ chipStatus: null, seriesEnd: null, ...hoursAfterCreate(15) })).toBe("updating");
  });

  it("analyticsUpdating on a computed row reads Updating, even over a stale series", () => {
    expect(kind({ analyticsUpdating: true })).toBe("updating");
    expect(kind({ analyticsUpdating: true, seriesEnd: "2026-10-03" })).toBe("updating");
  });

  it("a missing analytics row more than 16 hours after creation, nothing running, reads Stale (no data yet)", () => {
    const h = strategyHealthOf(
      input({ chipStatus: null, seriesEnd: null, ...hoursAfterCreate(17) }),
    );
    expect(h).toEqual({ kind: "stale_no_data", staleSince: null });
    expect(healthWord(h)).toBe("Stale (no data yet)");
    expect(HEALTH_TONE.stale_no_data).toBe("text-warning");
  });

  it("a missing row with an unreadable creation time degrades to honest absence, not a spinner", () => {
    expect(kind({ chipStatus: null, seriesEnd: null, createdAt: null })).toBe("stale_no_data");
  });
});

describe("strategyHealthOf — per-asset-class series boundaries (R-05, now 2026-11-09T12:00Z)", () => {
  const kind = (over: Partial<StrategyHealthInput>) => strategyHealthOf(input(over)).kind;

  it("crypto: age 7 reads Healthy, age 8 reads Stale", () => {
    expect(kind({ assetClass: "crypto", seriesEnd: "2026-11-02" })).toBe("healthy");
    expect(kind({ assetClass: "crypto", seriesEnd: "2026-11-01" })).toBe("stale");
  });

  it("the same day (age 8) is Stale for crypto and Healthy for traditional", () => {
    expect(kind({ assetClass: "crypto", seriesEnd: "2026-11-01" })).toBe("stale");
    expect(kind({ assetClass: "traditional", seriesEnd: "2026-11-01" })).toBe("healthy");
  });

  it.each(["traditional", null] as const)(
    "assetClass %s: age 8 and 10 read Healthy, age 11 reads Stale",
    (assetClass) => {
      expect(kind({ assetClass, seriesEnd: "2026-11-01" })).toBe("healthy");
      expect(kind({ assetClass, seriesEnd: "2026-10-30" })).toBe("healthy");
      expect(kind({ assetClass, seriesEnd: "2026-10-29" })).toBe("stale");
    },
  );

  it("the Stale word names the series end day for every class", () => {
    expect(healthWord(strategyHealthOf(input({ assetClass: "traditional", seriesEnd: "2026-10-29" })))).toBe(
      "Stale (no data since Oct 29, 2026)",
    );
  });

  it("a series end up to 2 days ahead is current and reads Healthy", () => {
    expect(kind({ seriesEnd: "2026-11-11" })).toBe("healthy");
  });
});

describe("strategyHealthOf — the em dash cases", () => {
  const kind = (over: Partial<StrategyHealthInput>) => strategyHealthOf(input(over)).kind;

  it.each([
    ["3 days ahead", "2026-11-12"],
    ["a calendar-impossible day", "2026-02-31"],
    ["an unparseable string", "garbage"],
    ["null", null],
  ])("a computed row whose series end is %s reads the em dash", (_label, seriesEnd) => {
    const h = strategyHealthOf(input({ seriesEnd }));
    expect(h).toEqual({ kind: "not_judged", staleSince: null });
    expect(healthWord(h)).toBe("—");
    expect(HEALTH_TONE.not_judged).toBe("text-text-muted");
  });

  it("keyStatusUnreadable turns Healthy into the em dash", () => {
    expect(kind({ keyStatusUnreadable: true })).toBe("not_judged");
  });

  it("keyStatusUnreadable leaves Stale, Updating, Analytics failed and Stale (no data yet) unchanged", () => {
    expect(kind({ keyStatusUnreadable: true, seriesEnd: "2026-10-03" })).toBe("stale");
    expect(kind({ keyStatusUnreadable: true, analyticsUpdating: true })).toBe("updating");
    expect(kind({ keyStatusUnreadable: true, chipStatus: "failed" })).toBe("analytics_failed");
    expect(kind({ keyStatusUnreadable: true, chipStatus: null, seriesEnd: null, createdAt: "2026-01-01T00:00:00Z" })).toBe(
      "stale_no_data",
    );
  });
});

describe("words and tones (UI-SPEC)", () => {
  it("every kind has a word and a tone, with no red and no green", () => {
    const kinds = Object.keys(HEALTH_TONE) as (keyof typeof HEALTH_TONE)[];
    expect(kinds).toHaveLength(7);
    for (const k of kinds) {
      expect(healthWord({ kind: k, staleSince: k === "stale" ? "2026-10-03" : null })).not.toBe("");
      expect(HEALTH_TONE[k]).toMatch(/^text-(text-secondary|text-muted|warning)$/);
    }
    expect(HEALTH_TONE.healthy).toBe("text-text-secondary");
    expect(HEALTH_TONE.updating).toBe("text-text-secondary");
    expect(HEALTH_TONE.key_problem).toBe("text-warning");
    expect(HEALTH_TONE.analytics_failed).toBe("text-warning");
  });

  it("pins the literal words", () => {
    const word = (kind: Parameters<typeof healthWord>[0]["kind"]) => healthWord({ kind, staleSince: null });
    expect(word("healthy")).toBe("Healthy");
    expect(word("key_problem")).toBe("Key problem");
    expect(word("analytics_failed")).toBe("Analytics failed");
    expect(word("updating")).toBe("Updating");
    expect(word("stale_no_data")).toBe("Stale (no data yet)");
    expect(word("not_judged")).toBe("—");
  });
});
