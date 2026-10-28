/**
 * Phase 167.1 AUMTRUST — the Scenario composer's live-holdings total and the
 * part of it that comes from keys needing attention, summed in ONE pass.
 *
 * WHY THIS MODULE EXISTS. The composer's PORTFOLIO AUM field (book mode) is
 * seeded from the live-holdings total, and a holding whose source key needs
 * attention (`keyNeedsAttention`: a `revoked` or `sign_in_failed` sync status,
 * or, since 167.1.1 D-02, a soft-disconnected key whatever its sync status) is
 * summed into it. The founder's decision (2026-09-22) is to KEEP THE TOTAL AND FLAG
 * IT: the figure does not change, and a disclosure beside it names the untrusted
 * dollars. That disclosure is only honest if it is a strict subset of the total
 * it qualifies, so the total and its untrusted subset come from the SAME
 * iteration here. A second, hand-kept copy of the loop is how the two would
 * drift apart (D-04 / D-19).
 *
 * It is a plain module rather than code inside the composer for a second
 * reason: its unit test doubles `@/lib/closed-sets` to prove the membership
 * test is the shared predicate `keyNeedsAttention` (D-15 pin 5). That double must not be hoisted
 * into the composer's own suite, where it would apply to every test.
 *
 * Client-safe: `@/lib/queries` is `server-only`, so it is imported for its
 * TYPE only. `@/lib/closed-sets` has no `server-only` import.
 */

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { buildHoldingRef } from "./holding-outcome-adapter";
import {
  holdingEquityContribution,
  holdingEquityIsReported,
  holdingIsPriceGap,
} from "@/lib/holding-equity";
import {
  keyNeedsAttention,
  UNKNOWN_KEY_STATUS_SET_NOUN,
  UNTRUSTED_KEY_SET_NOUN,
} from "@/lib/closed-sets";

type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

/**
 * Phase 167.1.1 D-02 — the two key-state maps `summarizeLiveHoldings` reads,
 * built from ONE pass over the payload's key list so they can never describe
 * different key sets. `statusByKeyId` keeps the WR-05 `.has` semantics (a key
 * absent from the list is UNKNOWN, a key present with a null status is
 * trusted); `disconnectedAtByKeyId` carries the soft-disconnect timestamp.
 *
 * Exported so the composer and the phase's end-to-end test derive the maps the
 * same way production does. A missing key list yields two empty maps.
 */
export function keyStateMapsOf(
  apiKeys:
    | ReadonlyArray<{
        id: string;
        sync_status: string | null;
        disconnected_at: string | null;
      }>
    | null
    | undefined,
): {
  statusByKeyId: Map<string, string | null>;
  disconnectedAtByKeyId: Map<string, string | null>;
} {
  const statusByKeyId = new Map<string, string | null>();
  const disconnectedAtByKeyId = new Map<string, string | null>();
  for (const k of apiKeys ?? []) {
    statusByKeyId.set(k.id, k.sync_status);
    disconnectedAtByKeyId.set(k.id, k.disconnected_at);
  }
  return { statusByKeyId, disconnectedAtByKeyId };
}

/**
 * 170.4 D-08 ("One Key is One Strategy") — group the payload's holdings by the
 * composer's scope ref (`buildHoldingRef`: venue:symbol:type), KEEPING EVERY ROW
 * and the input order.
 *
 * WHY MANY ROWS PER REF. A scope ref is the Scenario's line, a persisted
 * identifier (toggles and match decisions are keyed on it). Its rows are every
 * live key's position in that venue:symbol:type. The pre-170.4 map held one
 * holding per ref (`Map.set` overwrote), so once the payload carries one row per
 * key, a second key's row replaced the first and dropped out of the live total.
 * Each row is classified by its OWN key's status in `summarizeLiveHoldings`.
 */
