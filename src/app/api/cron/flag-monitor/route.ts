/**
 * Phase 19 / BACKBONE-05 — error-rate monitor cron (ALERT-ONLY since Phase 106).
 *
 * Polls Sentry events API every 15 minutes for /process-key error events.
 * Computes error envelope rate — Sentry error EVENTS over /process-key HTTP
 * ATTEMPTS in the same tumbling window. Both sides are ATTEMPT-grained (D-02,
 * Phase 141.2; see getDenominator for why, and for the downward bias that
 * grain carries under retry). Threshold: errorRate > 0.5% with total >= 20 →
 * sends a Resend [ALERT] email to the founder. Sub-threshold (errorRate >
 * 0.25%) sends a WARN email.
 *
 * Phase 106 (Stage B) RETIRED the auto-rollback. The unified backbone is now
 * the only path — the feature_flags kill-switch row (`process_key_unified_backbone`)
 * has zero readers and is inert. This cron NEVER writes it: flipping it would be
 * an outage, not a rollback. Post-Stage-B rollback is `git revert + redeploy`
 * (see the PR body). This monitor is purely an error-rate alerter now.
 *
 * Sentry events API shape verified by scripts/probe-sentry-events-api.sh
 * BEFORE deploy (Assumption A1). The handler parses BOTH `data[0]["count()"]`
 * and `data[0].count` for resilience to a third shape rotation.
 *
 * Pitfall 8: the outbound Sentry query MUST include `environment:production`
 * to prevent dev/preview events (e.g. CI cassette runs) from firing spurious
 * production alerts. The src/instrumentation.ts + analytics-service/
 * sentry_init.py inits both stamp environment from VERCEL_ENV — see
 * tests/integration/sentry-environment.test.ts (H-6).
 *
 * H-2: when audit_log denominator is 0 for >2 consecutive 15-min windows,
 * the cron is a silent no-op. Streak counter in feature_flags row
 * `flag_monitor_zero_denominator_streak` (a DIFFERENT row from the retired
 * kill-switch) triggers a SEV-2 alert email on the 3rd zero window.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { captureToSentry } from "@/lib/sentry-capture";
import { scrubSeamError } from "@/lib/seam-redaction";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sentry organizations are region-locked since the 2023 EU launch — an
// EU-region org (`region_url: https://de.sentry.io` in the auth-token JWT)
// silently returns `{ "data": [] }` (HTTP 200) from the global `sentry.io`
// host. The empty-data response masquerades as "0 errors", causing the
// auto-rollback path to never trip (`errorCount / audit_log_denominator = 0%`
// always). Make the base host explicit via env so EU orgs override; default
// to global for back-compat with US-region orgs.
const SENTRY_BASE =
  process.env.SENTRY_API_BASE ?? "https://sentry.io/api/0/organizations";

const ALERT_THRESHOLD = 0.005; // 0.5% error envelope rate
const WARN_THRESHOLD = 0.0025; // 0.25%
const MIN_SAMPLE = 20;
const ZERO_DENOMINATOR_ALERT_AFTER = 2; // alert when streak exceeds this (i.e. >=3)

const ZERO_DENOM_STREAK_KEY = "flag_monitor_zero_denominator_streak";

// M-7: alert From: header. Hoisted near other constants so a domain-rename
// (e.g. quantalyze.com → quantalyze.app) is a one-line config edit, not a
// scatter through three hard-coded literals.
const ALERT_FROM =
  process.env.RESEND_ALERT_FROM ?? "Quantalyze <alerts@quantalyze.com>";

/** Resilient parse for Sentry events API response. Probe-verified shape is
 *  `data[0]["count()"]` but Sentry has rotated this twice — also accept
 *  `data[0].count` as a fallback. Anything else returns 0 (cron will report
 *  "ok" with 0 errors; safe default — better than throwing). */
