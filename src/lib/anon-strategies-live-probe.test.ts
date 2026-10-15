/**
 * Anonymous-visitor live probe for `public.strategies` (Phase 170.6.1.1 ANONKEYID).
 *
 * WHY THIS FILE EXISTS. `public.strategies.api_key_id` is readable by `anon`
 * today (table-level SELECT), so any visitor with the publishable key can read
 * which API key backs a published strategy. PR-B revokes that: table-level
 * SELECT goes, column-level SELECT stays on every column but `api_key_id`. After
 * the revoke, ANY anon query that selects `*` or names `api_key_id` answers
 * 42501, which takes a public page down. PR-A (this file's phase, plan 01)
 * narrows every anonymous reader first, and this probe is the proof: it runs the
 * REAL readers as a signed-out visitor against a real PostgREST + Postgres.
 *
 * THE VISITOR. `@/lib/supabase/server` is mocked so `createClient()` returns a
 * supabase-js client built from the lane URL and the ANON key (no bearer token),
 * with an `auth.getUser` / `auth.getSession` that answer no user. That is exactly
 * what `src/lib/supabase/server.ts` hands a server component when the request
 * carries no session: PostgREST runs the query as the `anon` Postgres role.
 *
 * THE D-02 CENSUS (which readers a signed-out visitor reaches) is recorded in
 * `.planning/phases/170.6.1.1-*` plan 01. Census A (wildcard readers) are
 * narrowed in plan 01; census B (readers that already name explicit columns)
 * each get an arm here because "names no api_key_id" is a claim about source
 * text and the arm is the proof under revoked grants.
 *
 * SCOPE. PR-B (plan 05) extends THIS file with the refusal arms (anon refused
 * `api_key_id`, anon holds no write privilege) once the migration exists. This
 * plan adds no migration and changes no grant.
 *
 * Gate: the sec-005 shape, `HAS_LIVE_DB` plus the anon key. It references
 * `HAS_LIVE_DB`, so `scripts/live-db-lane-corpus.mjs` derives it into the
 * live-DB lane corpus. Skips in the unit shards (no credentials there).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { STRATEGY_PUBLIC_COLUMNS } from "./constants";
import { withPublishedOnly } from "./visibility";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "./test-helpers/live-db";

// `@/lib/queries` imports `server-only`, which throws outside a React Server
// Component. The repo's standing idiom is a bare stub.
vi.mock("server-only", () => ({}));

// The OG route builds an `ImageResponse`. The REAL class runs (status 200, a PNG),
// subclassed only to record the element tree it was handed, so the arm can tell a
// card rendered from the seeded row from the generic not-found card.
const ogCalls = vi.hoisted(() => [] as Array<{ element: unknown }>);
vi.mock("next/og", async (importActual) => {
  const actual = await importActual<typeof import("next/og")>();
  return {
    ...actual,
    ImageResponse: class extends actual.ImageResponse {
      constructor(element: ConstructorParameters<typeof actual.ImageResponse>[0], options?: ConstructorParameters<typeof actual.ImageResponse>[1]) {
        ogCalls.push({ element });
        super(element, options);
      }
    },
  };
});

// A failed OG read is reported through `after()`, which needs a Next request
// scope vitest does not provide. The spy doubles as the failure-path detector:
// the route calls it only when a read or compute stage failed.
const afterSpy = vi.hoisted(() => vi.fn((cb: () => unknown) => void cb()));
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: afterSpy,
}));

// A signed-out visitor: the lane's ANON key, no bearer token, no session.
vi.mock("@/lib/supabase/server", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    createClient: async () => {
      const base = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const visitor: typeof base = Object.create(base);
      Object.defineProperty(visitor, "auth", {
        value: {
          getUser: async () => ({ data: { user: null }, error: null }),
          getSession: async () => ({ data: { session: null }, error: null }),
        },
      });
      return visitor;
    },
  };
});

const LIVE_DB_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_ANON_PROBE = HAS_LIVE_DB && Boolean(LIVE_DB_ANON_KEY);

/** A signed-out client for the direct (non-reader) arms. */
function anonClient() {
  return createSupabaseClient(LIVE_DB_URL!, LIVE_DB_ANON_KEY!, {
    auth: { persistSession: false },
  });
}