export function holdingsByRef(
  holdings: readonly DashboardHolding[],
): Map<string, DashboardHolding[]> {
  const byRef = new Map<string, DashboardHolding[]>();
  for (const h of holdings) {
    const ref = buildHoldingRef({
      venue: h.venue,
      symbol: h.symbol,
      holding_type: h.holding_type,
    });
    const rows = byRef.get(ref);
    if (rows) rows.push(h);
    else byRef.set(ref, [h]);
  }
  return byRef;
}

/**
 * DSRC-02 (D2) — per-holding equity contribution, the per-key WEIGHT source.
 *
 * Phase 167.1.1.2 D-04: this is the SAME function object as the SSR
 * `holdingEquityContribution` (`src/lib/queries.ts` re-exports it), both read
 * from the pure module `@/lib/holding-equity`. The client and the server read
 * one definition; there is no second copy to keep in step.
 *   - derivative → `unrealized_pnl_usd` (the actual equity at stake; `value_usd`
 *     is the leveraged NOTIONAL contract size, which would inflate the weight by
 *     the leverage factor); a non-finite P&L → 0; a null / absent P&L → `null`
 *     (D-06, withheld: a SUM skips and counts it, a WEIGHT reads `?? 0`).
 *   - spot       → `value_usd` (marked fair value = the equity contribution),
 *     non-finite → 0.
 *
 * Phase 167.1 moved this function here from `ScenarioComposer.tsx` so the
 * composer's `equityByApiKeyId` memo and `summarizeLiveHoldings` below read ONE
 * definition.
 */
export const holdingEquityContributionLocal = holdingEquityContribution;

/**
 * Review WR-03 — whether `holdingEquityContributionLocal` returned a REPORTED
 * figure, or the 0 / null it substitutes for a missing one (a derivative with a
 * null or non-finite `unrealized_pnl_usd`, a spot holding with a non-finite
 * `value_usd`). Re-exported from the pure module so the two cannot disagree
 * about which holdings were defaulted. It never changes the sum.
 */
