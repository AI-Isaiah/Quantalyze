/**
 * Phase 167.1 AUMTRUST — the Scenario composer's live-holdings total and the
 * part of it that comes from keys needing attention, summed in ONE pass.
 *
 * WHY THIS MODULE EXISTS. The composer's PORTFOLIO AUM field (book mode) is
 * seeded from the live-holdings total, and a holding whose source key's sync is
 * untrusted (`isUntrustedKeySyncStatus`: `revoked`, `sign_in_failed`) is summed
 * into it. The founder's decision (2026-09-22) is to KEEP THE TOTAL AND FLAG
 * IT: the figure does not change, and a disclosure beside it names the untrusted
 * dollars. That disclosure is only honest if it is a strict subset of the total
 * it qualifies, so the total and its untrusted subset come from the SAME
 * iteration here. A second, hand-kept copy of the loop is how the two would
 * drift apart (D-04 / D-19).
 *
 * It is a plain module rather than code inside the composer for a second
 * reason: its unit test doubles `@/lib/closed-sets` to prove the membership
 * test is the shared predicate (D-15 pin 5). That double must not be hoisted
 * into the composer's own suite, where it would apply to every test.
 *
 * Client-safe: `@/lib/queries` is `server-only`, so it is imported for its
 * TYPE only. `@/lib/closed-sets` has no `server-only` import.
 */

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { isUntrustedKeySyncStatus } from "@/lib/closed-sets";

type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

/**
 * DSRC-02 (D2) — per-holding equity contribution, the per-key WEIGHT source.
 *
 * Mirrors the SSR `holdingEquityContribution` (`src/lib/queries.ts`) EXACTLY:
 *   - derivative → `unrealized_pnl_usd` (the actual equity at stake; `value_usd`
 *     is the leveraged NOTIONAL contract size, which would inflate the weight by
 *     the leverage factor), null/non-finite → 0.
 *   - spot       → `value_usd` (marked fair value = the equity contribution),
 *     non-finite → 0.
 *
 * Phase 167.1 moved this function here from `ScenarioComposer.tsx`, body
 * unchanged, so the composer's `equityByApiKeyId` memo and
 * `summarizeLiveHoldings` below read ONE definition. It is still a local copy
 * of the SSR helper rather than an import of it: `@/lib/queries` is
 * `server-only`, so importing its export into the "use client" composer would
 * cross the client/server boundary (and the per-key adapter sibling already
 * duplicates the per-key loop locally for the same reason). Keep this in
 * lockstep with the SSR helper so the client weight matches the server's.
 */
export function holdingEquityContributionLocal(h: DashboardHolding): number {
  if (h.holding_type === "derivative") {
    const pnl = h.unrealized_pnl_usd ?? 0;
    return Number.isFinite(pnl) ? pnl : 0;
  }
  return Number.isFinite(h.value_usd) ? h.value_usd : 0;
}

/** The composer's live-holdings total and its untrusted-key parts. */
export interface LiveHoldingsSummary {
  /** The live-holdings total. Byte-identical to the composer's pre-167.1
   *  `liveHoldingsSum`: same walk, same filters, same accumulation order. */
  total: number;
  /** The part of `total` from holdings whose key is untrusted. `count` gates
   *  the disclosure, never `amount`: a derivative's contribution can be zero
   *  or negative and is still sourced from a key whose numbers are not current
   *  (D-07). Because of that, `amount <= total` is NOT an invariant. */
  untrusted: { amount: number; count: number };
  /** Holdings from untrusted keys that the contributing-set narrowing dropped
   *  from `total`. Nothing renders this yet; it exists so the D-06 pin can
   *  measure the `revoked` exclusion, and the founder's D-06 answer decides
   *  whether it is ever disclosed. */
  excludedUntrusted: { amount: number; count: number };
}

export function summarizeLiveHoldings(args: {
  toggleByScopeRef: Readonly<Record<string, boolean>>;
  holdingByRef: ReadonlyMap<string, DashboardHolding>;
  contributingApiKeyIds: readonly string[];
  statusByKeyId: ReadonlyMap<string, string | null>;
}): LiveHoldingsSummary {
  const contributing = new Set(args.contributingApiKeyIds);
  // ⚠️ The narrowing applies only when there IS a modelled set to narrow TO.
  // An EMPTY contributing set means no per-key row exists, so there is nothing
  // for the AUM to agree with — and narrowing to ∅ would zero it, taking the
  // dollar columns, the commit sizing and the commit itself down with it (the
  // AUM-zero refusal), which is a far worse answer than custody's total.
  //
  // In production `bookEntryGateSatisfied === contributingApiKeyIds.length > 0`
  // and book mode requires that gate, so this branch is unreachable there; it
  // exists because the flag is read from the payload rather than re-derived,
  // and a payload that asserts book-entry with an empty contributing set must
  // degrade to the honest whole-book number rather than to zero. It also does
  // NOT reintroduce F2's two-figure defect: with no contributing key,
  // `totalBookEquity` is null and every NOTIONAL cell is an em-dash, so there
  // is no second dollar figure to disagree with.
  //
  // The neighbouring degenerate case — a non-empty contributing set whose keys
  // happen to carry no holdings — deliberately DOES land on 0: there the rows
  // exist and their equity really is zero, so the USD and NOTIONAL columns are
  // both honestly non-derivable and still agree.
  //
  // Phase 167.1: in that degrade branch a `revoked` key's holdings ARE summed,
  // and so they ARE flagged below. The predicate is tested on every summed
  // holding, whichever branch put it there (D-05).
  const narrowToModelledBook = contributing.size > 0;
  const out: LiveHoldingsSummary = {
    total: 0,
    untrusted: { amount: 0, count: 0 },
    excludedUntrusted: { amount: 0, count: 0 },
  };
  for (const [scopeRef, on] of Object.entries(args.toggleByScopeRef)) {
    if (!on) continue;
    if (!scopeRef.startsWith("holding:")) continue;
    const h = args.holdingByRef.get(scopeRef);
    if (!h) continue;
    // E1 — the SAME per-holding equity definition `equityByApiKeyId` (and
    // therefore `totalBookEquity`, and therefore every NOTIONAL cell) uses.
    // Never `h.value_usd`: on a derivative that is notional, not equity.
    const equity = holdingEquityContributionLocal(h);
    // ⛔ The shared predicate is the ONLY membership test (167 D-16). A local
    // equality on the status column is the defect that rule exists to prevent.
    const untrusted = isUntrustedKeySyncStatus(args.statusByKeyId.get(h.api_key_id));
    if (narrowToModelledBook && !contributing.has(h.api_key_id)) {
      if (untrusted) {
        out.excludedUntrusted.amount += equity;
        out.excludedUntrusted.count += 1;
      }
      continue;
    }
    out.total += equity;
    if (untrusted) {
      out.untrusted.amount += equity;
      out.untrusted.count += 1;
    }
  }
  return out;
}
