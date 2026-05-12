import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * audit-2026-05-07 P200 — CI grep gate enforcing CSRF + admin rate-limit
 * coverage on every POST handler under `src/app/api/admin/`.
 *
 * Why a grep test instead of a CI bash script: this runs on every developer's
 * `npm run test` invocation alongside the rest of the unit suite, so a missing
 * defense fails locally before push (not only in CI). It also reuses the
 * existing vitest infra (no new GitHub Actions step to maintain) and the
 * failure message points the dev directly at the offending route file.
 *
 * Coverage rules:
 *   1. CSRF: every POST handler must enforce same-origin. Acceptable patterns:
 *        a. Direct  `import { assertSameOrigin } from "@/lib/csrf";`
 *        b. Wrapped via `withAdminAuth` (which calls assertSameOrigin internally)
 *        c. Wrapped via `withRole`       (ditto)
 *   2. Rate limit: every POST handler must consume an Upstash bucket.
 *      Acceptable patterns:
 *        a. Direct  `import { ... checkLimit } from "@/lib/ratelimit";`
 *        b. Wrapped via `withRole` (which enforces userActionLimiter internally)
 *
 * Note on the wrapper exemption: `withAdminAuth` does NOT enforce a rate
 * limit today — the four routes touched by Lane 5 of audit-2026-05-07 add
 * the rate limit at the route file alongside the wrapper. Any future admin
 * POST route that uses `withAdminAuth` MUST also import `checkLimit` from
 * @/lib/ratelimit (this test will fail until it does).
 */

const ADMIN_ROUTES_DIR = join(__dirname, "..", "app", "api", "admin");

/**
 * Routes the rate-limit gate intentionally does not cover yet. Each entry
 * MUST cite the audit FIX-LIST P-number that owns the follow-up. The CSRF
 * gate has no exemptions — every admin POST must enforce same-origin.
 */
const RATE_LIMIT_EXEMPTIONS: Record<string, string> = {
  // The following admin POST routes enforce CSRF (via assertSameOrigin or
  // a wrapper) but do NOT yet bind a checkLimit() call. They are
  // out-of-scope for Lane 5 of audit-2026-05-07 (which was scoped to
  // P197/P198/P199/P200/P203 — the four sibling routes touched by this
  // PR). Each entry is tracked for a follow-up sweep so the grep gate
  // doesn't false-fail on routes not in this PR's blast radius.
  "src/app/api/admin/for-quants-leads/process/route.ts":
    "out-of-scope for Lane 5; uses withAdminAuth (CSRF only). Follow-up sweep should add adminActionLimiter.",
  "src/app/api/admin/match/decisions/route.ts":
    "out-of-scope for Lane 5; CSRF via assertSameOrigin only. Follow-up sweep should add adminActionLimiter.",
  "src/app/api/admin/match/kill-switch/route.ts":
    "out-of-scope for Lane 5; CSRF via assertSameOrigin only. Follow-up sweep should add adminActionLimiter.",
  "src/app/api/admin/match/send-intro/route.ts":
    "out-of-scope for Lane 5; CSRF via assertSameOrigin only. Follow-up sweep should add adminActionLimiter.",
};

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function hasPostHandler(source: string): boolean {
  // Either `export async function POST(` or `export const POST = ...`.
  return (
    /export\s+async\s+function\s+POST\s*\(/.test(source) ||
    /export\s+const\s+POST\s*=/.test(source)
  );
}

function hasCsrfDefense(source: string): boolean {
  return (
    source.includes("from \"@/lib/csrf\"") ||
    source.includes("from \"@/lib/api/withAdminAuth\"") ||
    /from\s+["']@\/lib\/auth["']/.test(source) // withRole lives in @/lib/auth
  );
}

function hasRateLimit(source: string): boolean {
  return (
    source.includes("from \"@/lib/ratelimit\"") ||
    /from\s+["']@\/lib\/auth["']/.test(source) // withRole enforces userActionLimiter
  );
}

describe("audit-2026-05-07 P200 — admin POST routes must enforce CSRF + rate limit", () => {
  const allRouteFiles = listRouteFiles(ADMIN_ROUTES_DIR);
  const postRouteFiles = allRouteFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return hasPostHandler(source);
  });

  it("found at least one admin POST route to audit (sanity)", () => {
    expect(postRouteFiles.length).toBeGreaterThan(0);
  });

  for (const file of postRouteFiles) {
    const rel = relative(process.cwd(), file);
    const source = readFileSync(file, "utf8");

    it(`${rel} enforces CSRF (assertSameOrigin / withAdminAuth / withRole)`, () => {
      expect(
        hasCsrfDefense(source),
        `Missing CSRF defense in ${rel}. Either import { assertSameOrigin } from "@/lib/csrf", or use withAdminAuth / withRole.`,
      ).toBe(true);
    });

    it(`${rel} enforces rate limit (checkLimit / withRole)`, () => {
      const exemption = RATE_LIMIT_EXEMPTIONS[rel];
      if (exemption) {
        // Sanity guard: an exempted file should NOT also have the import,
        // otherwise the exemption is stale and should be removed. Keeps the
        // exemption list honest as the codebase evolves.
        expect(
          hasRateLimit(source),
          `Stale rate-limit exemption for ${rel}: the import is now present, remove the entry from RATE_LIMIT_EXEMPTIONS. Reason on file: ${exemption}`,
        ).toBe(false);
        return;
      }
      expect(
        hasRateLimit(source),
        `Missing rate-limit guard in ${rel}. Import { adminActionLimiter, checkLimit } from "@/lib/ratelimit" (or use withRole, which enforces it internally).`,
      ).toBe(true);
    });
  }
});
