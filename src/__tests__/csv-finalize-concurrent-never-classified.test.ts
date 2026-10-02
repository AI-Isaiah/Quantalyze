/**
 * VAC-07 / Phase 164.5 criterion 6 — TWO CONCURRENT `csv-finalize` POSTs ON ONE
 * NEVER-CLASSIFIED `wizard_session_id`.
 *
 * THE GUARANTEE UNDER TEST
 * ------------------------
 * Two simultaneous POSTs carrying the SAME `wizard_session_id` and the SAME file,
 * differing only in the category they ask for, must produce:
 *
 *   1. EXACTLY ONE 2xx applied receipt (never two, never zero);
 *   2. one HONEST refusal for the other, by a NAMED code and status
 *      (`CSV_PERSIST_FAIL` / 503 on the compare-and-set loser, or
 *      `CSV_SESSION_REUSED` / 409 on the classification-mismatch arm), carrying the
 *      WINNER's `strategy_id` in `debug_context`;
 *   3. exactly ONE `strategies` row for that session, whose `category_id` holds the
 *      category of whichever POST returned the 2xx — read off the responses, never
 *      hardcoded.
 *
 * The fence that produces (1) and (3) is the partial unique index
 * `strategies_user_wizard_session_source_uniq` on
 * `(user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT NULL`
 * (migration 20260728120000, present in `supabase/schema/baseline.sql`). Remove it
 * and BOTH submissions take the fresh-create arm, mint their own strategy row, and
 * both answer 200 — which is what the RED observation in 164.5-07-SUMMARY.md shows.
 *
 * ⛔ WHY TWO CLIENTS WITH SEPARATE ACCESS TOKENS — DO NOT "SIMPLIFY" THIS
 * ---------------------------------------------------------------------
 * A single supabase-js client with `Promise.all` CANNOT produce a race: both calls
 * serialize over one pooled PostgREST connection, so the window never opens and the
 * spec passes with AND without the fence — a test that cannot fail, which this
 * project treats as worse than no test at all. That is a MEASURED lesson, not a
 * hypothesis: `src/__tests__/scenario-commit-batch-race.test.ts:69-77` records it as
 * H-0033 / H-0036 for the migration-083 M7 race and drives its two RPCs from two
 * INDEPENDENT sessions for the same user. This spec copies that shape: two
 * `createClient()` calls, two `signInWithPassword()` calls, two distinct access
 * tokens (asserted below), two connections. Each request is bound to its own client
 * through an `AsyncLocalStorage`, so the two handler invocations cannot share one.
 *
 * ⛔ WHY THIS FILE FAILS RATHER THAN SKIPS
 * ---------------------------------------
 * `src/__tests__/csv-finalize-rpc.test.ts` carries the tombstone for the opposite
 * choice: six live-DB cases skip-gated on a flag that is false in every CI vitest
 * shard by explicit instruction, over a function that had been DROPped. They never
 * failed and they never ran. *"Coverage that cannot execute is worse than absent
 * coverage."* So this file has NO skip gate. When the lane is absent, `beforeAll`
 * THROWS a message naming the lane and the command that boots it, and the run exits
 * non-zero.
 *
 * WHAT MAKES IT EXECUTE
 * ---------------------
 * It is deliberately EXCLUDED from `vitest.config.ts`'s jsdom project (it needs a
 * booted Supabase stack the sharded run does not have) and is the sole `include` of
 * `vitest.local-stack.config.ts`. CI runs it in the `frontend-local-stack` job, which
 * boots the lane, runs `npm run test:local-stack`, and tears the lane down; that job
 * is wired into the `frontend` aggregator's `needs:` list AND its result loop.
 * `src/__tests__/local-stack-lane-wiring.test.ts` — which DOES run in every shard —
 * pins all four of those facts, so this file cannot quietly become a tombstone.
 *
 * SUBSTRATE: the local-stack lane (`scripts/local-stack/run.sh up`), NOT the pg-lane.
 * `csv-finalize` and `withAuth` reach the database through supabase-js, i.e.
 * PostgREST + GoTrue over HTTP, and the seed calls the GoTrue admin API. A bare
 * Postgres cluster serves none of those. This file is the FIRST consumer of
 * `scripts/local-stack/.stack-env`.
 *
 * ⛔ LOCAL ONLY. The lane's API URL is re-asserted as 127.0.0.1/localhost here before
 * anything is written, independently of `run.sh`'s own `assert_local`. TEST is shared
 * with other people's CI and PROD is PROD; this spec creates users and strategies.
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

// ── Hoisted holder ────────────────────────────────────────────────────────────
// The `vi.mock` factories below are hoisted above every import, so they may not
// dereference a module-body `const` at FACTORY time. They only read `H` from
// inside the functions they return, which run at REQUEST time — long after the
// module body has assigned both fields.
const H = vi.hoisted(() => ({
  als: null as null | { getStore(): unknown },
  userId: "",
}));

// The route obtains its database handle from `createClient()` (the SSR
// cookie-session client). There are no cookies in a vitest process, so it is
// replaced by the REAL, user-scoped supabase-js client this request is running
// under — real PostgREST, real RLS, real SECURITY DEFINER `auth.uid()`. The
// AsyncLocalStorage is what keeps the two concurrent invocations on SEPARATE
// clients; a module-level "current client" variable would be racy by construction
// and would silently re-create the single-client defect this spec exists to avoid.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const client = H.als?.getStore();
    if (!client) {
      throw new Error(
        "csv-finalize-concurrent: the route called createClient() outside the per-request AsyncLocalStorage context. Every POST must be fired inside laneCtx.run(client, …) or the two requests would share one connection and the race could not open.",
      );
    }
    return client;
  },
}));

// withAuth passthrough: cookie-session auth and the CSRF origin check are not what
// this spec measures, and neither exists in a vitest process. The identity that
// DOES matter — `auth.uid()` inside the SECURITY DEFINER fold — comes from the real
// JWT on the per-request client above, so the ownership guard is exercised for real.
vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    <H2 extends (req: unknown, user: unknown) => unknown>(handler: H2) =>
    async (req: unknown) =>
      handler(req, { id: H.userId }),
}));

// No Redis on the lane. The limiter is not under test; a real `checkLimit` would
// fail closed and mask the race behind a 503.
vi.mock("@/lib/ratelimit", () => ({
  csvValidateLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
  rateLimitDenyJson: () => {
    throw new Error("unreachable: the limiter is stubbed to always succeed");
  },
}));

// No Sentry DSN on the lane; the route captures on both refusal arms.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// `after()` requires a Next.js request scope, which a vitest process has not got.
// No-op it: its only payloads here are the audit-row emission and the analytics
// enqueue, neither of which participates in the race. A consequence that MATTERS
// and is relied on below: no compute job runs, so `strategy_analytics` stays empty
// and the fill arm's clock-safety guard takes its "no stored KPIs, nothing in
// flight" branch rather than refusing for an unrelated reason.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: vi.fn() };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/strategies/csv-finalize/route";

// ── The lane ──────────────────────────────────────────────────────────────────

const LANE_ENV_PATH = fileURLToPath(
  new URL("../../scripts/local-stack/.stack-env", import.meta.url),
);

const LANE_BOOT_HINT =
  "Boot it with:  bash scripts/local-stack/run.sh up   (then re-run). " +
  "This spec FAILS rather than skips on an absent lane — a silently skipped live-DB " +
  "spec is the csv-finalize-rpc.test.ts tombstone, and it is the defect Phase 164.5 " +
  "criterion 6 exists to not repeat.";

type LaneEnv = {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

/**
 * Reads `scripts/local-stack/.stack-env` (the handoff `run.sh up` writes, mode 600).
 * Throws — never returns a degraded value — when the lane is absent or the handoff
 * is missing a key this spec needs.
 */
