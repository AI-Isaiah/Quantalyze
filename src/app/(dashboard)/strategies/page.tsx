import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StrategyActions } from "@/components/strategy/StrategyActions";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { StrategiesSection } from "./StrategiesSection";
import { StrategiesLegend } from "./StrategiesLegend";
import { StrategiesEmptyState } from "./StrategiesEmptyState";
import { kSentence, mapCopy, NULL_COPY } from "./comparison-note";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
// Server component: import the predicate from the NON-client module. Importing
// it from ShareableLink.tsx compiles but throws at request time.
import { isPublishedStatus, shareAffordanceMode } from "@/lib/share-affordance";
// Same rule for the Phase 167.2 predicates and copy: every module CALLED here
// carries no client directive. AllocatorSyncStatus is only RENDERED.
import { EXCHANGE_DISPLAY, isComputedAnalytics, isUntrustedKeySyncStatus } from "@/lib/closed-sets";
import {
  deriveComputeState,
  recipientArm,
  selectFactsheetJob,
  type ComputeJobRow,
  type ComputeState,
  type RecipientArm,
} from "@/lib/compute-state";
import { readOwnerComputeJobs } from "@/lib/compute-jobs-read";
import {
  compositeHistoryOf,
  resolveStrategyShape,
  shouldPreferStitch,
  type CompositeHistory,
  type CompositeMemberCount,
  type StrategyShape,
} from "@/lib/strategy-shape";
import { captureToSentry } from "@/lib/sentry-capture";
// Phase 170.7 (D-01, D-03): the owner list is read through the SAME explicit
// ranking allowlist Discovery uses and shaped by the SAME shaper, so a strategy
// with no analytics (or a failed run) reads a dash and never a number.
import {
  CATEGORY_RANKING_ANALYTICS_COLUMNS,
  getOwnRowPercentiles,
  getRealPortfolio,
  getStrategylessActiveKeys,
  readPublicVerificationSignals,
  shapeRowAnalytics,
} from "@/lib/queries";
import { extractAnalytics, formatDay } from "@/lib/utils";
import type { Strategy } from "@/lib/types";
import {
  ownerRemedy,
  probeUnreadableShareNote,
  recipientShareNoteFor,
  unbuildableNoteKindOf,
  untrustedKeyCaption,
} from "@/lib/status-surface-copy";
// Phase 167.2.1 (D-04, D-08): the builder's own resolve stage, so the list and
// the share page decide "can this factsheet build?" from the same code.
import {
  FactsheetProbeTimeoutError,
  probeFactsheetBuildable,
} from "@/lib/factsheet/fetch-and-build-payload";
import { withPublishedOrOwner } from "@/lib/visibility";
import { PendingIntros } from "@/components/strategy/PendingIntros";
import Link from "next/link";
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";
import { redirect } from "next/navigation";
import { roleSurfaceHome } from "@/lib/routing/role-home";
import { apiKeyLabelById } from "@/lib/api-key-label";
import { DegradeLine } from "@/components/degrade/DegradeLine";
import {
  degradeSegments,
  viewerRemedyAction,
  type StaleAction,
} from "@/lib/degrade-warnings";
import {
  HEALTH_TONE,
  healthWord,
  rowChipStatus,
  strategyHealthOf,
  type StrategyHealth,
} from "@/lib/strategy-health";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 167.2 / KCS-06 — the key-status projection this page reads. An
 * ALLOWLIST of the six columns the pill and its caption need: `api_keys` is
 * column-granted, and the encrypted columns must never ride a wide select.
 * Phase 199 plan 12 (T-199-18) adds `label` only (the key's nickname, in
 * `API_KEY_USER_COLUMNS_ARR`), so the caption can name the key.
 */
const KEY_STATUS_COLUMNS = "id, exchange, label, sync_status, sync_error, last_sync_at";

interface KeyStatusRow {
  id: string;
  exchange: string;
  label: string;
  sync_status: string | null;
  sync_error: string | null;
  last_sync_at: string | null;
}

interface StrategyKeyMemberRow {
  strategy_id: string;
  api_key_id: string;
  seq: number;
}

/**
 * Phase 170.7 — one row of the owner list read: the whole `strategies` row
 * (`select("*")`, owner-scoped) plus the columns the page itself reads, and the
 * ranking embed as `unknown` (postgrest-js cannot type the `->-1->>` alias, so
 * the result is cast the way `getMyStrategies` casts it).
 */
type OwnerListRow = Strategy & {
  review_note: string | null;
  source: string;
  strategy_analytics: unknown;
};

/** One S4 line: one untrusted status, the keys in it, the first key seen. */
interface UntrustedKeyLine {
  status: string;
  caption: string;
  first: KeyStatusRow;
}

/**
 * KCS-06 — the S4 lines for one row: its feeding keys that are untrusted
 * (`isUntrustedKeySyncStatus`, never a local equality), grouped by status in
 * first-seen order over `feedingKeyIds`. The pill's error, time and exchange
 * come from the first key seen in that status; the caption names every key in
 * it by its `keyLabels` entry (Phase 199 plan 12: built once per page by
 * `apiKeyLabelById`, never joined by hand). A key id with no row read (not the
 * owner's, or the read failed) contributes nothing: no guessed pill.
 */
function untrustedKeyLines(
  feedingKeyIds: readonly string[],
  keysById: ReadonlyMap<string, KeyStatusRow>,
  keyLabels: ReadonlyMap<string, string>,
): UntrustedKeyLine[] {
  const groups = new Map<string, KeyStatusRow[]>();
  for (const id of feedingKeyIds) {
    const key = keysById.get(id);
    if (!key || !isUntrustedKeySyncStatus(key.sync_status)) continue;
    const group = groups.get(key.sync_status);
    if (group) group.push(key);
    else groups.set(key.sync_status, [key]);
  }
  return [...groups].map(([status, keys]) => ({
    status,
    // `keyLabels` is built over the same rows as `keysById`, so a read key
    // always has a label; the fallback is the masked-tail shape, never a raw id.
    caption: untrustedKeyCaption(
      keys.map((k) => keyLabels.get(k.id) ?? `${k.exchange} \u2014 \u2022\u2022\u2022\u2022`),
    ),
    first: keys[0],
  }));
}

/**
 * KCS-12 — the embedded analytics status. PostgREST hands a 1:1 embed back as
 * an object or a one-element array; a row with no analytics is null.
 */
function computationStatusOf(embed: unknown): string | null {
  const row = Array.isArray(embed) ? embed[0] : embed;
  const status = (row as { computation_status?: unknown } | null | undefined)
    ?.computation_status;
  return typeof status === "string" ? status : null;
}

/**
 * KCS-12 — what a recipient of this strategy's link sees right now, by the
 * SAME derivation the share page uses (`deriveComputeState` → `recipientArm`),
 * so the note and the page cannot disagree. One RPC per strategy, filtered by
 * `p_strategy_id` (never one unfiltered call: the window would be shared across
 * rows). The RPC is owner-scoped (SECURITY DEFINER, resolves auth.uid()).
 * ⛔ error-absent ≠ legit-absent: an error, an answer that is not a rows array,
 * or a throw derives `unreadable`, is logged, and is never an in-progress
 * claim. The server clock is read here, never in the component.
 *
 * 170.1 D-08 / R-1: returns the ComputeState beside the arm. The arm is
 * three-valued and `failed`, `stalled`, `finished` and `never_started` all map
 * to `not_available`, so a note that depends on "the jobs FINISHED" must read
 * `state.state`, never the arm.
 *
 * Phase 199 plan 16 (D-03): also returns what the Analytics failed detail needs
 * from the SAME read, so a row never reads its jobs twice: the day of the factsheet
 * job the state was derived from (`jobDayOf`) and the composite history (the
 * input of the row's shape, so a remedy never names a control the shape lacks).
 * A failed read has neither (`jobDay` null, history `unreadable`).
 */
interface ArmFacts {
  arm: RecipientArm;
  state: ComputeState | null;
  /** The last computation's UTC day (`YYYY-MM-DD`), or null when it could not be read. */
  jobDay: string | null;
  compositeHistory: CompositeHistory;
}

