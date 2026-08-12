import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 154 / WIZCONT-01 — THE single-sourced wizard-draft read.
 *
 * WHY THIS MODULE EXISTS: two entry points must offer the SAME draft. The SSR
 * page `/strategies/new/wizard` has queried it since Phase 46
 * (`page.tsx:79-89`); the `ContributionWizardOverlay` (reached from `+ Strategy`
 * and the My Strategies empty state) passed `initialDraft={null}` — an explicit
 * Phase 110 deferral. Giving the overlay its own query would create a SECOND
 * shape, and "one query shape, two callers" is the CONTEXT.md locked criterion:
 * a second divergent shape is exactly how the two paths drift apart. The query
 * body below is moved VERBATIM from `page.tsx:79-89`; the source-scan guard
 * `src/__tests__/wizard-draft-query-single-source.test.ts` reddens if the
 * `source='wizard'` + `status='draft'` pair reappears anywhere else under src/.
 *
 * SERVER-ONLY BY CONVENTION, CLIENT-IMPORTABLE BY CONSTRUCTION: this module
 * imports only TYPES (erased at build), never `@/lib/supabase/server`. That is
 * deliberate — `deriveDraftKind` / `draftMatchesSource` are pure rules the
 * CLIENT wizard also applies, so a runtime `next/headers` import here would
 * break any client component that needs them. `readLatestWizardDraft` takes its
 * client as an argument and is only ever called from a server component or a
 * route handler.
 */

/**
 * The draft shape the wizard hydrates from. Moved from
 * `…/strategies/new/wizard/page.tsx:33-47` unchanged — note it deliberately
 * does NOT carry `created_at` even though the select does (the column is the
 * ORDER key, not a form value).
 */
export interface InitialDraft {
  id: string;
  name: string | null;
  description: string | null;
  category_id: string | null;
  strategy_types: string[] | null;
  subtypes: string[] | null;
  markets: string[] | null;
  supported_exchanges: string[] | null;
  leverage_range: string | null;
  aum: number | null;
  max_capacity: number | null;
  api_key_id: string | null;
  asset_class: string | null;
}

/**
 * Which wizard BRANCH a draft belongs to.
 *
 * A4 / Pitfall W-2 (154-PATTERNS § 3), resolved here and ONLY here:
 * `api_key_id === null` is true for BOTH a CSV draft and a member-bearing
 * composite draft, so keying the branch off `api_key_id` alone would route a
 * composite draft to the CSV step. The composite discriminator that exists in
 * production today is `strategies.api_key_id IS NULL AND a strategy_keys count
 * > 0` (`keys/sync/route.ts:35`), and this is its single definition.
 */
export type WizardDraftKind = "api" | "csv" | "composite";

/** What `readLatestWizardDraft` answers with. */
export interface WizardDraftRead {
  /** The most recent wizard draft for the user, or `null` when there is none. */
  draft: InitialDraft | null;
  /** The draft's branch, or `null` when there is no draft. */
  kind: WizardDraftKind | null;
  /**
   * The draft SELECT's error, RETURNED rather than thrown.
   *
   * Deliberate asymmetry with the membership probe below. The SSR page has
   * always treated a failed draft read as "no draft, start fresh"
   * (`page.tsx:91` destructured `data` only); throwing here would turn any
   * transient `strategies` hiccup into a 500 on the whole wizard page — a
   * REGRESSION, not a fix. Callers that CAN report the failure (the route
   * handler) inspect this field and answer 500; the page keeps its existing
   * degrade-to-fresh posture.
   */
  error: PostgrestError | null;
}

/**
 * The canonical column list. Byte-identical to the pre-move `page.tsx:79-89`
 * select — do not reorder or reformat; the whole point of this module is that
 * both callers issue the SAME request.
 */
const WIZARD_DRAFT_COLUMNS =
  "id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, asset_class, created_at";

/**
 * Classify a draft into its wizard branch.
 *
 * `member_count` is REQUIRED to be a real measurement whenever `api_key_id` is
 * null. A null count with no error is unrepresentable, and `?? 0` on it would
 * fabricate "csv" for a composite draft — the same fabrication-by-another-route
 * that `keys/sync/route.ts:555-577` and `SyncPreviewStep.tsx:1400-1413` already
 * refuse. Absence is not a value: it throws.
 *
 * `member_count` is ignored (and may be null) when `api_key_id` is set — a
 * single-key draft is decided without a membership probe at all.
 */
export function deriveDraftKind(row: {
  api_key_id: string | null;
  member_count: number | null;
}): WizardDraftKind {
  if (row.api_key_id !== null) return "api";
  if (row.member_count === null) {
    throw new Error(
      "wizard draft kind is unknowable: strategy_keys count was null without an error",
    );
  }
  return row.member_count > 0 ? "composite" : "csv";
}

/**
 * The branch-matching rule: may a draft of `kind` be offered on the wizard
 * branch the user opened as `source`?
 *
 * The wizard has exactly TWO branches — `csv` and everything else ("api",
 * which is where a composite draft also resumes, since a composite is built
 * from API keys). Offering an API/composite draft on the CSV branch (or a CSV
 * draft on the API branch) resumes a user into a step their upload cannot
 * feed. One definition, two callers, for the same reason as the query.
 */
export function draftMatchesSource(
  kind: WizardDraftKind,
  source: string,
): boolean {
  return kind === "csv" ? source === "csv" : source !== "csv";
}

/**
 * Read the user's most recent wizard draft, plus its branch.
 *
 * The query body is VERBATIM from `…/strategies/new/wizard/page.tsx:79-89`.
 * The membership probe is issued ONLY when the draft has no `api_key_id`
 * (i.e. only when the CSV-vs-composite question is actually open), so the
 * single-key path still costs exactly one round trip.
 *
 * @param supabase an RLS-scoped, cookie-authenticated client. NEVER an admin
 *   client — the `user_id` predicate below is the app-layer half of a
 *   defense-in-depth pair whose other half is the `strategies` owner RLS.
 */
export async function readLatestWizardDraft(
  supabase: SupabaseClient,
  userId: string,
): Promise<WizardDraftRead> {
  const { data: draft, error } = await supabase
    .from("strategies")
    .select(WIZARD_DRAFT_COLUMNS)
    .eq("user_id", userId)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { draft: null, kind: null, error };

  const row = (draft ?? null) as InitialDraft | null;
  if (row === null) return { draft: null, kind: null, error: null };

  let memberCount: number | null = null;
  if (row.api_key_id === null) {
    // Head-count probe, mirroring `keys/sync/route.ts:547-580`
    // (`compositeMemberCount`). `head: true` means no rows cross the wire —
    // this reads a COUNT and never key material. A count error is as
    // unknowable as a null count, so both reach the throw in deriveDraftKind.
    const { count, error: countErr } = await supabase
      .from("strategy_keys")
      .select("strategy_id", { count: "exact", head: true })
      .eq("strategy_id", row.id);
    if (countErr) {
      throw new Error(
        `wizard draft kind is unknowable: strategy_keys count failed: ${countErr.message}`,
      );
    }
    memberCount = count;
  }

  return {
    draft: row,
    kind: deriveDraftKind({
      api_key_id: row.api_key_id,
      member_count: memberCount,
    }),
    error: null,
  };
}