function readLaneEnv(): LaneEnv {
  if (!existsSync(LANE_ENV_PATH)) {
    throw new Error(
      `LOCAL-STACK LANE ABSENT: ${LANE_ENV_PATH} does not exist, so the Supabase stack this spec needs (PostgREST + GoTrue) is not running. ${LANE_BOOT_HINT}`,
    );
  }
  const raw = readFileSync(LANE_ENV_PATH, "utf8");
  const pick = (key: string): string => {
    const m = raw.match(new RegExp(`^${key}="?([^"\\n]*)"?$`, "m"));
    if (!m || !m[1]) {
      throw new Error(
        `LOCAL-STACK LANE HANDOFF INCOMPLETE: ${LANE_ENV_PATH} carries no usable ${key}. The lane may have been torn down mid-write. ${LANE_BOOT_HINT}`,
      );
    }
    return m[1];
  };
  const env = {
    API_URL: pick("API_URL"),
    ANON_KEY: pick("ANON_KEY"),
    SERVICE_ROLE_KEY: pick("SERVICE_ROLE_KEY"),
  };
  // Independent of run.sh's own assert_local. This spec creates auth users and
  // strategies; it must never do that against shared TEST or PROD.
  if (
    !/^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(env.API_URL) &&
    !/^http:\/\/localhost(:\d+)?(\/|$)/.test(env.API_URL)
  ) {
    throw new Error(
      `LOCAL-STACK LANE REFUSED: the handoff reports a NON-LOCAL API URL. This spec writes auth users and strategies and is local-only. Refusing to continue.`,
    );
  }
  return env;
}

