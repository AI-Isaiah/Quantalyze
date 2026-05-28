/**
 * Sprint 6 closeout Task 7.3 code-review fix I2 — POST
 * /api/account/export must remove the uploaded storage object if
 * createSignedUrl fails. Otherwise the object is orphaned forever
 * (1-per-day rate limit means the user can't retry with upsert:true to
 * overwrite).
 *
 * Scope
 * -----
 * This file tests the route's error-handling path with a mocked
 * Supabase storage stack. The happy-path behavior (upload + sign +
 * audit + envelope response) is already exercised by the integration
 * test in gdpr-export.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  checkLimitMock,
  resetUsedTokensMock,
  uploadMock,
  createSignedUrlMock,
  removeMock,
  collectBundleMock,
  logAuditRpcMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  checkLimitMock: vi.fn(),
  resetUsedTokensMock: vi.fn(),
  uploadMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
  removeMock: vi.fn(),
  collectBundleMock: vi.fn(),
  logAuditRpcMock: vi.fn(),
}));

function makeUserClient() {
  return {
    auth: { getUser: getUserMock },
    rpc: logAuditRpcMock,
    // Audit-2026-05-07 C-0022 / C-0023 sanitize-loop gate: the route
    // reads profiles.display_name BEFORE the rate-limit consume. The
    // existing pre-cluster-A tests pre-date this gate; we return a
    // benign Alice display_name so the gate passes through and the
    // tests below continue to assert on their original concerns. A
    // dedicated test for the sanitize-state gate lives in
    // src/app/api/account/export/route.test.ts.
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { display_name: "Alice" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function makeAdminClient() {
  return {
    storage: {
      from: () => ({
        upload: (key: string, body: unknown, opts: unknown) =>
          uploadMock(key, body, opts),
        createSignedUrl: (key: string, ttl: number) =>
          createSignedUrlMock(key, ttl),
        remove: (paths: string[]) => removeMock(paths),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeUserClient()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

vi.mock("@/lib/ratelimit", () => ({
  // Audit 2026-05-07 red-team #2 (HIGH conf-8): the route refunds the
  // 1/day token on every refusal path via
  // `exportLimiter.resetUsedTokens(key)`. The mock exposes that method
  // so the refund spec is testable.
  exportLimiter: {
    resetUsedTokens: (key: string) => resetUsedTokensMock(key),
  },
  checkLimit: (limiter: unknown, key: string) => checkLimitMock(limiter, key),
  // Audit-2026-05-07 simplify pass: the route now uses the shared
  // `getClientIp` helper from the ratelimit module for the H-0200
  // fingerprint. Stub returns "unknown" to match the no-header default.
  getClientIp: (_headers: Headers): string => "unknown",
}));

vi.mock("@/lib/gdpr-export", () => ({
  collectUserExportBundle: (admin: unknown, userId: string) =>
    collectBundleMock(admin, userId),
  // The route now uses encodeExportBundle (specialist apply, performance
  // HIGH conf-9: single-pass row encode). For the route tests we don't
  // care about the byte-precise output — return a minimal Uint8Array so
  // the upload mock observes a Uint8Array as expected.
  encodeExportBundle: (bundle: unknown) =>
    new TextEncoder().encode(JSON.stringify(bundle)),
  // Audit 2026-05-07 red-team #7: the route wires `rowsForTable(bundle,
  // "profiles")` into the production download path so the null-on-
  // missing schema-drift contract becomes load-bearing. The route-
  // level mock returns the seeded bundle's profiles rows; tests that
  // want to exercise the manifest-drift path override per-test.
  rowsForTable: (
    bundle: { tables?: Array<{ table: string; rows: unknown[] }> },
    table: string,
  ): unknown[] | null => {
    const entry = bundle.tables?.find((t) => t.table === table);
    return entry ? entry.rows : null;
  },
}));

import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/account/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: "{}",
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/account/export/route");
}

/**
 * P448 (audit 2026-05-12 Lane E) + specialist apply 2026-05-07
 * performance HIGH conf-9 — peak memory invariant.
 *
 * The legacy upload path held `bundleJson` and `bundleBytes` in
 * scope simultaneously, peaking memory at ~3x the payload size
 * (object + JSON string + bytes). P448's fused expression cut the
 * named intermediate. The specialist apply went further: replaced
 * `new TextEncoder().encode(JSON.stringify(bundle))` with
 * `encodeExportBundle(bundle)`, which stitches the upload from the
 * cached per-row JSON strings stored on each
 * `ExportTablePayload.__cached_rows_json`. The intermediate string
 * is NEVER materialized, dropping peak heap from ~300MB to ~200MB
 * on the 100MB bundle path.
 *
 * Source-grep assertions:
 *   - `bundleJson` named intermediate MUST NOT reappear.
 *   - The route MUST call `encodeExportBundle(bundle)` (not the
 *     legacy `TextEncoder().encode(JSON.stringify(bundle))`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("POST /api/account/export - peak-memory invariant (P448 + specialist apply)", () => {
  it("uses encodeExportBundle (no double JSON.stringify of rows)", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "app", "api", "account", "export", "route.ts"),
      "utf8",
    );
    // Legacy named intermediate must not reappear.
    expect(src).not.toMatch(/\b(?:const|let|var)\s+bundleJson\b/);
    // Specialist apply: encodeExportBundle is the single-pass shape.
    expect(src).toMatch(/\bencodeExportBundle\(\s*bundle\s*\)/);
    // The fused TextEncoder/JSON.stringify(bundle) call must NOT be
    // present as the bundleBytes assignment — its replacement
    // (encodeExportBundle) avoids the re-serialization of every row.
    // Strip line comments so the regex doesn't match the explanatory
    // docstring next to the new call.
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(
      /TextEncoder\(\)\.encode\(\s*JSON\.stringify\(\s*bundle\s*\)\s*\)/,
    );
  });
});

describe("POST /api/account/export — orphan cleanup on sign failure (I2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-123", email: "u@test.com" } },
    });
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    resetUsedTokensMock.mockResolvedValue(undefined);
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-123",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 1,
      // Audit 2026-05-07 red-team #7: the route now wires
      // `rowsForTable(bundle, "profiles")` as a load-bearing manifest-
      // drift detector. Include a profiles entry in the bundle so the
      // happy-ish path reaches the sign-failure cleanup branch.
      tables: [
        {
          table: "profiles",
          rows: [{ id: "user-123" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("removes the uploaded object when createSignedUrl returns error", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "signing backend unavailable" },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to sign/i);

    // Upload happened (the object exists in bucket at this point)
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uploadedKey = uploadMock.mock.calls[0][0] as string;
    expect(uploadedKey.startsWith("user-123/")).toBe(true);

    // Cleanup MUST have fired with the exact same key
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][0]).toEqual([uploadedKey]);
  });

  it("removes the uploaded object when createSignedUrl returns no signedUrl in data", async () => {
    // Supabase client can succeed (no error) but return data without
    // signedUrl on certain backend-partial failures. The cleanup path
    // must handle that too.
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: null },
      error: null,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-throw if the cleanup remove() itself fails — the user sees the sign error only", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "signing backend unavailable" },
    });
    // Cleanup threw — the surface should still be the original sign
    // failure, not a cleanup error.
    removeMock.mockRejectedValue(new Error("remove exploded"));

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to sign/i);
    // The route didn't propagate the remove error
    expect(body.error).not.toMatch(/remove exploded/i);
  });

  it("does NOT remove the object on the happy path (sanity check)", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.com/signed?t=1" },
      error: null,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });
});

/**
 * Sprint 6 closeout Task 7.3 plan invariants — signed URL TTL + rate
 * limit + envelope shape.
 *
 * The happy-path response must:
 *   1. Pass `SIGNED_URL_EXPIRY_SECONDS` (3600 = 1 hour) as the TTL to
 *      `createSignedUrl`. A drift to a longer TTL widens the window an
 *      attacker who steals the URL can exfil with.
 *   2. Return `expires_at` in the envelope that is within a second of
 *      now + 1 hour (the route computes it as
 *      `new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000)`).
 *   3. Return the signed URL in the envelope body (NOT inline JSON —
 *      the 100MB cap makes inline infeasible, and the plan spec says
 *      "streams via signed URL").
 *   4. Emit `account.export` audit event with the expected shape.
 *
 * The 429 rate-limit path must:
 *   5. Return 429 when the `exportLimiter` token is exhausted.
 *   6. Return a `Retry-After` header matching the limiter's retryAfter.
 *   7. Short-circuit BEFORE calling `collectUserExportBundle` or
 *      `upload`, so a rate-limited caller doesn't waste the expensive
 *      bundle assembly.
 */
