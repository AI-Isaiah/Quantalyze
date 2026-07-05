import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyManagerApproved } from "@/lib/email";
import { checkStrategyGate, isLedgerBackedExchange, STRATEGY_GATE_MIN_TRADES, STRATEGY_GATE_MIN_CSV_ROWS } from "@/lib/strategyGate";
import { logAuditEventAsUser } from "@/lib/audit";

// Handler body inlined (rather than wrapped via withAdminAuth) so we run a
// single createClient + getUser + isAdminUser round-trip per request.
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // 403 body says "Forbidden" (distinct from 401 "Unauthorized") so callers
  // can branch on the failure mode.
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
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
      { error: "Too many requests" },
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
      { data: strategy },
      { count: tradeCount },
      { data: earliestTrade },
      { data: latestTrade },
      { data: analytics },
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
      console.error("[admin/strategy-review] csv_daily_returns count failed:", csvCountError);
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again." },
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
      const { data: keyRow } = await admin
        .from("api_keys")
        .select("exchange")
        .eq("id", approveApiKeyId)
        .maybeSingle();
      isLedgerBacked = isLedgerBackedExchange(keyRow?.exchange);
    }

    const gate = checkStrategyGate({
      apiKeyId: strategy?.api_key_id ?? null,
      tradeCount: tradeCount ?? 0,
      earliestTradeAt: earliestTrade?.[0]?.timestamp ? new Date(earliestTrade[0].timestamp) : null,
      latestTradeAt: latestTrade?.[0]?.timestamp ? new Date(latestTrade[0].timestamp) : null,
      computationStatus: analytics?.computation_status ?? null,
      computationError: analytics?.computation_error ?? null,
      csvRowCount: csvRowCount ?? 0,
      isLedgerBacked,
    });

    if (!gate.passed) {
      return NextResponse.json({ error: `Cannot approve: ${gate.reason}` }, { status: 400 });
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
      { count: recheckTradeCount },
      { count: recheckCsvCount, error: recheckCsvError },
      { data: recheckAnalytics },
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
      console.error("[admin/strategy-review] csv_daily_returns re-check count failed:", recheckCsvError);
      return NextResponse.json(
        { error: "Cannot verify strategy data source. Please try again." },
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
      (recheckTradeCount ?? 0) === 0 &&
      (recheckCsvCount ?? 0) > 0 &&
      (!approveApiKeyId || isLedgerBacked);
    if (isDailyReturnsSourced) {
      if ((recheckCsvCount ?? 0) < STRATEGY_GATE_MIN_CSV_ROWS) {
        return NextResponse.json(
          { error: "Cannot approve: CSV history fell below threshold during review." },
          { status: 409 },
        );
      }
    } else if ((recheckTradeCount ?? 0) < STRATEGY_GATE_MIN_TRADES) {
      return NextResponse.json(
        { error: "Cannot approve: trade count fell below threshold during review." },
        { status: 409 },
      );
    }
    if (recheckAnalytics?.computation_status !== "complete") {
      return NextResponse.json(
        { error: "Cannot approve: analytics no longer complete." },
        { status: 409 },
      );
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
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      // No row matched (id+status). Either the strategy left
      // `pending_review` between the gate check and the UPDATE, or it was
      // never in review. Return 409 so the admin retries instead of
      // assuming success.
      return NextResponse.json(
        { error: "Strategy is no longer awaiting review." },
        { status: 409 },
      );
    }
  } else {
    // @audit-skip: same rationale as the approve UPDATE above — the
    // strategy.reject audit fires at the logAuditEvent below this if/else.
    const { error } = await admin.from("strategies").update(update).eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
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
      err,
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
          err?.message ?? err,
        ),
      );
    }
  }

  return NextResponse.json({ success: true });
}
