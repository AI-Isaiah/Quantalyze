/**
 * Phase 19 / BACKBONE-05 — /api/cron/flag-monitor route handler tests.
 *
 * Coverage (per 19-07 PLAN behavior section):
 *   1.  test_unauthorized_returns_401            — auth gate
 *   2.  test_below_threshold_no_action           — errorRate=0.1%, no flip, no email
 *   3.  test_warn_threshold_sends_warn_email     — errorRate=0.3%, no flip, WARN email
 *   4.  test_above_threshold_alerts_only         — errorRate=1%, total>=20, ALERT
 *                                                  email, NEVER flips (Phase 106)
 *   5.  test_min_sample_guard                    — total<20, no alert even if errorRate=50%
 *   6.  test_sentry_unreachable_returns_warn     — Sentry 5xx, no alert
 *   7.  test_environment_production_filter       — outbound query carries env filter (Pitfall 8)
 *   8.  test_zero_denominator_alert_after_3_windows  — H-2: streak=3 → SEV-2 email
 *   9.  test_zero_denominator_streak_resets      — H-2: total>0 resets streak
 *   10. (removed) D-3 kill-switch PGRST fallback — auto-rollback retired (Phase 106)
 *   11. test_sentry_environment_smoke_workflow_exists — H-6 CI smoke workflow file presence
 *
 * Mock strategy mirrors src/app/api/cron/founder-lp-report/route.test.ts:
 *   - `vi.mock("server-only", () => ({}))` — jsdom doesn't allow server-only.
 *   - `vi.mock("resend", ...)` with a class so `new Resend(...)` resolves;
 *     all instances share the same `sendMock` for assertions.
 *   - `vi.doMock("@/lib/supabase/admin", ...)` per-test for fine-grained
 *     control over feature_flags + audit_log responses. `vi.resetModules()`
 *     between tests so the route imports the freshly mocked admin client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => sendMock(...args) };
  },
}));

// OPS-07 (Phase 163): the terminal denominator arms capture to Sentry alongside
// the non-200. Mocked so the capture is ASSERTABLE — the real helper swallows
// every failure by design, so a route that quietly stopped capturing would be
// indistinguishable from one that still does.
const captureMock = vi.fn(async () => undefined);
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureMock(...(args as [])),
}));

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

/** PostgREST's server-side row cap. Hand-typed: this is the DEPLOYED
 *  platform's behaviour (measured against production — audit_log held 7350
 *  rows, an unbounded `.select()` returned exactly 1000 with HTTP 200 and
 *  `error: null`), not a constant this repo owns. */
const POSTGREST_MAX_ROWS = 1000;

/**
 * Build a Supabase admin client mock with two collaborating tables:
 *   - feature_flags: select(value).eq("flag_key", X).maybeSingle()
 *                    upsert({...}, { onConflict })
 *   - audit_log: select("id", { count: "exact", head: true }).eq(...).gte(...)
 *                → { count } — a SERVER-SIDE COUNT of the /process-key HTTP
 *                  ATTEMPT rows in the window (D-02, Phase 141.2). The route no
 *                  longer materialises rows to dedup them by correlation_id.
 *
 * SHAPE-DISTINGUISHING, same discipline as the unit double: the COUNT chain and
 * a row-materialising select get DIFFERENT answers, so this suite can disagree
 * with a query that has silently stopped working. A shape-blind double is how
 * the dead `path:` numerator survived from Phase 19 to 141.1 — see 7d below,
 * which makes exactly that point about the Sentry side.
 *
 * `featureFlagsRows` is a dict keyed by flag_key. `auditLogTotal` is the true
 * attempt-row count, answered uncapped to the COUNT chain. The
 * row-materialising branch always answers a max_rows-capped page, exactly what
 * deployed PostgREST would return.
 *
 * ── OPS-07 (Phase 163): `auditLogRows` IS GONE, AND `auditLogError` /
 *    `auditLogCount` REPLACE IT ────────────────────────────────────────────
 *
 * `auditLogRows` was an override that NO TEST EVER PASSED (recorded in the
 * 141.2 close-out). An option no test passes is not neutral: it reads as
 * coverage of the truncation path at review time while guarding nothing, and it
 * was sitting in a harness whose whole subject is a monitor reporting health it
 * has not verified. Deleted rather than exercised — the route no longer
 * materialises rows at all (D-02 replaced the dedup with a server-side COUNT),
 * so there is no live path for it to override. The shape-distinguishing default
 * STAYS: a route that regressed to row materialisation still gets `count: null`
 * back and terminates, which is the disagreement this double exists to produce.
 *
 * The two new options are the ones the failure cases below actually pass, and
 * they exist because the same close-out found that no test drove a read error,
 * a null count, or a NaN count — so the file stayed green under BOTH shipped
 * denominator mutations.
 *   - `auditLogError`: a PostgREST error on the COUNT read.
 *   - `auditLogCount`: overrides the count VALUE independently of
 *     `auditLogTotal`, including `null` and `NaN` — the two shapes postgrest-js
 *     produces when the content-range header is absent or `*` / `*`.
 */