export { holdingEquityIsReported };

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
   *  `liveHoldingsSum`: same walk, same filters, same accumulation order.
   *  167.1.1.2 D-06: a derivative whose P&L was not reported added 0 before and
   *  adds nothing now (it is counted in `pnlMissing` instead), so no number
   *  moved. */
  total: number;
  /** 167.1.1.2 D-06 (UI-SPEC U-05 / 167.1 D-04). Toggled-on rows that would have
   *  entered `total` but are derivatives whose P&L was not reported
   *  (`holdingEquityIsReported` false: null, absent or non-finite). Counted per
   *  ROW, in the same pass as `total`. Such a row is in neither `total` nor any
   *  includes part (`untrusted`, `unknownStatus`), so a disclosure can never
   *  present it as a known figure. Spot rows are never counted here. A row the
   *  narrowing already dropped stays in its `excluded*` part, with
   *  `unavailable` incremented, and is not counted here (UI-SPEC rule 5). */
  pnlMissing: number;
  /** 167.2.1.1.1.1 D-07 (UI-SPEC P0 / 167.1 D-04). Toggled-on rows that would have
   *  entered `total` but are held SPOT rows with no usable price
   *  (`holdingIsPriceGap`: a finite quantity above 0 and a mark that is not a
   *  finite number above 0). Counted per ROW, in the same pass as `total`. Such a
   *  row is in neither `total` nor any includes part (`untrusted`,
   *  `unknownStatus`), exactly as `pnlMissing`, so a disclosure can never
   *  present its stored 0 as a known figure. The total does not move: a gap
   *  row's equity was 0. Derivatives are never counted here. A row the narrowing
   *  already dropped stays in its `excluded*` part, with `unavailable`
   *  incremented, and is not counted here. */
  priceGap: number;
  /** The part of `total` from holdings whose key needs attention
   *  (`keyNeedsAttention`: an untrusted sync status, or since 167.1.1 D-02 a
   *  soft-disconnected key whatever its status).
   *
   *  ⚠️ Which keys reach this part depends on the BRANCH (round-1 WR-03). In
   *  the degrade branch (empty contributing set) every needing-attention key's
   *  dollars are summed into `total` and counted here. In the narrowed (book)
   *  branch, the only one production runs, a soft-disconnected key is never
   *  contributing (`disconnected_at` is non-null, so it is not eligible), so
   *  its dollars are NOT in `total`: they land in `excludedUntrusted`, which
   *  the composer names "Excludes $Y from keys needing attention". "Stay IN
   *  the total" (CONTEXT D-02) therefore holds on Holdings and Open Positions
   *  and in the degrade branch, not in the composer's book-mode AUM.
   *  `count` gates
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
   *  `total` whose key needs attention (167.1.1 D-02: a soft-disconnected key
   *  is named here, no longer in `excludedNotConnected`; no number moves), MINUS the keys the payload names as
   *  manager-side (`managerSideApiKeyIds`). A manager-side key's holdings are
   *  not the allocator's book, so one the payload names is left out. An
   *  allocator-eligible untrusted key that has no return series yet IS
   *  counted, per D-20.
   *
   *  The residual, stated by its predicate (review round 2 WR-03): the payload
   *  names a manager-side key only while it is in `eligibleApiKeyIds`, which
   *  `isPerKeyDailiesEligibleKey` restricts to active, non-`revoked`,
   *  not-disconnected keys. A manager-side key outside `eligibleApiKeyIds`
   *  (revoked, soft-disconnected or inactive) cannot be told apart, so its
   *  untrusted holdings may be counted. That over-discloses and never hides.
   *
   *  What `$Y` does NOT carry (review round 2 IN-04): a dropped holding
   *  whose key is missing from `statusByKeyId` has no known status, so it
   *  fails the untrusted test. ⭐ SUPERSEDED 2026-09-24 (review round 3
   *  WR-01): such a holding is no longer in "no part". It is counted in
   *  `excludedUnknownStatus` below, and the composer names it. The text that
   *  stood here ("lands in no part … the "excludes" clause therefore says
   *  nothing about it") described the gap that part closes.
   *
   *  ⭐ D-06 RESOLVED 2026-09-24 by the founder: option (b). The composer
   *  discloses this part as "excludes $Y from keys needing attention",
   *  through `buildKeyTrustClause`. It is still never added to, or subtracted
   *  from, `total` (D-03). The sentence that stood here until then ("Nothing
   *  renders this yet … the founder's D-06 answer decides whether it is ever
   *  disclosed") is superseded. */
  excludedUntrusted: LiveHoldingsPart;
  /** Review round 3 WR-01 (2026-09-24). Holdings the contributing-set
   *  narrowing dropped from `total` whose `api_key_id` is not in
   *  `statusByKeyId` at all, minus the keys the payload names as manager-side
   *  (D-20, as for `excludedUntrusted`). The excludes-side twin of
   *  `unknownStatus`, with the same `.has` rule.
   *
   *  WHY IT EXISTS. `getUserApiKeys` drops a key row on an unsupported
   *  exchange, but that key's holdings still arrive. It is in no eligible set,
   *  so in production (where the narrowing is always on) its holdings take
   *  the narrowing arm. Before this part they landed nowhere and vanished from
   *  the "excludes" clause. That is the one production-reachable missing-key
   *  path, and D-06's intent is that the composer says what it excludes. An
   *  absent `payload.apiKeys` (an empty status map) lands every dropped
   *  holding here too, so the excludes side fails open like the includes
   *  side. Never added to, or subtracted from, `total` (D-03). */
  excludedUnknownStatus: LiveHoldingsPart;
  /** Phase 167.1.2 SC-4. Holdings the contributing-set narrowing dropped from
   *  `total` whose key is TRUSTED (present in `statusByKeyId`, not untrusted)
   *  and not manager-side: an allocator key with no return series yet. Until
   *  this part they fell through every branch and landed in no part at all,
   *  so the composer said nothing about them. On the founder's book that is
   *  where a shared account's dollars sat. The composer names it as "excludes
   *  $X from connected keys with no return history yet". Never added to, or
   *  subtracted from, `total` (D-03). */
  excludedTrusted: LiveHoldingsPart;
  /** Review C2 WR-03. Holdings the narrowing dropped whose key is in the
   *  status map, does not need attention, but is NOT in the payload's
   *  `eligibleApiKeyIds`: an INACTIVE key (its `disconnected_at` is null) whose
   *  last holdings still arrive. Since 167.1.1 D-02 a soft-disconnected key is
   *  not here: it needs attention and is named in `excludedUntrusted`.
   *  Its holdings still arrive (`holdingsSummary` is not filtered by key
   *  eligibility). Until this part they landed in `excludedTrusted` and were
   *  called "connected keys with no return history yet", both halves false.
   *  The composer names them "keys that are not connected". Empty when the
   *  caller passes no eligible set, because then the two cannot be told apart.
   *  Never added to, or subtracted from, `total` (D-03). */
  excludedNotConnected: LiveHoldingsPart;
  /** Phase 167.1.2 SC-4. Holdings the narrowing dropped whose key the payload
   *  names as manager-side (D-20: not the allocator's book), whatever its
   *  status. Kept OUT of every disclosure, per D-20's reasoning, but counted,
   *  so that every toggled-on dollar is in exactly one of `total` or an
   *  `excluded*` part (the conservation invariant the unit suite generates
   *  books against). */
  excludedManagerSide: LiveHoldingsPart;
}

