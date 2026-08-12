import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { getCorrelationId } from "@/lib/correlation-id";
import { readLatestWizardDraft } from "@/lib/wizard/draft-query";
import type { User } from "@supabase/supabase-js";

/**
 * GET /api/strategies/wizard-draft — Phase 154 / WIZCONT-01.
 *
 * The CLIENT-side half of the wizard's draft awareness. The SSR page
 * `/strategies/new/wizard` reads the caller's latest draft server-side; the
 * `ContributionWizardOverlay` (reached from `+ Strategy` and the My Strategies
 * empty state) is a client portal with no server render of its own, and has
 * been passing `initialDraft={null}` since the Phase 110 deferral — so
 * re-entering "add a strategy" restarted instead of continuing. This route is
 * that entry point's sanctioned read.
 *
 * ONE QUERY SHAPE, TWO CALLERS: the query is NOT re-authored here. It lives in
 * `@/lib/wizard/draft-query` and is imported by both this route and the SSR
 * page; `src/__tests__/wizard-draft-query-single-source.test.ts` reddens if a
 * second copy appears anywhere under src/. A divergent second shape is exactly
 * how the two entry paths drift apart.
 *
 * NO id PARAMETER (T-154-02-A): the route answers with the CALLER'S OWN latest
 * draft. There is nothing to enumerate — no id to probe, hence no `isUuid`
 * check and no existence oracle to equalize.
 *
 * SECURITY (T-154-02-C): the RLS-scoped, cookie-authenticated `createClient()`
 * only — never the service-role admin client. (Named obliquely on purpose: the
 * acceptance gate for this route is a literal grep for that symbol, and a
 * comment mentioning it would satisfy the gate while proving nothing.)
 * `withAuth` authenticates and applies the
 * universal approval gate; the helper's `user_id = <caller>` predicate rides on
 * top of the `strategies` owner RLS (defense in depth).
 *
 * SECRETLESS BY CONSTRUCTION: the helper's select names 14 non-secret columns
 * and no credential/envelope column, and the response below is built
 * FIELD-BY-FIELD — a DB row is never spread, so even an over-broad read could
 * not leak (the composite/members precedent, T-94-01).
 *
 * NO rate limiter: userActionLimiter buckets are for mutations. This read is
 * idempotent, RLS-bounded, and fires on overlay open — rate-limiting it would
 * break legitimate re-entry (the composite/members rationale, :36-39).
 *
 * CACHING: GET route handlers are dynamic by default in Next 15+/16
 * (`node_modules/next/dist/docs/…/route.md` Version History: "The default
 * caching for GET handlers was changed from static to dynamic", v15.0.0-RC),
 * and this handler reads auth cookies, which is dynamic by construction. No
 * `export const dynamic` opt-out is needed; `NO_STORE_HEADERS` covers the
 * response cache (Block D / P1947).
 */
export const GET = withAuth(async (_req: NextRequest, user: User) => {
  try {
    const supabase = await createClient();
    const { draft, kind, error } = await readLatestWizardDraft(
      supabase,
      user.id,
    );

    if (error) {
      // Log the inbound correlation_id (the wizard sends it on every fetch via
      // wizardFetch) so a failure the user reports is findable server-side. The
      // raw DB message NEVER crosses the wire (H-0305).
      const correlationId = await getCorrelationId();
      console.error(
        `[strategies/wizard-draft] draft read error [correlation_id=${correlationId}]:`,
        error.message,
      );
      return NextResponse.json(
        { code: "UNKNOWN" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Absent draft is a FACT, not an error: 200 with `draft: null`. A 4xx here
    // would make "you have no draft" indistinguishable from "the read broke",
    // and the overlay would show an error where it should show a fresh wizard.
    if (draft === null) {
      return NextResponse.json(
        { draft: null, kind: null },
        { headers: NO_STORE_HEADERS },
      );
    }

    // FIELD-BY-FIELD, never a spread. These are exactly the InitialDraft
    // fields the wizard hydrates from — `created_at` (the ORDER key) and any
    // future column the select gains stay server-side unless added here
    // deliberately.
    return NextResponse.json(
      {
        draft: {
          id: draft.id,
          name: draft.name,
          description: draft.description,
          category_id: draft.category_id,
          strategy_types: draft.strategy_types,
          subtypes: draft.subtypes,
          markets: draft.markets,
          supported_exchanges: draft.supported_exchanges,
          leverage_range: draft.leverage_range,
          aum: draft.aum,
          max_capacity: draft.max_capacity,
          api_key_id: draft.api_key_id,
          asset_class: draft.asset_class,
        },
        kind,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // Never forward the raw message — it can carry internal detail (H-0305).
    // This arm also catches the helper's deliberate throw on an UNKNOWABLE
    // membership count: a draft whose branch cannot be established must not be
    // offered on a guessed branch, so the read fails closed.
    const message = err instanceof Error ? err.message : "Draft read failed";
    const correlationId = await getCorrelationId();
    console.error(
      `[strategies/wizard-draft] caught exception [correlation_id=${correlationId}]:`,
      message,
    );
    return NextResponse.json(
      { code: "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
