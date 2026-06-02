import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * audit-2026-05-07 round-2 Block D / P1947 — no-store coverage regression gate.
 *
 * THE LEAK CLASS: an authenticated API route whose response BODY carries
 * tenant-specific data (a user's holdings, notes, encrypted keys, match
 * decisions, draft strategies, …) but does NOT send
 * `Cache-Control: private, no-store` can have that payload absorbed by a
 * shared/CDN cache keyed on the URL — and then served to a DIFFERENT tenant.
 * The fix is the shared `NO_STORE_HEADERS` const (`src/lib/api/headers.ts`),
 * stamped on every locally-constructed response of such a route.
 *
 * The `withAuth`-family wrappers stamp `NO_STORE_HEADERS` only on their OWN
 * 401 / approval-403 paths; a route's handler-local `NextResponse.json(...)`
 * success + error responses do NOT inherit it and must add it explicitly.
 * `withRole` and the `rateLimitDeny*` helpers do not stamp it at all — but
 * those carry only generic auth-fail / "Too many requests" bodies (no tenant
 * data), so they are out of this gate's scope (see EXEMPT rationale below).
 *
 * WHAT THIS GATE LOCKS: the set of authenticated tenant-data routes that were
 * audited and fixed to use the `NO_STORE_HEADERS` const. Each MUST reference
 * the const, so a future refactor that drops the import/stamp fails loudly
 * here (regression pressure), mirroring the grep-invariant style of
 * `for-quants-leads-projection.test.ts` and `audit-coverage.test.ts`.
 *
 * SCOPE (deliberate): this gate locks the AUDITED tenant-data surface by an
 * explicit allowlist; it does NOT enumerate-and-classify the entire route
 * corpus (a forces-classify-everything gate would (a) require re-auditing all
 * 77 routes and (b) trip every unrelated new-route PR until classified). New
 * routes are caught by the next audit cycle + code review, not by this test.
 *
 * EXEMPT routes (authenticated but NOT in scope — recorded so the
 * classification decision is documented, not asserted here):
 *   - Write-ack / mutation-only bodies ({success:true} / {ok:true,noop}):
 *     intro, intro-response, admin/strategy-review, admin/match/decisions,
 *     admin/match/preferences/[allocator_id], admin/allocator-approve,
 *     admin/manager-approve, admin/notify-submission, admin/intro-request,
 *     admin/for-quants-leads/process, alerts/[id]/acknowledge (204),
 *     watchlist/[strategyId]. No tenant payload is echoed back.
 *   - Single GLOBAL flag, not tenant-scoped: admin/match/kill-switch.
 *   - SSE stream (already `no-cache`, no JSON tenant body): debug-key-flow.
 *   - Public / unauthenticated published-data: factsheet/[id]/pdf,
 *     factsheet/[id]/tearsheet.pdf, demo/*, for-quants-lead, health.
 *   - PDF binary success already stamps inline `private, no-store`:
 *     portfolio-pdf/[id] (covered by its own route.test.ts).
 */

const API_DIR = path.resolve(__dirname, "../app/api");

/**
 * Authenticated, tenant-data-bearing routes audited under Block D / P1947
 * and fixed to stamp the `NO_STORE_HEADERS` const on their handler-local
 * responses. Paths are relative to `src/app/api/`.
 *
 * portfolio-optimizer + trades/upload were fixed in PR #425; the rest in the
 * no-store class-closure batch; me/audit-log/export was normalized from a
 * bare `"Cache-Control": "no-store"` to the canonical const.
 */
