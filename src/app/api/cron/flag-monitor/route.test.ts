import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/flag-monitor (M-0999).
 *
 * flag-monitor is the only sub-daily cron (every 15 min). Phase 106 (Stage B)
 * RETIRED the auto-rollback: the monitor is now ALERT-ONLY — it never writes
 * the feature_flags kill-switch row. The unified backbone is the only path and
 * the kill-switch row is inert, so a flip would be an outage, not a rollback.
 * Wrong threshold math or a wrong Sentry env filter would either page the
 * founder needlessly OR miss a real incident. This suite drives the exported
 * handler with mocked fetch/Supabase/Resend to hit the branching:
 *
 *   (1) parseSentryCount handles both `data[0]["count()"]` and `data[0].count`.
 *   (3) 429 + x-sentry-rate-limit-remaining → reason "sentry_rate_limited".
 *   (4) zero-denominator streak alerts only AFTER ZERO_DENOMINATOR_ALERT_AFTER
 *       (streak going 2→silent vs 3→alert). This ZERO_DENOM_STREAK_KEY upsert
 *       is a DIFFERENT row from the retired kill-switch and STAYS.
 *   (6) WARN threshold sends an email but never touches the kill-switch.
 *   (6b) ALERT threshold sends an [ALERT] email (reworded: auto-rollback
 *       retired, investigate manually) and STILL never touches the kill-switch.
 *
 * `import "server-only"` throws under jsdom; stub it. `resend` is mocked so we
 * can assert on outbound email subjects. `fetch` is stubbed per-test.
 */

vi.mock("server-only", () => ({}));

// Resend mock — capture every emails.send({subject,...}) call.
const sendEmailSpy = vi.fn<
  (args: { from: string; to: string; subject: string; html: string }) => Promise<{
    data: { id: string };
    error: null;
  }>
>(async () => ({ data: { id: "email-1" }, error: null }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendEmailSpy };
  },
}));

