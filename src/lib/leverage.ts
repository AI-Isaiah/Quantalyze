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

/**
 * R4 — leverage v1 bounds. No shorting (L ≥ 0); a 10× ceiling keeps the
 * projection in a sane range. Lifted from ScenarioComposer.tsx:178 so the
 * factsheet recompute, the composer, and the read-side sanitizer share a single
 * source of truth.
 */
export const MAX_LEVERAGE = 10;

/**
 * Read-side leverage clamp. Non-finite or negative → 1 (mirrors the engine
 * `lev()`); anything above the ceiling → MAX_LEVERAGE; otherwise identity
 * (0 is a valid, allowed multiplier).
 */
export function sanitizeLeverage(v: number): number {
  return Number.isFinite(v) && v >= 0 ? Math.min(MAX_LEVERAGE, v) : 1;
}

/**
 * Per-entry `sanitizeLeverage` over a leverage-override map (the LEV-02
 * rehydrate helper; D3 sanitize-on-read). `undefined` → `{}`.
 */
export function sanitizeLeverageMap(
  m: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    out[k] = sanitizeLeverage(v);
  }
  return out;
}