const SRC = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * The string literal passed to `.select(` right after each `.from("strategies")`
 * in a route file, plus whether it is the head-count form. Used by the two reads
 * that are NOT exported (the v2 page's Lane A read and the tearsheet's
 * `readReturnsUnit`) and by the landing page's count: the arm REPLAYS the route's
 * own source text as anon, because there is no function to import. Comments
 * between `.from(...)` and `.select(` are skipped; a template or concatenated
 * select is not matched, which the exactly-one assertions turn into a failure
 * instead of a silent pass.
 */
function strategiesSelectLiterals(file: string): Array<{ literal: string; isCount: boolean }> {
  const source = readFileSync(SRC(file), "utf8");
  const out: Array<{ literal: string; isCount: boolean }> = [];
  const parts = source.split('.from("strategies")').slice(1);
  for (const part of parts) {
    const next = part.indexOf(".from(");
    const slice = next === -1 ? part : part.slice(0, next);
    const m = /\.select\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]*)"(\s*,\s*\{\s*count)?/.exec(slice);
    if (m) out.push({ literal: m[1], isCount: Boolean(m[2]) });
  }
  return out;
}

describe("anon strategies live probe - the real public readers as a signed-out visitor", () => {
  const stamp = Date.now();
  const slug = `anonkeyid-${stamp}`;
  const seeded = {
    userId: null as string | null,
    apiKeyId: null as string | null,
    categoryId: null as string | null,
    strategyId: null as string | null,
    /** Four more published rows in the category, so the percentile cohort (min 5) is real. */
    peerIds: [] as string[],
  };
  const strategyName = `AnonKeyId Probe ${stamp}`;

  beforeAll(async () => {
    if (!HAS_ANON_PROBE) return;
    const admin = createLiveAdminClient();
    seeded.userId = await createTestUser(admin, `anonkeyid-${stamp}@test.sec`);

    const { data: key, error: keyErr } = await admin
      .from("api_keys")
      .insert({
        user_id: seeded.userId,
        exchange: "binance",
        label: "anonkeyid-probe",
        api_key_encrypted: "ANONKEYID_PROBE_CIPHERTEXT",
        dek_encrypted: "ANONKEYID_PROBE_DEK",
      })
      .select("id")
      .single();
    if (keyErr || !key) throw new Error(`seed api_keys: ${keyErr?.message}`);
    seeded.apiKeyId = key.id;

    const { data: cat, error: catErr } = await admin
      .from("discovery_categories")
      .insert({ name: `AnonKeyId ${stamp}`, slug })
      .select("id")
      .single();
    if (catErr || !cat) throw new Error(`seed discovery_categories: ${catErr?.message}`);
    seeded.categoryId = cat.id;

    // A published row that DOES carry a key id: if a reader still returned the
    // wildcard, `api_key_id` would be on the wire for it.
    const { data: strat, error: stratErr } = await admin
      .from("strategies")
      .insert({
        user_id: seeded.userId,
        category_id: seeded.categoryId,
        api_key_id: seeded.apiKeyId,
        name: strategyName,
        status: "published",
      })
      .select("id")
      .single();
    if (stratErr || !strat) throw new Error(`seed strategies: ${stratErr?.message}`);
    seeded.strategyId = strat.id;

    // Four peers, so getPercentiles (which answers null under 5 rankable rows)
    // has a real cohort in this category and, with the primary, in the table.
    for (let i = 1; i <= 4; i++) {
      const { data: peer, error: peerErr } = await admin
        .from("strategies")
        .insert({
          user_id: seeded.userId,
          category_id: seeded.categoryId,
          name: `AnonKeyId Peer ${i} ${stamp}`,
          status: "published",
        })
        .select("id")
        .single();
      if (peerErr || !peer) throw new Error(`seed peer strategy ${i}: ${peerErr?.message}`);
      seeded.peerIds.push(peer.id);
    }

    // A computed analytics row per strategy: getFactsheetDetail returns null
    // without one, and getPercentiles only ranks computed rows.
    const analyticsRows = [seeded.strategyId, ...seeded.peerIds].map((strategy_id, i) => ({
      strategy_id,
      computation_status: "complete",
      cagr: 0.1 + i * 0.02,
      sharpe: 1 + i * 0.1,
      sortino: 1.2 + i * 0.1,
      calmar: 0.8 + i * 0.1,
      max_drawdown: -(0.1 + i * 0.01),
      volatility: 0.2 + i * 0.01,
      cumulative_return: 0.3 + i * 0.05,
    }));
    const { error: analyticsErr } = await admin.from("strategy_analytics").insert(analyticsRows);
    if (analyticsErr) throw new Error(`seed strategy_analytics: ${analyticsErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (!HAS_ANON_PROBE) return;
    const admin = createLiveAdminClient();
    await cleanupLiveDbRow(admin, {
      strategyIds: [...(seeded.strategyId ? [seeded.strategyId] : []), ...seeded.peerIds],
      apiKeyIds: seeded.apiKeyId ? [seeded.apiKeyId] : [],
      userIds: seeded.userId ? [seeded.userId] : [],
    });
    if (seeded.categoryId) {
      const { error } = await admin
        .from("discovery_categories")
        .delete()
        .eq("id", seeded.categoryId);
      if (error) {
        throw new Error(`cleanup discovery_categories ${seeded.categoryId}: ${error.message}`);
      }
    }
  }, 120_000);

  it.skipIf(!HAS_ANON_PROBE)(
    "(b) anon reads the published row through STRATEGY_PUBLIC_COLUMNS",
    async () => {
      const { data, error } = await anonClient()
        .from("strategies")
        .select(STRATEGY_PUBLIC_COLUMNS)
        .eq("id", seeded.strategyId!);
      expect(error, `anon projection errored: ${error?.code} ${error?.message}`).toBeNull();
      expect(data, "the published row must be visible to a signed-out visitor").toHaveLength(1);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(c) getStrategiesByCategory returns the seeded row with no own api_key_id key",
    async () => {
      const { getStrategiesByCategory } = await import("@/lib/queries");
      const rows = await getStrategiesByCategory(slug);
      const row = rows.find((r) => r.id === seeded.strategyId);
      expect(row, "the ranked list must contain the seeded published strategy").toBeTruthy();
      expect(
        Object.prototype.hasOwnProperty.call(row, "api_key_id"),
        "the ranked-list row must not carry api_key_id: anon holds no SELECT on it after PR-B",
      ).toBe(false);
    },
  );

  // ---- census A: the readers that selected a wildcard (Task 2) ----------------

  it.skipIf(!HAS_ANON_PROBE)(
    "(d) getPublicStrategyDetail returns the seeded row with no own api_key_id key",
    async () => {
      const { getPublicStrategyDetail } = await import("@/lib/queries");
      const result = await getPublicStrategyDetail(seeded.strategyId!);
      expect(result, "the public detail reader must return the published row").not.toBeNull();
      expect(result!.strategy.id).toBe(seeded.strategyId);
      expect(
        Object.prototype.hasOwnProperty.call(result!.strategy, "api_key_id"),
        "the public detail row must not carry api_key_id",
      ).toBe(false);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(e) getFactsheetDetail returns the seeded row with no own api_key_id key",
    async () => {
      const { getFactsheetDetail } = await import("@/lib/queries");
      const result = await getFactsheetDetail(seeded.strategyId!);
      expect(result, "the tearsheet reader must return the published, computed row").not.toBeNull();
      expect(result!.strategy.id).toBe(seeded.strategyId);
      expect(
        Object.prototype.hasOwnProperty.call(result!.strategy, "api_key_id"),
        "the tearsheet row must not carry api_key_id",
      ).toBe(false);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(f) the landing page's published-strategy count selects \"id\" and counts at least one row",
    async () => {
      // Replays the page's own count select from source (getSocialProofStats is
      // not exported). The wildcard form is refused here so a regression to
      // `select("*")` fails this arm even under today's grants.
      const counts = strategiesSelectLiterals("../app/(marketing)/page.tsx").filter((l) => l.isCount);
      expect(counts, "exactly one strategies head-count select in the landing page").toHaveLength(1);
      const { literal } = counts[0];
      expect(literal, "the landing count must not be a wildcard").not.toBe("*");
      expect(literal).not.toContain("api_key_id");
      const { count, error } = await withPublishedOnly(
        anonClient().from("strategies").select(literal, { count: "exact", head: true }),
      );
      expect(error, `landing count errored: ${error?.code} ${error?.message}`).toBeNull();
      expect(count ?? 0).toBeGreaterThanOrEqual(1);
    },
  );

  // ---- census B: explicit-column readers; no code change, the arm is the proof --

  it.skipIf(!HAS_ANON_PROBE)("(g) getStrategyDetailV2 returns the seeded strategy", async () => {
    const { getStrategyDetailV2 } = await import("@/lib/queries");
    const result = await getStrategyDetailV2(seeded.strategyId!);
    expect(result, "the v2 detail reader must return the published row").not.toBeNull();
    expect(result!.strategy.id).toBe(seeded.strategyId);
  });

  it.skipIf(!HAS_ANON_PROBE)("(h) getPercentiles answers with and without a category slug", async () => {
    const { getPercentiles } = await import("@/lib/queries");
    const inCategory = await getPercentiles(slug);
    expect(inCategory, "five rankable rows in the seeded category must score").not.toBeNull();
    expect(Object.keys(inCategory!)).toContain(seeded.strategyId);
    const everywhere = await getPercentiles();
    expect(everywhere, "five rankable published rows exist table-wide").not.toBeNull();
  });

  it.skipIf(!HAS_ANON_PROBE)("(i) getPopulatedCategorySlugs includes the seeded slug", async () => {
    const { getPopulatedCategorySlugs } = await import("@/lib/queries");
    expect(await getPopulatedCategorySlugs()).toContain(slug);
  });

  it.skipIf(!HAS_ANON_PROBE)(
    "(j) the OG route's GET renders the seeded strategy without taking its failure path",
    async () => {
      const { GET } = await import("@/app/api/og/factsheet/[id]/route");
      ogCalls.length = 0;
      afterSpy.mockClear();
      const res = await GET(new Request("http://localhost/api/og/factsheet/x"), {
        params: Promise.resolve({ id: seeded.strategyId! }),
      });
      expect(res.status).toBe(200);
      // SFH-02: a card rendered from a failed read or compute is sent no-store.
      expect(res.headers.get("Cache-Control")).not.toBe("no-store");
      expect(afterSpy, "the route reported a read or compute failure").not.toHaveBeenCalled();
      // A genuine not-found also answers 200 with the long cache and the generic
      // card, so the element must name the seeded strategy to prove the row was read.
      expect(ogCalls).toHaveLength(1);
      expect(JSON.stringify(ogCalls[0].element)).toContain(strategyName);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(k) the factsheet v2 generateMetadata names the seeded strategy",
    async () => {
      const { generateMetadata } = await import("@/app/factsheet/[id]/v2/page");
      const meta = await generateMetadata({ params: Promise.resolve({ id: seeded.strategyId! }) });
      expect(String(meta.title)).toContain(strategyName);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(l) the factsheet v2 Lane A select, replayed from source as anon, returns the seeded row",
    async () => {
      // Lane A is inline in the page component and not exported. Two selects in
      // the file carry `trades_fetched_at, series_provenance`: Lane A and Lane B,
      // and Lane B names api_key_id (it runs after auth.getUser returned a user).
      // Lane A is the one that does not.
      const lanes = strategiesSelectLiterals("../app/factsheet/[id]/v2/page.tsx").filter(
        (l) => l.literal.includes("trades_fetched_at, series_provenance") && !l.literal.includes("api_key_id"),
      );
      expect(lanes, "exactly one api_key_id-free select with the Lane A fragment").toHaveLength(1);
      const { data, error } = await anonClient()
        .from("strategies")
        .select(lanes[0].literal)
        .eq("status", "published")
        .eq("id", seeded.strategyId!)
        .maybeSingle();
      expect(error, `Lane A errored: ${error?.code} ${error?.message}`).toBeNull();
      expect((data as { id?: string } | null)?.id).toBe(seeded.strategyId);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(m) the tearsheet's readReturnsUnit select, replayed from source as anon, returns the seeded row",
    async () => {
      const reads = strategiesSelectLiterals("../app/factsheet/[id]/tearsheet/page.tsx").filter(
        (l) => l.literal.includes("strategy_analytics ( data_quality_flags )") && !l.literal.includes("api_keys"),
      );
      expect(reads, "exactly one embed-only returns-unit select in the tearsheet").toHaveLength(1);
      const { data, error } = await anonClient()
        .from("strategies")
        .select(reads[0].literal)
        .eq("status", "published")
        .eq("id", seeded.strategyId!)
        .maybeSingle();
      expect(error, `readReturnsUnit errored: ${error?.code} ${error?.message}`).toBeNull();
      expect(
        (data as { strategy_analytics?: unknown } | null)?.strategy_analytics,
        "the analytics embed must come back for the seeded row",
      ).toBeTruthy();
    },
  );

  // ---- PR-B (plan 05): the refusal arm. The migration revokes table-level SELECT
  // from anon and grants column SELECT on every column but api_key_id. ----------

  it.skipIf(!HAS_ANON_PROBE)(
    "(a) anon selecting api_key_id is refused by the GRANT layer (42501, permission denied for table strategies)",
    async () => {
      const { data, error } = await anonClient()
        .from("strategies")
        .select("api_key_id")
        .eq("id", seeded.strategyId!);
      expect(error, "anon must be refused api_key_id outright; data was returned").not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toMatch(/permission denied for table strategies/);
      expect(data).toBeNull();
    },
  );

  // ---- D-04 / SC-2: anon holds no write privilege on strategies. -------------
  // RLS also refuses an anon write (a policy mismatch is SQLSTATE 42501 too), so
  // each arm must tell the GRANT refusal from the RLS refusal by message, and must
  // fail on a no-error result: an UPDATE or DELETE that RLS filters to zero rows
  // answers success with no error at all. The arms were seen RED under a temporary
  // `GRANT INSERT, UPDATE, DELETE ... TO anon` (RLS left as the only refusal) before
  // being seen green, so a pass here means the grant layer refused, not RLS.

  /** The refusal the GRANT layer gives, as opposed to the one RLS gives. */
  function expectGrantRefusal(error: { code?: string; message?: string } | null) {
    expect(error, "anon write must be refused; the call returned no error").not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message, "refused by RLS rather than by the grant").not.toMatch(/row-level security/i);
    expect(error!.message).toMatch(/permission denied for table strategies/);
  }

  it.skipIf(!HAS_ANON_PROBE)(
    "(n) anon INSERT on strategies is refused by the GRANT layer, not by RLS",
    async () => {
      const { error } = await anonClient()
        .from("strategies")
        .insert({ user_id: seeded.userId!, name: `AnonKeyId Write ${stamp}`, status: "draft" });
      expectGrantRefusal(error);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(o) anon UPDATE on strategies is refused by the GRANT layer, not filtered to zero rows by RLS",
    async () => {
      const { error } = await anonClient()
        .from("strategies")
        .update({ name: `AnonKeyId Tampered ${stamp}` })
        .eq("id", seeded.strategyId!);
      expectGrantRefusal(error);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(p) anon DELETE on strategies is refused by the GRANT layer, not filtered to zero rows by RLS",
    async () => {
      const { error } = await anonClient().from("strategies").delete().eq("id", seeded.strategyId!);
      expectGrantRefusal(error);
    },
  );

  it.skipIf(!HAS_ANON_PROBE)(
    "(q) after the write arms the seeded strategy is unchanged and no anon row was inserted",
    async () => {
      const admin = createLiveAdminClient();
      const { data, error } = await admin
        .from("strategies")
        .select("id, name, status")
        .eq("id", seeded.strategyId!)
        .single();
      expect(error, `admin re-read errored: ${error?.message}`).toBeNull();
      expect(data).toEqual({ id: seeded.strategyId, name: strategyName, status: "published" });
      const { count, error: countErr } = await admin
        .from("strategies")
        .select("id", { count: "exact", head: true })
        .eq("name", `AnonKeyId Write ${stamp}`);
      expect(countErr).toBeNull();
      expect(count, "the anon INSERT arm must not have created a row").toBe(0);
    },
  );

  it("advertises the live-DB skip reason", () => {
    advertiseLiveDbSkipReason("anon-strategies-live-probe");
    if (!HAS_LIVE_DB) return;
    expect(
      HAS_ANON_PROBE,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is absent: every arm above skipped, which proves nothing",
    ).toBe(true);
  });
});