// OPS-07 (Phase 163): the terminal denominator arms now capture to Sentry as
// well as answering non-200. Mocked (rather than left real) so the capture is
// ASSERTABLE — the real helper swallows everything by design, so a route that
// stopped capturing would be indistinguishable from one that still does.
const captureToSentrySpy = vi.fn(async () => undefined);
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureToSentrySpy(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Supabase admin mock. The route hits two tables:
//   feature_flags:
//     - .select("value").eq("flag_key", ZERO_DENOM_STREAK_KEY).maybeSingle()
//       → current zero-denominator streak (handleZeroDenominator)
//     - .upsert({...}, {onConflict}) → streak reset / streak bump
//   audit_log:
//     - .select("id", { count: "exact", head: true }).eq(...).gte(...)
//       → the denominator, as a SERVER-SIDE COUNT. No rows are materialised.
//
// ⚠️ THE audit_log DOUBLE IS SHAPE-DISTINGUISHING, ON PURPOSE.
//
// Every flag-monitor fetch double in this file before 141.2 was shape-BLIND: it
// answered whatever it was asked with the same payload, so the suite stayed
// green against a query that could not do its job in production. That is how
// the dead `path:` numerator survived from Phase 19 to 141.1, and how the
// truncating denominator shipped in 141.1. A double that cannot disagree with
// production is not evidence.
//
// So this double inspects the select it receives and answers the two shapes
// DIFFERENTLY:
//   - the COUNT chain (`{ head: true }`) resolves `{ count: rec.auditCount }` —
//     the scenario's TRUE total, uncapped, because a server-side count is not
//     subject to PostgREST's max_rows.
//   - any ROW-MATERIALISING select resolves `{ data: <row payload> }`, and that
//     payload is PER-TEST CONFIGURABLE via `rec.auditRows`.
//
// The per-test row payload is load-bearing, not a convenience. The two
// mutations this suite must redden need DIFFERENT row payloads:
//   - SC-F (restore the unbounded `.select()`) is caught only by a row payload
//     that models PostgREST's max_rows cap while the true total is HIGHER.
//   - SC-G (reintroduce the correlation_id dedup) is caught only by a row
//     payload whose ids REPEAT.
// One hardcoded row payload would redden one of those two and lie for the other.
//
// `rec.auditError` drives the read-failure path: a failed read must be reported
// DISTINCTLY from zero traffic, never collapsed into 0 (finding 12).
//
// Recorders capture every upsert payload so we can assert that the kill-switch
// row (flag_key === KILL_SWITCH_KEY) is NEVER written — the auto-rollback was
// retired in Phase 106 (Stage B). Only the ZERO_DENOM_STREAK_KEY row is ever
// upserted, on the zero-denominator path.
// ---------------------------------------------------------------------------

/**
 * PostgREST's server-side row cap. Hand-typed, NOT imported from anywhere: this
 * is the DEPLOYED platform's behaviour, measured against production (audit_log
 * held 7350 rows; an unbounded `.select()` returned exactly 1000 with HTTP 200
 * and `error: null`), not a constant this repo owns and could change.
 */
const POSTGREST_MAX_ROWS = 1000;

interface FlagMonitorRecorders {
  upserts: Array<Record<string, unknown>>;
  // Seeds:
  /** The audit_log COUNT the server returns — the scenario's true ATTEMPT-row
   *  total in the window. Answered to the `{ count: "exact", head: true }`
   *  chain, uncapped. */
  // `number | null` because PostgREST itself can resolve a COUNT chain with
  // `count: null` (no `content-range` header) or `count: NaN` (`*/*`), and both
  // are states the handler has to survive — see the (D1b/D1c) cases.
  auditCount: number | null;
  /** PostgREST error for the audit_log read. Non-null → the denominator read
   *  FAILED, which is a different state from "the window was empty". */
  auditError: { message: string } | null;
  /** Explicit row payload for a ROW-MATERIALISING audit_log select. `null` →
   *  synthesise `auditCount` rows with DISTINCT ids, capped at
   *  POSTGREST_MAX_ROWS so even the default models the real platform. */
  auditRows: Array<{ correlation_id: unknown }> | null;
  /** Every audit_log select shape the route actually asked for. Lets a test
   *  assert that NO row materialisation happened — the property a grep cannot
   *  check on a file whose docblock is required to name the removed construct. */
  auditSelects: Array<{ columns: string; head: boolean }>;
  streakValue: string | null; // feature_flags zero-denom streak row value
}

function makeFlagMonitorRecorders(): FlagMonitorRecorders {
  return {
    upserts: [],
    auditCount: 0,
    auditError: null,
    auditRows: null,
    auditSelects: [],
    streakValue: null,
  };
}

// The retired kill-switch row key. The monitor must NEVER upsert it now.
const KILL_SWITCH_KEY = "process_key_unified_backbone";
// The H-2 zero-denominator streak row. This one IS written — but only on a
// genuinely empty window, never on a failed read.
const ZERO_DENOM_STREAK_KEY = "flag_monitor_zero_denominator_streak";

function createSupabaseMock(rec: FlagMonitorRecorders) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};

      if (table === "audit_log") {
        let head = false;
        chain.select = (
          columns: string,
          opts?: { count?: string; head?: boolean },
        ) => {
          head = opts?.head === true;
          rec.auditSelects.push({ columns, head });
          return chain;
        };
        chain.eq = () => chain;
        chain.gte = () =>
          Promise.resolve(
            head
              ? // Server-side COUNT: no rows cross the wire, no max_rows cap.
                { data: null, count: rec.auditCount, error: rec.auditError }
              : // Row materialisation: whatever this test configured, defaulting
                // to a max_rows-capped page — exactly what deployed PostgREST
                // returns, with HTTP 200 and no truncation signal.
                {
                  data:
                    rec.auditRows ??
                    Array.from(
                      {
                        length: Math.min(
                          rec.auditCount ?? 0,
                          POSTGREST_MAX_ROWS,
                        ),
                      },
                      (_, i) => ({ correlation_id: `cid-${i}` }),
                    ),
                  count: null,
                  error: rec.auditError,
                },
          );
        return chain;
      }

      // feature_flags
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data: rec.streakValue === null ? null : { value: rec.streakValue },
        error: null,
      });
      chain.upsert = (payload: Record<string, unknown>) => {
        rec.upserts.push(payload);
        return Promise.resolve({ data: null, error: null });
      };
      return chain;
    },
  };
}

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

