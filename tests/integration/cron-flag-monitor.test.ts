/**
 * Phase 19 / BACKBONE-05 — /api/cron/flag-monitor route handler tests.
 *
 * Coverage (per 19-07 PLAN behavior section):
 *   1.  test_unauthorized_returns_401            — auth gate
 *   2.  test_below_threshold_no_action           — errorRate=0.1%, no flip, no email
 *   3.  test_warn_threshold_sends_warn_email     — errorRate=0.3%, no flip, WARN email
 *   4.  test_above_threshold_flips_kill_switch   — errorRate=1%, total>=20, flip + ALERT email
 *   5.  test_min_sample_guard                    — total<20, no flip even if errorRate=50%
 *   6.  test_sentry_unreachable_returns_warn     — Sentry 5xx, no flip
 *   7.  test_environment_production_filter       — outbound query carries env filter (Pitfall 8)
 *   8.  test_zero_denominator_alert_after_3_windows  — H-2: streak=3 → SEV-2 email
 *   9.  test_zero_denominator_streak_resets      — H-2: total>0 resets streak
 *   10. test_postgrest_function_not_found_fallback   — D-3: PGRST error → SEV-2 alert + 500
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

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

/**
 * Build a Supabase admin client mock with two collaborating tables:
 *   - feature_flags: select(value).eq("flag_key", X).maybeSingle()
 *                    upsert({...}, { onConflict })
 *   - audit_log: select("id", {count:"exact", head:true}).eq(...).gte(...)
 *
 * `featureFlagsRows` is a dict keyed by flag_key. `auditLogTotal` controls
 * the denominator. `featureFlagsUpsertImpl` lets a test override the upsert
 * (e.g. throw a PGRST error for D-3).
 */
function makeAdminMock(opts: {
  featureFlagsRows?: Record<string, { value: string }>;
  auditLogTotal: number;
  featureFlagsUpsertImpl?: (...args: unknown[]) => unknown;
}) {
  const { featureFlagsRows = {}, auditLogTotal, featureFlagsUpsertImpl } = opts;
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
          if (featureFlagsUpsertImpl) {
            const ret = featureFlagsUpsertImpl(row);
            return ret instanceof Promise ? ret : Promise.resolve(ret);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === "audit_log") {
      return {
        select: (_cols: string, _opts: { count: string; head: boolean }) => ({
          eq: () => ({
            gte: () =>
              Promise.resolve({ count: auditLogTotal, error: null }),
          }),
        }),
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
  "PHASE_19_STABILITY_CACHE_TTL_S",
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
  it("test_above_threshold_flips_kill_switch: errorRate=1% flips kill-switch", async () => {
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
    expect(body.action).toBe("rolled_back");
    const flips = admin.upsertCalls.filter(
      (c) => c.row.flag_key === "process_key_unified_backbone",
    );
    expect(flips.length).toBe(1);
    expect(flips[0].row.value).toBe("off");
    expect(flips[0].row.updated_by).toBe("cron/flag-monitor");
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
  // 10. D-3 — PostgREST function-not-found fallback
  // -------------------------------------------------------------------------
  it("test_postgrest_function_not_found_fallback: PGRST error sends SEV-2 + 500", async () => {
    mockSentry(10);
    let killSwitchUpsertCalls = 0;
    const admin = makeAdminMock({
      auditLogTotal: 1000,
      featureFlagsUpsertImpl: (...args: unknown[]) => {
        const row = args[0] as Record<string, unknown>;
        if (row.flag_key === "process_key_unified_backbone") {
          killSwitchUpsertCalls += 1;
          throw new Error(
            "PGRST202 Could not find the function in the schema cache",
          );
        }
        return { data: null, error: null };
      },
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => admin,
    }));
    const handler = await loadHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("kill_switch_unreachable_d3");
    expect(killSwitchUpsertCalls).toBe(1);
    // SEV-2 email
    expect(sendMock).toHaveBeenCalled();
    const subjects = sendMock.mock.calls.map(
      (c) => (c[0] as { subject: string }).subject,
    );
    expect(subjects.some((s) => /D-3/.test(s) && /SEV-2/.test(s))).toBe(true);
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
