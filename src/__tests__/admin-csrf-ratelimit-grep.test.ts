import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * audit-2026-05-07 P200 — CI grep gate enforcing CSRF + admin rate-limit
 * coverage on every mutating handler under `src/app/api/admin/`.
 *
 * Why a grep test instead of a CI bash script: this runs on every developer's
 * `npm run test` invocation alongside the rest of the unit suite, so a missing
 * defense fails locally before push (not only in CI). It also reuses the
 * existing vitest infra (no new GitHub Actions step to maintain) and the
 * failure message points the dev directly at the offending route file.
 *
 * Review-fix iteration (v0.22.24.1 — addresses C1/C2/C3 findings):
 *
 *   - C1: the @/lib/auth import used to satisfy BOTH CSRF AND rate-limit
 *     because `withRole` was incorrectly assumed to enforce a limiter. It
 *     does NOT (see src/lib/auth.ts). The rate-limit heuristic now ignores
 *     @/lib/auth entirely; only an explicit `checkLimit(...)` invocation
 *     counts. CSRF-via-@/lib/auth (withRole) remains acceptable because
 *     withRole DOES run assertSameOrigin on mutating verbs.
 *   - C2: a route can `import { assertSameOrigin } from "@/lib/csrf"` and
 *     never invoke it, and the gate used to pass. The CSRF heuristic now
 *     requires the actual call `assertSameOrigin(`. Same for the rate-limit
 *     heuristic — it now requires `checkLimit(` not just the import.
 *     Wrapper acceptance still works, but only when the wrapper is actually
 *     applied to an exported mutating handler in this file (the
 *     `wrapperApplied` regex catches `export const POST = withAdminAuth(`,
 *     `export const POST = withRole(`, `withRole<...>("admin")(`, etc.).
 *   - C3: the gate previously matched only POST. DELETE/PUT/PATCH handlers
 *     were uncovered. `hasMutatingHandler` now matches all four mutating
 *     verbs, and the wrapper-applied regex matches them too.
 *
 * Coverage rules (post-fix):
 *   1. CSRF: every mutating handler (POST/PUT/PATCH/DELETE) must enforce
 *      same-origin. Acceptable patterns:
 *        a. Direct invocation: `assertSameOrigin(` somewhere in source
 *           AND an import from `@/lib/csrf`.
 *        b. Mutating handler wrapped via `withAdminAuth` (which calls
 *           assertSameOrigin internally) — wrapper must be applied to an
 *           exported mutating handler in this file.
 *        c. Mutating handler wrapped via `withRole`     (ditto)
 *   2. Rate limit: every mutating handler must consume an Upstash bucket.
 *      Acceptable patterns:
 *        a. Direct `checkLimit(` call AND an import from `@/lib/ratelimit`.
 *      Wrappers do NOT count here — neither withAdminAuth nor withRole
 *      runs a rate-limit check today. A future wrapper that wraps a
 *      verified limiter could be added to `RATE_LIMIT_WRAPPERS` below.
 *
 * Carve-out note (v0.22.24.2): /api/admin/notify-submission is the ONLY
 * admin/ route that is NOT admin-role-gated. It lives under /api/admin/
 * for historical reasons but enforces auth via .eq("user_id", user.id)
 * on the strategy lookup, and uses userActionLimiter (not
 * adminActionLimiter) with a `notify-submission:<uid>` bucket key. The
 * CSRF + rate-limit invocation checks below still apply normally; only
 * the choice of limiter differs from its admin-gated siblings.
 */

const ADMIN_ROUTES_DIR = join(__dirname, "..", "app", "api", "admin");

/**
 * Routes the rate-limit gate intentionally does not cover yet. Each entry
 * MUST cite the audit FIX-LIST P-number that owns the follow-up. The CSRF
 * gate has no exemptions — every admin mutating handler must enforce
 * same-origin.
 */
const RATE_LIMIT_EXEMPTIONS: Record<string, string> = {
  // audit-2026-05-07 PR-2 (2026-05-28): all four prior exemptions closed
  // in one batch — for-quants-leads/process (via withAdminAuth opt-in),
  // match/decisions (POST + DELETE), match/kill-switch (POST),
  // match/preferences/[allocator_id] (PUT). Each route now binds
  // adminActionLimiter with a per-surface key prefix. If a future refactor
  // strips a checkLimit out, this test will catch it.
  //
  // Historical closures:
  //   - send-intro: rate-limit added in audit-2026-05-07 cluster-E
  //     fix-loop (v0.22.40.37).
  //   - deletion-requests/approve: cluster-K C-0032 (2026-05-17).
  //   - deletion-requests/reject: red-team-HIGH symmetry sweep (2026-05-17).
};

/**
 * Wrappers that satisfy the CSRF heuristic when actually applied to an
 * exported mutating handler in the route file. Both run
 * `assertSameOrigin` internally on mutating verbs (POST/PUT/PATCH/DELETE).
 *
 * Source of truth:
 *   - withAdminAuth: src/lib/api/withAdminAuth.ts (unconditional)
 *   - withRole:      src/lib/auth.ts (skips GET/HEAD/OPTIONS only)
 */