/**
 * CONTEXT D-20 — the keys the payload itself names as manager-side: in
 * `eligibleApiKeyIds` (per-key-dailies eligible) but not in
 * `allocatorEligibleApiKeyIds` (eligible minus the keys that feed a strategy
 * the owner runs as a manager). It is the difference of two SSR sets, in
 * `eligible` order, and never a re-derivation of either predicate on the
 * client.
 *
 * A pure function next to `summarizeLiveHoldings` rather than inline in the
 * composer (review round 2 WR-01): `excludedUntrusted` renders nowhere until
 * the founder answers D-06, so a wrong direction or a dropped argument here
 * would ship green unless the derivation is pinned where it is written.
 * ⭐ SUPERSEDED 2026-09-24 (D-06 answered (b); review round 3 IN-01): the
 * composer now renders `excludedUntrusted` as "excludes $Y from keys needing
 * attention". The sentence above is kept as lineage. The pin matters more
 * now: a wrong direction here would mis-state a rendered figure.
 *
 * ⛔ A MISSING field yields NO manager-side key (review round 2 WR-06). Reading
 * an absent `allocatorEligibleApiKeyIds` as `[]` would make every eligible key
 * manager-side, and `summarizeLiveHoldings` would then HIDE their untrusted
 * holdings from `$Y`. D-20's direction is over-disclose, never hide, so an
 * unknown difference is treated as empty.
 */
export function managerSideKeyIds(
  eligibleApiKeyIds: readonly string[] | undefined,
  allocatorEligibleApiKeyIds: readonly string[] | undefined,
): string[] {
  if (eligibleApiKeyIds === undefined || allocatorEligibleApiKeyIds === undefined) {
    return [];
  }
  const allocatorEligible = new Set(allocatorEligibleApiKeyIds);
  return eligibleApiKeyIds.filter((id) => !allocatorEligible.has(id));
}

