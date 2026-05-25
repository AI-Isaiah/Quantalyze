import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/flag-monitor (M-0999).
 *
 * flag-monitor is the only sub-daily cron (every 15 min) and it flips the
 * production kill-switch row in feature_flags. Wrong threshold math, a wrong
 * Sentry env filter, or swallowed PostgREST errors either roll back
 * production unnecessarily OR fail to roll back during a real incident.
 * Integration tests cannot exercise the extracted helpers exhaustively; this
 * suite drives the exported handler with mocked fetch/Supabase/Resend to hit
 * the branching the finding flags:
 *
 *   (1) parseSentryCount handles both `data[0]["count()"]` and `data[0].count`.
 *   (2) isPostgrestResolutionError gates the D-3 fallback (PGRST matches,
 *       unrelated errors rethrow → unhandled, not the D-3 500).
 *   (3) 429 + x-sentry-rate-limit-remaining → reason "sentry_rate_limited".
 *   (4) zero-denominator streak alerts only AFTER ZERO_DENOMINATOR_ALERT_AFTER
 *       (streak going 2→silent vs 3→alert).
 *   (5) triggerAutoRollback's D-3 PostgREST fallback → 500
 *       kill_switch_unreachable_d3 AND a SEV-2 email.
 *   (6) WARN threshold sends an email but does NOT flip the kill-switch.
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
// Recorders capture upsert payloads (so we can assert kill-switch flips) and
// the upsert mock can be made to THROW to exercise the D-3 fallback.
// ---------------------------------------------------------------------------
interface FlagMonitorRecorders {
  upserts: Array<Record<string, unknown>>;
  // Seeds:
  denominator: number; // audit_log count
  streakValue: string | null; // feature_flags zero-denom streak row value
  // When set, the kill-switch upsert (flag_key === KILL_SWITCH_KEY) throws.
  killSwitchUpsertError: Error | null;
}

function makeFlagMonitorRecorders(): FlagMonitorRecorders {
  return {
    upserts: [],
    denominator: 0,
    streakValue: null,
    killSwitchUpsertError: null,
  };
}

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
        if (
          payload.flag_key === KILL_SWITCH_KEY &&
          rec.killSwitchUpsertError
        ) {
          // PostgREST upsert failures surface as thrown errors in the route's
          // try/catch (D-3). Return a rejected thenable.
          return Promise.reject(rec.killSwitchUpsertError);
        }
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

    // --- (6) WARN threshold: email, no kill-switch flip --------------------

    it("(6) WARN threshold sends an email but does NOT flip the kill-switch", async () => {
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
      // ...but the kill-switch row must NOT be upserted to "off".
      const killFlips = rec.upserts.filter(
        (u) => u.flag_key === KILL_SWITCH_KEY,
      );
      expect(killFlips).toHaveLength(0);
    });

    it("(6b) ALERT threshold flips the kill-switch to off and emails", async () => {
      // total=1000, errorCount=10 → 1.0% > ALERT(0.5%), total >= MIN_SAMPLE.
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
      expect(body.action).toBe("rolled_back");
      const killFlips = rec.upserts.filter(
        (u) => u.flag_key === KILL_SWITCH_KEY && u.value === "off",
      );
      expect(killFlips).toHaveLength(1);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(String(sendEmailSpy.mock.calls[0][0].subject)).toContain("ALERT");
    });

    // --- (2)+(5) D-3 PostgREST fallback ------------------------------------

    it("(2)+(5) D-3: PostgREST kill-switch upsert error → 500 kill_switch_unreachable_d3 + SEV-2 email", async () => {
      // ALERT condition fires, but the kill-switch upsert raises a PostgREST
      // resolution error (schema cache). isPostgrestResolutionError must match
      // it and the route returns 500 kill_switch_unreachable_d3 + SEV-2 email.
      rec.denominator = 1000;
      rec.killSwitchUpsertError = new Error(
        "PGRST202: could not find function in the schema cache",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 10 }] } }),
        ),
      );
      const handler = await getHandler();
      const res = await handler(authedReq());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.reason).toBe("kill_switch_unreachable_d3");
      // SEV-2 email goes out so the founder uses the manual runbook.
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(String(sendEmailSpy.mock.calls[0][0].subject)).toContain("D-3 SEV-2");
    });

    it("(2b) non-PostgREST kill-switch upsert error does NOT take the D-3 path", async () => {
      // A generic (non-PGRST) error must NOT be matched by
      // isPostgrestResolutionError — the route rethrows it (an unhandled
      // rejection) rather than masquerading as the D-3 500. We assert the
      // handler does NOT resolve with kill_switch_unreachable_d3.
      rec.denominator = 1000;
      rec.killSwitchUpsertError = new Error("connection reset by peer");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sentryResponse({ ok: true, json: { data: [{ "count()": 10 }] } }),
        ),
      );
      const handler = await getHandler();
      // The route rethrows the non-PGRST error (it is not caught by the D-3
      // matcher), so the handler promise rejects rather than returning the
      // D-3 envelope.
      await expect(handler(authedReq())).rejects.toThrow(
        "connection reset by peer",
      );
    });
  },
);
