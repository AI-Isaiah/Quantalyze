import { describe, it, expect } from "vitest";
import { buildEnvelope } from "./envelope";

describe("buildEnvelope (Phase 16 / OBSERV-06)", () => {
  it("maps title -> human_message, fix -> debug_context, cause -> cause", () => {
    const env = buildEnvelope("KEY_HAS_TRADING_PERMS", "abc-123");
    expect(env.ok).toBe(false);
    expect(env.code).toBe("KEY_HAS_TRADING_PERMS");
    expect(typeof env.human_message).toBe("string");
    expect(env.human_message.length).toBeGreaterThan(0);
    expect(Array.isArray(env.debug_context)).toBe(true);
    expect(env.debug_context.length).toBeGreaterThan(0);
    expect(env.correlation_id).toBe("abc-123");
    // Phase 21 — cause must be carried through. Was being dropped silently
    // before, leaving the user with title + fix only and no WHY.
    expect(typeof env.cause).toBe("string");
    expect(env.cause!.length).toBeGreaterThan(0);
  });

  it("forwards span-day context into the cause for GATE_INSUFFICIENT_DAYS", () => {
    // Regression: Bybit MWF-Read live key (3,842 fills, <7 calendar days)
    // hit this gate in /qa 2026-05-05. The user must see the actual span
    // they had, not just the threshold they failed.
    const env = buildEnvelope("GATE_INSUFFICIENT_DAYS", "corr-1", { days: 4.2 });
    expect(env.cause).toContain("4.2 calendar day");
    expect(env.cause).toContain("Your trades span");
    expect(env.human_message).toContain("history");
    expect(env.human_message).not.toContain("activity");
  });

  it("recoverable=true for codes whose actions include try_another_key", () => {
    const env = buildEnvelope("GATE_INSUFFICIENT_DAYS", "corr-2");
    expect(env.recoverable).toBe(true);
  });

  // RED-TEAM R1 regression guard (H-0192 follow-up): GUARD_BLOCKED is the 403
  // refresh-nudge, so it MUST be recoverable — its envelope renders the Retry
  // control the old UNKNOWN mapping provided. GATE_DRAFT_GONE (draft truly
  // gone) is correctly NOT recoverable — retrying can't bring it back; the user
  // starts fresh. A revert that dropped clear_and_retry from GUARD_BLOCKED (and
  // silently removed the Retry button) fails here.
  it("GUARD_BLOCKED is recoverable; GATE_DRAFT_GONE is not", () => {
    expect(buildEnvelope("GUARD_BLOCKED", "corr-3").recoverable).toBe(true);
    expect(buildEnvelope("GATE_DRAFT_GONE", "corr-4").recoverable).toBe(false);
  });
});
