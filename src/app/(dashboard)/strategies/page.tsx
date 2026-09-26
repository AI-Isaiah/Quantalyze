import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StrategyActions } from "@/components/strategy/StrategyActions";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
// Server component: import the predicate from the NON-client module. Importing
// it from ShareableLink.tsx compiles but throws at request time.
import { isPublishedStatus, shareAffordanceMode } from "@/lib/share-affordance";
// Same rule for the Phase 167.2 predicates and copy: every module CALLED here
// carries no client directive. AllocatorSyncStatus is only RENDERED.
import { isComputedAnalytics, isUntrustedKeySyncStatus } from "@/lib/closed-sets";
import {
  deriveComputeState,
  recipientArm,
  type RecipientArm,
} from "@/lib/compute-state";
import { readOwnerComputeJobs } from "@/lib/compute-jobs-read";
import {
  compositeHistoryOf,
  shouldPreferStitch,
  type CompositeMemberCount,
} from "@/lib/strategy-shape";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  KEY_STATUS_UNREADABLE_NOTE,
  probeUnreadableShareNote,
  recipientShareNote,
  recipientShareNoteFor,
  STRATEGIES_LIST_UNREADABLE,
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
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 167.2 / KCS-06 — the key-status projection this page reads. An
 * ALLOWLIST of the five columns the pill needs: `api_keys` is column-granted,
 * and the encrypted columns must never ride a wide select.
 */
const KEY_STATUS_COLUMNS = "id, exchange, sync_status, sync_error, last_sync_at";

interface KeyStatusRow {
  id: string;
  exchange: string;
  sync_status: string | null;
  sync_error: string | null;
  last_sync_at: string | null;
}

interface StrategyKeyMemberRow {
  strategy_id: string;
  api_key_id: string;
  seq: number;
}

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
 * come from the first key seen in that status; the caption names every
 * distinct exchange in it. A key id with no row read (not the owner's, or the
 * read failed) contributes nothing: no guessed pill.
 */
