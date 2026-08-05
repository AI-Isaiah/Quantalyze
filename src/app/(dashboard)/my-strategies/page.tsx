import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireRolePage } from "@/lib/auth/requireRolePage";
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";
import {
  getMyStrategies,
  getOwnRowPercentiles,
  getRealPortfolio,
  getStrategylessActiveKeys,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { MyStrategiesEmptyState } from "./MyStrategiesEmptyState";
import { MyStrategiesSection } from "./MyStrategiesSection";

/**
 * Phase 149 / NAV-01 — "My Strategies": the allocator's own ranking, at
 * discovery parity.
 *
 * The allocator workspace was write-only: you could add a strategy and never
 * see it again unless it was published. This surface renders every own row at
 * every non-archived status through the SAME `StrategyTable` /discovery uses —
 * same columns, same sort, same `#n` + `Pnn` presentation — plus one unranked
 * placeholder row per active key that has produced no strategy yet.
 *
 * Copy literals below are the 149-UI-SPEC Copywriting Contract, verbatim.
 */

const mapCopy = (n: number) =>
  `Ranked against ${n} published strategies. # is the row's position in this list; Pnn compares the row against those ${n} published strategies. Private and draft rows are visible only to you and do not affect public rankings.`;

const NULL_COPY =
  "Percentile ranks appear once 5 strategies are published in the comparison set. Private and draft rows are visible only to you.";

const kSentence = (k: number) => `${k} of your keys have no strategy yet.`;

export default async function MyStrategiesPage() {
  // C-0016 precedent, re-targeted: this page renders ONE owner's private and
  // draft rows. It must never be cached across users. The explicit noStore()
  // call ensures that any future `'use cache'` directive introduced anywhere in
  // this subtree fails loudly instead of silently serving one allocator's
  // unpublished strategies to another.
  noStore();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/my-strategies");
  // Phase 149 NAV-01 — allocator-owned surface, pinned in
  // requireRolePage-wiring.test.tsx. OUTSIDE any try/catch: the wrong-role
  // redirect() throws NEXT_REDIRECT.
  await requireRolePage(supabase, user, "allocator");

  // THREE fetches, and deliberately no `getPercentiles` (the I-2 single-fetch
  // ruling): the published universe is fetched ONCE, inside
  // getOwnRowPercentiles below. getPercentiles keeps its exact signature and
  // stays the discovery-surface caller of the same extracted scoring core.
  //
  // T-149-11 / T-149-14: every owner id here comes from auth.getUser(). This
  // page takes no params and no searchParams, so there is no other identity it
  // could read.
  const [strategies, bareKeys, portfolio] = await Promise.all([
    getMyStrategies(user.id),
    getStrategylessActiveKeys(user.id),
    getRealPortfolio(user.id),
  ]);

  // Sequential, not parallel: it consumes the rows the first fetch returned.
  //
  // FOUNDER SCORER RULING + W-A (2026-08-05): own rows — drafts and private
  // rows included — are scored SELF-INCLUSIVELY against the PUBLISHED
  // population via the ONE extracted core, so a draft is literally told "if
  // published, this would sit at Pnn". The population is never widened: an own
  // row's value participates only in its own score and cannot shift a public
  // rank.
  //
  // N for the copy is `own.populationSize` — byte-equal to the old
  // `Object.keys(await getPercentiles()).length`, i.e. the number of strategies
  // that ENTERED the ranking, which is exactly what the sentence claims. A
  // per-metric n can be smaller; do NOT build a per-metric N.
  const own = strategies.length > 0 ? await getOwnRowPercentiles(strategies) : null;

  // Delta 5 — formatted SERVER-side so the client table never owns exchange
  // naming (and so an unmapped code can never reach the DOM as `undefined`).
  const placeholderRows = bareKeys.map((k) => ({
    id: k.id,
    exchangeLabel: EXCHANGE_DISPLAY[k.exchange],
    keyLabel: k.label,
  }));

  const noteParts: string[] = [];
  if (strategies.length > 0) {
    // The two branches flip together with getOwnRowPercentiles' own `< 5`
    // gates, so the page can never show a Pnn while claiming there is no
    // comparison set, or vice versa.
    noteParts.push(own ? mapCopy(own.populationSize) : NULL_COPY);
  }
  if (placeholderRows.length > 0) {
    noteParts.push(kSentence(placeholderRows.length));
  }
  const noteText = noteParts.join(" ");

  const isEmpty = strategies.length === 0 && placeholderRows.length === 0;

  return (
    // Data surface fluid-fill: fill toward ~1920px then center (Phase 52
    // APPLY-01 / TYPE-03). (dashboard)/layout.tsx does NOT cap width, so the
    // cap goes here at the page shell rather than in the layout.
    <div className="mx-auto max-w-[1920px]">
      <PageHeader title="My Strategies" />
      {isEmpty ? (
        <MyStrategiesEmptyState />
      ) : (
        <>
          <p
            data-testid="comparison-set-note"
            className="mb-6 text-small text-text-secondary"
          >
            {noteText}
          </p>
          {/* Deliberately the /browse VARIANT of the table: no `userId`, no
              `initialWatchedSet`, and therefore no star column or watchlist
              tabs — starring your own upload is meaningless. The
              customize-columns / view-prefs affordances are absent for the
              same reason: parity with the closest sibling surface, not an
              omission (iteration-2 checker I-2). No `key={…}` remount prop
              either — this is a static route, not a dynamic segment. */}
          <MyStrategiesSection
            strategies={strategies}
            placeholderKeys={placeholderRows}
            portfolioId={portfolio?.id ?? null}
            percentiles={own?.ownMap ?? null}
          />
        </>
      )}
    </div>
  );
}