const MUST_STAMP_NO_STORE: readonly string[] = [
  "portfolio-optimizer/route.ts",
  "preferences/route.ts",
  "match/decisions/holding/route.ts",
  "trades/upload/route.ts",
  "bridge/outcome/route.ts",
  "bridge/outcome/dismiss/route.ts",
  "bridge/outcome/[id]/curves/route.ts",
  "strategies/draft/route.ts",
  "strategies/draft/[id]/route.ts",
  "strategies/csv-validate/route.ts",
  "strategies/create-with-key/route.ts",
  "strategies/csv-finalize/route.ts",
  "strategies/finalize-wizard/route.ts",
  "admin/match/send-intro/route.ts",
  "admin/match/recompute/route.ts",
  "admin/match/[allocator_id]/route.ts",
  "admin/match/allocators/route.ts",
  "admin/match/eval/route.ts",
  "admin/partner-import/route.ts",
  "admin/compute-jobs/route.ts",
  "admin/users/[id]/roles/route.ts",
  "usage/session-start/route.ts",
  "portfolio-alerts/route.ts",
  "alerts/critical/route.ts",
  "notes/route.ts",
  "allocator/holdings/sync/route.ts",
  "attestation/route.ts",
  "keys/validate-and-encrypt/route.ts",
  "keys/sync/route.ts",
  "keys/[id]/permissions/route.ts",
  "account/deletion-request/route.ts",
  "portfolio-strategies/alias/route.ts",
  "portfolio-documents/route.ts",
  "me/audit-log/export/route.ts",
];

describe("no-store coverage: audited tenant-data routes stamp NO_STORE_HEADERS", () => {
  // Vacuity guard: a typo that drops entries from the allowlist must fail,
  // not silently shrink the gate.
  it("locks the full audited tenant-data surface (34 routes)", () => {
    expect(MUST_STAMP_NO_STORE.length).toBe(34);
    expect(new Set(MUST_STAMP_NO_STORE).size).toBe(MUST_STAMP_NO_STORE.length);
  });

  it("every audited tenant-data route exists and references NO_STORE_HEADERS", () => {
    const missingFile: string[] = [];
    const missingStamp: string[] = [];

    for (const rel of MUST_STAMP_NO_STORE) {
      const full = path.join(API_DIR, rel);
      if (!fs.existsSync(full)) {
        // A rename/move must fail loudly — the gate cannot silently stop
        // protecting a route because its path drifted.
        missingFile.push(rel);
        continue;
      }
      const src = fs.readFileSync(full, "utf8");
      // The route must (a) import the const from the single source and
      // (b) actually STAMP it on a response. We match the two real stamping
      // forms — `headers: NO_STORE_HEADERS` (direct) and `...NO_STORE_HEADERS`
      // (spread, merged with Retry-After/Content-Type) — rather than counting
      // bare `NO_STORE_HEADERS` occurrences, so an import + a stray comment
      // mention can no longer satisfy the gate (a `>=2 occurrences` heuristic
      // would: review w0ganyfe1 finding). This is a TOTAL-REMOVAL tripwire: it
      // proves the route still imports + stamps at least one response. It does
      // NOT prove the SUCCESS body specifically is stamped — that intent is
      // pinned by the behavioral `Cache-Control: private, no-store` success
      // assertions on the crown-jewel routes (keys/validate-and-encrypt,
      // keys/[id]/permissions, preferences, notes, portfolio-documents,
      // admin/match/allocators) in their route.test.ts files.
      const importsConst =
        /import\s*\{[^}]*\bNO_STORE_HEADERS\b[^}]*\}\s*from\s*["']@\/lib\/api\/headers["']/.test(
          src,
        );
      const stampsConst =
        /headers:\s*NO_STORE_HEADERS\b/.test(src) ||
        /\.\.\.NO_STORE_HEADERS\b/.test(src);
      if (!importsConst || !stampsConst) missingStamp.push(rel);
    }

    expect(
      missingFile,
      `These audited tenant-data routes no longer exist at their recorded ` +
        `path — update MUST_STAMP_NO_STORE (or restore the route):\n  ` +
        missingFile.join("\n  "),
    ).toEqual([]);

    expect(
      missingStamp,
      `These authenticated routes return tenant-specific data but no longer ` +
        `import + use NO_STORE_HEADERS from "@/lib/api/headers" — a shared ` +
        `cache could leak one tenant's payload to another (Block D / P1947). ` +
        `Stamp NO_STORE_HEADERS on every locally-constructed response:\n  ` +
        missingStamp.join("\n  "),
    ).toEqual([]);
  });
});
