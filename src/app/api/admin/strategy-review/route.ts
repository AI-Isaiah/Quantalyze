import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyManagerApproved } from "@/lib/email";
import { checkStrategyGate, isLedgerBackedExchange, StrategyGateUnevaluableError, STRATEGY_GATE_MIN_TRADES, STRATEGY_GATE_MIN_CSV_ROWS } from "@/lib/strategyGate";
import { logAuditEventAsUser } from "@/lib/audit";
// 140.4-16 / WR-04 — this route imports NONE of the three seam modules, so
// `seam-log-coverage.test.ts`'s derived roster is structurally blind to it and
// SEAMRIM-06 never inspected these sites. The same predicate runs colocated in
// `route.test.ts`; see the docblock there before adding a console site.
import { scrubSeamError } from "@/lib/seam-redaction";

/**
 * C-3 — the publish-side read discipline for this route.
 *
 * supabase-js RESOLVES a failed read; it does not throw. So an unbound `error`
 * makes a read failure indistinguishable from real data, and the coercions that
 * follow (`?? 0`, `?.timestamp ?? null`) turn it into a MEASUREMENT about the
 * manager's account. On the approve path that measurement feeds `checkStrategyGate`,
 * whose only consumer here is the `{ status: "published" }` write below.
 *
 * The two guards that predate this one (csv-count, api_keys exchange) both
 * defend the fail-CLOSED direction — a false REJECTION. Nothing defended the
 * fail-OPEN direction, which is the one that publishes: a failed earliest/latest
 * timestamp read made the gate's span null, which skipped the 7-day check
 * entirely and returned PASS. Every read that participates in the decision now
 * answers 503 ABOUT US, before any write.
 *
 * NO-ROWS IS NOT A READ FAILURE. PostgREST reports "0 rows" from `.single()` as
 * an error object carrying code PGRST116 (it uses the same code when a
 * `.single()` matches more than one row). In BOTH shapes `data` is null, so the
 * value reaching the gate is the same one an absent row would produce, and the
 * gate already has a fail-CLOSED verdict for it — NO_DATA_SOURCE or
 * ANALYTICS_MISSING, both 400. Answering 503 there would replace a manager's
 * actionable "sync trades first" with an outage message, and it can never be the
 * fail-open direction. Every OTHER error is a read we could not perform.
 */
const POSTGREST_NO_ROWS = "PGRST116";

function isReadFailure(err: { code?: string } | null | undefined): boolean {
  return Boolean(err) && err?.code !== POSTGREST_NO_ROWS;
}