function makeAdminMock(opts: {
  featureFlagsRows?: Record<string, { value: string }>;
  auditLogTotal: number;
  auditLogCount?: number | null;
  auditLogError?: { message: string; code?: string };
}) {
  const { featureFlagsRows = {}, auditLogTotal, auditLogError } = opts;
  // `??` is wrong here: `auditLogCount: null` is a MEANINGFUL value (the
  // absent-content-range shape), and `??` would silently swap it for the
  // healthy total — reintroducing the exact collapse these cases exist to
  // falsify, inside the double that is supposed to falsify it.
  const countAnswer = Object.prototype.hasOwnProperty.call(opts, "auditLogCount")
    ? (opts.auditLogCount as number | null)
    : auditLogTotal;
  const upsertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];

  function fromTable(table: string) {
    if (table === "feature_flags") {
      return {
        select: () => ({
          eq: (_col: string, key: string) => ({
            maybeSingle: () =>
              Promise.resolve({ data: featureFlagsRows[key] ?? null }),
          }),
        }),
        upsert: (row: Record<string, unknown>, _opts?: unknown) => {
          upsertCalls.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === "audit_log") {
      const rows = Array.from(
        { length: Math.min(auditLogTotal, POSTGREST_MAX_ROWS) },
        (_, i) => ({ correlation_id: `cid-${i}` }),
      );
      return {
        select: (
          _cols: string,
          selectOpts?: { count?: string; head?: boolean },
        ) => {
          const answer =
            selectOpts?.head === true
              ? // Server-side COUNT: no rows cross the wire, no cap.
                {
                  data: null,
                  count: countAnswer,
                  error: auditLogError ?? null,
                }
              : // Row materialisation: capped, with no truncation signal.
                { data: rows, count: null, error: null };
          return {
            eq: () => ({
              gte: () => Promise.resolve(answer),
            }),
          };
        },
      };
    }
    throw new Error(`unmocked table: ${table}`);
  }

  return {
    from: vi.fn(fromTable),
    upsertCalls,
  };
}

const ENV_KEYS = [
  "CRON_SECRET",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG_SLUG",
  "RESEND_API_KEY",
  "FOUNDER_LP_REPORT_TO",
] as const;

describe("/api/cron/flag-monitor", () => {
  let savedEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
    process.env.SENTRY_AUTH_TOKEN = "sentry-token-fake";
    process.env.SENTRY_ORG_SLUG = "quantalyze";
    process.env.RESEND_API_KEY = "re_fake";
    process.env.FOUNDER_LP_REPORT_TO = "founder@example.com";
    sendMock.mockReset();
    sendMock.mockResolvedValue({ id: "email-id" });
    captureMock.mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function mockSentry(errorCount: number, status = 200) {
    fetchSpy.mockImplementation((async (url: string) => {
      if (typeof url === "string" && url.includes("sentry.io")) {
        return new Response(
          JSON.stringify({ data: [{ "count()": errorCount }] }),
          { status, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch);
  }

  async function loadHandler() {
    const mod = await import("@/app/api/cron/flag-monitor/route");
    return mod.GET;
  }

  // -------------------------------------------------------------------------
  // 1. Auth gate
  // -------------------------------------------------------------------------
  it("test_unauthorized_returns_401: returns 401 without bearer token", async () => {
    const handler = await loadHandler();
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 2. Below threshold — no flip, no email
  // -------------------------------------------------------------------------
  it("test_below_threshold_no_action: errorRate=0.1% does nothing", async () => {
    mockSentry(1); // 1 error
    const admin = makeAdminMock({ auditLogTotal: 1000 }); // rate = 0.1%
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.errorRate).toBeCloseTo(0.001, 5);
    // No kill-switch flip, no warn email
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Sub-threshold WARN email
  // -------------------------------------------------------------------------
  it("test_warn_threshold_sends_warn_email: errorRate=0.3% sends WARN email only", async () => {
    mockSentry(3);
    const admin = makeAdminMock({ auditLogTotal: 1000 }); // 0.3%
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("warn_sent");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as { subject: string };
    expect(arg.subject).toMatch(/WARN/);
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. Above threshold — kill-switch flip + ALERT email
  // -------------------------------------------------------------------------
  it("test_above_threshold_alerts_only: errorRate=1% alerts but NEVER flips kill-switch (Phase 106)", async () => {
    mockSentry(10);
    const admin = makeAdminMock({ auditLogTotal: 1000 }); // 1%
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Phase 106: auto-rollback retired — the monitor alerts, never rolls back.
    expect(body.action).toBe("alerted");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as { subject: string };
    expect(arg.subject).toMatch(/ALERT/);
  });

  // -------------------------------------------------------------------------
  // 5. Min-sample guard — total<20 cannot trigger rollback
  // -------------------------------------------------------------------------
  it("test_min_sample_guard: errorRate=50% with total=10 does NOT flip", async () => {
    mockSentry(5);
    const admin = makeAdminMock({ auditLogTotal: 10 }); // 50% but tiny sample
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBeUndefined();
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Sentry unreachable — fail open
  // -------------------------------------------------------------------------
  it("test_sentry_unreachable_returns_warn_response: Sentry 5xx returns sentry_unreachable", async () => {
    mockSentry(0, 502);
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_unreachable");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7. environment:production filter (Pitfall 8)
  // -------------------------------------------------------------------------
  it("test_environment_production_filter: outbound Sentry query string contains environment:production", async () => {
    mockSentry(0);
    const admin = makeAdminMock({ auditLogTotal: 100 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/environment[:%]/);
    expect(decodeURIComponent(url)).toContain("environment:production");
  });

  // -------------------------------------------------------------------------
  // 7b. SC-N (D-16) — the numerator query is built from INDEXED fields only.
  //
  // WHY this matters, not just what it does: `path` is written into Sentry
  // `extra` by src/instrumentation.ts's onRequestError, never into `tags`.
  // `extra` is metadata — it is not indexed and not searchable. A `path:` term
  // in a Sentry query therefore matches NOTHING, and the alert goes silent
  // without any signal that it has. That is exactly what happened between
  // Phase 19 and Phase 141.1: `path:/api/process-key` returned 0 events for
  // the monitor's entire lifetime and the founder was never paged.
  // -------------------------------------------------------------------------
  async function captureSentryQuery(): Promise<string> {
    mockSentry(0);
    const admin = makeAdminMock({ auditLogTotal: 100 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0][0] as string;
    // URLSearchParams decodes `+` back to a space; decodeURIComponent does not.
    const query = new URL(url).searchParams.get("query");
    expect(query).not.toBeNull();
    return query as string;
  }

  it("SC-N negative: the outbound Sentry query contains NO `path:` term (any path: term is dead — the field is unindexed by construction)", async () => {
    const query = await captureSentryQuery();
    expect(query).not.toContain("path:");
  });

  it("SC-N positive: the outbound Sentry query is exactly the indexed-field query (hand-typed oracle — any drift reddens)", async () => {
    const query = await captureSentryQuery();
    // Hand-typed literal, NOT rebuilt from the route's own constants: an
    // oracle derived from the implementation cannot falsify the
    // implementation. `transaction:` is the indexed scoping term that replaced
    // the dead `path:` filter — dropping it would let the 682/694
    // cron-recompute errors swamp the process-key ratio into false alerts.
    expect(query).toBe(
      "level:error transaction:/process-key correlation_id:* environment:production",
    );
  });

  // -------------------------------------------------------------------------
  // 7c. SC-N recurrence guard.
  //
  // Scope honesty: the dead-`path:` class is currently of size ONE — this is
  // RECURRENCE PREVENTION, not the closing of a second live instance. The
  // historical sibling (src/app/api/cron/phase19-error-rollup/route.ts, which
  // carried the same query) was retired in Phase 106 Stage B (ce32afbd).
  // Exhaustive greps at the time of writing: `path:/api/process-key` → 1 hit
  // in src/; `level:error` in non-test src/ → the same single line.
  // -------------------------------------------------------------------------
  it("SC-N recurrence guard: no Sentry query string anywhere in src/ filters on `path:`", () => {
    // Hand-typed. APPEND new Sentry-query call sites here (and bump the length
    // pin) so a new one is at least visible at review.
    const SENTRY_QUERY_FILES = ["src/app/api/cron/flag-monitor/route.ts"];
    expect(SENTRY_QUERY_FILES.length).toBe(1);

    const repoRoot = resolve(__dirname, "..", "..");
    for (const rel of SENTRY_QUERY_FILES) {
      const abs = resolve(repoRoot, rel);
      expect(existsSync(abs)).toBe(true);
      const src = readFileSync(abs, "utf8");

      // Extract every `query: "..."` literal — the Sentry query strings
      // themselves, NOT prose comments (which legitimately name the removed
      // `path:` term to explain why it must never come back).
      const literals = [...src.matchAll(/\bquery:\s*"([^"]*)"/g)].map(
        (m) => m[1],
      );
      // Fail loud if the extractor stops matching: a guard that silently finds
      // nothing to check is a guard that has stopped guarding.
      expect(
        literals.length,
        `${rel}: found no \`query: "..."\` literal to inspect. Either the Sentry ` +
          `query moved/was reformatted (update this extractor) or the file no ` +
          `longer builds a Sentry query (remove it from SENTRY_QUERY_FILES).`,
      ).toBeGreaterThan(0);

      for (const literal of literals) {
        expect(
          literal.includes("path:"),
          `${rel}: Sentry query "${literal}" filters on \`path:\`. On this repo's ` +
            `instrumentation, path is written to Sentry \`extra\` and NEVER to \`tags\` ` +
            `— extra is unindexed, so a \`path:\` filter matches nothing and the alert ` +
            `goes permanently silent with no signal. This is how the flag-monitor ` +
            `numerator sat at 0 from Phase 19 to Phase 141.1. Scope on indexed fields ` +
            `instead: transaction / routePath / correlation_id / level / environment.`,
        ).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 7d. SC-N end-to-end — the repaired numerator actually DRIVES the alert.
  //
  // Every other test here mocks Sentry with a URL-blind fetch that returns the
  // same count whatever is asked, so they stay green even against a query that
  // matches nothing in production. That is precisely the failure this phase
  // exists to close, so it cannot be the only evidence.
  //
  // The double below is an INDEX SIMULATOR: it answers the query the way the
  // real Sentry backend does, given this repo's instrumentation.
  //   - a `path:` term matches nothing (onRequestError writes path into
  //     `extra`, never `tags`; extra is unindexed) → count 0, alert silent.
  //     This reproduces the observed production reality: 0 events for the
  //     monitor's entire Phase 19 → 141.1 lifetime.
  //   - the repaired indexed-field query matches the 10 process-key errors.
  //   - an UNSCOPED query (scoping term dropped) matches the whole error
  //     population — 682 cron-recompute events — which is why the plan forbids
  //     that "fix": the ratio would swamp into permanent false alerts.
  // Asserting errorCount === 10 separates all three arms.
  // -------------------------------------------------------------------------
  it("SC-N end-to-end: 10 indexed /process-key errors over 1000 requests reach the 0.5% threshold and PAGE the founder (a dead `path:` query returns 0 and stays silent)", async () => {
    const PROCESS_KEY_ERRORS = 10; // matched only by the repaired query
    const WHOLE_ERROR_POPULATION = 682; // cron-recompute; matched if unscoped
    fetchSpy.mockImplementation((async (url: string) => {
      const query = new URL(url).searchParams.get("query") ?? "";
      const count = query.includes("path:")
        ? 0 // dead term — matches no event, ever
        : query.includes("transaction:/process-key")
          ? PROCESS_KEY_ERRORS
          : WHOLE_ERROR_POPULATION;
      return new Response(JSON.stringify({ data: [{ "count()": count }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);

    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();

    // The numerator counted the real error events...
    expect(body.errorCount).toBe(10);
    expect(body.total).toBe(1000);
    // ...the ratio crossed ALERT_THRESHOLD (0.5%) with total >= MIN_SAMPLE...
    expect(body.errorRate).toBeCloseTo(0.01, 5);
    expect(body.action).toBe("alerted");
    // ...and the founder was actually paged. An alert that computes a rate but
    // sends no email is the same silence in a different costume.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const email = sendMock.mock.calls[0][0] as {
      subject: string;
      to: string;
    };
    expect(email.subject).toMatch(/\[ALERT\]/);
    expect(email.subject).toContain("1.00%");
    expect(email.to).toBe("founder@example.com");
  });

  // -------------------------------------------------------------------------
  // 8. H-2 — zero-denominator streak escalates after 3 windows
  // -------------------------------------------------------------------------
  it("test_zero_denominator_alert_after_3_windows: streak=3 sends SEV-2 email", async () => {
    mockSentry(0);
    const admin = makeAdminMock({
      auditLogTotal: 0,
      featureFlagsRows: {
        flag_monitor_zero_denominator_streak: { value: "2" },
      },
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("zero_denominator");
    expect(body.streak).toBe(3);
    // Streak counter incremented in feature_flags
    const streakUpserts = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "flag_monitor_zero_denominator_streak",
    );
    expect(streakUpserts.length).toBe(1);
    expect(streakUpserts[0].row.value).toBe("3");
    // SEV-2 email sent
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as { subject: string };
    expect(arg.subject).toMatch(/H-2/);
    expect(arg.subject).toMatch(/SEV-2/);
  });

  // -------------------------------------------------------------------------
  // 9. H-2 — non-zero window resets streak
  // -------------------------------------------------------------------------
  it("test_zero_denominator_streak_resets: total>0 resets streak to 0", async () => {
    mockSentry(0);
    const admin = makeAdminMock({
      auditLogTotal: 100,
      featureFlagsRows: {
        flag_monitor_zero_denominator_streak: { value: "2" },
      },
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const streakUpserts = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "flag_monitor_zero_denominator_streak",
    );
    expect(streakUpserts.length).toBe(1);
    expect(streakUpserts[0].row.value).toBe("0");
    // No SEV-2 email — first non-zero window after a streak does NOT alert
    expect(sendMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // OPS-07 (Phase 163) — THE DENOMINATOR READ MUST PAGE, AND THIS FILE MUST BE
  // ABLE TO SAY SO.
  //
  // ⚠️ WHY THESE EXIST AT ALL — THIS SUITE WAS THE THING THAT FAILED.
  //
  // The 141.2 close-out recorded that this file gained an `auditLogRows` option
  // NO TEST PASSED, and that no case here drove a read error, a `count: null`
  // or a `count: NaN`. Consequence, measured then and re-measured now: under
  // BOTH shipped denominator mutations — (M1) collapsing a read error into
  // zero, and (M2) restoring `count ?? 0` — every test in this file stayed
  // GREEN. A monitor's own integration suite reported health it had not
  // verified, which is the same defect the monitor exists to catch, one level
  // up. The three runs below are the falsifiers that were missing.
  //
  // They pin the FULL terminal answer, not just the reason string:
  //   - reason `denominator_read_failed`, which kills M1 and M2 (both would
  //     answer `zero_denominator` instead), and
  //   - a NON-200 status, which is what makes the run register FAILED in Vercel
  //     cron history. Before this phase both arms returned at the default 200,
  //     so a persistent Supabase read failure logged a green run every 15
  //     minutes forever. Distinguishing a state and then reporting it as
  //     success is not distinguishing it — 141.2's own lesson ("the remedy
  //     replaced a wrong page with no page") recurring inside 141.2's remedy.
  //
  // ⭐ RED DEMOS (each run, restored after — see 163-05-SUMMARY.md for the
  //    verbatim failure output):
  //   (a) revert DENOMINATOR_FAILURE_STATUS to 200 → all THREE runs fail on
  //       `expected 200 to be 503`, and ONLY on that: every reason assertion
  //       still passes. That is precisely why the status is asserted
  //       separately — the classification was already right and paged nobody.
  //   (b) M1 — collapse the read-error arm to `{ kind: "ok", total: 0 }` → the
  //       read-error run fails, `expected 'zero_denominator' to be
  //       'denominator_read_failed'`.
  //   (c) M2 — disarm the usable-count guard and restore `count ?? 0` → TWO
  //       runs fail: `count: null` on the same reason mismatch, and `count:
  //       NaN` on `expected true to be false` (ok:true, i.e. NaN passed
  //       straight through as a rate with both alert arms disarmed).
  //   Under M1 and M2 this file used to be entirely green.
  // -------------------------------------------------------------------------
  /** The three shapes of "we could not read the denominator", and the one
   *  shape that is genuinely zero. Table-driven so a fourth failure shape is a
   *  one-line addition rather than a fourth copy-pasted block. */
  const DENOMINATOR_FAILURES = [
    {
      name: "a PostgREST read ERROR",
      opts: {
        auditLogTotal: 5000, // irrelevant — the read never succeeds
        auditLogError: { message: "PGRST301: JWT expired", code: "PGRST301" },
      },
    },
    {
      name: "an ABSENT count (`count: null`, no error — `?? 0` calls this zero traffic)",
      opts: { auditLogTotal: 1000, auditLogCount: null },
    },
    {
      name: "a NaN count (`*/*` content-range — not `=== 0`, so no zero-check catches it)",
      opts: { auditLogTotal: 1000, auditLogCount: Number.NaN },
    },
  ] as const;

  for (const scenario of DENOMINATOR_FAILURES) {
    it(`OPS-07: ${scenario.name} ends the run NON-200 with reason denominator_read_failed, and PAGES`, async () => {
      mockSentry(0);
      const admin = makeAdminMock({ ...scenario.opts });
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => admin,
      }));
      const handler = await loadHandler();
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      const body = await res.json();

      // The classification (kills M1 and M2)...
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("denominator_read_failed");
      expect(body.reason).not.toBe("zero_denominator");

      // ...and the PAGE. Asserted separately because the classification alone
      // was already correct before this phase and still paged nobody.
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(200);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const tags = (captureMock.mock.calls[0] as unknown[])[1] as {
        tags: Record<string, string>;
      };
      expect(tags.tags).toMatchObject({
        route: "cron.flag-monitor",
        denominator_read_failed: "true",
      });

      // A failed read is NOT a zero window: advancing the H-2 streak would
      // eventually page with the wrong story (the SEV-2 email asserts "no
      // traffic OR the audit-write is failing", both false here), and the
      // no-traffic email must not fire either.
      const streakUpserts = admin.upsertCalls.filter(
        (c) => c.row.flag_key === "flag_monitor_zero_denominator_streak",
      );
      expect(streakUpserts).toHaveLength(0);
      expect(sendMock).not.toHaveBeenCalled();
    });
  }

  it("OPS-07 control: a genuinely EMPTY window stays 200 and does NOT page — the streak machinery still owns it", async () => {
    // The positive control, and the reason the paging fix is not just "return
    // 503 more often". A change that reddened every quiet window would satisfy
    // all three runs above while destroying the H-2 escalation, replacing a
    // no-page with a permanent page — the same trade 141.2 made in reverse.
    mockSentry(0);
    const admin = makeAdminMock({ auditLogTotal: 0 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reason).toBe("zero_denominator");
    expect(body.reason).not.toBe("denominator_read_failed");
    expect(captureMock).not.toHaveBeenCalled();
    // The streak DOES advance here — that is this arm's whole job.
    expect(
      admin.upsertCalls.filter(
        (c) => c.row.flag_key === "flag_monitor_zero_denominator_streak",
      ),
    ).toHaveLength(1);
  });

  it("OPS-07: a HEALTHY window is still a 200 — the paging arms did not leak into the success path", async () => {
    mockSentry(1);
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(captureMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // I-T4 — Sentry-not-configured + Sentry-unreachable distinction.
  // -------------------------------------------------------------------------
  it("I-T4a: SENTRY_ORG_SLUG missing returns sentry_not_configured + no kill-switch flip", async () => {
    delete process.env.SENTRY_ORG_SLUG;
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_not_configured");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  it("I-T4b: fetch ECONNRESET returns sentry_unreachable + no kill-switch flip", async () => {
    fetchSpy.mockImplementation((async (url: string) => {
      if (typeof url === "string" && url.includes("sentry.io")) {
        throw new Error("ECONNRESET");
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch);
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_unreachable");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // I-T5 — boundary tests for ALERT_THRESHOLD + MIN_SAMPLE.
  // -------------------------------------------------------------------------
  it("I-T5a: 5/1000 (errorRate=0.5%) does NOT flip — strict > threshold", async () => {
    mockSentry(5);
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // 0.005 is NOT > 0.005 (strict >), so no ALERT. Above WARN_THRESHOLD
    // (0.0025) so action may be `warn_sent` — but critically NO kill-switch
    // flip (retired in Phase 106).
    expect(body.action).not.toBe("alerted");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  it("I-T5b: 1/20 (errorRate=5%, total=20) ALERTS — meets MIN_SAMPLE, never flips (Phase 106)", async () => {
    mockSentry(1);
    const admin = makeAdminMock({ auditLogTotal: 20 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.action).toBe("alerted");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  it("I-T5c: 1/19 (total=19 < MIN_SAMPLE) does NOT flip — sample-size guard", async () => {
    mockSentry(1);
    const admin = makeAdminMock({ auditLogTotal: 19 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.action).not.toBe("alerted");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // I-T6 — RESEND_API_KEY missing in ALERT path: alert-only monitor never
  // flips the (retired) kill-switch and skips the email, action='alerted'.
  // -------------------------------------------------------------------------
  it("I-T6: missing RESEND_API_KEY skips the alert email and NEVER flips the kill-switch (Phase 106)", async () => {
    delete process.env.RESEND_API_KEY;
    mockSentry(10);
    const admin = makeAdminMock({ auditLogTotal: 1000 }); // 1%
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("alerted");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
    // Resend was never instantiated (resendKey absent), so send was never called.
    expect(sendMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // I-perf-cron — Sentry 429 + rate-limit headers map to sentry_rate_limited.
  // -------------------------------------------------------------------------
  it("I-perf-cron: Sentry 429 + Retry-After header returns sentry_rate_limited", async () => {
    fetchSpy.mockImplementation((async (url: string) => {
      if (typeof url === "string" && url.includes("sentry.io")) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: {
            "content-type": "text/plain",
            "retry-after": "60",
            "x-sentry-rate-limit-remaining": "0",
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch);
    const admin = makeAdminMock({ auditLogTotal: 1000 });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_rate_limited");
    expect(body.retry_after).toBe("60");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 11. H-6 — CI smoke workflow file existence stub
  // -------------------------------------------------------------------------
  it("test_sentry_environment_smoke: workflow OR static-source smoke wires VERCEL_ENV", () => {
    // The CI dynamic smoke (capture event → query Sentry events API → assert
    // tags.environment) is a deferred operational step requiring a live test
    // Sentry org. Until then, we check that EITHER:
    //   (a) a workflow file referencing the smoke command exists, OR
    //   (b) the static-source companion test (sentry-environment.test.ts)
    //       exists in tests/integration/.
    const workflowPath = resolve(
      __dirname,
      "..",
      "..",
      ".github",
      "workflows",
      "phase-19-stability.yml",
    );
    const staticSmokePath = resolve(__dirname, "sentry-environment.test.ts");
    const workflowExists =
      existsSync(workflowPath) &&
      readFileSync(workflowPath, "utf8").includes("smoke:sentry-env");
    const staticSmokeExists = existsSync(staticSmokePath);
    expect(workflowExists || staticSmokeExists).toBe(true);
  });
});
