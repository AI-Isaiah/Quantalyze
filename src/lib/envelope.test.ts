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

  // -------------------------------------------------------------------------
  // 140.3-09 / SEAMUX-06 — a wait must be REPRESENTABLE before any copy can
  // name one. Before this plan neither WizardErrorContext nor ErrorEnvelope
  // carried a wait field at all, so "name the real wait" was unrepresentable
  // rather than merely unimplemented (correction C-7).
  //
  // Every expected sentence below is a LITERAL typed in this file. Nothing
  // reads WIZARD_ERROR_COPY[code] on the expected side of an expect() — that
  // self-referential oracle is the defect class this programme keeps hitting.
  // -------------------------------------------------------------------------
  describe("[140.3-09 / SEAMUX-06] the advertised wait, in seconds", () => {
    it("carries a supplied wait through to the envelope, in SECONDS, unclamped", () => {
      const env = buildEnvelope("KEY_RATE_LIMIT", "corr-wait-1", {
        retryAfterSeconds: 90,
      });
      expect(env.retry_after_seconds).toBe(90);

      // Unclamped and unconverted: a 42-minute server wait must survive as
      // 2520 seconds, not be squashed to a "reasonable" ceiling and not be
      // silently turned into minutes. Units are decided ONCE, at the context
      // field, and nothing between the wire and here converts.
      const long = buildEnvelope("KEY_RATE_LIMIT", "corr-wait-2", {
        retryAfterSeconds: 2520,
      });
      expect(long.retry_after_seconds).toBe(2520);
    });

    it("ADDITIVE SAFETY: an envelope built without a wait is byte-identical to its pre-plan shape", () => {
      // THE hand-typed expected output. This is the additive-optional property
      // the `cause?` field established and this plan copies: every caller that
      // predates the wait field must produce exactly what it produced before.
      // Hand-typed rather than derived, so a copy edit that silently changes
      // what pre-existing callers emit reddens here instead of passing.
      const env = buildEnvelope("KEY_RATE_LIMIT", "corr-nowait");
      expect(env).toEqual({
        ok: false,
        code: "KEY_RATE_LIMIT",
        human_message: "The exchange rate-limited this request.",
        cause:
          "The exchange asked us to slow down. This is a transient, exchange-side throttle and not a problem with your key.",
        debug_context: [
          "Wait 60 seconds and try again.",
          "If it persists, try a different exchange account or contact support.",
        ],
        correlation_id: "corr-nowait",
        recoverable: true,
      });

      // Stated separately because `toEqual` ignores undefined-valued keys and
      // the absence is the whole point: no wait was advertised, so the envelope
      // names none. Absence must never read as zero (TRAP-3).
      expect(env.retry_after_seconds).toBeUndefined();
    });

    it("does not invent a wait for a code whose copy merely mentions one", () => {
      // KEY_RATE_LIMIT's static fix line says "Wait 60 seconds and try again."
      // That sentence is copy, not a measurement — the envelope must still
      // report NO advertised wait, because no upstream stated one. A surface
      // that promoted the copy's 60 to the wait slot would be asserting a
      // duration nobody sent.
      const env = buildEnvelope("KEY_RATE_LIMIT", "corr-nolie");
      expect(env.debug_context[0]).toBe("Wait 60 seconds and try again.");
      expect(env.retry_after_seconds).toBeUndefined();
    });

    it("carries a wait onto a NON-recoverable code too — the render gate lives in the renderer, not here", () => {
      // buildEnvelope is a pure mapping; suppressing the value here would make
      // the data lie about what arrived. Whether it is SHOWN is the renderer's
      // decision, asserted in ErrorEnvelope.test.tsx.
      const env = buildEnvelope("GATE_DRAFT_GONE", "corr-wait-3", {
        retryAfterSeconds: 30,
      });
      expect(env.recoverable).toBe(false);
      expect(env.retry_after_seconds).toBe(30);
    });
  });
});