// Handler body inlined (rather than wrapped via withAdminAuth) so we run a
// single createClient + getUser + isAdminUser round-trip per request.
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── 140.3-G9 / SEAMUX-03 — a machine `code` on EVERY arm this route emits ──
  // The tenth seam-importing production route (the one the 140.3-VERIFICATION
  // nine-route list MISSED): its only seam import is `scrubSeamError` and it
  // makes no analytics-service call, so it is in the class by the class
  // definition (seam-importing route), and every arm below is admin-reachable.
  // A consumer discriminates on a stable token instead of sniffing the prose
  // (140.3-12's to reword). ONE-FACT-ONE-TOKEN (keys/sync:108-120 doctrine):
  // all thirteen byte-identical "Cannot verify strategy data source" 503 arms
  // carry the SAME `REVIEW_SOURCE_READ_FAILED` — WHICH read failed is our
  // internal accounting (the console.error names it), off the wire; and every
  // 409 re-check arm carries the SAME `REVIEW_RECHECK_FAILED`. UNAUTHENTICATED
  // / FORBIDDEN are inline gate codes, NOT WizardErrorCode members: admin-only
  // arms must never force wizard copy. Additive only — no status, sentence or
  // header changed, and the byte-identical-sibling-bodies property survives.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  // 403 body says "Forbidden" (distinct from 401 "Unauthorized") so callers
  // can branch on the failure mode.
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "VALIDATION_FAILED" }, { status: 400 });
  }

  // B9 boundary-validation parity (M-1143): validate the admin POST body with a
  // Zod schema rather than ad-hoc truthy checks. The defect this closes:
  // `review_note` was written into strategies.review_note (unbounded TEXT) on
  // the reject path with NO length cap — only the audit-metadata COPY (L220-227
  // below) was bounded, so an admin (or hijacked admin session) could bloat the
  // row with a multi-megabyte note. `.max(2000)` rejects it at the boundary
  // (fail-loud 400) before the DB write. `id`/`action` semantics are preserved
  // (non-empty id + approve|reject enum), so existing callers are unaffected.
  // Parse stays BEFORE the rate limiter (B15b ordering) so a malformed body
  // never burns an admin token.
  const parsed = z
    .object({
      id: z.string().min(1),
      action: z.enum(["approve", "reject"]),
      review_note: z.string().max(2000).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", code: "VALIDATION_FAILED" }, { status: 400 });
  }
  const { id, action, review_note } = parsed.data;

  // B15b (audit-2026-05-07): rate-limit AFTER input validation so a
  // malformed/invalid body (rejected 400 above) never consumes one of the
  // admin's adminActionLimiter tokens.
  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:strategy-review`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  const admin = createAdminClient();

  let strategyData: { api_key_id: string | null; name: string; user_id: string } | null = null;
  // P72 — the linked key's id + whether its exchange is ledger-backed (Deribit).
  // Both are resolved in the first-pass approve block and reused by the TOCTOU
  // re-check (immutable across the review window). Captured into plain locals so
  // the re-check predicate does not depend on `strategyData`'s cross-block type.
  let approveApiKeyId: string | null = null;
  let isLedgerBacked = false;

  if (action === "approve") {
    const [
      { data: strategy, error: strategyError },
      { count: tradeCount, error: tradeCountError },
      { data: earliestTrade, error: earliestTradeError },
      { data: latestTrade, error: latestTradeError },
      { data: analytics, error: analyticsError },
      { count: csvRowCount, error: csvCountError },
    ] = await Promise.all([
      admin.from("strategies").select("api_key_id, name, user_id").eq("id", id).single(),
      admin.from("trades").select("id", { count: "exact", head: true }).eq("strategy_id", id),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: true }).limit(1),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: false }).limit(1),
      admin.from("strategy_analytics").select("computation_status, computation_error").eq("strategy_id", id).single(),
      // CSV-uploaded strategies keep their history in csv_daily_returns, not
      // `trades`. Count it so the gate recognizes it as a valid data source
      // (else every CSV strategy is un-approvable — NO_DATA_SOURCE).
      admin.from("csv_daily_returns").select("strategy_id", { count: "exact", head: true }).eq("strategy_id", id),
    ]);

    // Fail LOUD on a csv-count read error rather than coercing to 0: a silent
    // `csvRowCount = 0` would return the misleading NO_DATA_SOURCE 400 for a
    // CSV strategy that DOES have data (re-creating the very bug this fixes),
    // with no diagnostic trail. Mirrors the verify-strategy count-read guard.
    if (csvCountError) {
      console.error("[admin/strategy-review] csv_daily_returns count failed:", scrubSeamError(csvCountError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }

    // C-3 — the other five members of the same Promise.all. Each read below
    // feeds `checkStrategyGate` (or the key lookup that selects its branch), so
    // a coerced value here is a claim about the strategy that nobody measured.
    // Same sentence as the guard above, reused verbatim: the failure is ours,
    // and the manager can retry it.
    if (isReadFailure(strategyError)) {
      console.error("[admin/strategy-review] strategies read failed:", scrubSeamError(strategyError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    // A null count with NO error is equally unrepresentable: `?? 0` would hand
    // the gate "this strategy has zero trades" — the exact fabrication this
    // finding is about — and zero trades is a verdict (INSUFFICIENT_TRADES),
    // not an absence of one.
    if (isReadFailure(tradeCountError) || tradeCount === null) {
      console.error("[admin/strategy-review] trades count read failed:", tradeCountError ? scrubSeamError(tradeCountError) : "count was null with no error");
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    // THE publish-side fail-open. A failed earliest/latest read left the gate's
    // span null, and `spanDays !== null &&` skipped the 7-day history check
    // entirely — an under-history track record published as verified. The two
    // probes are guarded separately so the log names which one failed.
    if (isReadFailure(earliestTradeError)) {
      console.error("[admin/strategy-review] earliest trade read failed:", scrubSeamError(earliestTradeError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    if (isReadFailure(latestTradeError)) {
      console.error("[admin/strategy-review] latest trade read failed:", scrubSeamError(latestTradeError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    // No-rows is NOT a failure here (see isReadFailure): an absent analytics row
    // is the ANALYTICS_MISSING verdict the gate already returns, and answering
    // 503 to it would turn "sync your trades first" into an outage message.
    if (isReadFailure(analyticsError)) {
      console.error("[admin/strategy-review] strategy_analytics read failed:", scrubSeamError(analyticsError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }

    // P72 — resolve the linked key's exchange so the gate can distinguish a
    // ledger-backed (Deribit) keyed strategy — which legitimately has zero
    // `trades` and a `csv_daily_returns` series — from a keyed FILL-based (perp)
    // strategy whose 0-trade + funding-series state must NOT publish (no
    // completeness gate). Immutable across the review window, so fetched once
    // and reused for the TOCTOU re-check below.
    approveApiKeyId = strategy?.api_key_id ?? null;
    if (approveApiKeyId) {
      const { data: keyRow, error: keyRowError } = await admin
        .from("api_keys")
        .select("exchange")
        .eq("id", approveApiKeyId)
        .maybeSingle();
      // Fail LOUD (WR-01): a coerced `isLedgerBacked=false` on a transient read
      // error would reject a legitimate Deribit onboarding with a misleading
      // "0 trades / INSUFFICIENT_TRADES" 400. Mirror the csvCountError 503 guard
      // above — never let an unread venue silently divert the gate branch.
      if (keyRowError) {
        console.error("[admin/strategy-review] api_keys exchange lookup failed:", scrubSeamError(keyRowError));
        return NextResponse.json(
          { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
          { status: 503 },
        );
      }
      isLedgerBacked = isLedgerBackedExchange(keyRow?.exchange);
    }

    // `checkStrategyGate` is PARTIAL: it refuses (throws) rather than answering
    // for an input it cannot evaluate — trades present, span unreadable. The
    // guards above should make that unreachable from here, and the arm exists
    // anyway: a refusal must never decay into a verdict. The catch is narrowed
    // by `instanceof` and rethrows everything else — swallowing an unknown
    // throw at the last gate before the publish write is how a fail-open
    // returns.
    let gate;
    try {
      gate = checkStrategyGate({
        apiKeyId: strategy?.api_key_id ?? null,
        tradeCount,
        earliestTradeAt: earliestTrade?.[0]?.timestamp ? new Date(earliestTrade[0].timestamp) : null,
        latestTradeAt: latestTrade?.[0]?.timestamp ? new Date(latestTrade[0].timestamp) : null,
        computationStatus: analytics?.computation_status ?? null,
        computationError: analytics?.computation_error ?? null,
        csvRowCount: csvRowCount ?? 0,
        isLedgerBacked,
      });
    } catch (err) {
      if (!(err instanceof StrategyGateUnevaluableError)) throw err;
      console.error("[admin/strategy-review] gate refused to evaluate:", scrubSeamError(err));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }

    if (!gate.passed) {
      return NextResponse.json({ error: `Cannot approve: ${gate.reason}`, code: "GUARD_BLOCKED" }, { status: 400 });
    }

    strategyData = strategy as typeof strategyData;
  }

  const update = action === "approve"
    ? { status: "published", review_note: null }
    : { status: "draft", review_note: (review_note as string) || "Needs changes before approval." };

  // audit-2026-05-07 C-0060 — TOCTOU hardening for the approve path.
  //
  // The gate above runs five SELECTs in parallel, then a separate UPDATE
  // flips status='published'. Between the read and the write, cron-sync
  // can mutate `trades` or set `strategy_analytics.computation_status`
  // back to 'computing'/'failed', and the admin's click would still
  // publish the strategy.
  //
  // PostgREST cannot express a cross-table UPDATE WHERE predicate, so we
  // close the race with two layers:
  //  1. A final sequential gate re-check immediately before the UPDATE
  //     (tightens the window from "5 parallel SELECTs + JS work" to
  //     "two awaited SELECTs and the UPDATE round-trip").
  //  2. A status-pinning UPDATE filter (.eq('status','pending_review'))
  //     combined with .select('id'): the UPDATE only matches rows still
  //     in the review queue, and `affected.length===0` distinguishes
  //     concurrent-state-change (409) from a genuine DB error (500).
  //
  // The reject path keeps a single .eq('id') UPDATE — flipping back to
  // 'draft' is idempotent regardless of any intervening state.
  if (action === "approve") {
    const [
      { count: recheckTradeCount, error: recheckTradeCountError },
      { count: recheckCsvCount, error: recheckCsvError },
      { data: recheckAnalytics, error: recheckAnalyticsError },
    ] = await Promise.all([
      // P72: the strategies `api_key_id` re-check was dropped — the
      // daily-returns predicate below no longer keys off `!api_key_id`
      // (keyed ledger-backed exchanges also route through csv_daily_returns),
      // so the query fed nothing and is removed.
      admin
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("strategy_id", id),
      admin
        .from("csv_daily_returns")
        .select("strategy_id", { count: "exact", head: true })
        .eq("strategy_id", id),
      admin
        .from("strategy_analytics")
        .select("computation_status")
        .eq("strategy_id", id)
        .single(),
    ]);
    // Fail loud on a csv-count read error here too (same rationale as the
    // first-pass guard) — a coerced 0 would misclassify a CSV strategy onto
    // the trade branch and 409 it with a misleading "trade count" message.
    if (recheckCsvError) {
      console.error("[admin/strategy-review] csv_daily_returns re-check count failed:", scrubSeamError(recheckCsvError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    // C-3 — the re-check's other two reads. Both decide 409-vs-publish, so an
    // unread value here is answered about US, never as a 409 claiming the
    // strategy's trade count or analytics changed during review. A null count
    // with no error is refused for the same reason as the first-pass one.
    if (isReadFailure(recheckTradeCountError) || recheckTradeCount === null) {
      console.error("[admin/strategy-review] trades re-check count failed:", recheckTradeCountError ? scrubSeamError(recheckTradeCountError) : "count was null with no error");
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    if (isReadFailure(recheckAnalyticsError)) {
      console.error("[admin/strategy-review] strategy_analytics re-check read failed:", scrubSeamError(recheckAnalyticsError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    // Daily-returns-sourced strategies (zero trades, history in
    // csv_daily_returns) must re-check the CSV row count, not the trade count —
    // the trade branch would 409 every such strategy on a `trades < 5` that is 0
    // by construction. This covers keyless CSV uploads AND keyed LEDGER-BACKED
    // exchanges (Deribit) — but NOT a keyed fill-based (perp) strategy whose
    // 0-trade + funding-series state must stay on the trade branch. Mirrors the
    // first-pass gate's isDailyReturnsSourced predicate EXACTLY (P72), including
    // the `!api_key_id || isLedgerBacked` venue term — the two must never diverge.
    const isDailyReturnsSourced =
      recheckTradeCount === 0 &&
      (recheckCsvCount ?? 0) > 0 &&
      (!approveApiKeyId || isLedgerBacked);
    if (isDailyReturnsSourced) {
      if ((recheckCsvCount ?? 0) < STRATEGY_GATE_MIN_CSV_ROWS) {
        return NextResponse.json(
          { error: "Cannot approve: CSV history fell below threshold during review.", code: "REVIEW_RECHECK_FAILED" },
          { status: 409 },
        );
      }
    } else if (recheckTradeCount < STRATEGY_GATE_MIN_TRADES) {
      return NextResponse.json(
        { error: "Cannot approve: trade count fell below threshold during review.", code: "REVIEW_RECHECK_FAILED" },
        { status: 409 },
      );
    }
    // complete_with_warnings is a terminal success the first-pass gate
    // (strategyGate.ts, a deny-list) admits; the re-check must too, or a warned
    // strategy passes the gate then 409s here — un-approvable (mig 20260707120000).
    if (!isComputedAnalytics(recheckAnalytics?.computation_status)) {
      return NextResponse.json(
        { error: "Cannot approve: analytics no longer complete.", code: "REVIEW_RECHECK_FAILED" },
        { status: 409 },
      );
    }

    // PUB-01 (Phase 87) defense-in-depth — a pure READ of terminal queue state,
    // AFTER the isComputedAnalytics primary gate (its error precedence is
    // unchanged). For a composite (>=1 strategy_keys member) the primary gate
    // reads strategy_analytics.computation_status; this additionally requires
    // the LATEST stitch_composite compute_jobs row to be status='done'. It
    // catches the pathological class where computation_status is laundered to
    // complete while the member fan-out stitch never finished. LOCKED-compliant:
    // it READS the worker's terminal state and never re-derives member
    // completeness (Pitfall 4) — no write, no worker/enqueue change here.
    //
    // Scoped to >=1 member so the single-key / CSV approve path is byte-
    // unchanged (SC-4): a zero-member strategy never issues the compute_jobs
    // read at all — the head-count short-circuits it.
    const { count: memberCount, error: memberCountError } = await admin
      .from("strategy_keys")
      .select("api_key_id", { count: "exact", head: true })
      .eq("strategy_id", id);
    // Fail LOUD (WR-01): a coerced memberCount=0 on a transient read error would
    // silently skip the composite check and could publish a holed composite.
    // Mirror the csvCountError 503 guard above — never divert the branch quietly.
    if (memberCountError) {
      console.error("[admin/strategy-review] strategy_keys count failed:", scrubSeamError(memberCountError));
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
        { status: 503 },
      );
    }
    if ((memberCount ?? 0) >= 1) {
      // Latest generation wins by immutable created_at (updated_at is trigger-
      // clobbered to now() on every touch, so it is NOT a stable ordering key —
      // matches Plan 01's supersession key).
      const { data: latestStitchJob, error: stitchJobError } = await admin
        .from("compute_jobs")
        .select("status")
        .eq("strategy_id", id)
        .eq("kind", "stitch_composite")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (stitchJobError) {
        console.error("[admin/strategy-review] compute_jobs stitch lookup failed:", scrubSeamError(stitchJobError));
        return NextResponse.json(
          { error: "Cannot verify strategy data source. Please try again.", code: "REVIEW_SOURCE_READ_FAILED" },
          { status: 503 },
        );
      }
      // Missing row OR any non-done terminal/in-flight state blocks publish.
      // Least-disclosure message (no job ids / internals), matching the sibling
      // 409s above.
      if (latestStitchJob?.status !== "done") {
        return NextResponse.json(
          { error: "Cannot approve: composite computation is not complete.", code: "REVIEW_RECHECK_FAILED" },
          { status: 409 },
        );
      }
    }

    // @audit-skip: audit-event is emitted by the strategy.approve / strategy.reject
    // logAuditEvent call further down in this same function (after the
    // revalidateTag block) — covers BOTH the approve UPDATE here and the reject
    // UPDATE in the else branch. The audit-coverage walker can't see across
    // this if/else's closing brace, but the contract is intact.
    const { data: updated, error } = await admin
      .from("strategies")
      .update(update)
      .eq("id", id)
      .eq("status", "pending_review")
      .select("id");

    if (error) {
      // Beyond the plan's floor: a write fault, not a source read. It is the
      // publish UPDATE failing, so neither REVIEW_SOURCE_READ_FAILED (a read we
      // depend on) nor REVIEW_RECHECK_FAILED (state moved during review) fits —
      // it is a server fault we did not classify. UNKNOWN, the union's own
      // terminal-server-fault token (the eval sibling's 500 uses it).
      return NextResponse.json({ error: "Update failed", code: "UNKNOWN" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      // No row matched (id+status). Either the strategy left
      // `pending_review` between the gate check and the UPDATE, or it was
      // never in review. Return 409 so the admin retries instead of
      // assuming success. Beyond the plan's four listed 409s — but the SAME
      // re-check fact class (state changed during review; publish refused), so
      // the SAME token.
      return NextResponse.json(
        { error: "Strategy is no longer awaiting review.", code: "REVIEW_RECHECK_FAILED" },
        { status: 409 },
      );
    }
  } else {
    // @audit-skip: same rationale as the approve UPDATE above — the
    // strategy.reject audit fires at the logAuditEvent below this if/else.
    const { error } = await admin.from("strategies").update(update).eq("id", id);

    if (error) {
      // Beyond the plan's floor (reject-path write fault) — same rationale as
      // the approve-path 500 above: an unclassified server fault → UNKNOWN.
      return NextResponse.json({ error: "Update failed", code: "UNKNOWN" }, { status: 500 });
    }
  }

  // Bust just this strategy's v2 factsheet payload so a publish/unpublish
  // flip reflects immediately rather than serving stale for up to the
  // 3600s TTL. Per-id tag (rather than the global `factsheet-v2`) keeps
  // unrelated strategies' cached payloads warm — important at scale where
  // a batch of approvals would otherwise trigger a thundering-herd
  // recomputation of every cached factsheet. Next 16 signature is
  // `revalidateTag(tag, profile)`; "max" is the longest-lived cacheLife.
  try {
    revalidateTag(`factsheet-v2:${id as string}`, "max");
  } catch (err) {
    // revalidateTag throws if called outside a request context. Other
    // exceptions (API drift, tag misconfiguration) shouldn't be swallowed
    // silently — `console.error` so Vercel observability surfaces them
    // (matches the precedent at the manager-notify catch below).
    console.error(
      "[admin/strategy-review] revalidateTag failed (non-fatal):",
      scrubSeamError(err),
    );
  }

  // Audit the approve/reject decision. review_note is truncated to bound the
  // audit row size (capAuditMetadata in emit() also caps at 1024, but this
  // ad-hoc 2000-char slice pre-dates the central cap and is kept as an
  // explicit belt-and-suspenders marker for reviewers).
  //
  // NEW-C10-01 (audit-2026-05-26 security): switched from logAuditEvent
  // (user-scoped, deferred after()) to logAuditEventAsUser (service-role,
  // JWT-immune) so a strategy approve/reject audit row cannot be lost to
  // an admin JWT expiring between response flush and after() settle.
  // strategy.approve / strategy.reject are security-critical writes.
  const REVIEW_NOTE_AUDIT_CAP = 2000;
  const rawReviewNote = (review_note as string) || null;
  const reviewNoteForAudit =
    rawReviewNote !== null
      ? rawReviewNote.slice(0, REVIEW_NOTE_AUDIT_CAP)
      : null;
  const reviewNoteTruncated =
    rawReviewNote !== null && rawReviewNote.length > REVIEW_NOTE_AUDIT_CAP;
  logAuditEventAsUser(admin, user.id, {
    action: action === "approve" ? "strategy.approve" : "strategy.reject",
    entity_type: "strategy",
    entity_id: id as string,
    metadata:
      action === "approve"
        ? { new_status: "published" }
        : {
            new_status: "draft",
            review_note: reviewNoteForAudit,
            review_note_truncated: reviewNoteTruncated,
          },
  });

  if (action === "approve") {
    const sd = strategyData!;
    if (sd?.user_id) {
      Promise.resolve(
        admin.from("profiles").select("email").eq("id", sd.user_id).single()
      ).then(({ data: profile }) => {
        if (profile?.email) {
          // M-1152: RETURN the async notify so its promise is chained into the
          // .catch() below. notifyManagerApproved is async (awaits send()), so
          // without the `return` its rejection is a discarded floating promise
          // and the .catch() can NEVER fire on a real Resend/SMTP failure —
          // making the tagged log (and any test of it) illusory.
          return notifyManagerApproved(profile.email, sd.name, id as string);
        }
      }).catch((err) =>
        console.error(
          "[admin/strategy-review] manager-approval notify failed:",
          scrubSeamError(err),
        ),
      );
    }
  }

  return NextResponse.json({ success: true });
}
