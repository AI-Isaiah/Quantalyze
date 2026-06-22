/**
 * B15 (audit-2026-05-07) — limiter-ordering enforcement ("grep-test ORDER
 * upgrade"). The closed-by-construction backstop for the canonical order
 *
 *     auth -> input-validation -> rate-limit -> handler
 *
 * Two guarantees:
 *
 *  1. COMPLETENESS — every API route that consumes a rate-limit token
 *     (`checkLimit(` or the `withAuthLimited(` wrapper) MUST be classified in
 *     exactly one bucket below. A NEW limiter route that nobody classified
 *     fails this test, forcing a conscious decision about its ordering. This
 *     is the part that prevents regressions: you cannot add a rate-limited
 *     route without declaring whether it validates-then-limits.
 *
 *  2. ORDERING — for CANONICAL routes (authenticated, per-caller limiter,
 *     real request body), every HTTP-method handler that both reads a body
 *     AND consumes the limiter must read/validate the body BEFORE the limiter.
 *     A regression that moves `checkLimit` back above `req.json`/`safeParse`
 *     fails here.
 *
 * Buckets:
 *  - WRAPPER          — uses `withAuthLimited`; order guaranteed by construction.
 *  - CANONICAL        — inline limiter, validates-then-limits (verified below).
 *  - NO_INPUT         — limiter but no request body to validate (the
 *                       "burn-a-token-on-bad-input" bug cannot occur).
 *  - PUBLIC_IP_EXCEPTION — public/unauthenticated, per-IP limiter as scraper/
 *                       abuse defense. limit-FIRST is the intended design here
 *                       (reject cheaply before doing DB/puppeteer/parse work
 *                       for an attacker); see the `B15 limit-first:` markers.
 *  - WRAPPER_ADMIN    — admin routes rate-limited via `withAdminAuth({ rateLimitKey })`;
 *                       the wrapper validates-then-limits by construction (B15b),
 *                       like WRAPPER. The limiter lives in the wrapper, not the
 *                       route file, so these are excluded from the per-method
 *                       ordering check (verified in withAdminAuth.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = join(process.cwd(), "src/app/api");

// ---- Registry (paths relative to src/app/api/) -------------------------------

const WRAPPER = new Set([
  "bridge/outcome/route.ts",
  "bridge/outcome/dismiss/route.ts",
]);

const CANONICAL = new Set([
  "allocator/scenario/commit/route.ts",
  // Phase 23 scenario CRUD — validate-then-limit (B15). saved/route.ts (POST)
  // parses + safeParses the body before checkLimit; saved/[id]/route.ts inlines
  // checkLimit in each mutating method AFTER safeParse (PATCH/PUT) / after the
  // uuid + auth gate (body-less DELETE), mirroring commit/route.ts.
  "allocator/scenario/saved/route.ts",
  "allocator/scenario/saved/[id]/route.ts",
  // Phase 25 scenario sharing — both validate the scenario_id (safeParse via
  // isUuid) BEFORE checkLimit, so a 400 never burns a token (B15 ordering).
  "allocator/scenario/share/route.ts",
  "allocator/scenario/share/revoke/route.ts",
  "attestation/route.ts",
  "bridge/route.ts",
  "bridge/outcome/[id]/curves/route.ts",
  "intro/route.ts",
  "intro-response/route.ts",
  "keys/[id]/permissions/route.ts",
  "keys/sync/route.ts",
  "keys/validate-and-encrypt/route.ts",
  "notes/route.ts",
  "portfolio-optimizer/route.ts",
  // Phase 28 weight optimizer — parses + validates the body (objective + series
  // shape + non-finite + payload caps) BEFORE checkLimit, so a 400 never burns a
  // token (B15 validate-then-limit).
  "scenario/optimize/route.ts",
  "portfolio-strategies/alias/route.ts",
  "preferences/route.ts",
  "simulator/route.ts",
  "strategies/create-with-key/route.ts",
  "strategies/csv-finalize/route.ts",
  "strategies/csv-validate/route.ts",
  "strategies/draft/[id]/route.ts",
  "strategies/finalize-wizard/route.ts",
  "trades/upload/route.ts",
  "watchlist/[strategyId]/route.ts",
  // B15b (audit-2026-05-07): admin cluster — reordered from PENDING_B15B to
  // validate-then-limit. The inline checkLimit moved below body parse + field
  // validation (and below URL-param validation for the params-only methods).
  "admin/allocator-approve/route.ts",
  "admin/deletion-requests/[id]/reject/route.ts",
  "admin/intro-request/route.ts",
  "admin/manager-approve/route.ts",
  "admin/match/decisions/route.ts",
  "admin/match/kill-switch/route.ts",
  "admin/match/preferences/[allocator_id]/route.ts",
  "admin/match/recompute/route.ts",
  "admin/match/send-intro/route.ts",
  "admin/notify-submission/route.ts",
  "admin/partner-import/route.ts",
  "admin/strategy-review/route.ts",
  "admin/users/[id]/roles/route.ts",
]);

const NO_INPUT = new Set([
  "account/deletion-request/route.ts",
  "account/export/route.ts",
  "admin/allocators/[id]/holdings/route.ts",
  "admin/deletion-requests/[id]/approve/route.ts",
  // Public BTC benchmark GET — added to PUBLIC_ROUTES so the anonymous
  // scenario-share recipient page can self-fetch the overlay. publicIpLimiter
  // (10/min/IP), no request body (symbol hard-coded), limit-FIRST before the DB
  // read. Same shape as demo/match below (public per-IP, no body).
  "benchmark/btc/route.ts",
  "demo/match/[allocator_id]/route.ts",
  "factsheet/[id]/pdf/route.ts",
  "me/audit-log/export/route.ts",
  "portfolio-pdf/[id]/route.ts",
  "strategies/browse/route.ts",
]);

// limit-FIRST is intentional here (public/unauth scraper defense).
const PUBLIC_IP_EXCEPTION = new Set([
  "alerts/ack/route.ts",
  "demo/portfolio-pdf/[id]/route.ts",
  "factsheet/[id]/tearsheet.pdf/route.ts",
  "for-quants-lead/route.ts",
  "verify-strategy/route.ts",
]);

// Admin routes rate-limited via `withAdminAuth({ rateLimitKey })`: the wrapper
// consumes the token, so there is no inline checkLimit in the route file. As of
// B15b the wrapper parses + schema-validates the body BEFORE the limiter
// (withAdminAuth.ts), so the canonical validate→limit order is guaranteed by
// construction — the same way WRAPPER (withAuthLimited) routes are. Verified in
// src/lib/api/withAdminAuth.test.ts. Excluded from the per-method body-marker
// ordering + helper-extraction checks below (the limiter is not in the file).
const WRAPPER_ADMIN = new Set([
  "admin/for-quants-leads/process/route.ts",
]);

// CANONICAL routes whose only input is URL params (no request body to read) —
// the per-method body-marker ordering check legitimately skips these. Listing
// them explicitly means a body-bearing CANONICAL route that LOSES its in-method
// body marker (e.g. body parse extracted to a top-level helper) fails loudly
// instead of silently downgrading to unchecked.
const PARAMS_ONLY_CANONICAL = new Set([
  "bridge/outcome/[id]/curves/route.ts",
  "keys/[id]/permissions/route.ts",
  "strategies/draft/[id]/route.ts",
]);

// ---- Helpers -----------------------------------------------------------------

function findRouteFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...findRouteFiles(join(dir, entry.name), rel));
    } else if (entry.name === "route.ts") {
      out.push(rel);
    }
  }
  return out;
}

// `rateLimitKey:` catches routes rate-limited SOLELY via the withAdminAuth
// option (no inline checkLimit) — they consume a token in the wrapper and would
// otherwise escape the completeness net.
const CONSUMES_LIMITER = /\bcheckLimit\s*\(|\bwithAuthLimited\s*\(|\brateLimitKey\s*:/;
const CHECK_LIMIT = /\bcheckLimit\s*\(/;
// Body-read / validation markers. Matches both `req.` and `request.` param
// names and the buffering verbs, plus Zod safeParse and JSON.parse.
const BODY_READ =
  /\b(?:req|request)\.(?:json|formData|text|arrayBuffer|blob)\s*\(|\.safeParse\s*\(|\bJSON\.parse\s*\(/;
const HANDLER_BOUNDARY =
  /export\s+(?:const\s+(?:GET|POST|PUT|PATCH|DELETE)\b|(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/g;

/** Split a route source into per-HTTP-method handler segments. */
function methodSegments(src: string): string[] {
  const idxs: number[] = [];
  let m: RegExpExecArray | null;
  HANDLER_BOUNDARY.lastIndex = 0;
  while ((m = HANDLER_BOUNDARY.exec(src))) idxs.push(m.index);
  if (idxs.length === 0) return [src];
  return idxs.map((start, i) => src.slice(start, idxs[i + 1] ?? src.length));
}

