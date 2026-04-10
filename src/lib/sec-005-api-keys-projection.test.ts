/**
 * SEC-005 regression test — enforces the API_KEY_USER_COLUMNS allowlist.
 *
 * Migration 027 revokes SELECT on api_keys encrypted columns
 * (api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
 * dek_encrypted, nonce) from anon and authenticated roles. Any query that
 * projects `*` from `api_keys` via a user-scoped client will silently
 * return NULL for those columns, because PostgREST returns NULL for
 * columns the caller lacks SELECT on — not an error.
 *
 * This test scans the user-scoped Supabase call sites in src/** and fails
 * if any of them uses `.from("api_keys").select("*")`. Breaking the rule
 * would reintroduce the silent-NULL UI bug the migration is designed to
 * surface loudly.
 *
 * Allowed patterns:
 *   .from("api_keys").select(API_KEY_USER_COLUMNS)  // imports from constants
 *   .from("api_keys").select("id")                  // explicit single column
 *   .from("api_keys").select("exchange")            // any explicit column list
 *   .from("api_keys").insert({...})                 // writes never .select("*")
 *   .from("api_keys").delete()                      // writes never .select("*")
 *
 * Excluded from the scan:
 *   - analytics-service/**  (Python, service-role client, full access)
 *   - scripts/seed-full-app-demo.ts  (service-role client, bypasses RLS)
 *   - any .test.ts or .test.tsx file  (tests mock Supabase)
 *
 * If this test fails: find the offending call site, import
 * `API_KEY_USER_COLUMNS` from `@/lib/constants`, and project it instead of
 * `"*"`. See migration 027 for the full rationale.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, resolve } from "path";
import { API_KEY_USER_COLUMNS } from "./constants";

const SRC_ROOT = resolve(__dirname, "..");

function walk(dir: string, seen: Set<string> = new Set()): string[] {
  // Cycle guard via canonical path — handles symlink loops from monorepo
  // workspace links (e.g., pnpm, yarn workspaces) that would otherwise
  // infinite-loop the walker.
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
    // Skip node_modules, .next, dist, and test files
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
    // Use lstat so we can detect symlinks explicitly and still walk them
    // (via the canonical-path guard above) rather than silently following.
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

// Regex #1 — literal `.from("api_keys").select("*")`.
// Tolerates single, double, or backtick quotes, and whitespace/newlines
// between method-call parts (multi-line fluent chains). Uses `\s` which
// matches newlines, so no /s flag needed. `/g` flag lets the test
// surface every offender per file via matchAll instead of only the first.
const FORBIDDEN_WILDCARD = /\.from\s*\(\s*["'`]api_keys["'`]\s*\)\s*\.select\s*\(\s*["'`]\*["'`]\s*\)/g;

// Regex #2 — PostgREST embed syntax `.select("..., api_keys(*), ...")`.
// This form exposes encrypted columns via a join from another table
// (e.g., `supabase.from("strategies").select("*, api_keys(*)")`). Must
// also be banned because PostgREST applies the column grants to the
// embedded resource just like a direct projection.
const FORBIDDEN_EMBED = /\.select\s*\(\s*["'`][^"'`]*api_keys\s*\(\s*\*\s*\)[^"'`]*["'`]/g;

describe("SEC-005: api_keys column projection", () => {
  it("API_KEY_USER_COLUMNS constant is defined and excludes encrypted columns", () => {
    expect(API_KEY_USER_COLUMNS).toBeDefined();
    expect(typeof API_KEY_USER_COLUMNS).toBe("string");

    // Must NOT include any encrypted column
    expect(API_KEY_USER_COLUMNS).not.toContain("api_key_encrypted");
    expect(API_KEY_USER_COLUMNS).not.toContain("api_secret_encrypted");
    expect(API_KEY_USER_COLUMNS).not.toContain("passphrase_encrypted");
    expect(API_KEY_USER_COLUMNS).not.toContain("dek_encrypted");
    expect(API_KEY_USER_COLUMNS).not.toContain("nonce");

    // Must include the columns the app actually reads
    expect(API_KEY_USER_COLUMNS).toContain("id");
    expect(API_KEY_USER_COLUMNS).toContain("exchange");
    expect(API_KEY_USER_COLUMNS).toContain("label");
    expect(API_KEY_USER_COLUMNS).toContain("is_active");
  });

  it("no source file uses .from(\"api_keys\").select(\"*\") or api_keys(*) embed", () => {
    const files = walk(SRC_ROOT);
    const offenders: Array<{ file: string; snippet: string; kind: string }> = [];

    function collect(
      file: string,
      content: string,
      regex: RegExp,
      kind: string,
    ): void {
      for (const match of content.matchAll(regex)) {
        const idx = match.index ?? content.indexOf(match[0]);
        const line = content.slice(0, idx).split("\n").length;
        offenders.push({
          file: `${file.replace(SRC_ROOT + "/", "src/")}:${line}`,
          snippet: match[0].replace(/\s+/g, " "),
          kind,
        });
      }
    }

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      collect(file, content, FORBIDDEN_WILDCARD, "wildcard");
      collect(file, content, FORBIDDEN_EMBED, "embed");
    }

    if (offenders.length > 0) {
      const lines = offenders
        .map((o) => `  - [${o.kind}] ${o.file}: ${o.snippet}`)
        .join("\n");
      throw new Error(
        `SEC-005 violation: ${offenders.length} source file(s) project ` +
          `api_keys encrypted columns via wildcard or embed. After migration ` +
          `027 these will silently return NULL for the revoked columns and ` +
          `break the UI.\n` +
          `Fix: replace with .select(API_KEY_USER_COLUMNS) from ` +
          `@/lib/constants. For PostgREST embeds, project explicit columns ` +
          `instead of api_keys(*).\n\nOffenders:\n${lines}`,
      );
    }

    expect(offenders.length).toBe(0);
  });
});
