/**
 * F4b — Strategy-row adapter for the Holdings tab.
 *
 * Phase 150 / OWN-03 made this row set UNION-shaped (D-12-A):
 *
 *     rows = (own-capital MARKED strategies) ∪ (this portfolio's POSITIONS)
 *
 * joined by strategy id. Both halves matter:
 *
 *   - A marked strategy with NO position is the whole point of the phase —
 *     it is what the allocator clicks `Allocate…` on. It has no
 *     `portfolio_strategies` row, so it cannot be reached by widening the
 *     position-rooted dashboard embed.
 *   - A position whose strategy is NOT marked KEEPS its row. Allocated money
 *     never leaves the money surface just because nobody has answered the
 *     capital question for it yet. Such a row carries `capitalOwnership:
 *     null`, and Plan 07 renders it WITHOUT the Allocate/Edit affordance.
 *     The remedy is one click (the Mark-ownership dialog) where the viewer
 *     owns the strategy; where it is third-party-owned there is no remedy and
 *     none is needed — the allocator cannot mark someone else's strategy.
 *
 * Discipline (mirrors `holdings-adapter.ts`):
 *   - pure: zero I/O, zero DOM access
 *   - `now` is an injectable input for deterministic age math in tests
 *   - disclosure-tier redaction is preserved for THIRD-PARTY rows: their name
 *     routes through `displayStrategyName` (alias wins, then codename, then a
 *     synthetic id) and `manager` consumes the already-server-redacted
 *     `organization_name`. The owner-name carve-out below is scoped to the
 *     marked set and cannot reach them.
 */

import type {
  MyAllocationDashboardPayload,
  OwnCapitalStrategy,
} from "@/lib/queries";
import type { DisclosureTier } from "@/lib/types";
import { displayStrategyName } from "@/lib/strategy-display";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { OWN_CAPITAL, isAllocatable } from "@/lib/capital-ownership";

type PositionRow = MyAllocationDashboardPayload["strategies"][number];

export interface StrategyRow {
  /** Stable React key — the strategy id. Dialogs use this; there is no second id field. */
  id: string;
  /** Display name: alias wins, then the OWNER's real name, then tier-aware `displayStrategyName`. */
  strategy: string;
  /**
   * Managing org/team. `organization_name` is already server-redacted (null
   * on non-institutional rows); fall through to `codename` (the safe
   * pseudonym), then null. Never leaks manager identity on exploratory tiers.
   */
  manager: string | null;
  /**
   * Phase 150 / OWN-03 — is this row's strategy marked as the viewer's OWN
   * capital? Derived from membership of the marked set, which is owner-scoped
   * by construction (`getOwnCapitalStrategies` filters on `user_id`).
   *
   * `null` means positioned-but-unmarked: render the money, render no tag,
   * offer no allocate affordance.
   */
  capitalOwnership: typeof OWN_CAPITAL | null;
  /**
   * RENDER-DERIVED share of allocated capital (D-12-B):
   * `allocation / Σ allocation` across the ALLOCATED OWN-CAPITAL rows.
   *
   * ⛔ This is NOT `portfolio_strategies.current_weight`, and that column is
   * deliberately never read here. It has no writer anywhere in the repo, and
   * two analytics consumers substitute `1.0` for a NULL weight and then
   * renormalize — so a display that read it would show a stale/absent number
   * while any write to it would silently distort `portfolio_returns_series`
   * and match scoring (150-RESEARCH § Schema Findings 2). Deriving the
   * display value is what lets the column stay writer-free until Phase 151.
   *
   * `null` for unallocated rows, non-own-capital rows, and a zero
   * denominator — never a fabricated 0.
   */
  weight: number | null;
  /** Allocated amount in USD (`allocated_amount`), or null when not allocated. */
  allocation: number | null;
  /** Month-to-date return derived from daily_returns. Null when no data. */
  mtd: number | null;
  sharpe: number | null;
  maxDd: number | null;
  /**
   * Whole days since `added_at`, clamped to >= 0 (defensive vs clock skew).
   *
   * `null` for a marked strategy with no position: there is no `added_at` to
   * derive from, and defaulting to 0 would render "added today" about a
   * strategy that was never added (no-invented-data). `formatDays` and
   * `compareStrategyRows` are both already null-safe.
   */
  age: number | null;
}