const laneCtx = new AsyncLocalStorage<SupabaseClient>();
H.als = laneCtx as unknown as { getStore(): unknown };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("VAC-07 — two concurrent csv-finalize POSTs on one never-classified wizard session (local-stack lane)", () => {
  let lane: LaneEnv;
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let tokenA: string;
  let tokenB: string;
  let userId: string;
  let userEmail: string;

  /**
   * ⛔ WHY SETUP FAILURES ARE CAPTURED HERE INSTEAD OF THROWN OUT OF `beforeAll`.
   * A throwing `beforeAll` fails the FILE (exit 1, correctly) but vitest then
   * renders its tests as `2 skipped` — and "skipped" is the exact word the
   * `csv-finalize-rpc.test.ts` tombstone is remembered by. A reader scanning CI
   * output for silently-skipped live-DB coverage would find this file matching the
   * pattern it exists to disprove. Re-throwing inside each test instead makes the
   * run report `2 failed`, with the lane-absent sentence attached to a named test.
   * Nothing is swallowed: the message is byte-identical and the exit code is the
   * same.
   */
  let setupError: Error | null = null;
  const requireLane = () => {
    if (setupError) throw setupError;
  };

  // One session id and one file for BOTH submissions — that is what makes them a
  // double-submit rather than two uploads. Only the category differs, so the
  // outcome is deterministic (the two can never "agree" onto a second 200).
  const stamp = Date.now();
  const SESSION_ID = crypto.randomUUID();
  const STRATEGY_NAME = `VAC-07 concurrent finalize ${stamp}`;
  const SERIES = [
    { date: "2024-01-02", daily_return: 0.011 },
    { date: "2024-01-03", daily_return: -0.004 },
    { date: "2024-01-04", daily_return: 0.007 },
  ];
  const CATEGORY_A = crypto.randomUUID();
  const CATEGORY_B = crypto.randomUUID();

  function makeRequest(categoryId: string): NextRequest {
    return new NextRequest(
      "http://localhost:3000/api/strategies/csv-finalize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          wizard_session_id: SESSION_ID,
          fmt: "daily_returns",
          strategy_name: STRATEGY_NAME,
          daily_returns_series: SERIES,
          // asset_class is IDENTICAL on both submissions on purpose: it makes
          // `category_id` the sole discriminator, so a refusal on the
          // already-classified arm can only be the category mismatch.
          metadata: { category_id: categoryId, asset_class: "crypto" },
        }),
      },
    );
  }

  beforeAll(async () => {
    try {
      await seedLane();
    } catch (e) {
      setupError = e instanceof Error ? e : new Error(String(e));
    }
  }, 120_000);

  async function seedLane(): Promise<void> {
    lane = readLaneEnv();

    // The route builds its own admin client from these two, ABOVE the commit
    // (OPS-06). Left unset it would throw a 500 over the whole race.
    process.env.NEXT_PUBLIC_SUPABASE_URL = lane.API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = lane.ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = lane.SERVICE_ROLE_KEY;

    admin = createClient(lane.API_URL, lane.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fail loud if the lane is up but the app schema was NOT loaded
    // (`run.sh up --no-schema`): every assertion below would otherwise fail with
    // an opaque PostgREST 404 that reads like a product bug.
    const schemaProbe = await admin.from("strategies").select("id").limit(1);
    if (schemaProbe.error) {
      throw new Error(
        `LOCAL-STACK LANE HAS NO APP SCHEMA: reading public.strategies failed (${schemaProbe.error.code ?? "no code"}: ${schemaProbe.error.message}). 'run.sh up --no-schema' starts the stack WITHOUT the baseline. ${LANE_BOOT_HINT}`,
      );
    }

    userEmail = `vac07-concurrent-${stamp}@test.local`;
    const password = `LaneSpec${stamp}!`;
    const created = await admin.auth.admin.createUser({
      email: userEmail,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(
        `failed to create the lane user: ${created.error?.message}`,
      );
    }
    userId = created.data.user.id;
    H.userId = userId;

    const profile = await admin
      .from("profiles")
      .upsert({ id: userId, display_name: userEmail }, { onConflict: "id" });
    if (profile.error) {
      throw new Error(`failed to seed profiles: ${profile.error.message}`);
    }

    // `strategies.category_id` is FK → `discovery_categories(id)` ON DELETE SET
    // NULL, so both categories must exist or the metadata UPDATE fails with a
    // 23503 and the spec would be measuring a foreign key, not a race.
    const cats = await admin.from("discovery_categories").insert([
      { id: CATEGORY_A, name: `VAC-07 A ${stamp}`, slug: `vac07-a-${stamp}` },
      { id: CATEGORY_B, name: `VAC-07 B ${stamp}`, slug: `vac07-b-${stamp}` },
    ]);
    if (cats.error) {
      throw new Error(
        `failed to seed discovery_categories: ${cats.error.message}`,
      );
    }

    // TWO INDEPENDENT SESSIONS for the SAME user (H-0033 / H-0036). A distinct
    // createClient + signInWithPassword yields its own access token and its own
    // connection, so the two POSTs below can genuinely overlap instead of
    // serializing over one pooled socket. Both tokens carry the same
    // `auth.uid()`, so both satisfy the fold's `p_user_id = auth.uid()` guard.
    clientA = createClient(lane.API_URL, lane.ANON_KEY, {
      auth: { storageKey: "vac07-session-A", persistSession: false },
    });
    const signInA = await clientA.auth.signInWithPassword({
      email: userEmail,
      password,
    });
    if (signInA.error || !signInA.data.session) {
      throw new Error(`failed to sign in session A: ${signInA.error?.message}`);
    }
    tokenA = signInA.data.session.access_token;

    clientB = createClient(lane.API_URL, lane.ANON_KEY, {
      auth: { storageKey: "vac07-session-B", persistSession: false },
    });
    const signInB = await clientB.auth.signInWithPassword({
      email: userEmail,
      password,
    });
    if (signInB.error || !signInB.data.session) {
      throw new Error(`failed to sign in session B: ${signInB.error?.message}`);
    }
    tokenB = signInB.data.session.access_token;
  }

  afterAll(async () => {
    if (!admin || !userId) return;
    const owned = await admin
      .from("strategies")
      .select("id")
      .eq("user_id", userId);
    const ids = (owned.data ?? []).map((r) => (r as { id: string }).id);
    if (ids.length > 0) {
      await admin.from("csv_daily_returns").delete().in("strategy_id", ids);
      await admin.from("strategy_verifications").delete().in("strategy_id", ids);
      await admin.from("strategies").delete().in("id", ids);
    }
    await admin
      .from("discovery_categories")
      .delete()
      .in("id", [CATEGORY_A, CATEGORY_B]);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }, 120_000);

  it("SETUP — the two clients hold DIFFERENT access tokens (a single client cannot open the race)", () => {
    requireLane();
    expect(tokenA.length, "session A produced no access token").toBeGreaterThan(
      0,
    );
    expect(tokenB.length, "session B produced no access token").toBeGreaterThan(
      0,
    );
    expect(
      tokenA,
      "the two clients share one access token, so both POSTs would ride one PostgREST connection and serialize — the race window would never open and this spec would pass with AND without the fence (H-0033 / H-0036)",
    ).not.toBe(tokenB);
  });

  it(
    "VAC-07: exactly ONE applied receipt, one NAMED refusal, and category_id holds the winner",
    async () => {
      requireLane();
      // Own-seeded invariant, never a global empty-state: the lane is reusable and
      // a global count is unreliable (shared-fixture rule).
      const before = await admin
        .from("strategies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("wizard_session_id", SESSION_ID);
      expect(
        before.count,
        "this wizard session must start with NO committed strategy — otherwise the 'never classified' precondition does not hold",
      ).toBe(0);

      // FIRE. Two POSTs, two clients, two access tokens, one wizard session.
      const [resA, resB] = await Promise.all([
        laneCtx.run(clientA, () => POST(makeRequest(CATEGORY_A))),
        laneCtx.run(clientB, () => POST(makeRequest(CATEGORY_B))),
      ]);

      const bodyA = await resA.json();
      const bodyB = await resB.json();
      const results = [
        { label: "A", categoryId: CATEGORY_A, res: resA, body: bodyA },
        { label: "B", categoryId: CATEGORY_B, res: resB, body: bodyB },
      ];
      const is2xx = (s: number) => s >= 200 && s < 300;
      const applied = results.filter((r) => is2xx(r.res.status));
      const refused = results.filter((r) => !is2xx(r.res.status));

      // (1) EXACTLY ONE APPLIED RECEIPT. Two means the double-submit fence
      //     (strategies_user_wizard_session_source_uniq) did not bite and both
      //     submissions minted their own strategy; zero means neither landed.
      const outcomes = results.map(
        (r) => `${r.label}:${r.res.status}:${r.body?.code ?? "ok"}`,
      );
      expect(
        applied.map((r) => `${r.label}:${r.res.status}`),
        `exactly ONE of the two concurrent csv-finalize POSTs may return a 2xx applied receipt — the partial unique index strategies_user_wizard_session_source_uniq is what makes the second one collide with 23505 and take the resolve arm. Both outcomes were: ${outcomes.join(", ")}`,
      ).toHaveLength(1);

      const winner = applied[0];
      const loser = refused[0];
      expect(winner.body.ok).toBe(true);
      expect(
        UUID_RE.test(String(winner.body.strategy_id)),
        `the applied receipt must carry the committed strategy id (got ${JSON.stringify(winner.body.strategy_id)})`,
      ).toBe(true);
      const winnerStrategyId = winner.body.strategy_id as string;

      // (2) THE LOSER'S REFUSAL IS NAMED, not merely non-2xx. Both reachable
      //     orderings are enumerated with their own status and sentence; a crash, a
      //     timeout, an auth failure or the read-failure arm (`failClosed`, whose
      //     debug_context is EMPTY) all fall outside and fail here.
      expect(loser.body.ok).toBe(false);
      expect(
        ["CSV_PERSIST_FAIL", "CSV_SESSION_REUSED"],
        `the raced-out submission must be refused by one of the two named csv-finalize arms, not by an unrelated fault (got status ${loser.res.status}, body ${JSON.stringify(loser.body)})`,
      ).toContain(loser.body.code);

      if (loser.body.code === "CSV_PERSIST_FAIL") {
        // The compare-and-set loser: `.is("category_id", null)` matched zero rows
        // because the other submission's classification landed first.
        expect(loser.res.status).toBe(503);
        expect(
          loser.body.human_message,
          "CSV_PERSIST_FAIL must carry one of the two RANK-07 raced sentences — the fresh-arm one or the fill-arm one — not the read-failure sentence",
        ).toMatch(
          /another submission of this same wizard session classified it first|that write did not land, so nothing was changed/,
        );
      } else {
        // The already-classified arm: the winner's category was committed before
        // this request re-read the row, and the two categories differ.
        expect(loser.res.status).toBe(409);
        expect(
          loser.body.human_message,
          "CSV_SESSION_REUSED on this arm must carry the CLASSIFICATION conflict sentence, not the default 'different track record' one (the file is identical; only the classification differs)",
        ).toContain(
          "already created a strategy with a different classification",
        );
      }
      expect(
        loser.body.debug_context?.strategy_id,
        "the refusal must name the WINNER's strategy id — an empty debug_context is the fail-closed read-failure arm, which is a different fault",
      ).toBe(winnerStrategyId);

      // (3) ONE ROW, AND IT HOLDS THE WINNER'S CATEGORY.
      const after = await admin
        .from("strategies")
        .select("id, category_id, source, status")
        .eq("user_id", userId)
        .eq("wizard_session_id", SESSION_ID);
      expect(after.error).toBeNull();
      const rows = (after.data ?? []) as {
        id: string;
        category_id: string | null;
        source: string;
        status: string;
      }[];
      expect(
        rows.map((r) => r.id),
        "the two concurrent submissions must collapse onto EXACTLY ONE strategies row for this wizard session — more than one is the silent double-submit the fence exists to stop",
      ).toHaveLength(1);
      expect(rows[0].id).toBe(winnerStrategyId);
      expect(rows[0].source).toBe("csv");
      expect(
        rows[0].category_id,
        "category_id must hold the category of whichever POST returned the 2xx applied receipt — the winner is read off the responses, never assumed",
      ).toBe(winner.categoryId);

      // The verification row rides the same transaction as the strategies row, so
      // a second one is the same double-apply seen from the other side.
      const verifications = await admin
        .from("strategy_verifications")
        .select("id", { count: "exact", head: true })
        .eq("strategy_id", winnerStrategyId);
      expect(
        verifications.count,
        "exactly one strategy_verifications row must exist for the committed strategy",
      ).toBe(1);
    },
    120_000,
  );
});
