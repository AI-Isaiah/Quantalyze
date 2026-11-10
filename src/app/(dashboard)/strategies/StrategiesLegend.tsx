/**
 * Phase 199 plan 14 (D-03, SC-3, UI-SPEC "Legend") - the legend under the merged
 * strategies list. One static panel explains every Health word the list can
 * print.
 *
 * Server-renderable and STATIC: it carries no client directive, no state and no
 * live region, it prints, and it renders the same entries whether or not a row
 * uses them. It is a plain square data panel (DESIGN.md), not a card, a details
 * or a tooltip.
 *
 * Five groups, and every term is the REAL component the table renders, never a
 * copy of its classes: HEALTH from `healthWord` and `HEALTH_TONE`; STATUS from
 * `STRATEGY_STATUSES` through `Badge`; TAGS from `OwnershipTag`'s label map, the
 * verified check and the compact `ReturnsUnitChip`; PIPELINE from `PIPELINE_CHIPS`;
 * KEY PILLS from `UNTRUSTED_KEY_SYNC_STATUSES` through `AllocatorSyncStatus` in its
 * pill-only mode (no helper line, so the legend never announces). Each definition
 * table is a `Record` over its source set, so a new status, mark, chip or key state
 * fails the type check until it has a sentence, and the contract test in
 * `page.merged.test.tsx` fails on any label the page renders without an entry.
 *
 * DEFINITIONS ARE CLAIMS, each checked against the code that produces the state.
 * Two UI-SPEC sentences were corrected here, never the behaviour they describe:
 * Draft and Archived (see the notes on `STATUS_DEFINITIONS`).
 *
 * The Health terms use the same functions the Health cell prints with, so the
 * cell and the legend cannot name a state differently. The two stale thresholds are INTERPOLATED from the constants the
 * list verdict reads (`SERIES_STALE_DAYS` for a crypto strategy,
 * `SERIES_STALE_DAYS_TRADITIONAL` for any other class, a missing one included),
 * never typed here: moving a threshold moves its sentence (R-05). The comparison
 * words match `listSeriesVerdict`'s operator, which reads stale when the age is
 * GREATER than the threshold, so a row is Healthy "at most" the threshold and
 * Stale "older than" it.
 */
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
import { Badge } from "@/components/ui/Badge";
import { LABELS as OWNERSHIP_LABELS, OwnershipTag } from "@/components/strategy/OwnershipTag";
import { ReturnsUnitChip } from "@/components/strategy/ReturnsUnitChip";
import { DATA_STATE_CHIP, PIPELINE_CHIPS } from "@/components/strategy/StaleSeriesChip";
import { VerifiedCheck } from "@/components/strategy/VerifiedCheck";
import { OWN_CAPITAL, TEAM_REVIEW } from "@/lib/capital-ownership";
import {
  STRATEGY_STATUSES,
  UNTRUSTED_KEY_SYNC_STATUSES,
  type StrategyStatus,
  type UntrustedKeySyncStatus,
} from "@/lib/closed-sets";
import { SERIES_STALE_DAYS, SERIES_STALE_DAYS_TRADITIONAL } from "@/lib/freshness";
import {
  HEALTH_TONE,
  healthWord,
  type StrategyHealthKind,
} from "@/lib/strategy-health";
import { cn } from "@/lib/utils";

/** `Stale (no data since <day>)` carries a per-row date, so its term is the pattern. */
const STALE_TERM = "Stale (no data since …)";

const OTHER_CLASSES = `for a crypto strategy, or ${SERIES_STALE_DAYS_TRADITIONAL} days for any other`;

interface HealthLegendEntry {
  /** The Health kinds this entry explains (`stale_no_data` shares the Stale entry). */
  kinds: readonly StrategyHealthKind[];
  /** The tone the cell prints the word in. */
  tone: string;
  term: string;
  definition: string;
}

/** Exported so the contract test can require an entry for every Health kind. */
export const HEALTH_LEGEND: readonly HealthLegendEntry[] = [
  {
    kinds: ["healthy"],
    tone: HEALTH_TONE.healthy,
    term: healthWord({ kind: "healthy", staleSince: null }),
    definition: `Analytics are computed and the newest data point is at most ${SERIES_STALE_DAYS} days old ${OTHER_CLASSES}.`,
  },
  {
    kinds: ["updating"],
    tone: HEALTH_TONE.updating,
    term: healthWord({ kind: "updating", staleSince: null }),
    definition:
      "A computation is queued or running. Any figures shown are from the last completed computation.",
  },
  {
    kinds: ["stale", "stale_no_data"],
    tone: HEALTH_TONE.stale,
    term: STALE_TERM,
    definition: `The newest data point is older than ${SERIES_STALE_DAYS} days ${OTHER_CLASSES}. The date is the last day with data. "No data yet" means nothing has been computed and nothing is running.`,
  },
  {
    kinds: ["analytics_failed"],
    tone: HEALTH_TONE.analytics_failed,
    term: healthWord({ kind: "analytics_failed", staleSince: null }),
    definition:
      "The last computation did not produce figures. The note under the row says what to do.",
  },
  {
    kinds: ["key_problem"],
    tone: HEALTH_TONE.key_problem,
    term: healthWord({ kind: "key_problem", staleSince: null }),
    definition:
      "An exchange key feeding this strategy is revoked or can no longer sign in. The note under the row names the key.",
  },
  {
    kinds: ["not_judged"],
    tone: HEALTH_TONE.not_judged,
    term: healthWord({ kind: "not_judged", staleSince: null }),
    definition:
      "Not judged: the strategy is archived, the row has no strategy yet, the newest date cannot be trusted, or key status could not be checked.",
  },
];

