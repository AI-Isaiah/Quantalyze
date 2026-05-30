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
 *  - PENDING_B15B     — admin cluster, still limit-then-validate. Scheduled for
 *                       the B15b PR; documented, not yet fixed. MUST shrink to
 *                       empty when B15b lands.
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
  "attestation/route.ts",
  "bridge/route.ts",
  "bridge/outcome/[id]/curves/route.ts",
  "intro/route.ts",
  "intro-response/route.ts",
  "keys/[id]/permissions/route.ts",
  "keys/sync/route.ts",
  "keys/validate-and-encrypt/route.ts",
  "portfolio-optimizer/route.ts",
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
]);

const NO_INPUT = new Set([
  "account/deletion-request/route.ts",
  "account/export/route.ts",
  "admin/allocators/[id]/holdings/route.ts",
  "admin/deletion-requests/[id]/approve/route.ts",
  "demo/match/[allocator_id]/route.ts",
  "factsheet/[id]/pdf/route.ts",
  "me/audit-log/export/route.ts",
  "portfolio-pdf/[id]/route.ts",
  "strategies/browse/route.ts",
  "strategies/draft/route.ts",
]);

// limit-FIRST is intentional here (public/unauth scraper defense).
const PUBLIC_IP_EXCEPTION = new Set([
  "alerts/ack/route.ts",
  "demo/portfolio-pdf/[id]/route.ts",
  "factsheet/[id]/tearsheet.pdf/route.ts",
  "for-quants-lead/route.ts",
  "verify-strategy/route.ts",
]);

// Admin cluster — still limit-then-validate; fixed in the B15b PR. Each entry
// here is a KNOWN violator deliberately deferred. This set MUST become empty
// when B15b lands (move each to CANONICAL after its reorder).
const PENDING_B15B = new Set([
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
  // Rate-limited via withAdminAuth({ rateLimitKey }) — the wrapper consumes the
  // token BEFORE request.json() (withAdminAuth.ts), so this is limit-before-
  // validate too. B15b fixes it by reordering withAdminAuth itself (validate
  // before the wrapper's limiter), which clears every rateLimitKey route.
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
      ...PENDING_B15B,
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
      ...PENDING_B15B,
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

  it("PENDING_B15B is documented and bounded (admin cluster, fixed in B15b)", () => {
    // This deliberately asserts the known-pending set is exactly the admin
    // cluster (13 inline-checkLimit routes + 1 withAdminAuth-rateLimitKey
    // route). When B15b reorders these, move each to CANONICAL and this count
    // drops to 0 — at which point delete this assertion.
    expect(PENDING_B15B.size).toBe(14);
    for (const f of PENDING_B15B) {
      expect(f.startsWith("admin/"), `${f} should be an admin route`).toBe(true);
    }
  });
});
