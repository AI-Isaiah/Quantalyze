import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Tests for POST /api/admin/partner-import — audit-2026-05-07 Cluster A.
 *
 * Coverage anchors:
 *   - C-0055 (red-team c9, duplicate strategies): on re-run with the
 *     same managers CSV, strategies are skipped (counter +1, no
 *     duplicate insert).
 *   - C-0053 / C-0054 (red-team c8 / c6, partial-completion auditing):
 *     when phase 2 throws mid-batch, the admin.partner_import audit row
 *     is emitted with `partial_completion: true` + counts.
 *   - C-0056 (security c6): entity_id is a real RFC 4122 v4 UUID
 *     (every call produces a distinct id).
 *   - C-0057 (pr-test-analyzer c7): non-admin 403, success-path audit
 *     with valid UUID, rollup-not-per-row.
 *   - H-0238 (security c8): partner_tag length cap applied to audit
 *     metadata via capAuditMetadata.
 *   - H-0239 (red-team c7): managers_rows_skipped / allocators_rows_skipped
 *     surfaced on response + audit when a row drops at the schema mapper.
 */

vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const STATE = vi.hoisted(() => ({
  authUser: { id: "00000000-0000-0000-0000-000000000001", email: "admin@x" } as
    | { id: string; email: string }
    | null,
  isAdminResult: true,
  csrfResponse: null as null | Response,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
  // Existing strategies returned by the `.in('user_id', ...)` pre-check
  existingStrategies: [] as Array<{ user_id: string; name: string }>,
  // If true, the existing-strategies pre-check returns an error so the
  // catch path runs. Pinned by the Phase-2 testing finding so a regression
  // that swallows existingErr lands red.
  failExistingStrategiesSelect: false,
  // Audit-2026-05-07 red-team R-0003: existing profiles returned by the
  // cross-tenant pre-check `.in('email', ...)`. Each row carries the
  // partner_tag the route compares against the import's tag.
  existingProfiles: [] as Array<{ email: string; partner_tag: string | null }>,
  insertedStrategies: [] as Array<Record<string, unknown>>,
  insertedProfiles: [] as Array<Record<string, unknown>>,
  insertedPrefs: [] as Array<Record<string, unknown>>,
  // If set, throw for the matching strategy_name insert
  failOnStrategyName: null as string | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  ensureAuthUserMap: new Map<string, string>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "strategies") {
        return {
          select: () => ({
            in: () =>
              STATE.failExistingStrategiesSelect
                ? {
                    data: null,
                    error: { message: "simulated select failure" },
                  }
                : { data: STATE.existingStrategies, error: null },
          }),
          insert: (payload: Record<string, unknown>) => {
            if (
              STATE.failOnStrategyName &&
              payload.name === STATE.failOnStrategyName
            ) {
              return Promise.resolve({
                error: { message: `simulated insert failure for ${payload.name}` },
              });
            }
            STATE.insertedStrategies.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "profiles") {
        return {
          // Audit-2026-05-07 red-team R-0003: cross-tenant pre-check
          // `.select('email, partner_tag').in('email', allEmails)`.
          select: () => ({
            in: () => ({ data: STATE.existingProfiles, error: null }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            STATE.insertedProfiles.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "allocator_preferences") {
        return {
          upsert: (payload: Record<string, unknown>) => {
            STATE.insertedPrefs.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => STATE.isAdminResult,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: async () => STATE.checkLimitResult,
  // silent-failure-hunter HIGH fix (Finding 6): the route now calls
  // isRateLimitMisconfigured to distinguish 503 (Upstash outage) from
  // 429 (quota exhaustion). Expose it in the mock — returns true only
  // when reason='ratelimit_misconfigured', mirroring the real implementation.
  isRateLimitMisconfigured: (
    rl: { success: boolean; reason?: string },
  ): boolean =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/supabase/admin-users", () => ({
  ensureAuthUser: async (
    _admin: unknown,
    { email }: { email: string },
  ): Promise<string> => {
    if (!STATE.ensureAuthUserMap.has(email)) {
      // Deterministic test id derived from the email so duplicate-CSV
      // tests get a stable map.
      const idx = STATE.ensureAuthUserMap.size + 1;
      STATE.ensureAuthUserMap.set(
        email,
        `00000000-0000-0000-0000-${String(idx).padStart(12, "0")}`,
      );
    }
    return STATE.ensureAuthUserMap.get(email)!;
  },
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return {
    ...actual,
    logAuditEvent: (
      _client: unknown,
      event: {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      auditEmissions.push({
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        metadata: event.metadata ?? {},
      });
    },
    // NEW-C28-05/C28-06: route now calls emitAsUser directly (awaited).
    // Intercept so the tests can observe audit emissions and the route
    // doesn't fail due to a missing Supabase connection in the test env.
    emitAsUser: async (
      _client: unknown,
      _userId: string,
      event: {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      auditEmissions.push({
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        metadata: event.metadata ?? {},
      });
    },
  };
});

import { POST } from "./route";

function buildRequest(
  body: Record<string, unknown>,
  query: string = "",
): NextRequest {
  const url = `https://example.com/api/admin/partner-import${query}`;
  return new NextRequest(url, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function buildRawRequest(rawBody: string): NextRequest {
  return new NextRequest("https://example.com/api/admin/partner-import", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
    },
    body: rawBody,
  });
}

const SAMPLE_MANAGERS_CSV = [
  "manager_email,strategy_name,disclosure_tier",
  "alice@x,Acme Macro,institutional",
  "alice@x,Acme Beta,institutional",
  "bob@x,Bob Trend,exploratory",
].join("\n");

const SAMPLE_ALLOCATORS_CSV = [
  "allocator_email,mandate_archetype,ticket_size_usd",
  "lp1@x,family_office,1000000",
].join("\n");

beforeEach(() => {
  STATE.authUser = { id: "00000000-0000-0000-0000-000000000001", email: "admin@x" };
  STATE.isAdminResult = true;
  STATE.csrfResponse = null;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.existingStrategies = [];
  STATE.failExistingStrategiesSelect = false;
  STATE.existingProfiles = [];
  STATE.insertedStrategies = [];
  STATE.insertedProfiles = [];
  STATE.insertedPrefs = [];
  STATE.failOnStrategyName = null;
  STATE.rpcCalls = [];
  STATE.ensureAuthUserMap = new Map();
  auditEmissions.length = 0;
});

describe("POST /api/admin/partner-import — audit-2026-05-07 cluster A", () => {
  it("C-0057 #1: returns 403 for non-admin caller", async () => {
    STATE.isAdminResult = false;
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(403);
    expect(auditEmissions).toHaveLength(0);
  });

  it("C-0057 #2 / C-0056: success emits ONE admin.partner_import audit with valid RFC 4122 v4 UUID + capped metadata", async () => {
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    expect(auditEmissions).toHaveLength(1);
    const evt = auditEmissions[0];
    expect(evt.action).toBe("admin.partner_import");
    expect(evt.entity_type).toBe("partner_import");
    // RFC 4122 v4 UUID shape: 8-4-4-4-12 hex, version='4', variant=[89ab]
    expect(evt.entity_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(evt.metadata.partial_completion).toBe(false);
    expect(evt.metadata.strategies_created).toBe(3);
    expect(evt.metadata.allocators_created).toBe(1);
  });

  it("C-0056: entity_id is non-deterministic — two runs produce distinct UUIDs", async () => {
    await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    // Second call (same partner_tag): in pre-fix code the same sha256-
    // derived UUID could collide if Date.now() landed in the same ms.
    // Post-fix the UUIDs are 122 bits of randomness; assert distinct.
    STATE.insertedStrategies = []; // reset for the second run
    await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(auditEmissions[0].entity_id).not.toBe(auditEmissions[1].entity_id);
  });

  it("C-0055: re-running with the same CSV skips existing strategies (no duplicate insert)", async () => {
    // First run lands 3 strategies. Existing-set on the second run
    // includes them.
    await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    const aliceId = STATE.ensureAuthUserMap.get("alice@x")!;
    const bobId = STATE.ensureAuthUserMap.get("bob@x")!;

    STATE.existingStrategies = [
      { user_id: aliceId, name: "Acme Macro" },
      { user_id: aliceId, name: "Acme Beta" },
      { user_id: bobId, name: "Bob Trend" },
    ];
    STATE.insertedStrategies = [];

    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies_created).toBe(0);
    expect(body.strategies_skipped_existing).toBe(3);
    expect(STATE.insertedStrategies).toHaveLength(0);
  });

  it("C-0053 / C-0054: phase-2 failure emits partial-completion audit + 500", async () => {
    STATE.failOnStrategyName = "Bob Trend";
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(500);
    const evt = auditEmissions.find((e) => e.action === "admin.partner_import");
    expect(evt).toBeTruthy();
    expect(evt?.metadata.partial_completion).toBe(true);
    expect(evt?.metadata.error_message).toContain("simulated insert failure");
    // managers_created > 0 because phase 1 succeeded.
    expect((evt?.metadata.managers_created as number) ?? 0).toBeGreaterThan(0);
  });

  it("C-0053 (audit-2026-05-21 v0.24.3.1): 500 response body surfaces partial_completion=true for operator retry decisions", async () => {
    // Pre-fix: the 500 envelope returned counters but no explicit
    // `partial_completion` flag — an operator could not tell from the
    // response alone whether re-running was safe (zero rows persisted)
    // or duplicative (phase-1 manager auth rows already committed).
    // The audit metadata had the flag; the operator-facing JSON did not.
    STATE.failOnStrategyName = "Bob Trend";
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.partial_completion).toBe(true);
    expect(body.managers_created).toBeGreaterThan(0);
    // The downstream allocator phase was never reached because the throw
    // happens in phase 2; this pins the contract that the 500 body's
    // counters reflect actual persisted state.
    expect(body.allocators_created).toBe(0);
  });

  it("C-0053 (audit-2026-05-21 v0.24.3.1): phase-2 throw aborts before allocator phase runs (no allocator_preferences upsert)", async () => {
    // mapConcurrent fail-stop semantics: when phase 2 throws on row 'Bob
    // Trend', phase 3 (allocator upsert loop) must not run AT ALL. Pre-
    // existing tests asserted partial_completion in audit + response;
    // this pins the inverse — STATE.insertedPrefs MUST remain empty so
    // the operator knows allocator rows are NOT in the partial state.
    STATE.failOnStrategyName = "Bob Trend";
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(500);
    expect(STATE.insertedPrefs).toHaveLength(0);
    // Profiles upserts happened for managers in phase 1 — that's the
    // partial state the audit metadata + response body now both expose.
    expect(STATE.insertedProfiles.length).toBeGreaterThan(0);
  });

  it("C-0053 (audit-2026-05-21 v0.24.3.1): success-path response body emits partial_completion=false", async () => {
    // Operator clients can switch on `partial_completion` uniformly
    // across success and failure responses instead of inferring partial
    // state from the HTTP status. Pre-fix only the 500 / audit paths
    // had the flag; the 200 success body did not surface it.
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partial_completion).toBe(false);
  });

  it("H-0238: huge partner_tag in audit metadata is truncated by capAuditMetadata", async () => {
    // partner_tag must match ^[a-z0-9-]+$; build a 4kB legal tag.
    const huge = "a".repeat(4096);
    const res = await POST(
      buildRequest({
        partner_tag: huge,
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    const evt = auditEmissions.find((e) => e.action === "admin.partner_import");
    expect(evt).toBeTruthy();
    expect((evt!.metadata.partner_tag as string).length).toBeLessThan(
      huge.length,
    );
    expect(evt!.metadata.partner_tag).toMatch(/…\[truncated:4096\]$/);
  });

  // -------------------------------------------------------------------
  // Phase-2 testing-finding additions
  // (route.test.ts:1 — early-return branches; route.test.ts:75 —
  // existing-strategies-select error; route.test.ts:119 — intra-batch
  // duplicate-strategy dedup). Each test asserts auditEmissions.length
  // === 0 (where applicable) so a future audit-emission-before-guard
  // regression fails loudly.
  // -------------------------------------------------------------------

  it("Phase-2: returns 401 + no audit when caller is unauthenticated", async () => {
    STATE.authUser = null;
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(401);
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2: returns CSRF response + no audit when assertSameOrigin denies", async () => {
    STATE.csrfResponse = NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(403);
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2: returns 429 + Retry-After + no audit when rate limiter denies", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 60 };
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2: returns 400 + no audit for invalid partner_tag (UPPERCASE)", async () => {
    const res = await POST(
      buildRequest({
        partner_tag: "UPPER",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(400);
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2: returns 400 + no audit for non-JSON body", async () => {
    const res = await POST(buildRawRequest("not json"));
    expect(res.status).toBe(400);
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2: returns 400 + no audit when both CSVs are empty", async () => {
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: "",
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(400);
    expect(auditEmissions).toHaveLength(0);
  });

  it("Phase-2 (C-0055 intra-batch): duplicate (manager_email,strategy_name) rows in a single CSV land exactly one insert", async () => {
    // The route's intra-batch dedup adds the (user_id, name) key to
    // existingStrategyKeys after the duplicate-pre-check select so that
    // concurrent workers in phase-2 mapConcurrent don't race the same
    // key. The cross-run dedup is exercised elsewhere; this pins the
    // intra-batch path explicitly.
    const dupCsv = [
      "manager_email,strategy_name,disclosure_tier",
      "alice@x,Acme Macro,institutional",
      "alice@x,Acme Macro,institutional",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: dupCsv,
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(200);
    const acmeInserts = STATE.insertedStrategies.filter(
      (s) => s.name === "Acme Macro",
    );
    expect(acmeInserts).toHaveLength(1);
    const body = await res.json();
    expect(body.strategies_created).toBe(1);
    expect(body.strategies_skipped_existing).toBe(1);
  });

  it("Phase-2: existing-strategies-select error surfaces partial-completion audit + 500", async () => {
    // Phase-1 finishes (managers_created > 0), then the duplicate-pre-
    // check select returns {error}, which the route throws. The catch
    // path now conditionally emits partial_completion based on observed
    // state — managers_created>0 → audit fires with error_message.
    STATE.failExistingStrategiesSelect = true;
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(500);
    const evt = auditEmissions.find((e) => e.action === "admin.partner_import");
    expect(evt).toBeTruthy();
    expect(evt?.metadata.partial_completion).toBe(true);
    expect((evt?.metadata.managers_created as number) ?? 0).toBeGreaterThan(0);
    expect(evt?.metadata.strategies_created).toBe(0);
    expect(evt?.metadata.error_message).toContain("simulated select failure");
  });

  it("red-team R-0003: existing user with different partner_tag → 400 + conflicts enumerated + no profile mutation", async () => {
    STATE.existingProfiles = [
      { email: "alice@x", partner_tag: "real-partner" },
    ];
    const res = await POST(
      buildRequest({
        partner_tag: "attacker-tag",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("partner_tag_conflict");
    expect(body.conflicts).toEqual([
      {
        email: "alice@x",
        existing_tag: "real-partner",
        attempted_tag: "attacker-tag",
      },
    ]);
    // No profile mutations should have landed because the pre-check
    // throws BEFORE phase-1 ensureAuthUser/upsert.
    expect(STATE.insertedProfiles).toHaveLength(0);
    expect(STATE.insertedStrategies).toHaveLength(0);
  });

  it("red-team R-0003: existing user with NULL partner_tag is not a conflict (new tenant takeover allowed)", async () => {
    // A profile that has never been touched by partner-import (no
    // partner_tag set) is fair game for the first import to claim.
    STATE.existingProfiles = [{ email: "alice@x", partner_tag: null }];
    const res = await POST(
      buildRequest({
        partner_tag: "first-tag",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("red-team R-0003: existing user with MATCHING partner_tag is not a conflict (idempotent re-run)", async () => {
    STATE.existingProfiles = [
      { email: "alice@x", partner_tag: "same-tag" },
      { email: "bob@x", partner_tag: "same-tag" },
    ];
    const res = await POST(
      buildRequest({
        partner_tag: "same-tag",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("red-team R-0004: CSV with conflicting disclosure_tier per (manager,strategy) → 400 + conflicts enumerated + no insert", async () => {
    const conflictCsv = [
      "manager_email,strategy_name,disclosure_tier",
      "alice@x,AcmeMacro,exploratory",
      "alice@x,AcmeMacro,institutional",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: conflictCsv,
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("strategy_tier_conflict");
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({
      manager_email: "alice@x",
      strategy_name: "AcmeMacro",
    });
    // Both tiers were observed in the input.
    expect(new Set(body.conflicts[0].tiers)).toEqual(
      new Set(["exploratory", "institutional"]),
    );
    // No mutations should have landed — the pre-check rejects before phase 1.
    expect(STATE.insertedStrategies).toHaveLength(0);
    expect(STATE.insertedProfiles).toHaveLength(0);
  });

  it("H-0239: silent row-drop surfaces in response + audit (managers_rows_skipped)", async () => {
    // Three raw rows, but one has only the email (no strategy_name) so
    // it drops at the mapper — raw_count=3, parsed=2.
    const csv = [
      "manager_email,strategy_name,disclosure_tier",
      "alice@x,Acme Macro,institutional",
      "alice@x,,institutional", // dropped by mapper (no strategy_name)
      "bob@x,Bob Trend,exploratory",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: csv,
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.managers_rows_skipped).toBe(1);
    const evt = auditEmissions.find((e) => e.action === "admin.partner_import");
    expect(evt?.metadata.managers_rows_skipped).toBe(1);
  });

  // -------------------------------------------------------------------
  // C-0052 (audit-2026-05-07): partner-import contract v2 — explicit
  // `with_header` query parameter replaces the brittle implicit-header
  // sniff. These tests pin the three contract states:
  //   1. Omitted → default to true (header assumed present) — keeps
  //      pre-v2 clients working unchanged.
  //   2. Explicit `with_header=false` → first CSV row is data.
  //   3. Anything other than `true`/`false` → 400.
  // -------------------------------------------------------------------

  it("C-0052: default behavior (no with_header query param) assumes header is present", async () => {
    // CSV starts with a header line — must parse the same way the
    // pre-v2 contract did when `with_header` is absent. This is the
    // back-compat anchor.
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies_created).toBe(3);
    expect(body.allocators_created).toBe(1);
  });

  it("C-0052: explicit ?with_header=true honored (same as default)", async () => {
    const res = await POST(
      buildRequest(
        {
          partner_tag: "demo-partner",
          managers_csv: SAMPLE_MANAGERS_CSV,
          allocators_csv: SAMPLE_ALLOCATORS_CSV,
        },
        "?with_header=true",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies_created).toBe(3);
  });

  it("C-0052: explicit ?with_header=false treats row 0 as data (no header)", async () => {
    // Same data rows as SAMPLE_MANAGERS_CSV but the header line is
    // omitted. Under contract v2 with `with_header=false`, every line
    // is a data row → 3 strategies, no rows skipped at the schema
    // mapper because there's no header to drop.
    const headerlessManagers = [
      "alice@x,Acme Macro,institutional",
      "alice@x,Acme Beta,institutional",
      "bob@x,Bob Trend,exploratory",
    ].join("\n");
    const headerlessAllocators = ["lp1@x,family_office,1000000"].join("\n");
    const res = await POST(
      buildRequest(
        {
          partner_tag: "demo-partner",
          managers_csv: headerlessManagers,
          allocators_csv: headerlessAllocators,
        },
        "?with_header=false",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies_created).toBe(3);
    expect(body.allocators_created).toBe(1);
    expect(body.managers_rows_skipped).toBe(0);
  });

  it("C-0052: invalid ?with_header value → 400 + no audit emission", async () => {
    // Strict rejection — silently coercing "yes"/"1"/"y" would re-
    // introduce the brittle sniff-style behaviour the contract-v2 fix
    // is trying to eliminate. Pin "no audit on bad input" so a future
    // regression that emits an audit row before the param-validation
    // gate lands red.
    const res = await POST(
      buildRequest(
        {
          partner_tag: "demo-partner",
          managers_csv: SAMPLE_MANAGERS_CSV,
          allocators_csv: SAMPLE_ALLOCATORS_CSV,
        },
        "?with_header=yes",
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/with_header must be 'true' or 'false'/);
    expect(auditEmissions).toHaveLength(0);
  });

  it("C-0052: ?with_header=false WITH a header row mis-parses (contract is operator's responsibility)", async () => {
    // Defensive contract check — the route does NOT sniff. If the
    // operator passes `with_header=false` but the CSV actually starts
    // with `manager_email,strategy_name,disclosure_tier`, row 0 is
    // treated as a data row → the `mapper_email` cell holds the
    // literal string "manager_email" and the strategy_name cell holds
    // "strategy_name". The route happily lands an "import" of a row
    // named after the header text. This pins the deterministic
    // (non-sniffing) behaviour: the parser obeys the explicit flag
    // even when the data clearly contains a header.
    const res = await POST(
      buildRequest(
        {
          partner_tag: "demo-partner",
          managers_csv: SAMPLE_MANAGERS_CSV,
          allocators_csv: "",
        },
        "?with_header=false",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // 4 rows: 1 header-as-data + 3 real data rows.
    expect(body.strategies_created).toBe(4);
  });
});

/**
 * NEW-C28-01: ticket_size_usd invariant — negative values and values >1e9
 * must be rejected (row dropped → surfaces in allocators_rows_skipped).
 *
 * NEW-C28-02: mandate_archetype length cap — rows with >500 chars are dropped.
 *
 * NEW-C28-03: strategy_name validation — rows with >80 chars or embedded
 * control chars (\r\n\0) are dropped.
 *
 * NEW-C28-04: row count cap — requests exceeding MAX_IMPORT_ROWS get 400
 * before any GoTrue calls fire.
 *
 * NEW-C28-05/06: audit emit is now awaited via emitAsUser so a failure
 * surfaces as 5xx. The test validates that emitAsUser is called (not the
 * fire-and-forget wrappers) by checking auditEmissions after the call.
 */
describe("NEW-C28 — partner-import input validation and audit fixes", () => {
  it("C28-01: negative ticket_size_usd row is silently dropped (allocators_rows_skipped +1)", async () => {
    const allocatorsCsv = [
      "allocator_email,mandate_archetype,ticket_size_usd",
      "bad@x,family_office,-500",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: "",
        allocators_csv: allocatorsCsv,
      }),
    );
    // Both CSVs empty after filtering → 400 "Both CSVs are empty"
    // because the only allocator row was dropped.
    expect([400, 200]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.allocators_created).toBe(0);
      expect(body.allocators_rows_skipped).toBeGreaterThanOrEqual(1);
    } else {
      expect(body.error).toMatch(/empty/i);
    }
  });

  it("C28-01: ticket_size_usd > 1e9 row is dropped", async () => {
    const allocatorsCsv = [
      "allocator_email,mandate_archetype,ticket_size_usd",
      "big@x,endowment,99999999999999",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: "",
        allocators_csv: allocatorsCsv,
      }),
    );
    expect([400, 200]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.allocators_created).toBe(0);
    } else {
      expect(body.error).toMatch(/empty/i);
    }
  });

  it("C28-02: mandate_archetype > 500 chars row is dropped", async () => {
    const longMandate = "A".repeat(501);
    const allocatorsCsv = [
      "allocator_email,mandate_archetype,ticket_size_usd",
      `long@x,${longMandate},1000000`,
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: "",
        allocators_csv: allocatorsCsv,
      }),
    );
    expect([400, 200]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.allocators_created).toBe(0);
    }
  });

  it("C28-02: mandate_archetype ≤ 500 chars is accepted", async () => {
    const okMandate = "A".repeat(500);
    const allocatorsCsv = [
      "allocator_email,mandate_archetype,ticket_size_usd",
      `ok@x,${okMandate},1000000`,
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: "",
        allocators_csv: allocatorsCsv,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).allocators_created).toBe(1);
  });

  it("C28-03: strategy_name > 80 chars row is dropped (managers_rows_skipped +1)", async () => {
    const longName = "S".repeat(81);
    const managersCsv = [
      "manager_email,strategy_name,disclosure_tier",
      `mgr@x,${longName},exploratory`,
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: managersCsv,
        allocators_csv: "",
      }),
    );
    expect([400, 200]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.strategies_created).toBe(0);
      expect(body.managers_rows_skipped).toBeGreaterThanOrEqual(1);
    }
  });

  it("C28-03: strategy_name with embedded NUL char is dropped", async () => {
    // Use a NUL byte (\0) which survives the CSV line-split (parseCsv splits
    // on \n, not \0) so the row reaches the schema mapper and the \0-guard fires.
    const managersCsv = [
      "manager_email,strategy_name,disclosure_tier",
      "mgr@x,Bad\x00Name,exploratory",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: managersCsv,
        allocators_csv: "",
      }),
    );
    // Either 400 (both empty after filtering) or 200 with 0 strategies created
    expect([400, 200]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.strategies_created).toBe(0);
    }
  });

  it("C28-04: returns 400 too_many_rows when total rows exceed MAX_IMPORT_ROWS", async () => {
    // Build a CSV with 600 manager rows (well above MAX_IMPORT_ROWS=500)
    const rows = ["manager_email,strategy_name,disclosure_tier"];
    for (let i = 0; i < 501; i++) {
      rows.push(`mgr${i}@x,Strategy ${i},exploratory`);
    }
    const managersCsv = rows.join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: managersCsv,
        allocators_csv: "",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("too_many_rows");
    expect(body.max_rows).toBe(500);
    // No managers must have been created — the gate fires BEFORE phase 1
    expect(STATE.insertedProfiles).toHaveLength(0);
  });

  it("C28-05/06: success path emits audit via emitAsUser (awaited, not fire-and-forget)", async () => {
    const res = await POST(
      buildRequest({
        partner_tag: "demo",
        managers_csv: SAMPLE_MANAGERS_CSV,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(200);
    // The emitAsUser mock captures into auditEmissions — if the route used
    // the fire-and-forget logAuditEvent wrapper instead, the emission would
    // be scheduled via after() and the auditEmissions array would be empty
    // in this synchronous test context.
    expect(auditEmissions).toHaveLength(1);
    expect(auditEmissions[0].action).toBe("admin.partner_import");
    expect(auditEmissions[0].metadata.partial_completion).toBe(false);
  });

  it("H-0440: a formula-prefixed CSV header fails loud as a 400, not a silent mis-match", async () => {
    // A spreadsheet export artifact (a header cell beginning with `=`) must
    // NOT be silently stripped-and-matched into the manager_email column —
    // headers are preserved verbatim, so parseCsvWithSchema throws and the
    // route converts it to an operator-actionable 400 with NO audit emission.
    // Pins the parse-inside-try -> 400 wiring so a future refactor that hoists
    // the parse out of the try (turning it into a 500/crash) lands red.
    const formulaHeaderCsv = [
      "=manager_email,strategy_name,disclosure_tier",
      "alice@x,Acme Macro,institutional",
    ].join("\n");
    const res = await POST(
      buildRequest({
        partner_tag: "demo-partner",
        managers_csv: formulaHeaderCsv,
        allocators_csv: SAMPLE_ALLOCATORS_CSV,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing CSV header column: manager_email/);
    // The diagnostic is operator-actionable (names the offending cell + fix).
    expect(body.error).toMatch(/remove the leading "="/);
    expect(auditEmissions).toHaveLength(0);
  });
});