export interface StrategyRowAdapterInputs {
  /** The own-capital MARKED strategies (`getOwnCapitalStrategies`). */
  strategies: OwnCapitalStrategy[];
  /**
   * This portfolio's `portfolio_strategies` rows. REQUIRED: the union has two
   * halves and a caller that omits one is asking for a row set that silently
   * drops allocated money (D-12-A). Pass `[]` to mean "no positions".
   */
  positions: MyAllocationDashboardPayload["strategies"];
  /** Injectable "now" for deterministic age math. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Month-to-date return from the strategy's `daily_returns` series.
 *
 * Mirrors the Python `compute_period_returns` MTD contract
 * (`analytics-service/services/portfolio_metrics.py`): anchor on the LAST
 * OBSERVED date in the series (not the wall clock), take the first calendar
 * day of that date's month, and compound every daily return on or after it:
 * `(1 + r1)·(1 + r2)·… − 1`. `normalizeDailyReturns` handles the nested
 * year-keyed JSONB shape and returns a date-ascending `{date, value}[]`.
 *
 * Review round 3 E2 — EXPORTED so `getOwnCapitalStrategies` can call it
 * SERVER-side and emit the scalar, instead of serializing a multi-year return
 * series across the RSC boundary for every marked strategy just so this
 * function can run in the browser. ONE definition, two call sites — never a
 * second implementation (the phase-147 SC2 lesson). The import direction
 * (`src/lib/queries.ts` → this module) is the established one: queries.ts:23
 * already imports `deriveSnapshotDrawdowns` from a sibling `allocations/lib`
 * module. It is cycle-free because this module's only `@/lib/queries` import is
 * `import type`, which is erased at runtime.
 */
export function computeMtd(rawDailyReturns: unknown): number | null {
  const points = normalizeDailyReturns(rawDailyReturns);
  if (points.length === 0) return null;
  const lastDate = points[points.length - 1].date; // "YYYY-MM-DD", sorted asc
  const monthStart = `${lastDate.slice(0, 7)}-01`; // first day of last month
  const slice = points.filter((p) => p.date >= monthStart);
  if (slice.length === 0) return null;
  let compound = 1;
  for (const p of slice) {
    if (Number.isFinite(p.value)) compound *= 1 + p.value;
  }
  const mtd = compound - 1;
  return Number.isFinite(mtd) ? mtd : null;
}

export function toStrategyRows(inputs: StrategyRowAdapterInputs): StrategyRow[] {
  const nowMs = (inputs.now ?? new Date()).getTime();

  const marked = inputs.strategies ?? [];
  const positions: PositionRow[] = inputs.positions ?? [];

  const markedById = new Map(marked.map((s) => [s.id, s]));

  const rows: StrategyRow[] = [];
  const seen = new Set<string>();

  // ── Half 1: the positions, exactly as they entered before this phase ─────
  for (const ps of positions) {
    const s = ps.strategy;
    const owned = markedById.get(ps.strategy_id);

    // OWN-05 SC 1c — the owner-name carve-out.
    //
    // `displayStrategyName` can never return `name` for a wizard-created
    // strategy (codename NULL + tier 'exploratory' ⇒ the synthetic
    // `Strategy #<id8>` branch), so without this the founder's own renamed
    // strategy renders as an opaque id on their own book — the 2026-08-05
    // holdings-confusion mechanism.
    //
    // The precedent and its security argument are `browse/route.ts:44-56`:
    // preferring the owner's real name "widens disclosure to nobody — the
    // owner already knows their own name + codename". Note the SCOPE: the
    // carve-out is gated on marked-set membership, and the marked set is
    // `user_id`-filtered server-side, so it is reachable ONLY for the viewer's
    // own strategies. A third-party exploratory row still redacts to its
    // codename; pairing a real name with a codename would defeat pseudonymity.
    const strategy =
      ps.alias?.trim() ||
      owned?.name ||
      displayStrategyName({
        id: s.id,
        name: s.name,
        codename: s.codename ?? null,
        disclosure_tier: (s.disclosure_tier ?? null) as DisclosureTier | null,
      });

    // organization_name is already null for non-institutional rows
    // (server-side redaction); codename is the safe public pseudonym.
    const manager = s.organization_name ?? s.codename ?? null;

    const ageMs = nowMs - new Date(ps.added_at).getTime();
    const age = ageMs >= 0 ? Math.floor(ageMs / 86_400_000) : 0;

    rows.push({
      id: ps.strategy_id,
      strategy,
      manager,
      // Fails CLOSED via the single-source predicate: a garbled value off the
      // untyped `text` column must not unlock the money affordance, even if
      // the server-side filter that produced the marked set ever drifts.
      capitalOwnership: isAllocatable(owned?.capital_ownership ?? null)
        ? OWN_CAPITAL
        : null,
      weight: null, // derived in the post-pass below
      allocation: ps.allocated_amount,
      mtd: computeMtd(s.strategy_analytics?.daily_returns),
      sharpe: s.strategy_analytics?.sharpe ?? null,
      maxDd: s.strategy_analytics?.max_drawdown ?? null,
      age,
    });
    seen.add(ps.strategy_id);
  }

  // ── Half 2: marked strategies with no position yet ───────────────────────
  for (const s of marked) {
    if (seen.has(s.id)) continue;
    rows.push({
      id: s.id,
      // Same carve-out; here there is no alias, because an alias lives on the
      // position row this strategy does not have.
      strategy:
        s.name ||
        displayStrategyName({
          id: s.id,
          name: s.name,
          codename: s.codename ?? null,
          disclosure_tier: (s.disclosure_tier ?? null) as DisclosureTier | null,
        }),
      // Review round 3 E3 — this comment used to promise an honest `—`, but the
      // line has always read `codename`, and every finalized strategy is
      // assigned one, so the Manager cell renders the codename. The CODENAME is
      // what is right for the user, and the comment is what was wrong: half 1
      // above resolves `organization_name ?? codename ?? null`, and for the
      // owner's own strategy `organization_name` is null (non-institutional
      // redaction) — so it lands on the codename too. Dropping to `null` here
      // would make the SAME strategy render "—" while unallocated and its
      // codename the moment money is placed behind it: a cell that changes
      // meaning on an unrelated event. The codename is also the only manager
      // identity that exists for a self-managed strategy — never a fabrication
      // (150-RESEARCH § Schema Findings 7), just the safe pseudonym, and `null`
      // still falls through to the honest em-dash when there is no codename yet.
      manager: s.codename ?? null,
      capitalOwnership: isAllocatable(s.capital_ownership) ? OWN_CAPITAL : null,
      weight: null,
      allocation: null, // not allocated — NOT 0
      // Review round 3 E2 — SERVER-computed by the same `computeMtd`
      // (`getOwnCapitalStrategies`), so the multi-year series it reduces never
      // crosses the RSC boundary. Half 1 above still calls it inline: that half
      // reads the dashboard payload's own embed, which is not this phase's to
      // change.
      mtd: s.mtd,
      sharpe: s.strategy_analytics?.sharpe ?? null,
      maxDd: s.strategy_analytics?.max_drawdown ?? null,
      age: null, // no added_at — NOT 0 ("added today" would be invented)
    });
  }

  // ── D-12-B: derive the weights ───────────────────────────────────────────
  // Pure post-pass over the assembled rows. The denominator is the ALLOCATED
  // OWN-CAPITAL set — which is exactly what the column header names ("share of
  // allocated capital"). An unmarked positioned row's money shows in the
  // Allocation column but is NOT in this denominator, because the share being
  // reported is a share of the capital the allocator has consciously placed.
  let allocatedOwnTotal = 0;
  for (const row of rows) {
    if (row.capitalOwnership === OWN_CAPITAL && row.allocation != null) {
      allocatedOwnTotal += row.allocation;
    }
  }
  if (allocatedOwnTotal > 0) {
    for (const row of rows) {
      if (row.capitalOwnership === OWN_CAPITAL && row.allocation != null) {
        row.weight = row.allocation / allocatedOwnTotal;
      }
    }
  }

  return rows;
}