// Builds a fake fetch Response for the Sentry events API.
function sentryResponse(opts: {
  ok: boolean;
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    headers,
    json: async () => opts.json ?? {},
  } as unknown as Response;
}

describe.each([["GET"], ["POST"]] as const)(
  "%s /api/cron/flag-monitor (M-0999)",
  (verb) => {
    let rec: FlagMonitorRecorders;
    const ORIGINAL = { ...process.env };

    beforeEach(() => {
      rec = makeFlagMonitorRecorders();
      process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
      process.env.SENTRY_ORG_SLUG = "quantalyze";
      process.env.SENTRY_AUTH_TOKEN = "sentry-token";
      process.env.FOUNDER_LP_REPORT_TO = "founder@example.com";
      process.env.RESEND_API_KEY = "resend-key";
      sendEmailSpy.mockClear();
      captureToSentrySpy.mockClear();
      vi.resetModules();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.doUnmock("@/lib/supabase/admin");
      vi.unstubAllGlobals();
      vi.resetModules();
      process.env = { ...ORIGINAL };
    });

    async function getHandler(): Promise<
      (req: NextRequest) => Promise<Response>
    > {
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => createSupabaseMock(rec),
      }));
      const mod = await import("./route");
      return verb === "GET" ? mod.GET : mod.POST;
    }

    const authedReq = () =>
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` });

    // --- Auth guard --------------------------------------------------------

    it("returns 401 when the bearer is wrong", async () => {
      const handler = await getHandler();
      const res = await handler(makeReq({ authorization: "Bearer nope-pad-16x" }));
      expect(res.status).toBe(401);
    });

    // --- (1) parseSentryCount shape rotation -------------------------------

    it("(1a) parses the Sentry `count()` shape into the numerator", async () => {
      rec.auditCount = 1000; // big denom → low rate → ok, no rollback
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 7 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.errorCount).toBe(7);
      expect(body.total).toBe(1000);
    });

    it("(1b) parses the alternate `count` shape into the numerator", async () => {
      rec.auditCount = 1000;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ count: 4 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.errorCount).toBe(4);
    });

    it("(1c) malformed Sentry payload → errorCount 0 (safe default)", async () => {
      rec.auditCount = 1000;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { garbage: true } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.errorCount).toBe(0);
    });

    // --- D-02 / D-05 denominator: counted, fail-loud, wire-proof -----------
    //
    // These four replace the D-16 (141.1) distinct-correlation_id denominator.
    // Findings 2, 3, 4, 7 and 12 are ONE rewrite, so they are pinned together.

    it("(D1/SC-I) a PostgREST read error is reported as denominator_read_failed — NEVER as zero traffic", async () => {
      // Finding 12. `handleZeroDenominator`'s email asserts ONE diagnosis:
      // "either no traffic is reaching /process-key OR the audit-write at
      // /process-key entry is failing". A failed READ is a third state and
      // belongs to neither, so collapsing it into 0 sends the operator to the
      // Python audit path for a fault that lives in this query. An empty result
      // and a query error are distinct states — src/lib/portfolio-exposure.ts
      // states that rule for this repo, and global Rule 12 is fail loud.
      rec.auditCount = 5000; // irrelevant: the read never succeeds
      rec.auditError = { message: "PGRST301: JWT expired" };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("denominator_read_failed");
      // OPS-07 (Phase 163): ...and the run REGISTERS FAILED. Distinguishing a
      // state you then report at HTTP 200 is not distinguishing it — Vercel's
      // cron history keys success off the status code, so the 200 this arm used
      // to return logged a green run every 15 minutes while the monitor was
      // blind. 141.2's own lesson, recurring inside 141.2's remedy.
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(200);
      // ...with a Sentry capture carrying the diagnosis, since the cron history
      // says "failed" without saying why.
      expect(captureToSentrySpy).toHaveBeenCalledTimes(1);
      const captureArgs = captureToSentrySpy.mock.calls[0] as unknown[];
      expect((captureArgs[1] as { tags: Record<string, string> }).tags).toMatchObject({
        route: "cron.flag-monitor",
        denominator_read_failed: "true",
      });
      // The zero-traffic diagnosis must be unreachable from a read failure...
      expect(body.reason).not.toBe("zero_denominator");
      // ...the H-2 streak must NOT advance (a failed read is not a zero
      // window; advancing it would eventually page with the wrong story)...
      const streakWrites = rec.upserts.filter(
        (u) => u.flag_key === ZERO_DENOM_STREAK_KEY,
      );
      expect(streakWrites).toHaveLength(0);
      // ...and no email fires for a fault we cannot yet diagnose.
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it("(D1b/SC-I) an ABSENT count with NO error is a failed read too — not zero traffic", async () => {
      // The narrower half of finding 12, left live by the first remedy. PostgREST
      // resolves `count: null` when the `content-range` header does not parse,
      // and `error` is null on that path — so `count ?? 0` restores the exact
      // conflation the docblock above `getDenominator` disclaims: a monitor that
      // cannot read its denominator emails "no traffic OR the audit-write is
      // failing" and sends the operator to the Python audit path for a fault
      // that lives in this query.
      rec.auditCount = null;
      rec.auditError = null;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("denominator_read_failed");
      expect(body.reason).not.toBe("zero_denominator");
      // OPS-07: pages, same as the explicit-error arm. A null count is a read we
      // could not complete, and the two arms must be indistinguishable to the
      // cron history — otherwise the narrower path stays silently green.
      expect(res.status).toBe(503);
      expect(captureToSentrySpy).toHaveBeenCalledTimes(1);
      expect(
        rec.upserts.filter((u) => u.flag_key === ZERO_DENOM_STREAK_KEY),
      ).toHaveLength(0);
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it("(D1c/SC-I) a NaN count answers ok:false — it must NOT pass through as a rate", async () => {
      // Worse than the null case and invisible to `?? 0`: postgrest-js derives
      // the count with `parseInt` over the `content-range` tail, so a `*/*`
      // range yields NaN. NaN fails `total === 0`, so the zero-denominator guard
      // does not catch it either; `errorCount / NaN` is NaN, and NaN is below
      // every threshold. The handler would answer `ok: true` with BOTH alert
      // arms silently disarmed for that window — the failure mode a monitor
      // exists to prevent, in the monitor itself.
      rec.auditCount = Number.NaN;
      rec.auditError = null;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 9999 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("denominator_read_failed");
      // OPS-07: pages. NaN is the arm where a 200 was most dangerous — it is not
      // `=== 0`, so the streak guard misses it, and `errorCount / NaN` is below
      // BOTH thresholds, meaning the handler answered ok with alerting silently
      // disarmed for the window.
      expect(res.status).toBe(503);
      expect(captureToSentrySpy).toHaveBeenCalledTimes(1);
      // NaN does not survive JSON, so the capture stringifies it — the whole
      // diagnosis on this arm is null-versus-NaN.
      const nanExtra = (captureToSentrySpy.mock.calls[0] as unknown[])[1] as {
        extra: Record<string, unknown>;
      };
      expect(nanExtra.extra.count).toBe("NaN");
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it("(D2/SC-I control) a genuinely EMPTY window still routes to the zero-denominator streak", async () => {
      // The positive control for (D1): the two states must stay distinct in
      // BOTH directions. A fix that reported everything as denominator_read_
      // failed would satisfy (D1) alone while destroying the H-2 guard.
      rec.auditCount = 0;
      rec.auditError = null;
      rec.streakValue = "0";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("zero_denominator");
      expect(body.reason).not.toBe("denominator_read_failed");
      expect(body.streak).toBe(1);
      const streakWrites = rec.upserts.filter(
        (u) => u.flag_key === ZERO_DENOM_STREAK_KEY,
      );
      expect(streakWrites).toHaveLength(1);
      // OPS-07: and this arm does NOT page. The paging fix must not be bought
      // by turning every quiet window red — the streak machinery owns the
      // zero-traffic escalation and reaches its own conclusion over 3 windows.
      expect(res.status).toBe(200);
      expect(captureToSentrySpy).not.toHaveBeenCalled();
    });

    it("(D3/SC-F) the denominator is a server-side COUNT: 3000 attempt rows count as 3000, not truncated at PostgREST's 1000-row cap", async () => {
      rec.auditCount = 3000;
      // The row payload is configured EXPLICITLY here rather than left to the
      // default, so the thing this test turns on is visible at review: a full
      // max_rows page is ALL a row-materialising select can ever see. Measured
      // against production — audit_log holds 7350 rows and an unbounded
      // `.select()` returned exactly 1000, HTTP 200, `error: null`. Nothing in
      // that response distinguishes a full page from a truncated one, which is
      // why the 141.1 form could not detect its own truncation and fabricated
      // a denominator: errorRate inflated, founder paged for nothing.
      rec.auditRows = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => ({
        correlation_id: `cid-${i}`,
      }));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.total).toBe(3000); // hand-typed, above the cap
      // And prove it got there WITHOUT materialising rows. This is the
      // assertion that stands in for an absence grep: `grep -c` cannot check
      // this file, whose docblock is REQUIRED to name the removed constructs.
      expect(rec.auditSelects.filter((s) => !s.head)).toHaveLength(0);
    });

    it("(D4/SC-G) a wire-supplied X-Correlation-Id cannot move the denominator: 200 attempt rows sharing ONE id count as 200", async () => {
      rec.auditCount = 200;
      // 200 rows carrying the SAME correlation_id. `getCorrelationId` returns
      // the inbound X-Correlation-Id verbatim when it matches its charset, and
      // the UNAUTHENTICATED /api/verify-strategy reaches postProcessKey without
      // supplying one — so an anonymous caller can put a value of its choosing
      // into that field. Under a denominator keyed on it, pinning a window's
      // traffic to one id collapses the denominator toward 1, and then any
      // single error clears the 0.5% threshold: attacker-chosen paging in one
      // direction, attacker-chosen silence in the other.
      //
      // The count contract is what makes that unreachable — the count reflects
      // ROWS, regardless of what any metadata field contains.
      rec.auditRows = Array.from({ length: 200 }, () => ({
        correlation_id: "wire-supplied-shared-id",
      }));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.total).toBe(200); // hand-typed: rows, not distinct ids
    });

    it("(D5/SC-H) the RATE is attempt-grained on BOTH sides: 2 events over 20 ATTEMPT rows = 10%, even though those 20 attempts are only 19 user requests", async () => {
      // ONE attempt-level scenario drives BOTH sides of the ratio, which is
      // what makes this a GRAIN pin rather than arithmetic over a fixture:
      //
      //   19 user requests, ONE of which retried  → 20 HTTP ATTEMPTS
      //   that retried request failed both times  →  2 Sentry EVENTS
      //
      // Sentry events are per-attempt. Audit rows are per-attempt too:
      // `_write_audit_sync` fires at /process-key entry BEFORE both the onboard
      // and the resync duplicate pre-checks, so every retried HTTP attempt
      // re-enters the endpoint and writes its own row. Attempt over attempt is
      // therefore internally consistent, and it is the ONLY pairing that is.
      //
      // (D3/SC-F) and (D4/SC-G) pin the denominator's magnitude and its
      // independence from the wire. Neither can see a GRAIN mismatch, because
      // neither involves the numerator. This one does, and it reds for a
      // mismatch introduced on EITHER side.
      const USER_REQUESTS = 19;
      const ATTEMPT_ROWS = 20; // one of those requests retried once
      rec.auditCount = ATTEMPT_ROWS;
      // The row path serves the retried request's two rows under ONE shared
      // correlation_id, so a reintroduced dedup has something real to collapse.
      // A pin whose fixture cannot express the mutation cannot redden for it —
      // that is finding 10's lesson applied to the denominator.
      rec.auditRows = [
        { correlation_id: "req-retried" }, // attempt 1
        { correlation_id: "req-retried" }, // attempt 2 — the retry
        ...Array.from({ length: USER_REQUESTS - 1 }, (_, i) => ({
          correlation_id: `req-${i}`,
        })),
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 2 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();

      // THE RATIO IS THE ASSERTION. It is deliberately checked BEFORE the
      // component values: a `total` assertion would short-circuit this one and
      // reduce the pin to a restatement of what the double returned, which is
      // already (D3/SC-F)'s and (D4/SC-G)'s job. The grain contract only lives
      // in the quotient, so the quotient is what has to fail first.
      expect(
        body.errorRate,
        "GRAIN CONTRACT: the numerator counts Sentry EVENTS per ATTEMPT and the " +
          "denominator counts audit ROWS per ATTEMPT. This scenario is 19 user " +
          "requests / 20 attempts / 2 events, so the only attempt-grained answer " +
          "is 2/20 = 0.1. Getting 2/19 means the DENOMINATOR was collapsed to " +
          "request grain; getting 1/20 means the NUMERATOR was. Either side " +
          "reddens this pin, which is the point — the two sides must agree on " +
          "the unit, and no single-sided test can check that.",
      ).toBe(0.1);
      // Component values, for diagnosis once the ratio has already spoken.
      expect(body.errorCount).toBe(2);
      expect(body.total).toBe(20); // ATTEMPTS, not user requests
    });

    // --- (1d)/(1e) DELETED with the D-16 dedup they described --------------
    //
    // (1d) asserted "3 audit rows across 2 correlation_ids → denominator 2" and
    // (1e) asserted that an unattributable row counts as its own singleton.
    // Both encoded the dedup, and both are false under D-02: the denominator is
    // now ROWS, so (1d)'s scenario answers 3 and (1e)'s answers 4. They are
    // deleted rather than re-pointed because their SUBJECT is gone — the
    // singleton branch existed only to stop unattributable rows collapsing
    // together, which a raw count does by construction. (D3/SC-F) and
    // (D4/SC-G) above cover the properties that replaced them.

    // --- (3) rate-limit vs outage distinction ------------------------------

    it("(3) 429 with x-sentry-rate-limit-remaining → reason sentry_rate_limited", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({
            ok: false,
            status: 429,
            headers: { "x-sentry-rate-limit-remaining": "0" },
          }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("sentry_rate_limited");
      expect(body.reason).not.toBe("sentry_unreachable");
      // WR-02 (163 review): the reason assertions above were the WHOLE of this
      // case, and they were green while the arm answered 200 — so the suite
      // could see that a throttle had been CLASSIFIED but not that the run was
      // reported as a success. The full falsifier table lives in
      // tests/integration/cron-flag-monitor.test.ts; this is the unit-tier pin.
      expect(res.status).toBe(503);
    });

    it("(3b) 500 with no rate-limit headers → reason sentry_unreachable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => sentryResponse({ ok: false, status: 500 })),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("sentry_unreachable");
      // WR-02 (163 review) — see the note on (3) above.
      expect(res.status).toBe(503);
    });

    // --- (4) zero-denominator streak boundary ------------------------------

    it("(4a) zero denominator with streak=2 bumps to 3 and DOES alert (boundary)", async () => {
      // ZERO_DENOMINATOR_ALERT_AFTER = 2 → alert when newStreak > 2 (i.e. 3).
      rec.auditCount = 0;
      rec.streakValue = "2"; // current streak; route bumps to 3.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("zero_denominator");
      expect(body.streak).toBe(3);
      // Streak crossed the threshold → SEV-2 H-2 email fires.
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(String(sendEmailSpy.mock.calls[0][0].subject)).toContain("H-2 SEV-2");
    });

    it("(4b) zero denominator with streak=1 bumps to 2 and STAYS SILENT (boundary)", async () => {
      rec.auditCount = 0;
      rec.streakValue = "1"; // bumps to 2 — not yet > 2, no alert.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.reason).toBe("zero_denominator");
      expect(body.streak).toBe(2);
      // Below the boundary → no email.
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    // --- (6) WARN threshold: email, never touches the kill-switch ----------

    it("(6) WARN threshold sends an email but never touches the kill-switch", async () => {
      // total=1000, errorCount=4 → rate=0.4% > WARN(0.25%) but < ALERT(0.5%).
      rec.auditCount = 1000;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 4 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      expect(body.action).toBe("warn_sent");
      // A WARN email is sent...
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(String(sendEmailSpy.mock.calls[0][0].subject)).toContain("WARN");
      // ...but the kill-switch row must NEVER be upserted.
      const killFlips = rec.upserts.filter(
        (u) => u.flag_key === KILL_SWITCH_KEY,
      );
      expect(killFlips).toHaveLength(0);
    });

    // --- (6b) ALERT threshold: alert-only, NEVER flips the kill-switch ------

    it("(6b) ALERT threshold sends an [ALERT] email but NEVER flips the kill-switch (auto-rollback retired, Phase 106)", async () => {
      // total=1000, errorCount=10 → 1.0% > ALERT(0.5%), total >= MIN_SAMPLE.
      // Pre-106 this flipped the kill-switch to "off". Phase 106 retired the
      // auto-rollback: the monitor alerts but can never write the row.
      rec.auditCount = 1000;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 10 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      const body = await res.json();
      // The monitor alerts (does not "roll back") — action reflects alert-only.
      expect(body.action).toBe("alerted");
      // The kill-switch row is NEVER upserted — not to "off", not at all.
      const killWrites = rec.upserts.filter(
        (u) => u.flag_key === KILL_SWITCH_KEY,
      );
      expect(killWrites).toHaveLength(0);
      // An [ALERT] email still fires so the founder investigates manually.
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      const alert = sendEmailSpy.mock.calls[0][0];
      expect(String(alert.subject)).toContain("ALERT");
      // The email must NOT claim a rollback happened — the old subject lied.
      expect(String(alert.subject)).not.toContain("auto-rolled-back");
      // Body directs to manual investigation (auto-rollback is retired).
      expect(String(alert.html).toLowerCase()).toContain("retired");
    });

    // --- (3) SENTRY_API_BASE region override (regression: silent false-clean) -

    it("(3a) respects SENTRY_API_BASE for EU-region orgs", async () => {
      // Pre-fix: SENTRY_BASE was hardcoded to https://sentry.io and EU-region
      // orgs (metaworld-fund-ltd on de.sentry.io) silently returned empty
      // data. Auto-rollback path was effectively disabled for the entire
      // post-deploy window. Fix is env-driven SENTRY_API_BASE.
      process.env.SENTRY_API_BASE = "https://de.sentry.io/api/0/organizations";
      rec.auditCount = 1000;
      const fetchFn = vi.fn(async () =>
        sentryResponse({ ok: true, json: { data: [{ "count()": 1 }] } }),
      );
      vi.stubGlobal("fetch", fetchFn);
      const handler = await getHandler();
      await handler(authedReq());
      const firstCall = (fetchFn.mock.calls[0] as unknown as [string])[0];
      expect(firstCall).toMatch(
        /^https:\/\/de\.sentry\.io\/api\/0\/organizations\/quantalyze\/events\//,
      );
    });

    it("(3b) defaults to https://sentry.io when SENTRY_API_BASE is unset (back-compat)", async () => {
      delete process.env.SENTRY_API_BASE;
      rec.auditCount = 1000;
      const fetchFn = vi.fn(async () =>
        sentryResponse({ ok: true, json: { data: [{ "count()": 0 }] } }),
      );
      vi.stubGlobal("fetch", fetchFn);
      const handler = await getHandler();
      await handler(authedReq());
      const firstCall = (fetchFn.mock.calls[0] as unknown as [string])[0];
      expect(firstCall).toMatch(
        /^https:\/\/sentry\.io\/api\/0\/organizations\//,
      );
    });
  },
);