export function summarizeLiveHoldings(args: {
  toggleByScopeRef: Readonly<Record<string, boolean>>;
  /** 170.4 D-08: every row under a scope ref, from `holdingsByRef`. */
  holdingsByRef: ReadonlyMap<string, readonly DashboardHolding[]>;
  contributingApiKeyIds: readonly string[];
  /** `eligibleApiKeyIds` minus `allocatorEligibleApiKeyIds`, both read from the
   *  payload (never re-derived): the keys that feed a strategy the owner runs
   *  as a manager. Read only to narrow `excludedUntrusted` to D-20's `$Y`. */
  managerSideApiKeyIds: readonly string[];
  statusByKeyId: ReadonlyMap<string, string | null>;
  /** Phase 167.1.1 D-02: each key's `disconnected_at`, from `keyStateMapsOf`.
   *  REQUIRED, so a caller cannot omit it and silently read a soft-disconnected
   *  key as connected (a fail-open). A key absent from the map reads as
   *  connected here; the WR-05 unknown-status rule still keys off
   *  `statusByKeyId.has`. */
  disconnectedAtByKeyId: ReadonlyMap<string, string | null>;
  /** The payload's `eligibleApiKeyIds` (server-built by
   *  `isPerKeyDailiesEligibleKey`; never re-derived here). Read only to split
   *  `excludedNotConnected` out of `excludedTrusted` (review C2 WR-03).
   *  Undefined means unknown, and nothing is called not-connected. */
  eligibleApiKeyIds?: readonly string[];
}): LiveHoldingsSummary {
  const contributing = new Set(args.contributingApiKeyIds);
  const eligible =
    args.eligibleApiKeyIds === undefined ? null : new Set(args.eligibleApiKeyIds);
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
  // and so they ARE flagged below (167.1.1 D-02: so are a soft-disconnected
  // key's). The predicate is tested on every summed
  // holding, whichever branch put it there (D-05).
  const narrowToModelledBook = contributing.size > 0;
  const out: LiveHoldingsSummary = {
    total: 0,
    pnlMissing: 0,
    priceGap: 0,
    untrusted: { amount: 0, count: 0, unavailable: 0 },
    unknownStatus: { amount: 0, count: 0, unavailable: 0 },
    excludedUntrusted: { amount: 0, count: 0, unavailable: 0 },
    excludedUnknownStatus: { amount: 0, count: 0, unavailable: 0 },
    excludedTrusted: { amount: 0, count: 0, unavailable: 0 },
    excludedNotConnected: { amount: 0, count: 0, unavailable: 0 },
    excludedManagerSide: { amount: 0, count: 0, unavailable: 0 },
  };
  const addTo = (part: LiveHoldingsPart, h: DashboardHolding, equity: number) => {
    part.amount += equity;
    part.count += 1;
    // 167.2.1.1.1.1 D-07: a price-gap row's stored 0 is not a known figure either.
    if (!holdingEquityIsReported(h) || holdingIsPriceGap(h)) part.unavailable += 1;
  };
  for (const [scopeRef, on] of Object.entries(args.toggleByScopeRef)) {
    if (!on) continue;
    if (!scopeRef.startsWith("holding:")) continue;
    const rows = args.holdingsByRef.get(scopeRef);
    if (!rows) continue;
    // D-08: every key's row under this ref counts, each by its OWN key.
    for (const h of rows) {
      // E1 — the SAME per-holding equity definition `equityByApiKeyId` (and
      // therefore `totalBookEquity`, and therefore every NOTIONAL cell) uses.
      // Never `h.value_usd`: on a derivative that is notional, not equity.
      // 167.1.1.2 D-06: `null` is a derivative whose P&L was not reported.
      const equity = holdingEquityContributionLocal(h);
      // ⛔ The shared predicate is the ONLY membership test (167 D-16). A local
      // equality on the status column is the defect that rule exists to prevent.
      // 167.1.1 D-02: it also covers a soft-disconnected key, whatever its status.
      const untrusted = keyNeedsAttention({
        sync_status: args.statusByKeyId.get(h.api_key_id),
        disconnected_at: args.disconnectedAtByKeyId.get(h.api_key_id) ?? null,
      });
      if (narrowToModelledBook && !contributing.has(h.api_key_id)) {
        // D-20: a manager-side key the payload identifies is not the allocator's
        // book, so its holdings are not part of what the narrowing excluded from
        // THEIR AUM. Only the indistinguishable remainder may over-disclose.
        // Phase 167.1.2 SC-4: every branch below lands the holding in a part, so
        // no toggled-on dollar leaves this loop unaccounted for.
        if (managerSide.has(h.api_key_id)) {
          addTo(out.excludedManagerSide, h, equity ?? 0);
        } else if (untrusted) {
          addTo(out.excludedUntrusted, h, equity ?? 0);
        } else if (!args.statusByKeyId.has(h.api_key_id)) {
          // Review round 3 WR-01: an ABSENT status is unknown, not trusted,
          // on the excludes side too (the WR-05 `.has` rule).
          addTo(out.excludedUnknownStatus, h, equity ?? 0);
        } else if (eligible !== null && !eligible.has(h.api_key_id)) {
          // Review C2 WR-03: in the key list, status not untrusted, but not
          // eligible: the key is disconnected or inactive, not "connected with
          // no return history yet".
          addTo(out.excludedNotConnected, h, equity ?? 0);
        } else {
          // Trusted, not contributing, not manager-side: a key with no return
          // series yet. Before 167.1.2 this fell through to `continue` unnamed.
          addTo(out.excludedTrusted, h, equity ?? 0);
        }
        continue;
      }
      // 167.1.1.2 D-06 (PD-05): a derivative whose P&L was not reported (null,
      // absent or non-finite) is counted and left out of the total AND of every
      // includes part, so a disclosure cannot present it as a known figure.
      // Spot rows never reach this branch: their equity is never null and a
      // non-finite spot value keeps the WR-03 `unavailable` path.
      if (
        equity === null ||
        (h.holding_type === "derivative" && !holdingEquityIsReported(h))
      ) {
        out.pnlMissing += 1;
        continue;
      }
      // 167.2.1.1.1.1 D-07: a held spot row with no usable price is counted and
      // left out of the total AND of every includes part, beside pnlMissing. Its
      // equity was 0, so the total does not move. A derivative is never a gap.
      if (holdingIsPriceGap(h)) {
        out.priceGap += 1;
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
  }
  return out;
}

/** How one surface renders the clause below: its own amount renderer (the one
 *  the figure it qualifies already uses, UI-SPEC U-05) and its own name for a
 *  row whose figure was not reported. */
export interface KeyTrustClauseRender {
  /** Renders a part's signed amount. */
  amount: (n: number) => string;
  /** What a defaulted row is missing, e.g. `value` or `P&L`. */
  missing: string;
  /** The row unit, singular then plural, e.g. `holding` / `holdings`. */
  unit: readonly [string, string];
}

/** Phase 167.1.2 SC-4 — the noun for `excludedTrusted`, the one phrase the
 *  plan fixed ("excludes $X from connected keys with no return history yet").
 *  Local to this module: only this clause renders it. */
const NO_RETURN_HISTORY_KEY_SET_NOUN = "connected keys with no return history yet";

/** Review C2 WR-03 — the noun for `excludedNotConnected`. Local to this module
 *  for the same reason as the noun above. */
const NOT_CONNECTED_KEY_SET_NOUN = "keys that are not connected";

/**
 * Phase 167.1 AUMTRUST — the ONE lower-case clause that names the parts of a
 * dollar total sourced from keys needing attention and from keys whose sync
 * status is unknown, e.g. `includes $12,345 from keys needing attention`.
 *
 * One builder for every surface (review round 2 WR-05): the composer's AUM
 * marker and the Open Positions footer word the same facts identically, so a
 * reader sent from one to the other finds the same nouns. The nouns are the
 * shared constants and are never restated as strings. No venue, key label,
 * key id or sync error is interpolated: the clause carries dollar sums,
 * counts and constant nouns.
 *
 * - An unknown-status part is named with its own noun, never folded into the
 *   untrusted one (review WR-05).
 * - A part whose rows were not reported says how many (review WR-03), right
 *   after THAT part (review round 2 IN-01 / IN-05), so with two parts the
 *   count never reads as qualifying the other part's amount.
 * - A part renders on its COUNT, never its amount (D-07). The caller renders
 *   the clause only when at least one part has a count.
 * - D-06 (b), founder answer 2026-09-24: an optional `excludedUntrusted` part
 *   (D-20's `$Y`, dollars the composer's modelled-book narrowing left OUT of
 *   the total) adds "excludes $Y from keys needing attention". When both
 *   sides are plain amounts of the one untrusted set, the noun is said once,
 *   at the end (UI-SPEC § 3): `includes $X and excludes $Y from keys needing
 *   attention`. When the includes side carries a second noun or an
 *   "(… unavailable …)" count, sharing the noun would misattribute it, so
 *   each side keeps its own. A caller that passes no excluded part (Open
 *   Positions) gets the includes-only wording, byte-identical to before.
 * - Review round 3 WR-01 (2026-09-24): an optional `excludedUnknownStatus`
 *   part (dropped dollars whose key the key list does not carry) is named
 *   with the unknown-status noun after the excluded untrusted part, e.g.
 *   `excludes $Z from keys with an unknown sync status`. Its presence rules
 *   out the shared-noun form. Open Positions passes neither excluded part.
 * - Phase 167.1.2 SC-4: an optional `excludedTrusted` part (dropped dollars
 *   from a trusted key with no return series yet) is named last, as
 *   `excludes $X from connected keys with no return history yet`, with the
 *   same count and unavailable rules. Its presence rules out the shared-noun
 *   form, which would otherwise return before naming it. Open Positions
 *   passes it no more than the other excluded parts.
 * - Review C2 WR-03: an optional `excludedNotConnected` part (dropped dollars
 *   from a key that is not connected) is named before it, as `excludes $X
 *   from keys that are not connected`, with the same rules.
 */
export function buildKeyTrustClause(
  untrusted: LiveHoldingsPart,
  unknownStatus: LiveHoldingsPart,
  render: KeyTrustClauseRender,
  excludedUntrusted?: LiveHoldingsPart,
  excludedUnknownStatus?: LiveHoldingsPart,
  excludedTrusted?: LiveHoldingsPart,
  excludedNotConnected?: LiveHoldingsPart,
): string {
  const phrase = (part: LiveHoldingsPart, noun: string): string => {
    const unitOf = (n: number) => (n === 1 ? render.unit[0] : render.unit[1]);
    // 169 review round 2 IN-R2-05 / SFH R2-5: when EVERY row of the part is
    // unavailable, `amount` is the 0 they were summed as, not a known figure.
    // Stating it ("$0.00 from keys needing attention") put a dollar figure to
    // the cent beside an Open Positions total that reads "—". Name the count
    // instead; a partly reported part keeps its amount.
    const lead =
      part.unavailable > 0 && part.unavailable >= part.count
        ? `${part.count} ${unitOf(part.count)}`
        : render.amount(part.amount);
    const base = `${lead} from ${noun}`;
    if (part.unavailable === 0) return base;
    return `${base} (${render.missing} unavailable for ${part.unavailable} ${unitOf(part.unavailable)})`;
  };
  const parts: string[] = [];
  if (untrusted.count > 0) parts.push(phrase(untrusted, UNTRUSTED_KEY_SET_NOUN));
  if (unknownStatus.count > 0) {
    parts.push(phrase(unknownStatus, UNKNOWN_KEY_STATUS_SET_NOUN));
  }
  const excluded =
    excludedUntrusted !== undefined && excludedUntrusted.count > 0
      ? excludedUntrusted
      : null;
  const excludedUnknown =
    excludedUnknownStatus !== undefined && excludedUnknownStatus.count > 0
      ? excludedUnknownStatus
      : null;
  const excludedNoHistory =
    excludedTrusted !== undefined && excludedTrusted.count > 0
      ? excludedTrusted
      : null;
  const excludedGone =
    excludedNotConnected !== undefined && excludedNotConnected.count > 0
      ? excludedNotConnected
      : null;
  const excludedParts: string[] = [];
  if (excluded !== null) {
    excludedParts.push(phrase(excluded, UNTRUSTED_KEY_SET_NOUN));
  }
  if (excludedUnknown !== null) {
    excludedParts.push(phrase(excludedUnknown, UNKNOWN_KEY_STATUS_SET_NOUN));
  }
  if (excludedGone !== null) {
    excludedParts.push(phrase(excludedGone, NOT_CONNECTED_KEY_SET_NOUN));
  }
  if (excludedNoHistory !== null) {
    excludedParts.push(phrase(excludedNoHistory, NO_RETURN_HISTORY_KEY_SET_NOUN));
  }
  if (excludedParts.length === 0) return `includes ${parts.join(" and ")}`;
  if (parts.length === 0) return `excludes ${excludedParts.join(" and ")}`;
  // `excluded !== null` is implied by the next term (some excluded part has a
  // count) and is written out so the type narrows for `.unavailable`.
  const oneNoun =
    excluded !== null &&
    excludedUnknown === null &&
    excludedNoHistory === null &&
    excludedGone === null &&
    unknownStatus.count === 0 &&
    untrusted.unavailable === 0 &&
    excluded.unavailable === 0;
  if (oneNoun) {
    return `includes ${render.amount(untrusted.amount)} and excludes ${render.amount(excluded.amount)} from ${UNTRUSTED_KEY_SET_NOUN}`;
  }
  return `includes ${parts.join(" and ")}, and excludes ${excludedParts.join(" and ")}`;
}

/**
 * Phase 167.1.1.2 D-06 (UI-SPEC P0) — the ONE sentence that says how many
 * derivatives the live-holdings total left out because the venue reported no
 * unrealized P&L for them, e.g. `2 derivatives without reported P&L left out.`
 *
 * One builder for every surface, as `buildKeyTrustClause` is for key trust: the
 * composer's AUM hint and the Open Positions footer render the same words. The
 * wording is the founder's (CONTEXT D-06, Q5: "N derivatives without reported
 * P&L left out"); the only adjustments are the terminal period, because the
 * sentence stands alone wherever it renders, and the singular for 1.
 *
 * - The count is interpolated RAW (no thousands separator), as
 *   `buildKeyTrustClause` interpolates `part.count`.
 * - A count below 1 returns the empty string, so a 0-count sentence ("0
 *   derivatives ...") can never render on any branch (UI-SPEC "Empty state
 *   heading"); a caller renders the sentence only when this is non-empty.
 * - It carries no symbol, venue, key label or amount (U-08): a count and a
 *   constant phrase.
 *
 * Client-safe: it imports nothing `server-only`.
 */
export function pnlMissingSentence(count: number): string {
  if (!(count >= 1)) return "";
  return `${count} ${count === 1 ? "derivative" : "derivatives"} without reported P&L left out.`;
}

/**
 * Phase 167.2.1.1.1.1 D-07 (UI-SPEC P0, approved 2026-10-27): the sentence that
 * says how many held spot rows without a price a figure left out, e.g.
 * `2 holdings without a price left out.`
 *
 * Same contract as `pnlMissingSentence`: the count is interpolated RAW, singular
 * for 1, the empty string below 1 (so a 0-count sentence can never render), and
 * it carries no symbol, venue, key label or amount. Client-safe.
 */
export function priceGapSentence(count: number): string {
  if (!(count >= 1)) return "";
  return `${count} ${count === 1 ? "holding" : "holdings"} without a price left out.`;
}

/**
 * Phase 167.2.1.1.1.1 D-07 (UI-SPEC P0): the Holdings tab's note that portfolio
 * AUM excludes the rows with no price, e.g.
 * `3 holdings have no price, so portfolio AUM leaves them out.`
 *
 * Same contract as `priceGapSentence`: raw count, singular for 1, empty below 1,
 * no symbol, venue or amount.
 */
export function priceGapHoldingsNote(count: number): string {
  if (!(count >= 1)) return "";
  return count === 1
    ? `${count} holding has no price, so portfolio AUM leaves it out.`
    : `${count} holdings have no price, so portfolio AUM leaves them out.`;
}

/** Sentence-cases a clause built above, for the standalone sentence form. */
export function capitalizeFirst(clause: string): string {
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}