function parseSentryCount(payload: unknown): number {
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : null;
  if (!Array.isArray(data) || data.length === 0) return 0;
  const row = data[0] as Record<string, unknown>;
  const v = row?.["count()"] ?? row?.count ?? 0;
  return typeof v === "number" ? v : 0;
}

/**
 * M-19 helpers — extracted from `handle()` so each step is independently
 * readable. Behavior is preserved: each helper returns either a NextResponse
 * (terminal — caller returns immediately) or a numeric/structured result the
 * caller folds into the next step. Tests assert on the same JSON envelopes.
 */

type SentryFetchResult =
  | { kind: "ok"; errorCount: number }
  | { kind: "terminal"; res: NextResponse };

/**
 * OPS-07 (Phase 163) — A FAILED READ MUST PAGE, AND THE STATUS CODE IS HOW.
 *
 * 141.2 distinguished a failed denominator read from a genuinely empty window
 * (the arms in `getDenominator`), which was the right split — but BOTH terminal
 * arms then returned at the default HTTP 200. Vercel's cron history keys "did
 * this run succeed?" off the status code, so a persistent Supabase read failure
 * logged a green run every 15 minutes forever, with the console.warn visible
 * only to someone already looking. That is 141.2's own lesson recurring inside
 * 141.2's own remedy: THE REMEDY REPLACED A WRONG PAGE WITH NO PAGE.
 * Distinguishing a state you then report as success is not distinguishing it.
 *
 * 503 makes the run register FAILED in Vercel cron history — that IS the page
 * channel for this route (Architectural Responsibility Map), and a Sentry
 * capture carries the diagnosis. The cost was priced in when the TODOS entry
 * was filed: a monitor that cannot complete its read IS broken, so the cron
 * history going red is the history becoming accurate, not becoming noisy.
 *
 * ── WR-02 (163 review) — WHY THIS IS `monitorReadFailed` AND NOT
 *    `denominatorReadFailed` ─────────────────────────────────────────────────
 *
 * ⚠️ THE FIRST VERSION OF THIS HELPER CLOSED ONE OF FOUR ARMS, IN THE FILE THAT
 * CONTAINED THE OTHER THREE. This cron computes ONE ratio out of TWO reads, and
 * nothing in the argument above is specific to the denominator — it is about a
 * read this monitor cannot complete. The NUMERATOR's three terminal arms (a
 * throwing `fetch`, a non-ok Sentry response, and missing Sentry credentials)
 * kept answering at the default 200. So a ROTATED OR EXPIRED SENTRY AUTH TOKEN
 * — materially MORE likely than the Supabase read failure that WAS fixed —
 * produced a 401 every 15 minutes, a `{ ok: false }` body nobody reads, and an
 * unbroken run of green in the cron history, while the /process-key error-rate
 * monitor was dead. OPS-07's criterion is "monitors cannot report false
 * health": that is a property of the MONITOR, so the helper is keyed on the
 * monitor rather than on one of its two terms.
 *
 * Every terminal arm in this file now routes through here. A new read added to
 * this cron that answers its own `NextResponse.json({ ok: false, … })` re-opens
 * the class — route it here instead.
 *
 * ⚠️ Email deliberately stays with the existing streak machinery
 * (`handleZeroDenominator`). A failed read is not a zero window and must not
 * advance that streak — its email asserts a diagnosis ("no traffic OR the
 * audit-write is failing") that is FALSE here and would send the operator to
 * the Python audit path for a fault that lives in this query.
 */

/** The denominator arms' shared machine reason. Named so the two of them cannot
 *  drift apart, and so the token that tests and Sentry filters match on has one
 *  definition. */
const DENOMINATOR_READ_FAILED = "denominator_read_failed";

/** Vercel cron treats a non-2xx as a failed run. Named so the terminal arms
 *  cannot drift apart, and so a reader sees it is a signal rather than an
 *  arbitrary code. */
const MONITOR_FAILURE_STATUS = 503;

/** Which half of the ratio the monitor could not read. */
type MonitorTerm = "numerator" | "denominator";