const allRouteFiles = findRouteFiles(API_ROOT);
const limiterRoutes = allRouteFiles.filter((f) =>
  CONSUMES_LIMITER.test(readFileSync(join(API_ROOT, f), "utf8")),
);

describe("B15 — limiter ordering enforcement", () => {
  it("every rate-limited route is classified (no unclassified limiter route)", () => {
    const classified = new Set([
      ...WRAPPER,
      ...CANONICAL,
      ...NO_INPUT,
      ...PUBLIC_IP_EXCEPTION,
      ...WRAPPER_ADMIN,
    ]);
    const unclassified = limiterRoutes.filter((f) => !classified.has(f));
    // A new rate-limited route landed without a B15 ordering decision. Add it
    // to the correct bucket in this file (CANONICAL if it validates before
    // limiting; PUBLIC_IP_EXCEPTION only if it is a public per-IP scrape
    // surface that must limit first).
    expect(unclassified).toEqual([]);
  });

  it("registry has no stale entries (every classified path exists & consumes a limiter)", () => {
    const classified = [
      ...WRAPPER,
      ...CANONICAL,
      ...NO_INPUT,
      ...PUBLIC_IP_EXCEPTION,
      ...WRAPPER_ADMIN,
    ];
    const stale = classified.filter((f) => !limiterRoutes.includes(f));
    expect(stale).toEqual([]);
  });

  it("WRAPPER routes use withAuthLimited and do not inline checkLimit", () => {
    for (const f of WRAPPER) {
      const src = readFileSync(join(API_ROOT, f), "utf8");
      expect(src, f).toMatch(/\bwithAuthLimited\s*\(/);
      expect(CHECK_LIMIT.test(src), `${f} should not inline checkLimit`).toBe(false);
    }
  });

  it("CANONICAL routes validate the body BEFORE consuming the limiter (per method)", () => {
    const violations: string[] = [];
    for (const f of CANONICAL) {
      const src = readFileSync(join(API_ROOT, f), "utf8");
      for (const seg of methodSegments(src)) {
        const limitIdx = seg.search(CHECK_LIMIT);
        if (limitIdx < 0) continue; // method does not consume the limiter
        const bodyIdx = seg.search(BODY_READ);
        if (bodyIdx < 0) continue; // params-only method — no body to front-run
        if (limitIdx < bodyIdx) {
          violations.push(
            `${f}: checkLimit at offset ${limitIdx} precedes body read/validation at offset ${bodyIdx}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("body-bearing CANONICAL routes keep an in-method body marker (helper-extraction guard)", () => {
    // Defends the ordering check above: it skips any method segment with no
    // body marker. If a body-bearing route's parse/validation is extracted to a
    // top-level helper, its method segment loses the marker and the ordering
    // check would silently stop covering it. Require that every body-bearing
    // CANONICAL route still has a method segment containing BOTH the limiter
    // and a body marker, so such a refactor fails here instead of going dark.
    const unchecked: string[] = [];
    for (const f of CANONICAL) {
      if (PARAMS_ONLY_CANONICAL.has(f)) continue;
      const src = readFileSync(join(API_ROOT, f), "utf8");
      const covered = methodSegments(src).some(
        (seg) => CHECK_LIMIT.test(seg) && BODY_READ.test(seg),
      );
      if (!covered) unchecked.push(f);
    }
    expect(unchecked).toEqual([]);
  });

  it("WRAPPER_ADMIN routes use withAdminAuth({ rateLimitKey }) + a schema and do not inline checkLimit", () => {
    // These routes rate-limit through the wrapper, which (B15b) parses +
    // schema-validates the body BEFORE consuming the token — so the canonical
    // validate→limit order holds by construction, asserted in
    // src/lib/api/withAdminAuth.test.ts. The schema requirement is load-bearing:
    // without it the wrapper only object-guards the body, so a schema-invalid
    // (but well-formed-object) request would still burn a token.
    for (const f of WRAPPER_ADMIN) {
      const src = readFileSync(join(API_ROOT, f), "utf8");
      expect(src, f).toMatch(/withAdminAuth\s*\(/);
      expect(
        src,
        `${f} should opt into the wrapper limiter via rateLimitKey`,
      ).toMatch(/rateLimitKey\s*:/);
      expect(
        src,
        `${f} should pass a schema to withAdminAuth so it validates before limiting`,
        // Bound to the withAdminAuth(...) call, not a free-floating `schema:`
        // token — so a future edit that drops the real option but leaves a
        // `schema:` in a comment/unrelated object can't pass this vacuously.
      ).toMatch(/withAdminAuth\s*\([\s\S]*?schema\s*:/);
      expect(
        CHECK_LIMIT.test(src),
        `${f} should not inline checkLimit (limiter lives in withAdminAuth)`,
      ).toBe(false);
    }
  });
});
