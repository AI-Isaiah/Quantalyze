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

/**
 * Review WR-03 — whether `holdingEquityContributionLocal` returned a REPORTED
 * figure, or the 0 it substitutes for a missing one (a derivative with a null
 * or non-finite `unrealized_pnl_usd`, a spot holding with a non-finite
 * `value_usd`). Same branches as that function, so the two cannot disagree
 * about which holdings were defaulted. It never changes the sum.
 */
export function holdingEquityIsReported(h: DashboardHolding): boolean {
  if (h.holding_type === "derivative") {
    return h.unrealized_pnl_usd != null && Number.isFinite(h.unrealized_pnl_usd);
  }
  return Number.isFinite(h.value_usd);
}

/** A disclosed part of the live-holdings total. */
export interface LiveHoldingsPart {
  /** Summed equity contribution, signed as it comes. */
  amount: number;
  /** Holdings summed. This, never `amount`, gates a disclosure (D-07). */
  count: number;
  /** Of `count`, the holdings whose equity was not reported and was summed as
   *  0 (review WR-03). A disclosure must say so rather than present that 0 as
   *  a known figure. */
  unavailable: number;
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
  untrusted: LiveHoldingsPart;
  /** Review WR-05. The part of `total` from holdings whose `api_key_id` is not
   *  in `statusByKeyId` at all. `allocator_holdings.api_key_id` is NOT NULL, so
   *  an absent entry means the key list dropped the key (for example an
   *  unsupported exchange), never "no key". Its status is UNKNOWN: treating it
   *  as trusted would under-state the part of the figure nobody can vouch for,
   *  and counting it as untrusted would claim a status it may not have. Only
   *  the degrade branch can sum such a holding (the contributing set is a
   *  subset of the `apiKeys` ids), but a disclosure must not fail open. */
  unknownStatus: LiveHoldingsPart;
  /** CONTEXT D-20's `$Y`: holdings the contributing-set narrowing dropped from
   *  `total` whose key is untrusted, MINUS the keys the payload names as
   *  manager-side (`managerSideApiKeyIds`). A manager-side key's holdings are
   *  not the allocator's book, so a `sign_in_failed` one is left out. A
   *  `revoked` manager-side key cannot be told apart (it is in neither eligible
   *  set), so its holdings may be counted: that over-discloses and never
   *  hides. An allocator-eligible untrusted key that has no return series yet
   *  IS counted, per D-20.
   *
   *  Nothing renders this yet. It exists so the D-06 pin can measure the
   *  exclusion, and the founder's D-06 answer decides whether it is ever
   *  disclosed. */
  excludedUntrusted: LiveHoldingsPart;
}

export function summarizeLiveHoldings(args: {
  toggleByScopeRef: Readonly<Record<string, boolean>>;
  holdingByRef: ReadonlyMap<string, DashboardHolding>;
  contributingApiKeyIds: readonly string[];
  /** `eligibleApiKeyIds` minus `allocatorEligibleApiKeyIds`, both read from the
   *  payload (never re-derived): the keys that feed a strategy the owner runs
   *  as a manager. Read only to narrow `excludedUntrusted` to D-20's `$Y`. */
  managerSideApiKeyIds: readonly string[];
  statusByKeyId: ReadonlyMap<string, string | null>;
}): LiveHoldingsSummary {
  const contributing = new Set(args.contributingApiKeyIds);
  const managerSide = new Set(args.managerSideApiKeyIds);
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
    untrusted: { amount: 0, count: 0, unavailable: 0 },
    unknownStatus: { amount: 0, count: 0, unavailable: 0 },
    excludedUntrusted: { amount: 0, count: 0, unavailable: 0 },
  };
  const addTo = (part: LiveHoldingsPart, h: DashboardHolding, equity: number) => {
    part.amount += equity;
    part.count += 1;
    if (!holdingEquityIsReported(h)) part.unavailable += 1;
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
      // D-20: a manager-side key the payload identifies is not the allocator's
      // book, so its holdings are not part of what the narrowing excluded from
      // THEIR AUM. Only the indistinguishable remainder may over-disclose.
      if (untrusted && !managerSide.has(h.api_key_id)) {
        addTo(out.excludedUntrusted, h, equity);
      }
      continue;
    }
    out.total += equity;
    if (untrusted) {
      addTo(out.untrusted, h, equity);
    } else if (!args.statusByKeyId.has(h.api_key_id)) {
      // WR-05: an ABSENT status is unknown, not trusted. `.has`, not a check
      // on the looked-up value: a key present with a null status is trusted.
      addTo(out.unknownStatus, h, equity);
    }
  }
  return out;
}