const CSRF_WRAPPERS = ["withAdminAuth", "withRole"];

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

const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const MUTATING_VERB_RE = MUTATING_VERBS.join("|");

function hasMutatingHandler(source: string): boolean {
  // Either `export async function <VERB>(` or `export const <VERB> = ...`.
  const fn = new RegExp(
    `export\\s+async\\s+function\\s+(${MUTATING_VERB_RE})\\s*\\(`,
  );
  const constForm = new RegExp(
    `export\\s+const\\s+(${MUTATING_VERB_RE})\\s*=`,
  );
  return fn.test(source) || constForm.test(source);
}

/**
 * Return true if any of the listed wrappers is actually APPLIED (not just
 * imported) to an exported mutating handler in this file. The C2 finding
 * was that the prior gate accepted an unused import as proof of defense.
 *
 * Matches:
 *   - `export const POST = withAdminAuth(...)`
 *   - `export const PUT  = withRole("admin")(...)`
 *   - `export const POST = withRole<{ id: string }>("admin")(...)` (generic)
 */
function wrapperAppliedToMutatingHandler(
  source: string,
  wrappers: string[],
): boolean {
  for (const wrapper of wrappers) {
    const re = new RegExp(
      `export\\s+const\\s+(${MUTATING_VERB_RE})\\s*=\\s*${wrapper}\\b`,
    );
    if (re.test(source)) return true;
  }
  return false;
}

function hasCsrfDefense(source: string): boolean {
  // Direct invocation: must have BOTH the import AND a call site, not just
  // a dangling import (C2). We tolerate single or double quoted imports.
  const importsCsrf =
    source.includes('from "@/lib/csrf"') ||
    source.includes("from '@/lib/csrf'");
  const callsAssertSameOrigin = /\bassertSameOrigin\s*\(/.test(source);
  if (importsCsrf && callsAssertSameOrigin) return true;

  // Wrapper acceptance: withAdminAuth / withRole both run assertSameOrigin
  // internally on mutating verbs, but ONLY if actually applied here.
  return wrapperAppliedToMutatingHandler(source, CSRF_WRAPPERS);
}

function hasRateLimit(source: string): boolean {
  // PR-2 2026-05-28: withAdminAuth now accepts a `rateLimitKey` option
  // (src/lib/api/withAdminAuth.ts) that plumbs through to checkLimit in
  // the wrapper. A route file that opts in via `{ rateLimitKey: ... }`
  // gets the same per-admin rate limit as routes that call checkLimit
  // directly — both shapes are accepted defenses.
  const importsRateLimit =
    source.includes('from "@/lib/ratelimit"') ||
    source.includes("from '@/lib/ratelimit'");
  const callsCheckLimit = /\bcheckLimit\s*\(/.test(source);
  if (importsRateLimit && callsCheckLimit) return true;

  // Wrapper opt-in via withAdminAuth({ rateLimitKey: ... }). Require the
  // wrapper IS applied (not just imported), and the rateLimitKey option
  // is passed in the SAME export const that applies the wrapper. A
  // dangling import or a separate options object should NOT count.
  const wrapperWithOpt = /export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=\s*withAdminAuth\([\s\S]*?rateLimitKey\s*:/;
  return wrapperWithOpt.test(source);
}

describe("audit-2026-05-07 P200 — admin mutating routes must enforce CSRF + rate limit", () => {
  const allRouteFiles = listRouteFiles(ADMIN_ROUTES_DIR);
  const mutatingRouteFiles = allRouteFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return hasMutatingHandler(source);
  });

  it("found at least one admin mutating route to audit (sanity)", () => {
    expect(mutatingRouteFiles.length).toBeGreaterThan(0);
  });

  for (const file of mutatingRouteFiles) {
    const rel = relative(process.cwd(), file);
    const source = readFileSync(file, "utf8");

    it(`${rel} enforces CSRF (assertSameOrigin invocation / withAdminAuth / withRole)`, () => {
      expect(
        hasCsrfDefense(source),
        `Missing CSRF defense in ${rel}. Either call assertSameOrigin() from "@/lib/csrf" inside the handler, or wrap an exported mutating handler with withAdminAuth / withRole.`,
      ).toBe(true);
    });

    it(`${rel} enforces rate limit (checkLimit invocation)`, () => {
      const exemption = RATE_LIMIT_EXEMPTIONS[rel];
      if (exemption) {
        // Sanity guard: an exempted file should NOT also pass the gate,
        // otherwise the exemption is stale and should be removed. Keeps
        // the exemption list honest as the codebase evolves.
        expect(
          hasRateLimit(source),
          `Stale rate-limit exemption for ${rel}: checkLimit() is now invoked, remove the entry from RATE_LIMIT_EXEMPTIONS. Reason on file: ${exemption}`,
        ).toBe(false);
        return;
      }
      expect(
        hasRateLimit(source),
        `Missing rate-limit guard in ${rel}. Import { adminActionLimiter, checkLimit } from "@/lib/ratelimit" and call checkLimit() against an authenticated identity.`,
      ).toBe(true);
    });
  }
});