/**
 * Checked against the visibility rules (`shareAffordanceMode`: every UNPUBLISHED row
 * can mint a private link) and the owner list read (archived rows stay on it).
 * Two sentences differ from UI-SPEC for that reason:
 *  - Draft said "Visible only to you", but a draft can be shared by private link
 *    like any unpublished row, so it now says so.
 *  - Archived said "Shown only on this page", but a private link still opens an
 *    archived row, so it now claims only what the code guarantees: gone from
 *    Discovery, still listed here.
 */
const STATUS_DEFINITIONS = {
  published: "Listed in Discovery and ranked against other published strategies.",
  pending_review: "Submitted and waiting for our review before it can be published.",
  draft: "Not submitted yet. Visible only to you, and to anyone you send a private link.",
  private: "Visible only to you and anyone you send a private link. Not ranked publicly.",
  archived: "Withdrawn from Discovery. It stays listed on this page.",
} as const satisfies Record<StrategyStatus, string>;

// Keyed by the named constants, never the spelled literals: the mark literal
// lives in `capital-ownership.ts` alone (phase-150 invariant P1).
const OWNERSHIP_DEFINITIONS = {
  [OWN_CAPITAL]:
    "You marked this strategy as your own capital. Only these strategies can take an allocation.",
  [TEAM_REVIEW]:
    "You marked this strategy as a trading team's key you are reviewing, not your own capital.",
} as const satisfies Record<keyof typeof OWNERSHIP_LABELS, string>;

const PIPELINE_DEFINITIONS = {
  syncing: "First metrics arrive about 10–15 minutes after a key connects.",
  no_data: "No figures yet, and no computation is running.",
  no_strategy_yet: "A connected key with no strategy. Finish setup creates one.",
} as const satisfies Record<keyof typeof PIPELINE_CHIPS, string>;

const KEY_PILL_DEFINITIONS = {
  revoked: "The exchange revoked this key. Re-add a read-only key from your exchange.",
  sign_in_failed:
    "This account's credentials no longer work. Update them; they may have changed.",
} as const satisfies Record<UntrustedKeySyncStatus, string>;

/** One group: a micro mono eyebrow, then a `<dl>` of term/definition rows. */
function LegendGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-legend-group={title}>
      <p className="mb-2 font-mono text-micro font-semibold uppercase tracking-[0.18em] text-text-muted">
        {title}
      </p>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

/** One row: the term (a real component, exactly as the table renders it) and its definition. */
function LegendRow({
  term,
  children,
}: {
  term: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt>{term}</dt>
      <dd className="text-caption text-text-secondary">{children}</dd>
    </div>
  );
}

export function StrategiesLegend() {
  return (
    <section
      aria-labelledby="strategies-legend-heading"
      id="strategies-legend"
      className="mt-6 border border-border bg-surface px-4 py-4"
    >
      {/* The container host is an ANCESTOR of the grid: a container query
          answers to its ancestor, never to the element it styles. */}
      <div className="@container">
        <h2
          id="strategies-legend-heading"
          className="mb-3 font-mono text-micro font-semibold uppercase tracking-[0.18em] text-text-muted"
        >
          Legend
        </h2>
        <div
          data-legend-grid
          className="grid grid-cols-1 gap-x-8 gap-y-3 @lg:grid-cols-2 @4xl:grid-cols-4"
        >
          <LegendGroup title="Health">
            {HEALTH_LEGEND.map((e) => (
              <LegendRow
                key={e.term}
                term={<span className={cn("text-caption font-semibold", e.tone)}>{e.term}</span>}
              >
                {e.definition}
              </LegendRow>
            ))}
          </LegendGroup>
          <LegendGroup title="Status">
            {STRATEGY_STATUSES.map((status) => (
              <LegendRow key={status} term={<Badge type="status" label={status} />}>
                {STATUS_DEFINITIONS[status]}
              </LegendRow>
            ))}
          </LegendGroup>
          <LegendGroup title="Tags">
            {(Object.keys(OWNERSHIP_LABELS) as Array<keyof typeof OWNERSHIP_LABELS>).map((mark) => (
              <LegendRow key={mark} term={<OwnershipTag mark={mark} />}>
                {OWNERSHIP_DEFINITIONS[mark]}
              </LegendRow>
            ))}
            <LegendRow term={<VerifiedCheck />}>
              Verified via exchange API: the data comes from a read-only exchange key.
            </LegendRow>
            <LegendRow term={<ReturnsUnitChip unit="BTC" variant="compact" />}>
              Returns are measured in BTC, not USD.
            </LegendRow>
          </LegendGroup>
          <LegendGroup title="Pipeline">
            {(Object.keys(PIPELINE_CHIPS) as Array<keyof typeof PIPELINE_CHIPS>).map((key) => (
              <LegendRow
                key={key}
                term={
                  <span className={`${DATA_STATE_CHIP} ${PIPELINE_CHIPS[key].tone}`}>
                    {PIPELINE_CHIPS[key].label}
                  </span>
                }
              >
                {PIPELINE_DEFINITIONS[key]}
              </LegendRow>
            ))}
          </LegendGroup>
          <LegendGroup title="Key pills">
            {UNTRUSTED_KEY_SYNC_STATUSES.map((status) => (
              <LegendRow
                key={status}
                term={
                  <AllocatorSyncStatus
                    pillOnly
                    subject="strategy-key"
                    syncStatus={status}
                    syncError={null}
                    lastSyncAt={null}
                    exchange=""
                  />
                }
              >
                {KEY_PILL_DEFINITIONS[status]}
              </LegendRow>
            ))}
          </LegendGroup>
        </div>
      </div>
    </section>
  );
}
