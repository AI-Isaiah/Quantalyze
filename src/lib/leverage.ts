/**
 * Shared leverage CONTRACT (Phase 90.5, D5). One spec consumed by both the
 * factsheet client recompute (LEV-01) and the scenario-draft rehydrate (LEV-02)
 * — the v1.5 "one spec, no divergent derivations" lesson.
 *
 * `sanitizeLeverage` is the READ-side sanitizer (rehydrate + factsheet map): it
 * MIRRORS the engine's `lev()` closure (src/lib/scenario.ts:325-328) on the
 * edge cases — a non-finite or negative multiplier becomes 1 (no shorting in
 * v1; a bad persisted value can never poison the curve). It ADDS the MAX_LEVERAGE
 * ceiling that the engine's `lev()` deliberately omits (the engine trusts
 * pre-sanitized input; the read side does not). This divergence is intentional
 * and documented.
 *
 * NOT the same as the composer's INTERACTIVE 0-clamp: `handleLeverageChange`
 * clamps a negative typed value to 0 with user-facing `setCommitError`
 * messaging. That is UX and stays local to the composer — it is not this
 * contract.
 *
 * ⚠️ GUARD (D3, corrected 2026-07-11): NEVER build a zod `.min`/`.max` refine on
 * top of these bounds. A schema refine failure routes the draft codec to reset
 * and can DELETE a user's whole saved draft. Sanitize on read here instead.
 *
 * The engine `src/lib/scenario.ts` is BYTE-UNTOUCHED — it keeps its own local
 * `lev()` closure and does not import from this module (D5: share the contract,
 * not the loop).
 */

import { captureToSentry } from "./sentry-capture";

/**
 * R4 — leverage v1 bounds. No shorting (L ≥ 0). Lifted from
 * ScenarioComposer.tsx:178 so the composer, the solver and the read-side
 * sanitizer share a single source of truth.
 *
 * ── 151 UAT (founder, 2026-08-07): raised 10 → 200 ─────────────────────────
 *
 * This is the CONTRACT ceiling: the widest multiplier the system will carry.
 * The founder models strategy rows well above 10×, and the old bound silently
 * truncated them — `sanitizeLeverage` clamps on READ, so a saved 50× came back
 * as 10× on every reopen, share-resolve and compare, with only a Sentry
 * breadcrumb to say so.
 *
 * There is no safety assumption at any particular ceiling. The engine's ruin
 * handling is bound-independent: `1 + L·r ≤ 0` collapses cumulative wealth and
 * `computeScenario` returns null metrics, which render as an honest em-dash;
 * `solveLeverageForMaxDD` ruin-clamps its own search domain by bisecting for
 * the smallest ruinous L before it solves. A 200× crypto sleeve simply reaches
 * ruin, honestly, instead of being quietly rewritten to 10×.
 *
 * ⚠️ KEEP THIS THE WIDEST BOUND IN THE SYSTEM. A surface may impose a NARROWER
 * input bound of its own (the public factsheet what-if does — see
 * {@link FACTSHEET_MAX_LEVERAGE} below), and that is safe in one direction
 * only: because the sanitizer's ceiling is the widest, no surface's stored
 * value is ever silently reduced on read. Lowering THIS constant below a
 * surface's own bound would reintroduce exactly the silent-truncation class
 * above.
 */
export const MAX_LEVERAGE = 200;

/**
 * The PUBLIC factsheet what-if projection's own, narrower input bound.
 *
 * 151 review A6 — this lived as a module-private const in `FactsheetView.tsx`,
 * which made the "widest bound" invariant above UNENFORCEABLE: nothing could
 * compare the two, so raising this past `MAX_LEVERAGE` (or lowering
 * `MAX_LEVERAGE` under it) would reintroduce silent read-time truncation of
 * stored values with the whole suite green. It lives HERE, beside the ceiling
 * it must stay under, so `leverage.test.ts` can pin the ORDERING —
 * `FACTSHEET_MAX_LEVERAGE <= MAX_LEVERAGE` — rather than two literals that
 * drift independently.
 *
 * The VALUE is deliberately unchanged (the pre-151 `MAX_LEVERAGE`): the 10 → 200
 * raise was asked for by the founder for the Scenario Composer's strategy rows,
 * and this anonymous public surface was not in that ask. Its behaviour and copy
 * are byte-identical to before the move.
 */
export const FACTSHEET_MAX_LEVERAGE = 10;

/**
 * Optional provenance for a sanitize call, used ONLY to enrich the SFH-2
 * coercion signal (below). Absent on the hot render path (the factsheet
 * ControlBar pre-clamps, so it never coerces in production); present on the
 * rehydrate path so a corrupt persisted value carries its offending key.
 */
interface SanitizeContext {
  source?: string;
  key?: string;
  /**
   * LOW-1 (round-3) — set `false` to SUPPRESS the coercion Sentry warning.
   * Default `true` (keep the actionable signal on the owner-facing interactive /
   * rehydrate path). Suppressed on non-actionable, high-volume readers: the
   * PUBLIC anonymous share page (a quota-burn vector — a corrupt persisted value
   * would fire on EVERY anonymous view) and the read-twice compare path (panel +
   * engine = 2 events per corrupt entry per compute). Behavior of the returned
   * value is IDENTICAL either way — only the observability emission is gated.
   */
  signal?: boolean;
}

/** Options for {@link sanitizeLeverageMap}. */
interface SanitizeMapOptions {
  /** See {@link SanitizeContext.signal}. Forwarded to every per-entry sanitize. */
  signal?: boolean;
}

/**
 * Read-side leverage clamp. Non-finite or negative → 1 (mirrors the engine
 * `lev()`); anything above the ceiling → MAX_LEVERAGE; otherwise identity
 * (0 is a valid, allowed multiplier).
 *
 * SFH-2 — the clamp is a fail-SAFE (a bad value can never poison the curve),
 * but a silent coercion of a *defined* value would leave corrupt persisted
 * leverage looking like an honest 1×/clamped multiplier with no signal. So a
 * REAL coercion (a finite input whose sanitized output differs — e.g. a
 * tampered persisted `999 → 10`, or a `-5 → 1`) emits a Sentry warning with an
 * errorId + the offending key/value. The identity path (0/2/10 → itself) and
 * unpersistable non-finite inputs (JSON can't carry NaN/Infinity) never log —
 * that would be pure noise. Behavior of the return value is UNCHANGED.
 */
export function sanitizeLeverage(v: number, context?: SanitizeContext): number {
  const out = Number.isFinite(v) && v >= 0 ? Math.min(MAX_LEVERAGE, v) : 1;
  if (Number.isFinite(v) && out !== v && context?.signal !== false) {
    captureToSentry(
      new Error(
        `sanitizeLeverage coerced an out-of-range leverage (${v} → ${out})`,
      ),
      {
        tags: {
          errorId: "LEV_SANITIZE_COERCION",
          source: context?.source ?? "sanitizeLeverage",
        },
        extra: { key: context?.key ?? null, input: v, output: out },
        level: "warning",
      },
    );
  }
  return out;
}

/**
 * Per-entry `sanitizeLeverage` over a leverage-override map (the LEV-02
 * rehydrate helper; D3 sanitize-on-read). `undefined` → `{}`. Threads each
 * entry's key into the SFH-2 coercion signal so a corrupt persisted value is
 * diagnosable by ref.
 */
export function sanitizeLeverageMap(
  m: Record<string, number> | undefined,
  options?: SanitizeMapOptions,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    out[k] = sanitizeLeverage(v, {
      source: "sanitizeLeverageMap",
      key: k,
      signal: options?.signal,
    });
  }
  return out;
}
