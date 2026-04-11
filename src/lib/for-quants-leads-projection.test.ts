/**
 * Static scan test — enforces that `for_quants_leads` is only accessed
 * via the service-role client. Companion to the SEC-005 test in
 * `sec-005-api-keys-projection.test.ts`.
 *
 * Migration 030 creates `for_quants_leads` with RLS enabled and no
 * policies, AND explicitly REVOKEs all table-level privileges from `anon`
 * and `authenticated`. The only intended writer/reader is the service-role
 * client called from `src/app/api/for-quants-lead/route.ts`.
 *
 * If any future call site uses the user-scoped Supabase client
 * (`createClient()` from `@/lib/supabase/client` or `@/lib/supabase/server`)
 * to touch this table, RLS will silently block the query and the caller
 * will get an empty result — a silent failure that TypeScript cannot
 * catch. This test fails CI the moment someone tries.
 *
 * Allowed call sites:
 *   - `src/app/api/for-quants-lead/route.ts` (service-role insert only)
 *   - Future `/api/admin/*` routes using `createAdminClient()`
 *   - Any file under `analytics-service/**` (Python, service role)
 *
 * Not allowed:
 *   - Any `.from("for_quants_leads")` call in a file that ALSO imports
 *     `createClient` from `@/lib/supabase/client` or `@/lib/supabase/server`.
 *
 * Test implementation: scan src/** for `.from("for_quants_leads")` and
 * assert that every file containing it also imports `createAdminClient`
 * (and NOT the user-scoped `createClient`).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, resolve } from "path";

const SRC_ROOT = resolve(__dirname, "..");

function walk(dir: string, seen: Set<string> = new Set()): string[] {
  // Cycle guard via canonical path — mirrors sec-005-api-keys-projection.test.ts.
  const canonical = (() => {
    try {
      return realpathSync(dir);
    } catch {
      return dir;
    }
  })();
  if (seen.has(canonical)) return [];
  seen.add(canonical);

  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === ".next" ||
      entry === "dist" ||
      entry.endsWith(".test.ts") ||
      entry.endsWith(".test.tsx")
    ) {
      continue;
    }
    const full = join(dir, entry);
    const s = (() => {
      try {
        return lstatSync(full);
      } catch {
        return null;
      }
    })();
    if (!s) continue;
    if (s.isDirectory() || s.isSymbolicLink()) {
      out.push(...walk(full, seen));
    } else if (
      entry.endsWith(".ts") ||
      entry.endsWith(".tsx") ||
      entry.endsWith(".js") ||
      entry.endsWith(".jsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

// Stateless — `.test()` without /g is stable across calls, no lastIndex bookkeeping.
const FROM_TABLE = /\.from\s*\(\s*["'`]for_quants_leads["'`]\s*\)/;
const IMPORTS_USER_CLIENT =
  /from\s+["']@\/lib\/supabase\/(client|server)["']/;
const IMPORTS_ADMIN_CLIENT = /from\s+["']@\/lib\/supabase\/admin["']/;

describe("Migration 030: for_quants_leads access discipline", () => {
  it("every .from(\"for_quants_leads\") call site imports the admin client and not the user-scoped client", () => {
    const files = walk(SRC_ROOT);
    const offenders: Array<{ file: string; reason: string }> = [];
    const callSites: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (!FROM_TABLE.test(content)) continue;

      const relPath = file.replace(SRC_ROOT + "/", "src/");
      callSites.push(relPath);

      if (IMPORTS_USER_CLIENT.test(content)) {
        offenders.push({
          file: relPath,
          reason:
            "imports user-scoped createClient — for_quants_leads is service-role only",
        });
      }
      if (!IMPORTS_ADMIN_CLIENT.test(content)) {
        offenders.push({
          file: relPath,
          reason:
            "does not import createAdminClient — for_quants_leads requires service-role access",
        });
      }
    }

    // Positive assertion — if no call site exists, the test is useless as a
    // regression gate. Either someone removed the only writer, or the walker
    // is broken. Either case wants a loud failure.
    expect(
      callSites.length,
      "expected at least one call site touching for_quants_leads",
    ).toBeGreaterThan(0);

    if (offenders.length > 0) {
      const lines = offenders.map((o) => `  - ${o.file}: ${o.reason}`).join("\n");
      throw new Error(
        `Migration 030 violation: ${offenders.length} file(s) touch ` +
          `for_quants_leads unsafely. RLS + missing policies will silently ` +
          `block user-scoped reads.\n\nOffenders:\n${lines}`,
      );
    }

    expect(offenders.length).toBe(0);
  });
});