function untrustedKeyLines(
  feedingKeyIds: readonly string[],
  keysById: ReadonlyMap<string, KeyStatusRow>,
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
    caption: untrustedKeyCaption(
      keys.map((k) => k.exchange),
      keys.length,
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
 */
async function readRecipientArm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  strategyId: string,
  // 167.2-REVIEW IN-03 / 167.2-REVIEW-R2 IN-05: the inputs of
  // `shouldPreferStitch`. A zero member count drops stitch preference only
  // for a proven single-key strategy (a linked key, or no stitch in the rows
  // read below), because RLS can fabricate a zero count.
  stitchInputs: { memberCount: CompositeMemberCount; apiKeyId: string | null },
): Promise<RecipientArm> {
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
    return recipientArm(deriveComputeState({ readError: true }));
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
  return recipientArm(
    deriveComputeState({
      rows: read.rows,
      readExhaustive: read.readExhaustive,
      nowMs: Date.now(),
      preferStitch: shouldPreferStitch({
        ...stitchInputs,
        compositeHistory: compositeHistoryOf(read),
      }),
    }),
  );
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

export default async function StrategiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Filter out wizard drafts — they belong to the wizard flow and
  // have their own Resume banner at /strategies/new/wizard. Including
  // them here would render a confusing "edit" link pointing at the
  // legacy StrategyForm, which does not understand wizard state.
  // See migration 031: `source` discriminates wizard drafts from
  // legacy / admin_import drafts. The PostgREST `.or()` filter below
  // keeps legacy drafts visible while hiding wizard-in-progress rows.
  const { data: strategies, error: strategiesError } = await supabase
    .from("strategies")
    .select("id, name, status, source, strategy_types, review_note, created_at, api_key_id, strategy_analytics ( computation_status )")
    .eq("user_id", user.id)
    .or("source.neq.wizard,status.neq.draft")
    .order("created_at", { ascending: false });
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
  const { data: wizardDraft } = await supabase
    .from("strategies")
    .select("id, name, created_at, review_note")
    .eq("user_id", user.id)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // M-0255: a rejected wizard draft is the SAME hidden row (source='wizard',
  // status='draft') but with review_note set by the admin reject path. The
  // inline list filter hides it AND the inline review_note render only fires
  // for rows that survive the filter — so the rejection + feedback were never
  // surfaced (and the cleanup cron would CASCADE-delete it). Surface it here in
  // the banner instead, preserving the StrategyForm-routing safety invariant
  // (the Resume CTA targets the wizard, which understands wizard state).
  const wizardDraftRejected = Boolean(wizardDraft?.review_note);

  const strategyIds = strategies?.map((s) => s.id) ?? [];

  const { data: introRequests } = strategyIds.length > 0
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
  // also captured and renders the page-level KEY_STATUS_UNREADABLE_NOTE, so
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
  const armOf = async (
    s: NonNullable<typeof strategies>[number],
    mode: ReturnType<typeof shareAffordanceMode>,
  ): Promise<RecipientArm> =>
    // 167.2-REVIEW IN-04: a published row's note is the public line whatever
    // the arm (`recipientShareNote` / `recipientShareNoteFor` ignore it for
    // "public-url"), so its jobs are not read: that was one RPC per row whose
    // answer, and whose failure log, described a value nobody reads. The arm
    // passed for it is the one that claims least; it is never rendered.
    mode === "public-url"
      ? "not_available"
      : readRecipientArm(
          supabase,
          s.id,
          // IN-03: a failed member read keeps stitch preference.
          {
            memberCount: membersReadFailed
              ? { ok: false, message: "strategy_keys member read failed" }
              : { ok: true, count: membersByStrategy.get(s.id)?.length ?? 0 },
            apiKeyId: s.api_key_id,
          },
        );
  const uncomputedNote = async (
    s: NonNullable<typeof strategies>[number],
    mode: ReturnType<typeof shareAffordanceMode>,
  ): Promise<string> => recipientShareNote(mode, await armOf(s, mode));

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
          if (!isComputedAnalytics(computationStatusOf(s.strategy_analytics))) {
            return [s.id, await uncomputedNote(s, mode)] as const;
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
            kind = probe.buildable ? null : unbuildableNoteKindOf(probe.reason);
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
            return [s.id, await uncomputedNote(s, mode)] as const;
          }
          // D-02: computed, but the builder refuses it (`kind`, above).
          return [s.id, recipientShareNoteFor(mode, await armOf(s, mode), kind)] as const;
        }),
      )
    ).filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
  captureProbeOutcomes(probeOutcomes);
  captureProbeThrows(probeThrows);

  return (
    <>
      <PageHeader
        title="My Strategies"
        actions={
          <Link href="/strategies/new">
            <Button>New Strategy</Button>
          </Link>
        }
      />

      {introRequests && introRequests.length > 0 && (
        <PendingIntros requests={introRequests as Parameters<typeof PendingIntros>[0]["requests"]} />
      )}

      {wizardDraft && (
        <Card
          data-testid="wizard-draft-resume-banner"
          data-rejected={wizardDraftRejected ? "true" : "false"}
          className={
            wizardDraftRejected
              ? "mb-3 border-negative/40 bg-negative/5"
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
                  <p className="mt-2 text-xs text-negative bg-negative/5 rounded px-2 py-1">
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
                      ? `"${wizardDraft.name}" — started ${new Date(wizardDraft.created_at).toLocaleDateString()}. Drafts expire after 30 days.`
                      : `Started ${new Date(wizardDraft.created_at).toLocaleDateString()}. Drafts expire after 30 days.`}
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

      {strategiesUnreadable ? (
        // H-1 (UI-SPEC KCS-LIST-UNREADABLE): muted, not red. Nothing is known
        // to be wrong with the strategies, only with this read of them.
        <Card className="text-center py-12" data-testid="strategies-list-unreadable">
          <p className="text-text-muted">{STRATEGIES_LIST_UNREADABLE}</p>
        </Card>
      ) : (!strategies || strategies.length === 0) ? (
        <Card className="text-center py-12">
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
            <>
              <p className="text-text-muted mb-4">No strategies yet.</p>
              <Link href="/strategies/new">
                <Button>Create your first strategy</Button>
              </Link>
            </>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {/* H-3 (UI-SPEC KCS-KEYSTATUS-UNREADABLE): one muted line, once per
              page, only when a key-status or member read failed. */}
          {keyStatusUnreadable && (
            <p
              data-testid="strategies-key-status-unreadable"
              className="text-xs text-text-muted"
            >
              {KEY_STATUS_UNREADABLE_NOTE}
            </p>
          )}
          {strategies.map((s) => {
            const keyLines = untrustedKeyLines(
              feedingKeyIdsByStrategy.get(s.id) ?? [],
              keysById,
            );
            const shareNote = shareNotes.get(s.id);
            return (
              <Card key={s.id} data-testid="strategy-row">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <Link href={`/strategies/${s.id}/edit`} className="font-medium text-text-primary hover:text-accent transition-colors">
                      {s.name}
                    </Link>
                    <div className="flex gap-1.5 mt-1">
                      {s.strategy_types.map((t: string) => (
                        <Badge key={t} label={t} />
                      ))}
                    </div>
                    {s.review_note && s.status === "draft" && (
                      <p className="mt-2 text-xs text-negative bg-negative/5 rounded px-2 py-1">
                        Review feedback: {s.review_note}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4">
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
                    />
                    <Badge label={s.status} type="status" />
                    <StrategyActions strategyId={s.id} status={s.status} hasApiKey={!!s.api_key_id} hasData={!!s.api_key_id} />
                    <span className="text-xs text-text-muted">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {/* Phase 167.2 / KCS-06 (S4) + KCS-12 (S5) — the footer band, only
                    when the row has something to show. One line per DISTINCT untrusted status,
                    carrying the key card's own pill and helper, mounted exactly
                    as the key card mounts it. The caption names a key and the
                    pill names its state: no claim about the strategy's numbers.
                    Each mount keeps its own helper live region; on this static
                    server render they never change, so they announce nothing. */}
                {(keyLines.length > 0 || shareNote) && (
                  <div
                    data-testid="strategy-row-footer"
                    className="mt-3 border-t border-border pt-3 space-y-2"
                  >
                    {keyLines.map((line) => (
                      <div
                        key={line.status}
                        data-testid="strategy-row-key-mark"
                        className="flex items-start justify-between gap-3"
                      >
                        <p className="text-xs text-text-muted">{line.caption}</p>
                        <AllocatorSyncStatus
                          syncStatus={line.status}
                          syncError={line.first.sync_error}
                          lastSyncAt={line.first.last_sync_at}
                          exchange={line.first.exchange}
                        />
                      </div>
                    ))}
                    {/* KCS-12 (S5) — after any S4 lines; plain text, no role. */}
                    {shareNote && (
                      <p
                        data-testid="strategy-row-share-note"
                        className="text-xs text-text-muted"
                      >
                        {shareNote}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