/**
 * Every terminal arm answers identically: a non-200 so the run registers FAILED
 * in the cron history, plus a Sentry capture carrying the diagnosis. Awaited by
 * the caller so the capture is not reaped when the function returns
 * (SEAMRIM-04).
 *
 * The `reason` stays per-arm: making the arms page is orthogonal to keeping
 * them DISTINGUISHABLE, and collapsing `sentry_rate_limited` into
 * `sentry_unreachable` would undo I-perf-cron.
 */
async function monitorReadFailed(args: {
  term: MonitorTerm;
  /** Machine token echoed in the JSON body — one per distinguishable fault. */
  reason: string;
  /** Human detail; becomes the Sentry issue title. */
  detail: string;
  extra: Record<string, unknown>;
  /** Arm-specific body fields (the Sentry non-ok arm carries its headers). */
  body?: Record<string, unknown>;
}): Promise<{ kind: "terminal"; res: NextResponse }> {
  await captureToSentry(
    new Error(`flag-monitor ${args.term} read failed: ${args.detail}`),
    {
      tags: {
        route: "cron.flag-monitor",
        monitor_read_failed: "true",
        monitor_term: args.term,
        // ⚠️ KEPT VERBATIM on the denominator arms. Any Sentry alert rule or
        // saved search written against the 141.2 / OPS-07 tag keeps matching —
        // widening this helper must not silently retire an existing filter.
        ...(args.term === "denominator"
          ? { denominator_read_failed: "true" }
          : {}),
      },
      extra: { ...args.extra, reason: args.reason },
      level: "error",
    },
  );
  return {
    kind: "terminal",
    res: NextResponse.json(
      { ok: false, reason: args.reason, ...(args.body ?? {}) },
      { status: MONITOR_FAILURE_STATUS },
    ),
  };
}

