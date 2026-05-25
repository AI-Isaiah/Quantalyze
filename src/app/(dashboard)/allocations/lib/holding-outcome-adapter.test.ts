import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHoldingRef,
  toBridgeOutcomeBannerProps,
  toAllocatedFormProps,
  toRejectedFormProps,
  deriveEligibleForOutcome,
  toVoluntaryRemoveDecision,
  toVoluntaryAddDecision,
  type FlaggedHolding,
  type VoluntaryRemoveDecisionShape,
  type VoluntaryAddDecisionShape,
} from "./holding-outcome-adapter";
import { FLAG_COMPOSITE_THRESHOLD } from "./flag-threshold";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
import { Constants } from "@/lib/database.types";

const SAMPLE: FlaggedHolding = {
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  value_usd: 50000,
  top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
  top_candidate_name: "Momentum-BTC-L",
  top_candidate_composite: 72,
  breach_reasons: ["max_weight"],
};

describe("buildHoldingRef", () => {
  it("returns exact format 'holding:{venue}:{symbol}:{holding_type}'", () => {
    expect(buildHoldingRef(SAMPLE)).toBe("holding:binance:BTC:spot");
  });
  it("output matches Phase 08 buildHoldingScopeRef byte-for-byte", () => {
    // buildHoldingScopeRef returns "{venue}:{symbol}:{holding_type}" (no 'holding:' prefix)
    // buildHoldingRef returns "holding:{venue}:{symbol}:{holding_type}"
    const scopeRef = buildHoldingScopeRef({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    expect(buildHoldingRef(SAMPLE)).toBe(`holding:${scopeRef}`);
  });
});

describe("toBridgeOutcomeBannerProps", () => {
  it("passes top_candidate_strategy_id as strategyId (NOT the pseudo holding-id)", () => {
    const onAllocatedClick = vi.fn();
    const onRejectedClick = vi.fn();
    const onDismiss = vi.fn();
    const props = toBridgeOutcomeBannerProps(SAMPLE, { onAllocatedClick, onRejectedClick, onDismiss });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.strategyId).not.toMatch(/^holding:/);
    expect(props.onAllocatedClick).toBe(onAllocatedClick);
  });
});

describe("toAllocatedFormProps", () => {
  it("passes top_candidate_strategy_id + maxWeight (nullable)", () => {
    const props = toAllocatedFormProps(SAMPLE, { onRecorded: vi.fn(), onCancel: vi.fn(), maxWeight: 0.25 });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.maxWeight).toBe(0.25);
  });
  it("maxWeight defaults to null when omitted", () => {
    const props = toAllocatedFormProps(SAMPLE, { onRecorded: vi.fn(), onCancel: vi.fn() });
    expect(props.maxWeight).toBeNull();
  });
});

describe("toRejectedFormProps", () => {
  it("passes top_candidate_strategy_id as strategyId", () => {
    const onRecorded = vi.fn();
    const onCancel = vi.fn();
    const props = toRejectedFormProps(SAMPLE, { onRecorded, onCancel });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.onRecorded).toBe(onRecorded);
    expect(props.onCancel).toBe(onCancel);
  });
});

describe("deriveEligibleForOutcome", () => {
  const ref = "holding:binance:BTC:spot";
  it("eligible=false when no match_decision exists", () => {
    const result = deriveEligibleForOutcome(SAMPLE, {}, {});
    expect(result).toEqual({ eligible: false, existingOutcome: null });
  });
  it("eligible=false with existingOutcome when outcome already recorded", () => {
    const existing = { id: "outcome-uuid", kind: "allocated" } as unknown as BridgeOutcome;
    const result = deriveEligibleForOutcome(
      SAMPLE,
      { [ref]: { id: "decision-uuid" } },
      { [ref]: existing }
    );
    expect(result.eligible).toBe(false);
    expect(result.existingOutcome).toBe(existing);
  });
  it("eligible=true when decision exists AND no outcome recorded", () => {
    const result = deriveEligibleForOutcome(SAMPLE, { [ref]: { id: "decision-uuid" } }, {});
    expect(result).toEqual({ eligible: true, existingOutcome: null });
  });
});