describe("POST /api/account/export — signed URL TTL + envelope (spec invariants)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-ttl", email: "ttl@test.com" } },
    });
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    resetUsedTokensMock.mockResolvedValue(undefined);
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-ttl",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 3,
      tables: [
        { table: "profiles", rows: [{ id: "user-ttl" }], row_count: 1, truncated_at_cap: false, parent_id_truncated: false, fetch_error: null },
        { table: "api_keys", rows: [{ id: "k1" }, { id: "k2" }], row_count: 2, truncated_at_cap: false, parent_id_truncated: false, fetch_error: null },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    uploadMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/gdpr-exports/user-ttl/abc.json?token=XYZ" },
      error: null,
    });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("passes SIGNED_URL_EXPIRY_SECONDS = 3600 (1h) to createSignedUrl", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    // Second positional argument is the TTL in seconds.
    const ttlSeconds = createSignedUrlMock.mock.calls[0][1];
    expect(ttlSeconds).toBe(60 * 60);
  });

  it("returns an envelope with signed_url + expires_at ≈ now + 1h (no inline bundle)", async () => {
    const { POST } = await loadRoute();
    const beforeMs = Date.now();
    const res = await POST(makeRequest());
    const afterMs = Date.now();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      signed_url: string;
      expires_at: string;
      bytes: number;
      table_count: number;
      total_row_count: number;
      truncated_at_size_cap: boolean;
      // The envelope MUST NOT carry the bundle inline.
      tables?: unknown;
      rows?: unknown;
    };

    expect(body.ok).toBe(true);
    expect(body.signed_url).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\/gdpr-exports\//);
    expect(body.total_row_count).toBe(3);
    expect(body.table_count).toBe(2);
    expect(body.truncated_at_size_cap).toBe(false);
    expect(typeof body.bytes).toBe("number");

    // Expires ~1h from now: within [before+3599s, after+3601s] window.
    const expiresMs = new Date(body.expires_at).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(beforeMs + 3599 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(afterMs + 3601 * 1000);

    // The envelope is the URL, not the data. An inline bundle would
    // violate the 100MB cap contract.
    expect(body.tables).toBeUndefined();
    expect(body.rows).toBeUndefined();
  });

  it("specialist apply: refuses to mint URL on ANY truncation (size cap / row cap / parent-id cap)", async () => {
    // Build a bundle that exercises all three truncation paths. Pre-
    // apply, the route returned 200 OK with advisory `incomplete_reasons`.
    // Per the specialist finding (silent-failure HIGH conf-9), that mixes
    // two policies on identical "incomplete export" modes — fetch errors
    // got a 500 refusal but truncation got a 200 with text the client
    // could trivially ignore. The apply extends the gate so all four
    // modes return the same refusal shape.
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-trunc",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 50000,
      tables: [
        {
          table: "trades",
          rows: [],
          row_count: 50000,
          truncated_at_cap: true,
          parent_id_truncated: false,
          fetch_error: null,
        },
        {
          table: "strategy_analytics",
          rows: [],
          row_count: 0,
          truncated_at_cap: false,
          parent_id_truncated: true,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: true,
      parent_id_truncated_tables: ["strategy_analytics"],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);

    const body = (await res.json()) as {
      error?: string;
      code?: string;
      request_id?: string;
      truncated_at_size_cap?: unknown;
      incomplete_reasons?: unknown;
    };
    // Stable code so clients can branch on the kind of refusal.
    expect(body.code).toBe("export_truncated");
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // The truncation detail is server-log-only — clients see a stable
    // error + a request_id to quote to support.
    expect(body.truncated_at_size_cap).toBeUndefined();
    expect(body.incomplete_reasons).toBeUndefined();

    // The storage round-trip MUST NOT have fired — the gate runs before
    // upload, so the 100MB upload cost is also saved.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();

    // Server-side log carries the truncation map for forensics.
    const logCall = consoleErrorSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("[api/account/export]"),
    );
    expect(logCall).toBeDefined();
    const ctx = logCall![1] as Record<string, unknown>;
    expect(ctx.truncated_at_size_cap).toBe(true);
    expect(ctx.row_capped_tables).toEqual(["trades"]);
    expect(ctx.parent_id_truncated_tables).toEqual(["strategy_analytics"]);
    const reasons = ctx.incomplete_reasons as string[];
    expect(reasons.some((r) => r.startsWith("size_cap_exceeded"))).toBe(true);
    expect(
      reasons.some(
        (r) => r.startsWith("per_table_row_cap_reached") && r.includes("trades"),
      ),
    ).toBe(true);
    expect(
      reasons.some(
        (r) =>
          r.startsWith("parent_id_cap_reached") &&
          r.includes("strategy_analytics"),
      ),
    ).toBe(true);

    // The refusal IS audited: forensic reconstruction must survive
    // response-body discard. account.export_refused is emitted with
    // the truncation booleans + counts in metadata.
    //
    // Audit 2026-05-07 red-team #1 (HIGH conf-9): the audit metadata
    // MUST NOT include verbatim table-name lists — those are schema
    // reconnaissance that a subject can read out of their next
    // successful export via audit_log_for_user. Aggregate counts
    // give regulators the "did the controller know" signal without
    // bundling the schema map. The full table-name lists remain on
    // the server-side console.error.
    await Promise.resolve();
    await Promise.resolve();
    const refusedCall = logAuditRpcMock.mock.calls.find(
      (c) =>
        c[0] === "log_audit_event" && c[1]?.p_action === "account.export_refused",
    );
    expect(refusedCall).toBeDefined();
    const md = (refusedCall![1] as Record<string, unknown>)
      .p_metadata as Record<string, unknown>;
    expect(md.truncated_at_size_cap).toBe(true);
    expect(md.row_capped_table_count).toBe(1);
    expect(md.parent_id_truncated_table_count).toBe(1);
    expect(md.failed_table_count).toBe(0);
    // Schema-reconnaissance fields MUST NOT appear on the audit row.
    expect(md.row_capped_tables).toBeUndefined();
    expect(md.parent_id_truncated_tables).toBeUndefined();
    expect(md.failed_tables).toBeUndefined();
    expect(md.incomplete_reasons).toBeUndefined();

    // Audit 2026-05-07 red-team #2 (HIGH conf-8): refund the 1/day
    // rate-limit token on refusal. Pre-fix the truncation was
    // deterministic and the consumed token locked the user out
    // permanently. The refund call MUST fire with the user's
    // identifier — verifies the spec's "refund on refusal" invariant.
    expect(resetUsedTokensMock).toHaveBeenCalledTimes(1);
    expect(resetUsedTokensMock.mock.calls[0][0]).toBe("export:user-ttl");

    consoleErrorSpy.mockRestore();
  });

  it("NEW-C16-08: refuses to mint URL (+ refunds token) when a NULL-PK parent dropped child rows", async () => {
    // A bundle that is otherwise complete (not partial, no fetch_error, no
    // cap hit) but dropped a NULL-keyed parent row → child rows missing.
    // Pre-fix this shipped as a 200 + signed URL (falsely complete). The
    // route must now refuse with the SAME shape as the cap path, and the
    // server-log reason must be the accurate parent_id_null_dropped (NOT the
    // misleading 2000-row cap message).
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-nulldrop",
      generated_at: "2026-05-28T00:00:00Z",
      total_row_count: 1,
      tables: [
        {
          table: "trades",
          rows: [],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: ["trades"],
      partial: false,
      failed_tables: [],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_truncated");

    // Gate runs before storage — no URL minted, no upload cost.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();

    // Server log carries the ACCURATE reason (not parent_id_cap_reached).
    const logCall = consoleErrorSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("[api/account/export]"),
    );
    expect(logCall).toBeDefined();
    const ctx = logCall![1] as Record<string, unknown>;
    expect(ctx.parent_id_null_dropped_tables).toEqual(["trades"]);
    const reasons = ctx.incomplete_reasons as string[];
    expect(
      reasons.some(
        (r) => r.startsWith("parent_id_null_dropped") && r.includes("trades"),
      ),
    ).toBe(true);

    // Refusal refunds the 1/day token so the subject is not locked out.
    expect(resetUsedTokensMock).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("emits account.export audit event with object_key_sha256 + expires_at + table_count + total_row_count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // audit.ts schedules via after()/queueMicrotask — drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logAuditRpcMock).toHaveBeenCalled();
    const call = logAuditRpcMock.mock.calls.find(
      (c) => c[0] === "log_audit_event" && c[1]?.p_action === "account.export",
    );
    expect(call).toBeDefined();
    const args = call![1] as Record<string, unknown>;
    expect(args.p_entity_type).toBe("user");
    expect(args.p_entity_id).toBe("user-ttl");
    const metadata = args.p_metadata as Record<string, unknown>;
    // Audit-2026-05-07 H-0202 / H-0203: storage_path is now hashed in
    // audit metadata so a future bucket-RLS regression cannot turn the
    // audit-log CSV stream into a bundle-treasure-map. The raw
    // objectKey lives in the server log line only.
    expect(metadata.storage_path).toBeUndefined();
    expect(typeof metadata.object_key_sha256).toBe("string");
    expect((metadata.object_key_sha256 as string)).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof metadata.expires_at).toBe("string");
    expect(metadata.table_count).toBe(2);
    expect(metadata.total_row_count).toBe(3);
    expect(metadata.truncated_at_size_cap).toBe(false);
    // Audit 2026-05-07 red-team #7: the wired-up rowsForTable("profiles")
    // helper's output surfaces into the audit metadata as
    // `profiles_row_count`. A future drift that drops profiles from
    // the manifest would have either short-circuited above (manifest
    // drift gate) or left this field at 0 — both observable.
    expect(metadata.profiles_row_count).toBe(1);

    // Audit 2026-05-07 red-team #2: token refund MUST NOT fire on
    // the happy path. The 1/day cap remains in effect when the
    // bundle ships normally.
    expect(resetUsedTokensMock).not.toHaveBeenCalled();
  });

  // Audit 2026-05-07 red-team #7 (MED conf-9): the route invokes
  // rowsForTable(bundle, "profiles") as a load-bearing manifest-drift
  // detector. A bundle without profiles must surface
  // export_manifest_drift + refund the rate-limit token.
  it("red-team #7: refuses with export_manifest_drift when bundle lacks profiles", async () => {
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-ttl",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 0,
      // No profiles entry — schema drift.
      tables: [
        {
          table: "user_notes",
          rows: [],
          row_count: 0,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("export_manifest_drift");
    // Token refund fires so the user isn't locked out by a deploy bug.
    expect(resetUsedTokensMock).toHaveBeenCalledTimes(1);
    expect(resetUsedTokensMock.mock.calls[0][0]).toBe("export:user-ttl");
    // No upload / signed URL on the drift path.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/account/export — 1/day rate limit (429 path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-429", email: "rl@test.com" } },
    });
    // Default: NOT rate-limited; each test overrides for the 429 case.
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    resetUsedTokensMock.mockResolvedValue(undefined);
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-429",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 1,
      // Audit 2026-05-07 red-team #7: `rowsForTable(bundle, "profiles")`
      // is wired into the production download path; include a profiles
      // entry so the happy-ish 200 branch can proceed past the manifest-
      // drift gate. Tests for the 429 / partial / truncated paths exit
      // before reaching this gate.
      tables: [
        {
          table: "profiles",
          rows: [{ id: "user-429" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    uploadMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.com/sign" },
      error: null,
    });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("returns 429 with Retry-After header when the exportLimiter token is spent", async () => {
    // 86400s = 24h; matches exportLimiter = makeLimiter(1, "86400 s").
    checkLimitMock.mockResolvedValueOnce({
      success: false,
      retryAfter: 86_400,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/export limit|limit reached|try again/i);

    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).toBe("86400");

    // H-0015 (fixed 2026-05-25): the 429 path now emits a dedicated
    // `account.export_rate_limited` audit event before returning, so a
    // credential-export probing storm leaves a forensic trail for
    // SecOps. The route returns early at the rate-limit gate but emits
    // the audit FIRST. Drain the microtask queue so the deferred emit
    // lands before we assert.
    await Promise.resolve();
    await Promise.resolve();
    const rlCall = logAuditRpcMock.mock.calls.find(
      (c) =>
        (c as unknown as [string, { p_action?: string }])[0] ===
          "log_audit_event" &&
        (c as unknown as [string, { p_action?: string }])[1]?.p_action ===
          "account.export_rate_limited",
    );
    expect(rlCall).toBeDefined();
  });

  // H-0015 (SURFACED): abuse-pattern signals (429 storms) should be
  // audited so SecOps can detect credential-export probing. The route
  // currently returns 429 WITHOUT emitting any audit event — a security
  // observability gap. This assertion encodes the desired behavior (a
  // dedicated `account.export_rate_limited` audit event on the 429
  // path) and FAILS today because the route short-circuits before any
  // logAuditEvent call. Promote to `it(...)` once the route emits a
  // rate-limit audit event. Production fix required in
  // src/app/api/account/export/route.ts (the 429 branch) — flagged, not
  // applied here (test files only).
  it(
    "H-0015: emits an audit event on the 429 rate-limit path (SURFACED — route does not audit 429s)",
    async () => {
      checkLimitMock.mockResolvedValueOnce({
        success: false,
        retryAfter: 86_400,
      });

      const { POST } = await loadRoute();
      const res = await POST(makeRequest());
      expect(res.status).toBe(429);

      // Drain the deferred-emit microtask queue.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // A rate-limit refusal must leave a forensic trail so a probing
      // storm is detectable. Expect a dedicated rate-limit audit action.
      const rlCall = logAuditRpcMock.mock.calls.find(
        (c) =>
          (c as unknown as [string, { p_action?: string }])[0] ===
            "log_audit_event" &&
          (c as unknown as [string, { p_action?: string }])[1]?.p_action ===
            "account.export_rate_limited",
      );
      expect(rlCall).toBeDefined();
    },
  );

  it("429 short-circuits before collectUserExportBundle or upload (wasted-compute guard)", async () => {
    checkLimitMock.mockResolvedValueOnce({
      success: false,
      retryAfter: 3600,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);

    // The expensive bundle assembly must NOT have run — otherwise a
    // rate-limited caller could DOS-amplify by waiting 0ms between
    // retries. The order-of-operations in route.ts is:
    //   csrf → auth → rate-limit → collectBundle → upload → sign
    // Any move of the rate-limit check below collectBundle would fail
    // this test.
    expect(collectBundleMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  /**
   * audit-2026-05-07 follow-up — Issue 5
   *
   * GDPR Art. 15 requires a COMPLETE export. Pre-fix, a rejected fetch
   * or PG error in collectUserExportBundle silently substituted `[]`
   * for the failed table, and the route happily minted a signed URL
   * over an incomplete bundle. Policy (a) from the audit playbook:
   * refuse to mint the URL on any fetch failure; return 500 with a
   * stable code so the user retries.
   *
   * The tests below pin:
   *   - bundle.partial=true → 500 with code=export_partial and the
   *     failed_tables array in the response body.
   *   - The signed URL is NOT minted and the storage object is NOT
   *     uploaded (the bundle assembly itself can be the slowest step
   *     but the cheap upload is also skipped).
   *   - The audit event is NOT emitted for a partial-export refusal.
   */
  it("Issue 5 + Finding 2: returns 500 with code=export_partial + request_id (NO failed_tables leak) when bundle.partial is true", async () => {
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-429",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 0,
      tables: [
        { table: "profiles", rows: [], row_count: 0, truncated_at_cap: false, parent_id_truncated: false, fetch_error: null },
        { table: "api_keys", rows: [], row_count: 0, truncated_at_cap: false, parent_id_truncated: false, fetch_error: "direct select failed for api_keys: statement timeout" },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: true,
      failed_tables: ["api_keys"],
    });

    // Finding 2 (audit-2026-05-07 red-team): the failed_tables list is
    // schema reconnaissance. The response MUST surface a stable code +
    // a request_id (UUID) the user can quote, but MUST NOT carry the
    // failed_tables array — that detail is server-log-only.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);

    const body = (await res.json()) as {
      error?: string;
      code?: string;
      request_id?: string;
      // Forbidden to leak.
      failed_tables?: unknown;
    };
    expect(body.code).toBe("export_partial");
    // Finding 2: failed_tables MUST NOT appear in the client body.
    expect(body.failed_tables).toBeUndefined();
    expect("failed_tables" in body).toBe(false);
    // request_id is a UUID v4 (random) and carries the correlation key.
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // The storage round-trip must NOT have fired.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();

    // Audit 2026-05-07 red-team #2: token refund MUST fire on the
    // export_partial path too — a transient-looking refusal still
    // locks the user out for 24h without the refund.
    expect(resetUsedTokensMock).toHaveBeenCalledTimes(1);
    expect(resetUsedTokensMock.mock.calls[0][0]).toBe("export:user-429");

    // The happy-path account.export audit MUST NOT fire (the export
    // never produced a signed URL). A NEW account.export_refused audit
    // DOES fire so forensic reconstruction survives the response-body
    // discard (specialist apply, low-conf-7 silent-failure: audit-log
    // fire-and-forget on the refusal path now has a durable trail).
    await Promise.resolve();
    await Promise.resolve();
    const exportCall = logAuditRpcMock.mock.calls.find(
      (c) => c[0] === "log_audit_event" && c[1]?.p_action === "account.export",
    );
    expect(exportCall).toBeUndefined();
    const refusedCall = logAuditRpcMock.mock.calls.find(
      (c) =>
        c[0] === "log_audit_event" && c[1]?.p_action === "account.export_refused",
    );
    expect(refusedCall).toBeDefined();

    // Audit 2026-05-07 red-team #1 (HIGH conf-9): the refused-export
    // audit metadata MUST NOT contain table-name lists (schema
    // reconnaissance), only the per-mode booleans and aggregate
    // counts. Pin this on the partial path AND the truncated path —
    // both feed audit_log via the same logAuditEvent call.
    const refusedMd = (refusedCall![1] as Record<string, unknown>)
      .p_metadata as Record<string, unknown>;
    expect(refusedMd.failed_table_count).toBe(1);
    expect(refusedMd.failed_tables).toBeUndefined();
    expect(refusedMd.row_capped_tables).toBeUndefined();
    expect(refusedMd.parent_id_truncated_tables).toBeUndefined();
    expect(refusedMd.incomplete_reasons).toBeUndefined();

    // Server-side log MUST carry the failed_tables (forensics) AND the
    // request_id (correlation key the user quoted to support).
    const logCall = consoleErrorSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("[api/account/export]"),
    );
    expect(logCall).toBeDefined();
    const ctx = logCall![1] as Record<string, unknown>;
    expect(ctx.failed_tables).toEqual(["api_keys"]);
    expect(ctx.user_id).toBe("user-429");
    expect(typeof ctx.request_id).toBe("string");
    // The request_id in the body matches the one in the log.
    expect(ctx.request_id).toBe(body.request_id);

    consoleErrorSpy.mockRestore();
  });

  it("the limiter key buckets per user (not global) — different users each get 1/day", async () => {
    // First call for user-A: token available.
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-A", email: "a@x" } },
    });
    const { POST } = await loadRoute();
    const resA = await POST(makeRequest());
    expect(resA.status).toBe(200);
    const keyArgA = checkLimitMock.mock.calls[0][1] as string;
    expect(keyArgA).toBe("export:user-A");

    // Second call for user-B: different bucket key.
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-B", email: "b@x" } },
    });
    checkLimitMock.mockResolvedValueOnce({ success: true, retryAfter: 0 });
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-B",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 1,
      tables: [
        {
          table: "profiles",
          rows: [{ id: "user-B" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    });
    uploadMock.mockResolvedValueOnce({ error: null });
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: "https://example.com/sign" },
      error: null,
    });
    const { POST: POST_B } = await loadRoute();
    const resB = await POST_B(makeRequest());
    expect(resB.status).toBe(200);
    const keyArgB = checkLimitMock.mock.calls[0][1] as string;
    expect(keyArgB).toBe("export:user-B");
  });
});