async function getNumerator(args: {
  orgSlug: string;
  sentryToken: string;
}): Promise<SentryFetchResult> {
  // D-16 / SC-N — REPAIRED NUMERATOR. Read this before touching the query.
  //
  // Until Phase 141.1 this query carried a `path:/api/process-key` term and
  // matched ZERO events since Phase 19 — the alert has never fired once. Two
  // independent, separately-sufficient causes, both confirmed by a read-only
  // 90d probe of the production Sentry project:
  //
  //   1. `path` is UNINDEXED on this repo's instrumentation. `onRequestError`
  //      in src/instrumentation.ts writes `path` into Sentry `extra` (metadata
  //      only, not searchable) while `correlation_id`, `routePath`, `routeType`
  //      and `routerKind` go into `tags`. Nothing anywhere calls setTag("path").
  //      Empirically 694/694 production error events report `path` as "".
  //   2. Even promoted to a tag, the VALUE was wrong. There is no
  //      `src/app/api/process-key` route — the endpoint is served by the
  //      FastAPI router in analytics-service (`APIRouter(prefix="/process-key")`
  //      in routers/process_key.py, mounted bare via include_router in main.py),
  //      so the transaction path is `/process-key`; the `/api` prefix is wrong
  //      even against the service that actually serves it.
  //
  // The 2026-05-27 region-URL fix (see SENTRY_BASE above) addressed only ONE of
  // the two causes that kept this monitor silent — the numerator stayed at 0.
  //
  // NEVER reintroduce a `path:` term here: it is unindexed by construction and
  // filters everything out silently. Scope on INDEXED fields only —
  // `transaction`, `routePath`, `correlation_id`, `level`, `environment`.
  //
  // ⚠️ SCOPE HONESTY: `transaction:/process-key` is DERIVED from the FastAPI
  // router prefix + bare mount, not observed. The 90d probe grouped by
  // `transaction` saw only `/api/match/cron-recompute` (682) and "" (12) —
  // no process-key-origin error has ever been indexed in this project, so
  // there was nothing to confirm the form against. This query CAN fire; it is
  // not yet PROVEN to fire. Confirming the transaction form of the first real
  // process-key event is booked forward in TODOS.md. Do NOT "fix" this by
  // dropping the scoping term: 682/694 current production errors are
  // cron-recompute and would swamp the process-key ratio into false alerts.
  const params = new URLSearchParams({
    statsPeriod: "15m",
    query:
      "level:error transaction:/process-key correlation_id:* environment:production",
    field: "count()",
  });
  const sentryUrl = `${SENTRY_BASE}/${args.orgSlug}/events/?${params}`;

  let sentryRes: Response;
  try {
    sentryRes = await fetch(sentryUrl, {
      headers: { Authorization: `Bearer ${args.sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    // ⚠️ SCRUBBED (Rule 2 — same class as the ratelimit module's TRAP-1). The
    // request this rejection describes carries `Authorization: Bearer
    // ${args.sentryToken}`, and undici inlines the outgoing request into the
    // error it produces — so logging `err` raw spilled the Sentry auth token
    // into the function log of the very cron whose token rotation this arm
    // exists to surface. The syscall detail survives the scrub.
    console.warn("[cron/flag-monitor] sentry fetch threw:", scrubSeamError(err));
    // WR-02: 503, not the default 200. See `monitorReadFailed`.
    return await monitorReadFailed({
      term: "numerator",
      reason: "sentry_unreachable",
      detail: "sentry fetch threw",
      // Pre-scrubbed for the same reason as the console.warn above: this is a
      // string `extra`, not the captured value, so the chokepoint's scrub of
      // the thrown object does not reach it.
      extra: { error: scrubSeamError(err) },
    });
  }

  if (!sentryRes.ok) {
    // I-perf-cron: distinguish rate-limiting from outage.
    const retryAfter = sentryRes.headers.get("retry-after");
    const sentryRateLimitRemaining = sentryRes.headers.get(
      "x-sentry-rate-limit-remaining",
    );
    const sentryRateLimitReset = sentryRes.headers.get(
      "x-sentry-rate-limit-reset",
    );
    const sentryRateLimitConcurrentRemaining = sentryRes.headers.get(
      "x-sentry-rate-limit-concurrent-remaining",
    );
    const isRateLimited =
      sentryRes.status === 429 ||
      retryAfter !== null ||
      sentryRateLimitRemaining !== null ||
      sentryRateLimitConcurrentRemaining !== null;
    const reason = isRateLimited ? "sentry_rate_limited" : "sentry_unreachable";
    console.warn(
      `[cron/flag-monitor] sentry status=${sentryRes.status} reason=${reason}`,
    );
    // WR-02: 503, not the default 200. A 401 from a rotated SENTRY_AUTH_TOKEN
    // lands here, and it is the single likeliest way this monitor goes blind.
    // `sentry_rate_limited` pages too: while Sentry is throttling us the
    // numerator is unread, and the cron runs every 15 minutes so a genuinely
    // transient throttle clears itself before the history reads as sustained.
    return await monitorReadFailed({
      term: "numerator",
      reason,
      detail: `sentry status=${sentryRes.status}`,
      extra: {
        sentry_status: sentryRes.status,
        rate_limited: isRateLimited,
        retry_after: retryAfter,
      },
      body: {
        status: sentryRes.status,
        ...(retryAfter ? { retry_after: retryAfter } : {}),
        ...(sentryRateLimitRemaining
          ? { rate_limit_remaining: sentryRateLimitRemaining }
          : {}),
        ...(sentryRateLimitReset
          ? { rate_limit_reset: sentryRateLimitReset }
          : {}),
      },
    });
  }

  const sentryData = await sentryRes.json().catch(() => ({}));
  return { kind: "ok", errorCount: parseSentryCount(sentryData) };
}

/**
 * D-02 (Phase 141.2) — ATTEMPT-grained denominator: a server-side COUNT of the
 * `process_key` audit rows in the window. This REPLACES the D-16 (141.1)
 * distinct-`correlation_id` denominator.
 *
 * ⚠️ THE SENTENCE THAT USED TO STAND HERE WAS FALSE AT THE SEAM, and it is
 * named rather than quietly deleted because it is the whole reason this
 * function was ever written the other way. D-16 asserted: "`correlation_id` is
 * minted once per client `postProcessKey` call, above the retry loop, so a
 * retried call reuses it" — and concluded that distinct `correlation_id` counts
 * USER REQUESTS. That is TRUE on the TypeScript side (`process-key-client.ts`
 * does mint it once, above the loop) and FALSE end-to-end, which is the only
 * place it had to be true:
 *
 *   - `wizardFetch` sends `X-Correlation-Id: wizard:<uuid>` unconditionally
 *     (src/lib/wizard/wizard-correlation.ts), on BOTH retry-eligible flows.
 *   - the Python handler parses the inbound value as a bare UUID and falls back
 *     to a FRESH `uuid.uuid4()` on any parse failure
 *     (analytics-service/routers/process_key.py), so a prefixed id is re-minted
 *     per attempt — and it is the SERVER value that lands in
 *     `metadata.correlation_id`.
 *   - measured on production over every `entity_type='process_key'` row:
 *     42/42 carry bare server-minted UUIDs, 0/42 carry a `wizard:` prefix, and
 *     the distinct-id count equals the row count EXACTLY.
 *
 * So the dedup collapsed nothing on real traffic, while costing two properties
 * a plain count has for free. Each cost was a live defect:
 *
 *   1. TRUNCATION. It had to materialise rows, and an unbounded PostgREST
 *      `.select()` is capped at `max_rows` (1000) with HTTP 200 and
 *      `error: null`. Measured on production: audit_log holds 7350 rows and the
 *      unbounded select returned exactly 1000. Nothing in the response
 *      distinguishes a full page from a truncated one, so above 1000 the
 *      denominator was silently fabricated — deflating it, inflating errorRate,
 *      and paging the founder for nothing. A COUNT has no row cap at any
 *      volume; `src/lib/observability.ts` is the in-repo shape.
 *   2. WIRE CONTROL. It keyed the denominator on `metadata.correlation_id`,
 *      which originates as the inbound `X-Correlation-Id` header.
 *      `/api/verify-strategy` reaches `postProcessKey` UNAUTHENTICATED and
 *      without supplying one, so the wire chooses the key. Pinning a window's
 *      traffic to a single id collapses the denominator toward 1 —
 *      attacker-chosen paging in one direction, attacker-chosen silence in the
 *      other. A COUNT reads no caller-supplied value at all.
 *
 * WHAT SURVIVES FROM D-16 — and is now the load-bearing half of the rationale:
 * in the Python service the `process_key.entry` audit emit fires BEFORE both
 * the onboard and the resync duplicate pre-checks (the `create_task` call for
 * `_write_audit_sync` precedes both pre-check sites), so a SECOND HTTP attempt
 * writes a SECOND `entity_type='process_key'` row deterministically, even when
 * it short-circuits as a duplicate and does no work. D-16 read that as a reason
 * to dedup. It is better read as the grain statement it actually is: ONE AUDIT
 * ROW PER HTTP ATTEMPT.
 *
 * ⚠️ THAT SENTENCE USED TO SAY "a retried onboard/resync", AND THE SHIPPED
 * RETRY SURFACE IS NARROWER THAN THAT (141.2 / D-01 + D-03). `resync` no longer
 * retries at all — its grant was withdrawn — and `onboard` retries only when the
 * call carries a usable idempotency key, decided by `retriesForFlow` at the
 * `postProcessKey` chokepoint. The MECHANISM above is unaffected, because it is
 * a property of the Python handler's emit ORDER and holds for any second
 * attempt whatever produced it; what changed is how much traffic can produce
 * one. It is corrected here rather than left standing because a reader
 * calibrating the downward bias below off "onboard/resync retry" would
 * over-estimate it. `getNumerator`
 * counts Sentry EVENTS, which are also per attempt. Attempt over attempt is
 * internally consistent and needs no dedup at all — which is what removes the
 * truncation and the wire-controllable key in the same move.
 *
 * KNOWN LIMITATION, stated rather than engineered around: retries inflate the
 * denominator, so `errorRate` biases DOWNWARD — the monitor gets quieter
 * precisely when the seam is retrying. That bias is real and it is why D-16 was
 * attempted. It is also the SAFE direction compared with what the dedup bought:
 * a fabricated denominator that pages falsely, and a wire-controlled one that
 * can be silenced on demand. A true per-request rate needs a SERVER-minted
 * request id that a retry reuses; that is a cross-seam contract change and is
 * deferred, not solved here.
 *
 * Two further honest caveats about what "per attempt" can actually see:
 *   - attempts refused ABOVE the audit write — the two `@limiter.limit`
 *     decorators and `_verify_internal_token` all run before it — write no row,
 *     so 429/401 attempts are invisible to this denominator.
 *   - the write is fire-and-forget and swallows its own failure, so a lost row
 *     under-counts and biases the rate UPWARD. Also the safe direction.
 *
 * The D-16 `unattributable` singleton branch goes with the dedup and nothing is
 * lost: it existed so rows with no usable `correlation_id` would not collapse
 * together, and a raw count already counts every row exactly once regardless of
 * metadata shape — the same answer that branch was engineering toward.
 *
 * FAIL LOUD (finding 12 / D-05): a read error returns a DISTINCT terminal
 * outcome, never 0. `0` is `handleZeroDenominator`'s meaning, and its email
 * asserts a specific diagnosis ("no traffic OR the audit-write is failing")
 * that is false for a failed read and sends the operator to the wrong system.
 * "An empty result and a query error are distinct states; never collapse an
 * error into `[]`" — src/lib/portfolio-exposure.ts, plus global Rule 12. Note
 * this is deliberately NOT a revert to the pre-141.1 body: that one destructured
 * only `count` and returned `?? 0`, i.e. it had finding 12 SILENTLY.
 */
type DenominatorResult =
  | { kind: "ok"; total: number }
  | { kind: "terminal"; res: NextResponse };

async function getDenominator(args: {
  admin: ReturnType<typeof createAdminClient>;
  windowStart: Date;
}): Promise<DenominatorResult> {
  const { count, error } = await args.admin
    .from("audit_log")
    // Server-side COUNT. `head: true` materialises NO rows, so PostgREST's
    // max_rows cap cannot truncate this at any volume.
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "process_key")
    .gte("created_at", args.windowStart.toISOString());

  if (error) {
    console.warn("[cron/flag-monitor] denominator read failed:", error);
    return await monitorReadFailed({
      term: "denominator",
      reason: DENOMINATOR_READ_FAILED,
      detail: "postgrest error",
      extra: {
        error_message: (error as { message?: string }).message ?? String(error),
        error_code: (error as { code?: string }).code ?? null,
        window_start: args.windowStart.toISOString(),
      },
    });
  }

  // A null `error` does not mean a usable count. postgrest-js only sets `count`
  // when the `content-range` header parses: an absent header leaves it null, and
  // a `*/*` range makes it NaN. `?? 0` catches only the first — and turns it
  // into the zero-traffic diagnosis this function exists to keep distinct, which
  // is finding 12 surviving on a narrower path than the one it was found on.
  // NaN is worse: it is not `=== 0`, so the streak guard misses it as well, and
  // `errorCount / NaN` is NaN, which is below BOTH thresholds — the handler
  // would answer ok with alerting silently disarmed for the window. Anything
  // that is not a non-negative integer is a read we could not complete.
  if (!Number.isInteger(count) || (count as number) < 0) {
    console.warn("[cron/flag-monitor] denominator count unusable:", count);
    return await monitorReadFailed({
      term: "denominator",
      reason: DENOMINATOR_READ_FAILED,
      detail: "unusable count",
      extra: {
        // Stringified: a raw NaN does not survive JSON serialisation into the
        // Sentry payload, and NaN-versus-null is the whole diagnosis here.
        count: String(count),
        window_start: args.windowStart.toISOString(),
      },
    });
  }

  return { kind: "ok", total: count as number };
}

async function handleZeroDenominator(args: {
  admin: ReturnType<typeof createAdminClient>;
  now: Date;
  resend: Resend | null;
  founderEmail: string | undefined;
}): Promise<NextResponse> {
  const { data: flagRow } = await args.admin
    .from("feature_flags")
    .select("value")
    .eq("flag_key", ZERO_DENOM_STREAK_KEY)
    .maybeSingle();
  const currentStreak = parseInt(flagRow?.value ?? "0", 10) || 0;
  const newStreak = currentStreak + 1;
  await args.admin.from("feature_flags").upsert(
    {
      flag_key: ZERO_DENOM_STREAK_KEY,
      value: String(newStreak),
      updated_at: args.now.toISOString(),
      updated_by: "cron/flag-monitor",
    },
    { onConflict: "flag_key" },
  );
  if (
    newStreak > ZERO_DENOMINATOR_ALERT_AFTER &&
    args.resend &&
    args.founderEmail
  ) {
    await args.resend.emails.send({
      from: ALERT_FROM,
      to: args.founderEmail,
      subject: `[H-2 SEV-2] Phase 19 flag-monitor denominator stuck at 0 for ${newStreak} windows`,
      html: `<p>The /process-key audit_log denominator has been 0 for ${newStreak} consecutive 15-min windows. Either no traffic is reaching /process-key OR the audit-write at /process-key entry is failing. Auto-rollback cannot trip in this state — investigate before traffic resumes.</p><p>Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
    });
  }
  return NextResponse.json({
    ok: false,
    reason: "zero_denominator",
    streak: newStreak,
  });
}

async function sendErrorRateAlert(args: {
  resend: Resend | null;
  founderEmail: string | undefined;
  errorRate: number;
  errorCount: number;
  total: number;
}): Promise<NextResponse> {
  // Phase 106 (Stage B): ALERT-ONLY. The auto-rollback was retired — this
  // never writes the feature_flags kill-switch row (flipping it would be an
  // outage, not a rollback: the unified backbone is the only path). The email
  // directs the founder to investigate manually; rollback = git revert +
  // redeploy.
  if (args.resend && args.founderEmail) {
    await args.resend.emails.send({
      from: ALERT_FROM,
      to: args.founderEmail,
      subject: `[ALERT] Phase 19 backbone error rate ${(args.errorRate * 100).toFixed(2)}% — auto-rollback retired (Phase 106), investigate manually`,
      html: `<p>Error envelope rate <code>${(args.errorRate * 100).toFixed(2)}%</code> exceeded ${(ALERT_THRESHOLD * 100).toFixed(2)}% threshold over the past 15 minutes (${args.errorCount}/${args.total}).</p><p><strong>Auto-rollback was retired in Phase 106.</strong> The unified backbone is the only path and the kill-switch row is inert — this alert is informational. Investigate the error source manually; post-Stage-B rollback is <code>git revert + redeploy</code>. Runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
    });
  }

  console.warn(
    `[cron/flag-monitor] ERROR-RATE ALERT: errorRate=${args.errorRate} total=${args.total}`,
  );
  return NextResponse.json({
    ok: true,
    action: "alerted",
    errorRate: args.errorRate,
    errorCount: args.errorCount,
    total: args.total,
  });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Auth — mirrors src/app/api/cron/sync-funding/route.ts:29-32
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  const founderEmail = process.env.FOUNDER_LP_REPORT_TO;
  const resendKey = process.env.RESEND_API_KEY;

  if (!orgSlug || !sentryToken) {
    console.warn(
      "[cron/flag-monitor] SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing — skipping",
    );
    // WR-02: 503, not the default 200. This one is not even transient — a
    // missing env var is a deploy defect that persists until someone acts, so
    // reporting it as a successful run is the most durable false-health this
    // route could emit. The capture still works: `captureToSentry` writes
    // through SENTRY_DSN, a DIFFERENT variable from the two events-API
    // credentials whose absence is being reported here.
    const terminal = await monitorReadFailed({
      term: "numerator",
      reason: "sentry_not_configured",
      detail: "SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing",
      // WHICH one is missing, without echoing either value.
      extra: {
        org_slug_present: Boolean(orgSlug),
        auth_token_present: Boolean(sentryToken),
      },
    });
    return terminal.res;
  }

  const admin = createAdminClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  const resend = resendKey ? new Resend(resendKey) : null;

  // 1) Numerator — Sentry error event count for /process-key in the last
  //    15 minutes, scoped on INDEXED fields only (D-16). Pitfall 8: the
  //    environment:production filter prevents dev/preview events (CI cassette
  //    runs) from triggering a spurious production alert.
  const numerator = await getNumerator({ orgSlug, sentryToken });
  if (numerator.kind === "terminal") return numerator.res;
  const errorCount = numerator.errorCount;

  // 2) Denominator — /process-key HTTP ATTEMPTS in the same window, counted
  //    server-side from Supabase audit_log. P4
  //    (analytics-service/routers/process_key.py) writes one audit row per
  //    attempt at /process-key entry; this is the load-bearing source. See
  //    getDenominator for why this is a raw COUNT rather than a distinct-
  //    request dedup, and why a failed read is NOT reported as zero traffic.
  const denominator = await getDenominator({ admin, windowStart });
  if (denominator.kind === "terminal") return denominator.res;
  const total = denominator.total;

  // 3) H-2 — denominator streak guard. If the attempt count stays 0 for
  //    >2 consecutive 15-min windows the denominator is silently broken and
  //    the cron is a no-op. Fail-open by sending a SEV-2 alert. A FAILED READ
  //    never reaches here — it terminated above with its own reason, so this
  //    branch keeps meaning exactly one thing.
  if (total === 0) {
    return await handleZeroDenominator({ admin, now, resend, founderEmail });
  }

  // Reset streak on the first non-zero window. Best-effort — if the upsert
  // fails we don't escalate; the next zero window starts the count again.
  await admin.from("feature_flags").upsert(
    {
      flag_key: ZERO_DENOM_STREAK_KEY,
      value: "0",
      updated_at: now.toISOString(),
      updated_by: "cron/flag-monitor",
    },
    { onConflict: "flag_key" },
  );

  const errorRate = errorCount / total;

  // 4) Threshold logic — order matters: ALERT first, then WARN. Phase 106:
  //    the ALERT branch alerts only — it never flips the (retired) kill-switch.
  if (errorRate > ALERT_THRESHOLD && total >= MIN_SAMPLE) {
    return await sendErrorRateAlert({
      resend,
      founderEmail,
      errorRate,
      errorCount,
      total,
    });
  }

  if (errorRate > WARN_THRESHOLD && total >= MIN_SAMPLE) {
    if (resend && founderEmail) {
      await resend.emails.send({
        from: ALERT_FROM,
        to: founderEmail,
        subject: `[WARN] Phase 19 error rate ${(errorRate * 100).toFixed(2)}% — below alert threshold`,
        html: `<p>Error rate ${errorCount}/${total} = ${(errorRate * 100).toFixed(2)}% — below the ${(ALERT_THRESHOLD * 100).toFixed(2)}% alert threshold but worth a look.</p>`,
      });
    }
    return NextResponse.json({
      ok: true,
      action: "warn_sent",
      errorRate,
      errorCount,
      total,
    });
  }

  return NextResponse.json({ ok: true, errorRate, errorCount, total });
}

export const GET = handle;
export const POST = handle;