describe("FLAG_COMPOSITE_THRESHOLD parity (finding f5)", () => {
  it("SSR constant equals 50 (D-06 + RESEARCH A3)", () => {
    expect(FLAG_COMPOSITE_THRESHOLD).toBe(50);
  });
  it("Python-side analytics-service constant equals 50 (numeric parity — engine-side half of finding f5)", () => {
    const pySrc = readFileSync(join(process.cwd(), "analytics-service/routers/match.py"), "utf8");
    // Source regex: `FLAG_COMPOSITE_THRESHOLD = 50` (possibly with type annotation)
    const match = pySrc.match(/^FLAG_COMPOSITE_THRESHOLD\s*(?::\s*int\s*)?=\s*(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(FLAG_COMPOSITE_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// Phase 10 Plan 01 / Task 3 — voluntary kind synthetic shapes (D-10 + D-11)
// ---------------------------------------------------------------------------

describe("toVoluntaryRemoveDecision (D-10)", () => {
  it("T_VR1 returns the synthetic voluntary_remove shape with original_holding_ref + null strategy ids", () => {
    const result: VoluntaryRemoveDecisionShape = toVoluntaryRemoveDecision({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
    });
    expect(result).toEqual({
      kind: "voluntary_remove",
      original_holding_ref: "holding:binance:BTC:spot",
      suggested_strategy_id: null,
      original_strategy_id: null,
    });
  });

  it("T_VR2 uses buildHoldingRef internally — different venue/symbol/type composes correctly", () => {
    const result = toVoluntaryRemoveDecision({
      venue: "okx",
      symbol: "ETH",
      holding_type: "derivative",
    });
    expect(result.original_holding_ref).toBe("holding:okx:ETH:derivative");
    expect(result.original_holding_ref).toBe(
      buildHoldingRef({ venue: "okx", symbol: "ETH", holding_type: "derivative" }),
    );
  });
});

describe("toVoluntaryAddDecision (D-11)", () => {
  it("T_VA1 returns the synthetic voluntary_add shape with suggested_strategy_id + null original_*", () => {
    const result: VoluntaryAddDecisionShape = toVoluntaryAddDecision(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toEqual({
      kind: "voluntary_add",
      original_holding_ref: null,
      original_strategy_id: null,
      suggested_strategy_id: "00000000-0000-0000-0000-000000000001",
    });
  });
});

// M-0145 (pr-test-analyzer) — T_VR1/T_VR2/T_VA1 above assert object-literal
// equality against the same constants the constructors emit (schema-sync
// tautology). They prove the constructor builds what it builds, but NOT that
// the `kind` discriminator stays in lockstep with the server-side enum
// (migration 20260426131718_match_decisions_kind_enum). The DB enum is the
// shared cross-file contract: if a server rename drops "voluntary_remove" or
// renames it (e.g. to "manual_remove"), the synthetic shape's literal would
// silently diverge from what the match_decisions row insert accepts. Pin the
// `kind` literals against the generated DB enum (Constants.public.Enums) so a
// rename on either side fails here instead of at runtime against the RPC.
describe("M-0145 — synthetic decision `kind` parity with match_decision_kind DB enum", () => {
  const DB_KINDS: readonly string[] =
    Constants.public.Enums.match_decision_kind;

  it("voluntary_remove synthetic kind is a member of the match_decision_kind enum", () => {
    const result = toVoluntaryRemoveDecision({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
    });
    expect(DB_KINDS).toContain(result.kind);
  });

  it("voluntary_add synthetic kind is a member of the match_decision_kind enum", () => {
    const result = toVoluntaryAddDecision(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(DB_KINDS).toContain(result.kind);
  });

  it("the DB enum still carries both voluntary kinds (guards a server-side rename)", () => {
    // Belt + braces: if migration 080 ever drops or renames either voluntary
    // kind, this fails and forces the adapter literals to be revisited.
    expect(DB_KINDS).toContain("voluntary_remove");
    expect(DB_KINDS).toContain("voluntary_add");
  });
});

describe("backward-compatibility regression (T_BC1) — existing exports unchanged", () => {
  it("buildHoldingRef + the four pre-Phase-10 adapter functions still behave identically", () => {
    // buildHoldingRef
    expect(buildHoldingRef(SAMPLE)).toBe("holding:binance:BTC:spot");
    // toBridgeOutcomeBannerProps
    const banner = toBridgeOutcomeBannerProps(SAMPLE, {
      onAllocatedClick: vi.fn(),
      onRejectedClick: vi.fn(),
      onDismiss: vi.fn(),
    });
    expect(banner.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    // toAllocatedFormProps
    const allocProps = toAllocatedFormProps(SAMPLE, {
      onRecorded: vi.fn(),
      onCancel: vi.fn(),
      maxWeight: 0.25,
    });
    expect(allocProps.maxWeight).toBe(0.25);
    // toRejectedFormProps
    const rejProps = toRejectedFormProps(SAMPLE, {
      onRecorded: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(rejProps.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    // deriveEligibleForOutcome
    const elig = deriveEligibleForOutcome(SAMPLE, {}, {});
    expect(elig).toEqual({ eligible: false, existingOutcome: null });
  });
});
