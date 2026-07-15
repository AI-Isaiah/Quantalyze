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

// ---------------------------------------------------------------------------
// Supabase admin mock. The route hits two tables:
//   feature_flags:
//     - .select("value").eq("flag_key", ZERO_DENOM_STREAK_KEY).maybeSingle()
//       → current zero-denominator streak (handleZeroDenominator)
//     - .upsert({...}, {onConflict}) → streak reset / streak bump / kill-switch
//   audit_log:
//     - .select("id",{count:"exact",head:true}).eq(...).gte(...)
//       → denominator (process_key audit rows in the window)
//
// Recorders capture every upsert payload so we can assert that the kill-switch
// row (flag_key === KILL_SWITCH_KEY) is NEVER written — the auto-rollback was
// retired in Phase 106 (Stage B). Only the ZERO_DENOM_STREAK_KEY row is ever
// upserted, on the zero-denominator path.
// ---------------------------------------------------------------------------
interface FlagMonitorRecorders {
  upserts: Array<Record<string, unknown>>;
  // Seeds:
  denominator: number; // audit_log count
  streakValue: string | null; // feature_flags zero-denom streak row value
}

function makeFlagMonitorRecorders(): FlagMonitorRecorders {
  return {
    upserts: [],
    denominator: 0,
    streakValue: null,
  };
}

// The retired kill-switch row key. The monitor must NEVER upsert it now.
const KILL_SWITCH_KEY = "process_key_unified_backbone";

function createSupabaseMock(rec: FlagMonitorRecorders) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};

      if (table === "audit_log") {
        // count query: select(...).eq(...).gte(...) — terminal thenable
        // resolving { count }.
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.gte = () =>
          Promise.resolve({ count: rec.denominator, error: null });
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
      rec.denominator = 1000; // big denom → low rate → ok, no rollback
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
      rec.denominator = 1000;
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
      rec.denominator = 1000;
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
    });

    // --- (4) zero-denominator streak boundary ------------------------------

    it("(4a) zero denominator with streak=2 bumps to 3 and DOES alert (boundary)", async () => {
      // ZERO_DENOMINATOR_ALERT_AFTER = 2 → alert when newStreak > 2 (i.e. 3).
      rec.denominator = 0;
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
      rec.denominator = 0;
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
      rec.denominator = 1000;
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
      rec.denominator = 1000;
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
      rec.denominator = 1000;
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
      rec.denominator = 1000;
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