/**
 * The UTC day of a compute job: `claimed_at`, else `created_at` (UI-SPEC "Row note, the
 * Health detail"). Null for no job, an absent timestamp or one that does not parse, so
 * the caller prints the unreadable sentence and never a guessed day.
 */
function jobDayOf(job: ComputeJobRow | null | undefined): string | null {
  const raw = job?.claimed_at ?? job?.created_at;
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

async function readRecipientArm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  strategyId: string,
  // 167.2-REVIEW IN-03 / 167.2-REVIEW-R2 IN-05: the inputs of
  // `shouldPreferStitch`. A zero member count drops stitch preference only
  // for a proven single-key strategy (a linked key, or no stitch in the rows
  // read below), because RLS can fabricate a zero count.
  stitchInputs: { memberCount: CompositeMemberCount; apiKeyId: string | null },
): Promise<ArmFacts> {
  // 167.2-REVIEW-SFH M-5: the shared bounded read, which re-asks once at the
  // RPC's cap when the first window is full of non-chain rows. A throw is
  // folded into the same failed-read arm.
  // Precondition (SFH L-3): the page redirected above unless `getUser()`
  // resolved a user, so an empty answer here is not a missing session.
  let read: Awaited<ReturnType<typeof readOwnerComputeJobs>>;
  try {
    read = await readOwnerComputeJobs(
      supabase as unknown as SupabaseClient,
      strategyId,
    );
  } catch (err) {
    read = {
      ok: false,
      code: undefined,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!read.ok) {
    console.error("[strategies/page] compute-state read failed", {
      id: strategyId,
      code: read.code,
      message: read.message,
    });
    // 167.2-REVIEW-SFH M-6: captured like the owner factsheet's identical read
    // (`readOwnerPendingStatus`), so the surfaces built to agree also agree on
    // observability. Tags only; the id stays in the server log.
    captureToSentry(new Error(read.message), {
      tags: { route: "strategies/page", stage: "compute-state" },
    });
    const state = deriveComputeState({ readError: true });
    return {
      arm: recipientArm(state),
      state,
      jobDay: null,
      compositeHistory: "unreadable",
    };
  }
  if (read.windowFull) {
    // Deterministic, and a reload cannot fix it, so it is logged and captured
    // as its own case rather than folded silently into `unreadable`.
    console.error("[strategies/page] compute-state window full", {
      id: strategyId,
      rows: read.rows.length,
    });
    captureToSentry(
      new Error("compute job window full at the RPC cap with no factsheet-chain job"),
      { tags: { route: "strategies/page", stage: "compute-state-window-full" } },
    );
  }
  const nowMs = Date.now();
  const compositeHistory = compositeHistoryOf(read);
  const preferStitch = shouldPreferStitch({ ...stitchInputs, compositeHistory });
  const state = deriveComputeState({
    rows: read.rows,
    readExhaustive: read.readExhaustive,
    nowMs,
    preferStitch,
  });
  // The same selection `deriveComputeState` made, so the day is the day of the job
  // the state describes.
  const jobDay = jobDayOf(selectFactsheetJob(read.rows, { preferStitch, nowMs }));
  return { arm: recipientArm(state), state, jobDay, compositeHistory };
}

/**
 * 167.2.1-REVIEW WR-01 — how many buildability probes one page load runs at
 * once. Each probe is a service-role read of the strategy row with its largest
 * JSON columns (`daily_returns`, `returns_series`, `metrics_json_by_basis`),
 * plus up to 20,000 `csv_daily_returns` rows for a composite. The list has no
 * pagination, so an unbounded fan-out fired one such read per computed row at
 * once on the dashboard's landing page, and pooler exhaustion then read as a
 * failed check on every row.
 */
const PROBE_CONCURRENCY = 4;

/**
 * A FIFO slot limiter: at most `limit` tasks run at once, the rest wait in
 * arrival order. A finishing task hands its slot straight to the next waiter
 * (`active` is not decremented then), so a caller arriving in between cannot
 * take the slot too and push the count past `limit`.
 */
function concurrencyLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * 167.2.1-REVIEW-R2 WR-01 / SFH-R2 N-1 — the probe answers Sentry should hear
 * about, counted over one page load. The resolve stage no longer captures for
 * a probe (it captures for a factsheet BUILD only), because pool saturation
 * arrives as a returned `read_error`, one per computed row, and durable data
 * states (`composite_unbuildable`, `malformed_series`) recur on every
 * navigation. The page sends ONE event carrying the counts instead.
 * `not_visible`, `not_computed` and `too_few_points` are not counted: the
 * first two are races logged at warn, the last is an honest data fact.
 * `timeout` (SFH-R2 N-3) is a probe that missed its deadline
 * (`FactsheetProbeTimeoutError`): an outage signal, counted here and never
 * grouped with the code throws.
 */
const COUNTED_PROBE_REASONS = ["read_error", "composite_unbuildable", "malformed_series", "timeout"] as const;
type CountedProbeReason = (typeof COUNTED_PROBE_REASONS)[number];

interface ProbeOutcomeTally {
  counts: Record<CountedProbeReason, number>;
  /** read_error rows per PostgREST / SQLSTATE code. */
  readErrorCodes: Map<string, number>;
  /** composite_unbuildable and malformed_series rows per `reason:gate`. */
  gates: Map<string, number>;
  /** malformed_series rows per counted column (SFH-R2 N-5). */
  sources: Map<string, number>;
}

function newProbeOutcomeTally(): ProbeOutcomeTally {
  return {
    counts: { read_error: 0, composite_unbuildable: 0, malformed_series: 0, timeout: 0 },
    readErrorCodes: new Map(),
    gates: new Map(),
    sources: new Map(),
  };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * `key:count` pairs, largest first, as one tag value. A code is a short
 * PostgREST / SQLSTATE token; anything else is reduced to that shape, and the
 * list is capped, so the tag stays inside Sentry's value limit.
 */
function formatCounts(map: ReadonlyMap<string, number>, cap = 10): string {
  return [...map]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([k, n]) => `${k.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 16)}:${n}`)
    .join(",");
}

/** One event for the page load, or none when nothing was counted. */
function captureProbeOutcomes(tally: ProbeOutcomeTally): void {
  const total = COUNTED_PROBE_REASONS.reduce((sum, r) => sum + tally.counts[r], 0);
  if (total === 0) return;
  const tags: Record<string, string> = {
    route: "strategies/page",
    stage: "factsheet-probe-outcomes",
    counted_rows: String(total),
  };
  for (const reason of COUNTED_PROBE_REASONS) tags[reason] = String(tally.counts[reason]);
  if (tally.readErrorCodes.size > 0) tags.read_error_codes = formatCounts(tally.readErrorCodes);
  // A composite refusal alone is a warning, as the build's own capture is. An
  // outage (a read error, a timeout) or a writer defect is an error.
  const level =
    tally.counts.read_error > 0 || tally.counts.malformed_series > 0 || tally.counts.timeout > 0
      ? "error"
      : "warning";
  captureToSentry(
    new Error("factsheet probe: computed rows could not be confirmed buildable on one page load"),
    {
      level,
      tags,
      extra: {
        gates: Object.fromEntries(tally.gates),
        malformedSources: Object.fromEntries(tally.sources),
      },
    },
  );
}

/**
 * 167.2.1-REVIEW-SFH-R2 N-2 — at most this many throw events per page load.
 */
const MAX_PROBE_THROW_EVENTS = 3;

/**
 * 167.2.1-REVIEW WR-01, SFH-R2 N-2 — the probes that THREW on one page load,
 * grouped by error name and message, one event per group. Sending only the
 * first throw let whichever cause finished first hide every other one: a
 * transient `fetch failed` could mask a `TypeError` from a code regression,
 * and the issue changed identity between loads. The largest groups go first,
 * capped at `MAX_PROBE_THROW_EVENTS`; every event carries the load's total
 * (`probe_throws`), its number of distinct causes (`probe_throw_kinds`) and its
 * own group's size (`group_throws`). The per-row console lines keep the ids.
 */
function captureProbeThrows(throws: readonly unknown[]): void {
  if (throws.length === 0) return;
  const groups = new Map<string, { error: Error; count: number }>();
  for (const thrown of throws) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    const key = `${error.name}:${error.message.slice(0, 80)}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { error, count: 1 });
  }
  // A stable sort: equal groups keep first-seen order.
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count);
  for (const group of ranked.slice(0, MAX_PROBE_THROW_EVENTS)) {
    captureToSentry(group.error, {
      tags: {
        route: "strategies/page",
        stage: "factsheet-probe",
        probe_throws: String(throws.length),
        probe_throw_kinds: String(groups.size),
        group_throws: String(group.count),
      },
    });
  }
}

/**
 * Phase 170.1 D-07 — the wizard's submit lands here with `?wizard_submitted=1`.
 * `searchParams` is a Promise in Next 16.
 */
interface StrategiesPageProps {
  searchParams: Promise<{ wizard_submitted?: string | string[] }>;
}

// 170.1.1 D-06: distinct from /my-strategies ("My strategies" tab title, "My Strategies" H1).
export const metadata: Metadata = { title: "Strategies" };

export default async function StrategiesPage({ searchParams }: StrategiesPageProps) {
  // D-07 / T-170.1-19: only the exact string "1" shows the status line. The
  // value is compared and never echoed, so a forged param can show only the
  // fixed sentence. An array (`?wizard_submitted=1&wizard_submitted=1`) is not "1".
  const { wizard_submitted } = await searchParams;
  const justSubmitted = wizard_submitted === "1";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Phase 199 D-01 / D-02 (LEAN-01): the index admits every strategy owner, so
  // the layout no longer guards a role and THIS page reads it, to decide which
  // furniture each row carries. The failure discipline mirrors
  // `requireRolePage`'s (T-199-15): a DB error is logged, captured and THROWN
  // to error.tsx, never turned into a guessed role (a guessed role is a guessed
  // set of controls); a missing profile row throws too; an unknown role is
  // denied by default and sent where the guard would have sent it. Nothing
  // below this block reads for a viewer whose role is not known.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("[strategies/page] profile lookup failed", {
      user_id: user.id,
      code: profileError.code,
      message: profileError.message,
    });
    captureToSentry(profileError, {
      tags: { route: "strategies/page", stage: "role" },
      extra: { user_id: user.id, message: profileError.message ?? "" },
      level: "error",
    });
    throw profileError;
  }
  if (!profile) {
    const missing = new Error("Profile row missing for auth user");
    console.error("[strategies/page] profile row missing for auth user", {
      user_id: user.id,
    });
    captureToSentry(missing, {
      tags: { route: "strategies/page", stage: "role-missing" },
      extra: { user_id: user.id },
      level: "warning",
    });
    throw missing;
  }
  const role = profile.role;
  // `redirect()` throws NEXT_REDIRECT, so it sits at the top level, outside any
  // try/catch (redirect.md).
  if (role !== "manager" && role !== "allocator" && role !== "both") {
    redirect(roleSurfaceHome(role));
  }
  // D-02: `both` is each role at once, never a third mode.
  const isManager = role === "manager" || role === "both";
  const isAllocator = role === "allocator" || role === "both";

  // Filter out wizard drafts — they belong to the wizard flow and
  // have their own Resume banner at /strategies/new/wizard. Including
  // them here would render a confusing "edit" link pointing at the
  // legacy StrategyForm, which does not understand wizard state.
  // See migration 031: `source` discriminates wizard drafts from
  // legacy / admin_import drafts. The PostgREST `.or()` filter below
  // keeps legacy drafts visible while hiding wizard-in-progress rows.
  // Phase 199 plan 10 (CD-10): that filter is the MANAGER's. `/strategies/new/wizard`
  // stays manager-guarded (the Phase 110 exception is the overlay, not the route),
  // so for an allocator-only viewer the banner's target would only bounce them,
  // and hiding the draft would drop a row /my-strategies always showed. An
  // allocator-only viewer therefore keeps a wizard draft as a Draft row with no
  // banner; manager and `both` keep the filter and the banner.
  // Phase 170.7 (D-01, D-03): `*` plus the explicit ranking allowlist. Never
  // `strategy_analytics (*)` (the owner-only exemption inside `getMyStrategies`,
  // RANK-02), and never `getMyStrategies` itself: it drops archived rows and
  // does not hide wizard drafts. The owner scope below is the page's own, with
  // RLS (`strategies_read`, `analytics_read`) as the backstop. `computation_status`
  // is in the allowlist, so the KCS-12 reads below keep their input.
  const ownerList = supabase
    .from("strategies")
    .select(`*, strategy_analytics (${CATEGORY_RANKING_ANALYTICS_COLUMNS})`)
    .eq("user_id", user.id);
  const { data: listData, error: strategiesError } = await (
    isManager ? ownerList.or("source.neq.wizard,status.neq.draft") : ownerList
  ).order("created_at", { ascending: false });
  // The cast is type-only: the `->-1->>` alias in the allowlist defeats
  // postgrest-js's select parser (RESEARCH Pitfall 4). `null` stays `null`, so
  // the unreadable arm below still sees a missing rows array.
  const strategies = listData as unknown as OwnerListRow[] | null;
  // 167.2-REVIEW-SFH H-1: a failed list read is NOT "no strategies". The
  // KCS-12 analytics embed added new ways for this one query to fail whole (a
  // column grant revoked on `computation_status`, an ambiguous embed), and the
  // discarded error used to render "No strategies yet" to an owner with live
  // strategies: the H-0395 class the key card already fixed for itself. It is
  // logged, captured, and rendered as its own line below.
  // 167.2-REVIEW-R2 IN-03: `data: null` with no error is not a clean read
  // either (the L-2 rule `loadKeys` already applies), so it takes the same
  // unreadable arm rather than "No strategies yet".
  const strategiesUnreadable = !!strategiesError || !Array.isArray(strategies);
  if (strategiesUnreadable) {
    const message = strategiesError?.message ?? "the strategies read returned no rows array and no error";
    console.error("[strategies/page] strategies read failed", message);
    captureToSentry(new Error(message), {
      tags: { route: "strategies/page", stage: "list" },
    });
  }

  // Companion query for the wizard-draft Resume CTA.
  //
  // The `.or()` filter above intentionally hides wizard-in-progress rows
  // from the list (they need a different "edit" target than the legacy
  // StrategyForm). But pre-fix that hiding was total: a user who left
  // the wizard mid-flow and came back to /strategies saw "No strategies
  // yet" and lost their draft to the cleanup cron without realizing.
  // This second query surfaces a Resume banner without re-rendering the
  // hidden row inline — preserving the StrategyForm-routing safety
  // invariant while closing the dogfood UX gap (2026-05-21).
  // Manager and `both` only (CD-10): an allocator-only viewer has no banner, so
  // the read is not made at all rather than made and thrown away.
  const { data: wizardDraft } = isManager
    ? await supabase
        .from("strategies")
        .select("id, name, created_at, review_note")
        .eq("user_id", user.id)
        .eq("source", "wizard")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // M-0255: a rejected wizard draft is the SAME hidden row (source='wizard',
  // status='draft') but with review_note set by the admin reject path. The
  // inline list filter hides it AND the inline review_note render only fires
  // for rows that survive the filter — so the rejection + feedback were never
  // surfaced (and the cleanup cron would CASCADE-delete it). Surface it here in
  // the banner instead, preserving the StrategyForm-routing safety invariant
  // (the Resume CTA targets the wizard, which understands wizard state).
  const wizardDraftRejected = Boolean(wizardDraft?.review_note);

  const strategyIds = strategies?.map((s) => s.id) ?? [];

  // Phase 164.6.6.3.1 D-05/D-06 (item 6f) — which UNPUBLISHED rows carry a
  // confirmed live private link, so the row can say "Manage private link".
  // ONE batched read over the listed unpublished ids, on the request-scoped
  // client under RLS `strategy_shares_owner` (`created_by = auth.uid()`), and
  // never the admin client. Only `strategy_id, revoked_at` are selected: the
  // token inputs (`nonce`, `generation`) never leave the database, and only a
  // boolean per row crosses to the client component. The live flag is derived
  // HERE, in code, as `revoked_at === null` (the factsheet's own rule), not in
  // the query, so a revoked row cannot read as live.
  // ⛔ D-06: fail CLOSED. `liveShareIds` starts empty and stays empty on any
  // read failure, so every unpublished row reads "Get private link" rather than
  // claim a live link nobody confirmed. The failure is logged and captured with
  // tags only (no id, no row), and no visible note is shown. Zero unpublished
  // rows means no read at all.
  const unpublishedIds = (strategies ?? [])
    .filter((s) => !isPublishedStatus(s.status))
    .map((s) => s.id);
  const liveShareIds = new Set<string>();
  if (unpublishedIds.length > 0) {
    // The generated types predate `strategy_shares`; the cast is type-only and
    // the runtime client stays RLS-scoped (as for `strategy_keys` below).
    const { data: shareRows, error: sharesError } = await (
      supabase as unknown as SupabaseClient
    )
      .from("strategy_shares")
      .select("strategy_id, revoked_at")
      .in("strategy_id", unpublishedIds);
    if (sharesError || !Array.isArray(shareRows)) {
      const message = sharesError
        ? sharesError.message
        : "strategy_shares read returned a non-array answer";
      console.error("[strategies/page] active-share read failed", message);
      captureToSentry(new Error(message), {
        tags: { route: "strategies/page", stage: "active-share" },
      });
    } else {
      for (const r of shareRows as { strategy_id: string; revoked_at: string | null }[]) {
        if (r.revoked_at === null) liveShareIds.add(r.strategy_id);
      }
    }
  }

  // D-02: introductions are a manager surface. An allocator's page makes no
  // `contact_requests` read at all (not a read thrown away), and `both` reads.
  const { data: introRequests } = isManager && strategyIds.length > 0
    ? await supabase
        .from("contact_requests")
        .select("id, status, message, created_at, strategy_id, founder_notes, profiles!contact_requests_allocator_id_fkey(display_name, company), strategies!contact_requests_strategy_id_fkey(id, name, codename, disclosure_tier)")
        .in("strategy_id", strategyIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Phase 167.2 / KCS-06 — which rows are fed by an untrusted key. A row's
  // feeding keys are the SET `[api_key_id, ...strategy_keys members by seq]`,
  // de-duplicated: a composite usually has no api_key_id, and its stitch fans
  // out over EVERY member (not only open windows), so any untrusted member
  // stops it refreshing. Both reads are owner-scoped on the request client
  // (`strategy_keys_owner`, `api_keys_owner`); nothing here touches a
  // factsheet path.
  // ⛔ A failed member read is logged and the row is judged on api_key_id
  // alone (truthful, partial). A failed key read renders NO mark at all (an
  // error is not "healthy", but it is not a known-bad key either, so no pill
  // is guessed) and is logged. Since 167.2-REVIEW-SFH H-3 either failure is
  // also captured and renders the page-level key-status line (registry id
  // `strategies.key-status-unreadable`), so
  // the absence of a pill stops reading as "healthy" during an outage.
  // 167.2-REVIEW-SFH H-3: on this page the healthy state is the ABSENCE of a
  // pill, so a failed key-status or member read would render every row as
  // healthy, the exact state KCS-06 exists to surface. Either failure is
  // captured and sets this flag, which renders one page-level line saying the
  // status could not be checked.
  let keyStatusUnreadable = false;
  let membersReadFailed = false;
  const membersByStrategy = new Map<string, StrategyKeyMemberRow[]>();
  if (strategyIds.length > 0) {
    // The generated types predate `strategy_keys`; the cast is type-only (as in
    // the composite members route) and the runtime client stays RLS-scoped.
    const { data: memberRows, error: membersError } = await (
      supabase as unknown as SupabaseClient
    )
      .from("strategy_keys")
      .select("strategy_id, api_key_id, seq")
      .in("strategy_id", strategyIds);
    if (membersError) {
      console.error("[strategies/page] strategy_keys read failed", membersError.message);
      captureToSentry(new Error(membersError.message), {
        tags: { route: "strategies/page", stage: "strategy-keys" },
      });
      keyStatusUnreadable = true;
      membersReadFailed = true;
    } else {
      for (const m of (memberRows ?? []) as StrategyKeyMemberRow[]) {
        const list = membersByStrategy.get(m.strategy_id);
        if (list) list.push(m);
        else membersByStrategy.set(m.strategy_id, [m]);
      }
    }
  }
  const feedingKeyIdsByStrategy = new Map<string, string[]>(
    (strategies ?? []).map((s) => {
      const members = [...(membersByStrategy.get(s.id) ?? [])].sort(
        (a, b) => a.seq - b.seq,
      );
      const ids = [
        ...(s.api_key_id ? [s.api_key_id] : []),
        ...members.map((m) => m.api_key_id),
      ];
      return [s.id, [...new Set(ids)]];
    }),
  );
  const keyIds = [...new Set([...feedingKeyIdsByStrategy.values()].flat())];
  const keysById = new Map<string, KeyStatusRow>();
  if (keyIds.length > 0) {
    const { data: keyRows, error: keysError } = await supabase
      .from("api_keys")
      .select(KEY_STATUS_COLUMNS)
      .in("id", keyIds);
    if (keysError) {
      console.error("[strategies/page] api_keys read failed", keysError.message);
      captureToSentry(new Error(keysError.message), {
        tags: { route: "strategies/page", stage: "key-status" },
      });
      keyStatusUnreadable = true;
    } else {
      for (const key of (keyRows ?? []) as KeyStatusRow[]) keysById.set(key.id, key);
    }
  }
  // Phase 199 plan 12 (D-03): the ONE key-label rule, over the owner's own keys.
  const keyLabels = apiKeyLabelById([...keysById.values()]);

  // Phase 167.2 / KCS-12 — beside each share control, what a recipient of that
  // link sees right now, for every row WITHOUT a buildable factsheet. "Has a
  // computed factsheet" starts at `isComputedAnalytics(computation_status)`:
  // the factsheet builder's own first gate (STALE-01 in fetchAndBuildPayload),
  // so a row this predicate calls uncomputed is one the builder refuses.
  // Lineage: 167.2-REVIEW WR-02 (a computed row whose series cannot build read
  // as "has a factsheet" here) is closed by 167.2.1 D-04 and D-08. A computed
  // row is now asked `probeFactsheetBuildable`, the builder's own resolve
  // stage, so the list and the share page decide from the builder's own code
  // whether the factsheet has a null exit. They do not decide whether it
  // renders: a builder throw is outside that answer (IN-03, below).
  //
  // The recipient arm, and the note an uncomputed row has always shown. One
  // function, so the uncomputed path and the probe's fallbacks read the arm
  // the same way.
  // IN-03: a failed member read keeps stitch preference.
  const memberCountOf = (strategyId: string): CompositeMemberCount =>
    membersReadFailed
      ? { ok: false, message: "strategy_keys member read failed" }
      : { ok: true, count: membersByStrategy.get(strategyId)?.length ?? 0 };
  // Phase 199 plan 16: one read per row. The share note and the Analytics failed
  // detail both ask for the same row's jobs, so the first answer is kept and the
  // second asker gets the same promise.
  const armReads = new Map<string, Promise<ArmFacts>>();
  const armOf = (
    s: NonNullable<typeof strategies>[number],
    mode: ReturnType<typeof shareAffordanceMode>,
  ): Promise<ArmFacts> => {
    // 167.2-REVIEW IN-04: a published row's note is the public line whatever
    // the arm (`recipientShareNote` / `recipientShareNoteFor` ignore it for
    // "public-url"), so its jobs are not read: that was one RPC per row whose
    // answer, and whose failure log, described a value nobody reads. The arm
    // passed for it is the one that claims least; it is never rendered.
    // 170.1 D-08: its `state` is null for the same reason, so a published row
    // can never take the finished-not-built kind.
    // Phase 199 plan 16: a published row that is Analytics failed reads its jobs
    // for its detail's day, outside this function (`failedFactsOf`, below).
    if (mode === "public-url") {
      return Promise.resolve({
        arm: "not_available",
        state: null,
        jobDay: null,
        compositeHistory: "unreadable",
      });
    }
    const known = armReads.get(s.id);
    if (known) return known;
    const read = readRecipientArm(supabase, s.id, {
      memberCount: memberCountOf(s.id),
      apiKeyId: s.api_key_id ?? null,
    });
    armReads.set(s.id, read);
    return read;
  };
  // 164.6.6.3.3 D-08: `kind` is `analytics_failed` for a row whose analytics
  // FAILED, else null (`recipientShareNoteFor` with no kind is exactly
  // `recipientShareNote`). A running recompute keeps KCS12-MINT-A.
  // 170.1 D-08 / R-1: an unpublished row whose jobs FINISHED without a built
  // factsheet takes `finished_not_built`. `jobsFinished` is read from the
  // ComputeState (`finished`), never from the arm, which `failed`, `stalled` and
  // `never_started` share. `analyticsFailed` wins inside the selector, and the
  // in_progress arm keeps KCS12-MINT-A for every kind (`recipientShareNoteFor`).
  const uncomputedNote = async (
    s: NonNullable<typeof strategies>[number],
    mode: ReturnType<typeof shareAffordanceMode>,
    analyticsFailed = false,
  ): Promise<string> => {
    const { arm, state } = await armOf(s, mode);
    const kind = unbuildableNoteKindOf("not_computed", {
      ...(analyticsFailed ? { analyticsFailed: true as const } : {}),
      jobsFinished: state?.state === "finished",
    });
    return recipientShareNoteFor(mode, arm, kind);
  };

  // WR-01: the probes share one limiter per page load, and a probe that
  // THROWS is recorded here and captured after the fan-out, one event per
  // distinct cause (`captureProbeThrows`, SFH-R2 N-2), never once per row.
  const runProbe = concurrencyLimiter(PROBE_CONCURRENCY);
  const probeThrows: unknown[] = [];
  // 167.2.1-REVIEW-R2 WR-01: the RETURNED failures, counted, and captured
  // once after the fan-out (`captureProbeOutcomes`).
  const probeOutcomes = newProbeOutcomeTally();

  const shareNotes = new Map<string, string>(
    (
      await Promise.all(
        (strategies ?? []).map(async (s): Promise<readonly [string, string | null]> => {
          const mode = shareAffordanceMode(isPublishedStatus(s.status));
          // D-08: an uncomputed row is never probed; it keeps today's path.
          const embedStatus = computationStatusOf(s.strategy_analytics);
          if (!isComputedAnalytics(embedStatus)) {
            return [
              s.id,
              await uncomputedNote(s, mode, embedStatus === "failed"),
            ] as const;
          }
          // D-08: a computed row is probed, uncached, under the owner
          // predicate. Only ids from the owner-filtered list reach here.
          // COST, accepted (167.2.1-REVIEW WR-01): one heavy service-role
          // read per computed row per page load (the strategy row with its
          // series and basis columns; a composite adds its csv read), at most
          // PROBE_CONCURRENCY at once. The list is unpaginated, so the cost
          // still grows linearly with the owner's computed strategies; the
          // parity invariant needs the resolve stage itself, so a cheaper
          // answer is a writer-side verdict or a column-light resolve, not a
          // shortcut here.
          let probe: Awaited<ReturnType<typeof probeFactsheetBuildable>>;
          let kind: ReturnType<typeof unbuildableNoteKindOf>;
          try {
            probe = await runProbe(() =>
              probeFactsheetBuildable(s.id, (q) => withPublishedOrOwner(q, user.id)),
            );
            // 167.2.1-REVIEW-SFH-R2 N-7: inside the per-row try. Its `never`
            // arm throws on a reason it does not know (reachable only through
            // a type lie). Out here, that throw rejected `Promise.all` and put
            // the whole list behind the error boundary; in here it fails this
            // row's check, and is captured with the other throws.
            kind = probe.buildable ? null : unbuildableNoteKindOf(probe.reason, probe);
          } catch (err) {
            if (err instanceof FactsheetProbeTimeoutError) {
              // 167.2.1-REVIEW-SFH-R2 N-3: no answer within the probe's
              // deadline. Its own reason in the page's one event, and the
              // same "could not check" line as any failed check.
              console.error("[strategies/page] factsheet probe timed out", {
                id: s.id,
                deadlineMs: err.deadlineMs,
              });
              probeOutcomes.counts.timeout += 1;
              return [s.id, probeUnreadableShareNote(mode)] as const;
            }
            // D-05: a probe that throws is never read as "buildable".
            // 167.2.1-REVIEW-SFH H-2: nor as "not available". Every failed
            // check (this throw, and the read_error and not_visible arms
            // below) renders the "could not check" line for its share mode.
            // It used to render `recipientShareNote(mode, "unreadable")`,
            // which for a PUBLISHED row is KCS12-PUBLIC, "… not available yet
            // …", while the public factsheet most likely rendered fine.
            // Logged here per row, with its id; captured once per page load
            // after the fan-out (WR-01).
            console.error("[strategies/page] factsheet probe failed", {
              id: s.id,
              message: err instanceof Error ? err.message : String(err),
            });
            probeThrows.push(err);
            return [s.id, probeUnreadableShareNote(mode)] as const;
          }
          // 167.2.1-REVIEW IN-03: "buildable" means "no null exit", not
          // "renders". A builder throw at the recipient's request (the basis
          // reads, the build itself) is outside the probe's domain, so it is
          // outside this note's domain too: such a row shows no note here and
          // its recipient gets the error boundary.
          if (probe.buildable) return [s.id, null] as const;
          if (probe.reason === "read_error" || probe.reason === "composite_unbuildable" || probe.reason === "malformed_series") {
            probeOutcomes.counts[probe.reason] += 1;
            if (probe.code !== undefined) bump(probeOutcomes.readErrorCodes, probe.code);
            if (probe.gate !== undefined) bump(probeOutcomes.gates, `${probe.reason}:${probe.gate}`);
            if (probe.source !== undefined) bump(probeOutcomes.sources, probe.source);
          }
          if (probe.reason === "read_error") {
            // D-05: the probe could not read the row, so what the recipient
            // sees is not known. The resolve stage logged this read with its
            // id and code (`resolve(probe)`). 167.2.1-REVIEW-R2 WR-01: it no
            // longer captures it; the count above does, once per page load.
            return [s.id, probeUnreadableShareNote(mode)] as const;
          }
          if (probe.reason === "not_visible") {
            // D-05: the probe found no row. 167.2.1-REVIEW IN-01: on THIS page
            // that is not an outage. The id came from the owner's own list
            // read moments earlier and the probe runs under the owner
            // predicate, so no row means the strategy was deleted between the
            // two reads. A warning, never a capture: counting it as an error
            // would inflate the outage signal the read_error capture carries.
            console.warn("[strategies/page] factsheet probe found no row (deleted since the list read)", {
              id: s.id,
              reason: probe.reason,
            });
            return [s.id, probeUnreadableShareNote(mode)] as const;
          }
          // D-05: the embed and the admin read disagree (a race): the admin
          // read is the builder's, so the row takes the uncomputed path.
          // 167.2.1-REVIEW-SFH M-5: logged at warn so the race rate is
          // measurable. Not captured: a status flip between two reads is
          // legitimate, and one event per occurrence would be noise.
          if (probe.reason === "not_computed") {
            console.warn("[strategies/page] factsheet probe found the analytics row not computed (the list embed said computed)", {
              id: s.id,
              reason: probe.reason,
            });
            // D-08: when the builder's read says the row FAILED, the same
            // analytics-failed note as the embed path (`kind` is that or null).
            return [s.id, await uncomputedNote(s, mode, kind === "analytics_failed")] as const;
          }
          // D-02: computed, but the builder refuses it (`kind`, above).
          return [s.id, recipientShareNoteFor(mode, (await armOf(s, mode)).arm, kind)] as const;
        }),
      )
    ).filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
  captureProbeOutcomes(probeOutcomes);
  captureProbeThrows(probeThrows);

  // Phase 199 plan 10 (D-02): the allocator half of /my-strategies, for allocator
  // and `both`: one placeholder row per active key that has produced no strategy,
  // and the viewer's real portfolio (what Simulate Impact scores against). A
  // manager-only page makes neither read. Both take the session user's id and
  // nothing else (T-199-30; RLS is the backstop).
  // ⛔ T-199-25, error ≠ empty (149 WR-01, the `getMyWatchlist` idiom):
  // `getStrategylessActiveKeys` returns `null` on a transient DB failure, and a
  // null is NEVER read as "no keys". It prints its own line below, and the page
  // never takes the empty state while it stands. `getRealPortfolio` already
  // THROWS on a read error (to error.tsx) and returns null only for "this viewer
  // has no portfolio row", which is a real answer and not a failure.
  const [bareKeys, portfolio] = isAllocator
    ? await Promise.all([getStrategylessActiveKeys(user.id), getRealPortfolio(user.id)])
    : [[], null];
  const placeholderKeysUnreadable = bareKeys === null;
  // Delta 5 — formatted SERVER-side so the client table never owns exchange
  // naming (and so an unmapped code can never reach the DOM as `undefined`).
  // 162-06 / HONEST-06 — `exchange` (the venue ID) rides ALONGSIDE the formatted
  // label: the wizard needs the id, the row shows only the label.
  const placeholderRows = (bareKeys ?? []).map((k) => ({
    id: k.id,
    exchange: k.exchange,
    exchangeLabel: EXCHANGE_DISPLAY[k.exchange],
    keyLabel: k.label,
  }));

  // Phase 170.7 (D-03): every row is shaped by the one analytics shaper. A
  // missing `strategy_analytics` row, and a run that did not finish (`failed`,
  // `pending`, `computing`), come out as the empty shape with their real status,
  // so the table prints a dash, never a 0 and never a failed run's stored
  // figures. No `?? 0` anywhere on this path.
  const shapedRows = (strategies ?? []).map((s) => {
    const a = extractAnalytics(s.strategy_analytics);
    return { ...s, analytics: shapeRowAnalytics(a, s.id), analyticsPresent: a !== null };
  });

  // Phase 199 plan 10 (D-02, CD-12): the Phase 149 ranking and the public trust
  // tier, for every role. Two independent reads, so they run together.
  //  - `trust_tier` comes from the published-gated signal reader, the one
  //    `getMyStrategies` shapes its rows with. Without it a published composite
  //    (no `api_key_id`) loses the verified check the table draws from
  //    `trust_tier === "api_verified" || api_key_id`. The reader fails soft (an
  //    absent signal reads `null`: no check, never an invented one).
  //  - The ranking is asked about the NON-ARCHIVED rows only (CD-12): an archived
  //    row stays on the list but is no subject of the ranking, so it carries no
  //    `Pnn`. This is the W-4 rule `getMyStrategies` always applied. A null (no
  //    comparison set yet, or a failed read) renders the threshold copy, as it
  //    did on /my-strategies. N for the copy is `own.populationSize`, the number
  //    of strategies that ENTERED the ranking; never build a per-metric N.
  //    Own rows are scored self-inclusively against the published universe and
  //    never join it, so no row here can move a public rank.
  const rankable = shapedRows.filter((s) => s.status !== "archived");
  const [signals, own] = await Promise.all([
    readPublicVerificationSignals(strategyIds),
    rankable.length > 0 ? getOwnRowPercentiles(rankable) : Promise.resolve(null),
  ]);
  const rows = shapedRows.map((s) => ({
    ...s,
    trust_tier: (signals.get(s.id)?.trust_tier ?? null) as Strategy["trust_tier"],
  }));

  // Phase 199 plan 12 (D-03, SC-3, R-05): each row's Health, decided HERE on the
  // server by the one pure function, with the server clock (`healthNowMs`, read
  // once per request so every row is judged against the same instant) and the
  // row's own `asset_class` (the Phase 197 list verdict's 7-or-10-day ladder).
  // The client only prints the word it is handed. A feeding key whose row was
  // not read (the read failed, or it is not the owner's) contributes no status;
  // `keyStatusUnreadable` is what keeps that absence from reading as Healthy.
  // Phase 199 plan 16: decided before the notes, because a row's note carries its
  // Health detail and the detail is chosen by the Health kind.
  // eslint-disable-next-line react-hooks/purity -- an async server page runs once per request, not per re-render: the clock is read once and passed down
  const healthNowMs = Date.now();
  const healthOfRow = (s: (typeof rows)[number]): StrategyHealth =>
    strategyHealthOf({
      status: s.status,
      createdAt: s.created_at,
      chipStatus: rowChipStatus(s),
      analyticsUpdating: s.analytics.analytics_updating === true,
      seriesEnd: s.analytics.series_end,
      assetClass: s.asset_class,
      feedingKeySyncStatuses: (feedingKeyIdsByStrategy.get(s.id) ?? []).map(
        (id) => keysById.get(id)?.sync_status,
      ),
      keyStatusUnreadable,
      nowMs: healthNowMs,
    });
  const healthByRow = new Map(rows.map((s) => [s.id, healthOfRow(s)] as const));
  const healthOf = (s: (typeof rows)[number]): { word: string; tone: string } => {
    const health = healthByRow.get(s.id) ?? healthOfRow(s);
    return { word: healthWord(health), tone: HEALTH_TONE[health.kind] };
  };

  // Phase 199 plan 16 (D-03, CD-05): what an Analytics failed row's detail needs from
  // its compute jobs: the state (for `ownerRemedy`), the last computation's day and the
  // composite history (for the shape). EVERY failed row is read, and (SFH-03: the Stale
  // (no data yet) remedy comes from the real state too) every Stale (no data yet) row, and only
  // those. An unpublished row reuses the read its share note already made (`armOf` keeps one per
  // row); a published row's share note skips the read (IN-04), so it gets one of its own
  // here. A failed read has no day and renders the unreadable sentence; it is never
  // read as "no failure".
  const failedFactsOf = async (
    s: (typeof rows)[number],
  ): Promise<{
    state: ComputeState | null;
    jobDay: string | null;
    compositeHistory: CompositeHistory;
  }> => {
    const mode = shareAffordanceMode(isPublishedStatus(s.status));
    if (mode !== "public-url") {
      const { state, jobDay, compositeHistory } = await armOf(s, mode);
      return { state, jobDay, compositeHistory };
    }
    let read: Awaited<ReturnType<typeof readOwnerComputeJobs>>;
    try {
      read = await readOwnerComputeJobs(supabase as unknown as SupabaseClient, s.id);
    } catch (err) {
      read = {
        ok: false,
        code: undefined,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (!read.ok) {
      console.error("[strategies/page] analytics-failed day read failed", {
        id: s.id,
        code: read.code,
        message: read.message,
      });
      captureToSentry(new Error(read.message), {
        tags: { route: "strategies/page", stage: "analytics-failed-day" },
      });
      return {
        state: deriveComputeState({ readError: true }),
        jobDay: null,
        compositeHistory: "unreadable",
      };
    }
    // The request's one clock (`healthNowMs`), as the Health judgement uses.
    const nowMs = healthNowMs;
    const compositeHistory = compositeHistoryOf(read);
    const preferStitch = shouldPreferStitch({
      memberCount: memberCountOf(s.id),
      apiKeyId: s.api_key_id ?? null,
      compositeHistory,
    });
    return {
      state: deriveComputeState({
        rows: read.rows,
        readExhaustive: read.readExhaustive,
        nowMs,
        preferStitch,
      }),
      jobDay: jobDayOf(selectFactsheetJob(read.rows, { preferStitch, nowMs })),
      compositeHistory,
    };
  };
  const failedFacts = new Map(
    await Promise.all(
      rows
        .filter((s) => {
          const kind = healthByRow.get(s.id)?.kind;
          return kind === "analytics_failed" || kind === "stale_no_data";
        })
        .map(async (s) => [s.id, await failedFactsOf(s)] as const),
    ),
  );
  // The row's shape, for the remedy: `resolveStrategyShape`'s own rule over the page's
  // member read and, where a row's jobs were read, its composite history.
  const shapeOf = (
    s: { id: string; source: string; api_key_id?: string | null },
    compositeHistory?: CompositeHistory,
  ): StrategyShape | "unknown" =>
    resolveStrategyShape({
      source: s.source,
      apiKeyId: s.api_key_id,
      memberCount: memberCountOf(s.id),
      compositeHistory,
    });
  const DETAIL_CLASS = "text-caption font-normal text-text-muted";
  // The row's Health detail (UI-SPEC "Row note, the Health detail"), one registered
  // line, or null for a row whose Health needs none here.
  const healthDetailFor = (s: OwnerListRow): ReactNode => {
    const health = healthByRow.get(s.id);
    if (health?.kind === "stale" && health.staleSince) {
      // CD-11: a CSV strategy's remedy is its upload, but that route is manager-guarded, so
      // an allocator-only viewer is pointed at the contact form; an API or composite
      // strategy's is the edit page (manager, both) or the Exchanges page (allocator only).
      const action: StaleAction =
        shapeOf(s) === "csv"
          ? isManager
            ? "A-CSV"
            : "A-CONTACT-CHECK"
          : isManager
            ? "A-EDIT"
            : "A-EXCHANGES-KEY";
      return (
        <DegradeLine
          id="strategies.stale"
          element="p"
          className={DETAIL_CLASS}
          segments={degradeSegments("strategies.stale", {
            day: health.staleSince,
            action,
            strategyId: s.id,
          })}
        />
      );
    }
    if (health?.kind === "stale_no_data") {
      // The remedy for the row's REAL compute state (SFH-03: a failed or stalled job under a
      // pending or missing analytics row is not "never started"): `ownerRemedy`'s own for a
      // manager, the allocator-only substitute otherwise. A failed jobs read is the
      // unreadable line, never a guessed state.
      const facts = failedFacts.get(s.id);
      const state: ComputeState = facts?.state ?? { state: "unreadable" };
      if (!facts || state.state === "unreadable") {
        return (
          <DegradeLine
            id="strategies.compute-status-unreadable"
            element="p"
            className={DETAIL_CLASS}
            segments={degradeSegments("strategies.compute-status-unreadable", undefined)}
          />
        );
      }
      const shape = shapeOf(s, facts.compositeHistory);
      const remedy = ownerRemedy(state, shape, s.id);
      return (
        <DegradeLine
          id="strategies.stale-no-data"
          element="p"
          className={DETAIL_CLASS}
          segments={degradeSegments("strategies.stale-no-data", {
            action: viewerRemedyAction({ remedy, managerSurface: isManager, shape }),
            strategyId: s.id,
          })}
        />
      );
    }
    if (health?.kind !== "analytics_failed") return null;
    const facts = failedFacts.get(s.id);
    // Only a failed read is the unreadable line (`deriveComputeState({ readError: true })`).
    // A read that worked and found no job (done jobs are purged after ~30 days) has no day
    // to print, but it is not unreadable and a reload cannot add a job (WR-02).
    const state: ComputeState = facts?.state ?? { state: "unreadable" };
    if (!facts || state.state === "unreadable") {
      return (
        <DegradeLine
          id="strategies.compute-status-unreadable"
          element="p"
          className={DETAIL_CLASS}
          segments={degradeSegments("strategies.compute-status-unreadable", undefined)}
        />
      );
    }
    const shape = shapeOf(s, facts.compositeHistory);
    const remedy = ownerRemedy(state, shape, s.id, {
      buildUnreadable: false,
      analyticsFailed: true,
    });
    if (facts.jobDay === null) {
      return (
        <DegradeLine
          id="strategies.analytics-failed-undated"
          element="p"
          className={DETAIL_CLASS}
          segments={degradeSegments("strategies.analytics-failed-undated", {
            action: viewerRemedyAction({ remedy, managerSurface: isManager, shape }),
            strategyId: s.id,
          })}
        />
      );
    }
    return (
      <DegradeLine
        id="strategies.analytics-failed"
        element="p"
        className={DETAIL_CLASS}
        segments={degradeSegments("strategies.analytics-failed", {
          day: facts.jobDay,
          action: viewerRemedyAction({ remedy, managerSurface: isManager, shape }),
          strategyId: s.id,
        })}
      />
    );
  };

  // Phase 167.2 / KCS-06 (S4) + KCS-12 (S5), and the 170.7 review feedback —
  // one strategy's note: what the table renders in the full-width row under it.
  // Built here and not in the table because the key pills and the contact
  // pointer are server-composed. The table owns the wrapping block
  // (`strategy-row-footer`), so this returns that block's CHILDREN as a
  // Fragment, in the order D-06 fixes: review feedback, then one line per
  // DISTINCT untrusted key status (the key card's own pill and helper, mounted
  // as the key card mounts it; the caption names a key and the pill names its
  // state, no claim about the strategy's numbers), then (Phase 199 plan 16) the
  // Health detail, then the share note.
  // `undefined` when the strategy has none of them, so no empty row renders.
  // Each mount keeps its own helper live region; on this static server render
  // they never change, so they announce nothing.
  const noteFor = (s: OwnerListRow): ReactNode => {
    const keyLines = untrustedKeyLines(
      feedingKeyIdsByStrategy.get(s.id) ?? [],
      keysById,
      keyLabels,
    );
    const shareNote = shareNotes.get(s.id);
    const healthDetail = healthDetailFor(s);
    const showFeedback = Boolean(s.review_note) && s.status === "draft";
    if (!showFeedback && keyLines.length === 0 && !healthDetail && !shareNote) return undefined;
    return (
      <>
        {showFeedback && (
          // D-08 (2026-10-09): feedback is recoverable (revise and resubmit), so
          // DESIGN.md's colour gate makes it amber, not red.
          <p className="rounded px-2 py-1 text-caption font-normal text-warning bg-warning/5">
            Review feedback: {s.review_note}
          </p>
        )}
        {keyLines.map((line) => (
          <div
            key={line.status}
            data-testid="strategy-row-key-mark"
            data-degrade-id="strategies.key-problem"
            className="flex items-start justify-between gap-3"
          >
            <p className="text-caption font-normal text-text-muted">{line.caption}</p>
            <AllocatorSyncStatus
              subject="strategy-key"
              syncStatus={line.status}
              syncError={line.first.sync_error}
              lastSyncAt={line.first.last_sync_at}
              exchange={line.first.exchange}
            />
          </div>
        ))}
        {/* Phase 199 plan 16 — the Health detail: after review feedback and the key
            lines, before the share note. */}
        {healthDetail}
        {/* KCS-12 (S5) — after any S4 lines; plain text, no role. */}
        {shareNote && (
          <p
            data-testid="strategy-row-share-note"
            data-degrade-id="strategies.share-note"
            className="text-caption font-normal text-text-muted"
          >
            {/* AD-05: the note's "contact form" phrase links the support topic
                with this row's strategy id. */}
            <ContactPointerText
              text={shareNote}
              href={contactHref({ topic: "support", strategy: s.id })}
            />
          </p>
        )}
      </>
    );
  };

  // Phase 170.7 (D-01): each row's Edit target, its actions and its note, keyed
  // by strategy id and built ONCE per request. Props are strings and booleans
  // only (never a token, nonce or generation), so they serialize across the
  // RSC boundary. The elements are rendered once, in the table's one Actions
  // cell: a second mount would be a second dialog and a second `shareLive`.
  // Phase 199 D-02 (T-199-14): the note is every role's; the Edit target and the
  // actions are built ONLY when the viewer is a manager (or `both`), so an
  // allocator's payload carries no manager control at all.
  const managerRows = Object.fromEntries(
    rows.map((s) => [
      s.id,
      {
        health: healthOf(s),
        editHref: isManager ? `/strategies/${s.id}/edit` : undefined,
        actions: isManager ? (
          <>
            {/* Phase 164 (SHARE-04) — the status gate is GONE, and its
                removal is the point, not a side effect. Hiding the control
                for unpublished rows was the other half of the same
                dishonesty class as the factsheet's 404-producing Copy
                Link: an owner with a private strategy had no affordance at
                all, so the product's answer to "show this to my LP" was
                "you can't". Every row on this page belongs to the session
                user, so an unpublished row now yields a working, revocable
                private link instead of nothing.
                ⛔ `StrategyActions` in the same row is untouched (D-03). */}
            <ShareableLink
              strategyId={s.id}
              published={isPublishedStatus(s.status)}
              hasActiveShare={liveShareIds.has(s.id)}
              size="sm"
            />
            <StrategyActions
              strategyId={s.id}
              status={s.status}
              hasApiKey={!!s.api_key_id}
              hasData={!!s.api_key_id}
            />
          </>
        ) : undefined,
        note: noteFor(s),
      },
    ]),
  );

  // The note: the ranking sentence while there are rows, the K sentence while
  // there are placeholders. The two branches flip with the ranking's own
  // threshold, so the page never shows a Pnn while claiming there is no
  // comparison set, or the reverse.
  const hasRows = rows.length > 0 || placeholderRows.length > 0;
  const noteParts: string[] = [];
  if (rows.length > 0) noteParts.push(own ? mapCopy(own.populationSize) : NULL_COPY);
  if (placeholderRows.length > 0) noteParts.push(kSentence(placeholderRows.length));

  return (
    <>
      <PageHeader
        title="Strategies"
        actions={
          isManager ? (
            // Phase 200 D-12: the manager's ONE entry point to add a strategy,
            // straight to the wizard (`/strategies/new` is only a redirect now).
            <Link href="/strategies/new/wizard">
              <Button>Add a strategy</Button>
            </Link>
          ) : undefined
        }
      />

      {/* 170.1 D-07 / UI-SPEC V-1: renders whether or not the list read
          succeeded. When it failed there is no list, so "listed below as
          pending review" would be false (170.1-REVIEW SFH-3): the line is cut
          to "Strategy submitted." and the unreadable card below states the read
          failure itself. A square data panel (DESIGN.md): no radius, no shadow,
          no icon, and no truncation, so it wraps by word at 390 px. */}
      {justSubmitted && (
        <p
          role="status"
          data-testid="wizard-submitted-status"
          className="mb-4 border border-border bg-surface px-4 py-3 text-small text-text-primary"
        >
          {strategiesUnreadable
            ? "Strategy submitted."
            : "Strategy submitted. It is listed below as pending review."}
        </p>
      )}

      {isManager && introRequests && introRequests.length > 0 && (
        <PendingIntros requests={introRequests as Parameters<typeof PendingIntros>[0]["requests"]} />
      )}

      {isManager && wizardDraft && (
        <Card
          data-testid="wizard-draft-resume-banner"
          data-rejected={wizardDraftRejected ? "true" : "false"}
          // 2026-10-09 Phase 170.7 D-08: review feedback is recoverable -> amber (DESIGN.md colour gate)
          className={
            wizardDraftRejected
              ? "mb-3 border-warning/40 bg-warning/5"
              : "mb-3 border-accent/40 bg-accent/5"
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {wizardDraftRejected ? (
                <>
                  <p className="text-sm font-medium text-text-primary">
                    Your strategy submission was sent back for changes.
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {wizardDraft.name
                      ? `"${wizardDraft.name}" needs revisions before it can be published.`
                      : "Your draft needs revisions before it can be published."}
                  </p>
                  {/* No fill, no padding of its own: it sits on the shell's single
                      bg-warning/5 layer (4.68:1); a second layer is 4.39:1 (AD-06). */}
                  <p className="mt-2 text-xs text-warning">
                    Review feedback: {wizardDraft.review_note}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-text-primary">
                    You have an unfinished strategy draft.
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {wizardDraft.name
                      ? `"${wizardDraft.name}" — started ${formatDay(wizardDraft.created_at)}. Drafts expire after 30 days.`
                      : `Started ${formatDay(wizardDraft.created_at)}. Drafts expire after 30 days.`}
                  </p>
                </>
              )}
            </div>
            <Link href="/strategies/new/wizard">
              <Button size="sm">
                {wizardDraftRejected ? "Revise & resubmit" : "Resume draft"}
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* UI-SPEC read-failure order: the list read's own card replaces the table
          below; this line is the placeholder-key read's. One muted line, above
          the note, and it stands whether or not any row loaded (T-199-25). */}
      {placeholderKeysUnreadable && (
        <p
          data-testid="strategies-placeholder-keys-unreadable"
          className="mb-4 text-sm text-text-secondary"
        >
          <DegradeLine
            id="strategies.placeholder-keys-unreadable"
            segments={degradeSegments("strategies.placeholder-keys-unreadable", undefined)}
          />
        </p>
      )}

      {strategiesUnreadable ? (
        // H-1 (UI-SPEC KCS-LIST-UNREADABLE): muted, not red. Nothing is known
        // to be wrong with the strategies, only with this read of them.
        <Card className="text-center py-12" data-testid="strategies-list-unreadable">
          <DegradeLine
            id="strategies.list-unreadable"
            element="p"
            className="text-text-muted"
            segments={degradeSegments("strategies.list-unreadable", undefined)}
          />
        </Card>
      ) : !hasRows ? (
        // Phase 199 plan 10 (D-02): the empty state is the role's own. It is an
        // ACCOUNT-STATE claim ("you have nothing"), so a failed placeholder-key
        // read (T-199-25) renders neither it nor a table: the line above is the
        // whole degraded surface.
        placeholderKeysUnreadable ? null : isManager ? (
          // Phase 199 plan 16 (D-04): one registry id for the manager's empty card, in
          // both its variants (a draft in progress, or nothing at all).
          <Card className="text-center py-12" data-degrade-id="strategies.empty">
            {wizardDraft ? (
              <>
                <p className="text-text-muted mb-4">
                  No published strategies yet — but you have a draft in progress.
                </p>
                <Link href="/strategies/new/wizard">
                  <Button>Resume your draft</Button>
                </Link>
              </>
            ) : (
              // D-12 / LEAN-04: no second create control. The header's
              // `Add a strategy` is the one entry point.
              <p className="text-text-muted">
                No strategies yet. Use Add a strategy above to start one.
              </p>
            )}
          </Card>
        ) : (
          // Allocator only: a CLIENT ACTION that opens the wizard overlay, never a
          // link into the manager-guarded /strategies subtree.
          <StrategiesEmptyState />
        )
      ) : (
        <div className="space-y-3">
          {/* H-3 (UI-SPEC KCS-KEYSTATUS-UNREADABLE): one muted line, once per
              page, only when a key-status or member read failed. */}
          {keyStatusUnreadable && (
            <p
              data-testid="strategies-key-status-unreadable"
              className="text-xs text-text-muted"
            >
              <DegradeLine
                id="strategies.key-status-unreadable"
                segments={degradeSegments("strategies.key-status-unreadable", undefined)}
              />
            </p>
          )}
          {/* Phase 199 plan 10 (D-02): the Phase 149 note, for every role. It
              explains the `#` every viewer sees. */}
          <p
            data-testid="comparison-set-note"
            className="mb-6 text-small text-text-secondary"
          >
            {noteParts.join(" ")}
          </p>
          {/* Phase 199 (D-02): one client host for every role. The page builds the
              role's furniture on the server (`managerRows`) and the host mints
              the Mark and Rename callbacks only under `allocatorFurniture`. The
              origin is the page's own (R-04): rows link `?from=strategies`.
              A prefs-SCOPE key, not a discovery category, is derived from it. No
              `userId` is passed, so the table persists no sort or density here
              and `initialSort` is not overwritten by a hydrated preference. */}
          <StrategiesSection
            strategies={rows}
            origin={{ key: "strategies" }}
            placeholderKeys={placeholderRows}
            portfolioId={portfolio?.id ?? null}
            percentiles={own?.ownMap ?? null}
            managerRows={managerRows}
            allocatorFurniture={isAllocator}
            initialSort={{ key: "created_at", dir: "desc" }}
          />
        </div>
      )}

      {/* Phase 199 plan 14 (D-03, SC-3): the legend explains every Health word
          and chip the table can print. It carries its own mt-6, sits outside
          the table's `space-y-3` stack, and renders only where there IS a table:
          an empty or unreadable page has nothing to explain. */}
      {!strategiesUnreadable && hasRows && <StrategiesLegend />}
    </>
  );
}
