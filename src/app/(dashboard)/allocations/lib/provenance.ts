/**
 * Phase 111 / CONSTIT-02 — constituent provenance derivation (presentation).
 *
 * This is a PURE, presentation-layer helper. It maps a constituent's
 * server-truth provenance metadata to the badge union `ProvenanceTier | null`.
 *
 * Deliberately NOT in `scenario.ts` (byte-frozen engine, CONSTIT-04) and NOT in
 * the `scenario-adapter` `StrategyForBuilder` shape (Pitfall 3): provenance is
 * presentation metadata and must never ride into the frozen blend engine. It
 * lives beside the composer's other pure lib helpers so the composer can render
 * a per-row badge (wave 3 / 111-03) without threading a new engine input.
 *
 * The `composite` identity is a badge-layer concept only — it is derived from
 * the server-coerced `is_composite` boolean (data_quality_flags.composite ===
 * true), NOT a DB `strategy_verifications.trust_tier` value. The DB `TrustTier`
 * union stays 3-valued; `ProvenanceTier` widens it with `composite`.
 */
import type { ProvenanceTier, TrustTier } from "@/lib/design-tokens/trust-tier";

/**
 * The three DB verification tiers, as a runtime set for validating an untrusted
 * `trust_tier` string before it is treated as a badge variant. Kept in sync with
 * the `TrustTier` union by construction (the `satisfies` pins the membership).
 */
const VALID_TRUST_TIERS = new Set<TrustTier>([
  "api_verified",
  "csv_uploaded",
  "self_reported",
]) satisfies ReadonlySet<TrustTier>;

/**
 * A constituent's server-truth provenance metadata. Sourced from the SSR payload
 * (book strategies) or the widened lazy-returns route (drawer-added strategies);
 * per-key units pass `trust_tier: "api_verified"` by construction.
 */
export interface ConstituentProvenanceInput {
  /** Most-recent strategy_verifications.trust_tier (D-04); null when unverified. */
  trust_tier?: string | null;
  /** Server-coerced data_quality_flags.composite === true. */
  is_composite?: boolean | null;
}

/**
 * Map constituent provenance metadata to a badge variant, or `null` when there
 * is nothing honest to show (no composite flag, no recognised tier).
 *
 * Precedence:
 *   1. `is_composite === true`               → "composite" (composite wins)
 *   2. `trust_tier` is a valid `TrustTier`   → that tier
 *   3. otherwise                             → null (badge hidden)
 *
 * Strictness: only a real `true` triggers composite (mirrors the server's strict
 * coercion — a truthy-but-not-true value must not assert composite provenance).
 * An unrecognised `trust_tier` string is dropped to null — never invented.
 */
export function deriveProvenance(
  input: ConstituentProvenanceInput,
): ProvenanceTier | null {
  if (input.is_composite === true) return "composite";
  const tier = input.trust_tier;
  if (tier != null && VALID_TRUST_TIERS.has(tier as TrustTier)) {
    return tier as TrustTier;
  }
  return null;
}
