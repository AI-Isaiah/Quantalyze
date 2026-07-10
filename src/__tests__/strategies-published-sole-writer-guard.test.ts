import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Phase 87 PUB-01 / W-1 — SC-1 "sole published writer" source-scan guard.
 *
 * INVARIANT (SC-1, "any status-advancing path"): the admin approve route
 * `src/app/api/admin/strategy-review/route.ts` is the ONLY code path — in TS
 * OR SQL — that WRITES `strategies.status = 'published'`. The publish decision
 * belongs to that one admin-gated handler (isAdminUser + assertSameOrigin +
 * adminActionLimiter). A NEW second writer added anywhere (Phase 88's wizard,
 * a future cron, or stray migration SQL) would bypass the publish gate and
 * silently publish a strategy without the all-N-members-complete check. This
 * guard makes that invariant a falsifiable, repo-native regression that runs on
 * every `npm run test` — a second writer reddens it BEFORE it can land.
 *
 * Why a source-scan (mirrors src/__tests__/admin-csrf-ratelimit-grep.test.ts,
 * plus the phase-32 / phase-63 frozen-invariant guards): it runs in the normal
 * unit suite (fails locally before push), needs no new CI step, and the failure
 * message points the dev at the offending file.
 *
 * ── HEURISTIC (deliberately broad on the 'published' literal + strategies-table
 *    proximity so it cannot be trivially evaded) ─────────────────────────────
 *
 * Scan A (TypeScript, src/**.ts[x]) — a file is an OFFENDER when it BOTH:
 *   (1) writes to the strategies table — `from("strategies")` AND a
 *       `.update(` / `.upsert(` call somewhere in the file; AND
 *   (2) carries a publish WRITE payload — `status: "published"` (object literal)
 *       or `status = "published"` (a status variable assigned "published",
 *       route.ts's ternary-var shape). The `(?<![A-Za-z0-9_])` lookbehind
 *       excludes `new_status: "published"` (audit metadata, a different key).
 *   The ONLY allow-listed file is the admin approve route.
 *
 *   Carve-outs (documented, zero false positives on the current tree):
 *   • READ filters `.eq("status", "published")` use the comma-quoted form —
 *     they do NOT match the colon/equals object-literal write shape above, so
 *     RLS-style status reads are never flagged.
 *   • Test files (*.test.ts[x], anything under __tests__/ or test-helpers/) are
 *     EXCLUDED: they seed fixture rows directly into the TEST database (e.g.
 *     `from("strategies").upsert({ status: "published" })` in the RLS suites),
 *     which is DBA-style test setup, not a production publish-path writer. The
 *     invariant confines the PRODUCTION status transition; a synthetic second
 *     PRODUCTION (non-test) writer still reddens this guard (proven below).
 *
 * Scan B (SQL, supabase/migrations/**.sql incl. down/) — flag any
 *   `UPDATE [public.]strategies SET ... status = 'published'` (or a PL/pgSQL
 *   `status := 'published'` assignment). The SET-list is extracted up to the
 *   first WHERE / RETURNING / `;`, so a `WHERE status = 'published'` predicate
 *   on an UPDATE of OTHER columns is NOT a publish write. Line comments are
 *   stripped first, and RLS/policy READ predicates (USING / WITH CHECK /
 *   CREATE POLICY ... status = 'published', bare WHERE reads) are never inside
 *   an `UPDATE strategies SET` list — so they are not flagged. Expected hits on
 *   the current tree: ZERO.
 *
 * Secondary assertion (belt-and-braces, pins Research A2/A4): the status-
 * advancing SQL paths finalize_wizard_strategy + process_key_long reach ONLY
 * `pending_review` — never `published`.
 *
 * ── FALSIFIABILITY (verified once in development, recorded in 87-03-SUMMARY) ──
 *   • TS: adding a throwaway NON-test file under src/ with
 *     `await sb.from("strategies").update({ status: "published" })` makes Scan A
 *     exit non-zero; removing it → green.
 *   • SQL: adding a throwaway migration with
 *     `UPDATE strategies SET status = 'published' WHERE id = x;` makes Scan B
 *     exit non-zero; removing it → green.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/** The ONE sanctioned production writer of strategies.status='published'. */
const ALLOWED_TS_WRITER = "src/app/api/admin/strategy-review/route.ts";

// --- shared regexes ---------------------------------------------------------
const STRATEGIES_TABLE_RE = /from\(\s*["']strategies["']\s*\)/;
const MUTATION_RE = /\.(update|upsert)\s*\(/;
// Object-literal `status: "published"` OR variable `status = "published"`. The
// lookbehind rejects `new_status: "published"` (a different key). Does NOT match
// `.eq("status", "published")` (quoted key + comma) — read filters are safe.
const PUBLISH_PAYLOAD_RE = /(?<![A-Za-z0-9_])status\s*[:=]\s*["']published["']/;

function isTestPath(rel: string): boolean {
  return (
    /\.test\.[tj]sx?$/.test(rel) ||
    rel.split(/[\\/]/).includes("__tests__") ||
    rel.includes("test-helpers")
  );
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** True when the SQL text WRITES strategies.status='published' (not a read). */
function sqlHasPublishWrite(sql: string): boolean {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const updateRe =
    /update\s+(?:public\.)?strategies\s+set\b([\s\S]*?)(?:\bwhere\b|\breturning\b|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = updateRe.exec(noComments)) !== null) {
    if (/\bstatus\s*(?::=|=)\s*'published'/i.test(m[1])) return true;
  }
  // Bare PL/pgSQL assignment (no UPDATE...SET form).
  if (/\bstatus\s*:=\s*'published'/i.test(noComments)) return true;
  return false;
}

function latestDefFile(fnName: string): string {
  const files = walk(MIGRATIONS_DIR, [".sql"])
    .filter((f) => !f.includes(`${join("migrations", "down")}`))
    .filter((f) => readFileSync(f, "utf8").includes(fnName))
    .sort();
  if (files.length === 0) {
    throw new Error(`no migration defines ${fnName}`);
  }
  return files[files.length - 1];
}

describe("Phase 87 PUB-01 / W-1 — strategies.status='published' sole-writer guard", () => {
  // ── Scan A: TypeScript ────────────────────────────────────────────────────
  const tsFiles = walk(SRC_DIR, [".ts", ".tsx"]).filter(
    (f) => !isTestPath(relative(REPO_ROOT, f)),
  );

  it("sanity: the allow-listed admin route IS detected by the heuristic (guard is live)", () => {
    const src = readFileSync(join(REPO_ROOT, ALLOWED_TS_WRITER), "utf8");
    expect(
      STRATEGIES_TABLE_RE.test(src) &&
        MUTATION_RE.test(src) &&
        PUBLISH_PAYLOAD_RE.test(src),
      "the admin approve route no longer matches the publish-write heuristic — the guard has gone blind; re-tune the regexes.",
    ).toBe(true);
  });

  it("TS: admin/strategy-review is the ONLY production strategies->published writer", () => {
    const offenders = tsFiles
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return (
          STRATEGIES_TABLE_RE.test(src) &&
          MUTATION_RE.test(src) &&
          PUBLISH_PAYLOAD_RE.test(src)
        );
      })
      .map((f) => relative(REPO_ROOT, f))
      .filter((rel) => rel !== ALLOWED_TS_WRITER);

    expect(
      offenders,
      `Unsanctioned strategies.status='published' writer(s): ${offenders.join(
        ", ",
      )}. The publish transition must live ONLY in ${ALLOWED_TS_WRITER} (admin-gated). If this is a legitimate new publish path, it must go through that route — not a second writer.`,
    ).toEqual([]);
  });

  // ── Scan B: SQL / migrations ──────────────────────────────────────────────
  const sqlFiles = walk(MIGRATIONS_DIR, [".sql"]);

  it("SQL: no migration WRITES strategies.status='published' (RLS reads are not flagged)", () => {
    const offenders = sqlFiles
      .filter((f) => sqlHasPublishWrite(readFileSync(f, "utf8")))
      .map((f) => relative(REPO_ROOT, f));
    expect(
      offenders,
      `Migration(s) WRITE strategies.status='published': ${offenders.join(
        ", ",
      )}. Only the admin approve route may advance a strategy to published; a SQL writer bypasses the publish gate.`,
    ).toEqual([]);
  });

  // ── Secondary (belt-and-braces): the status-advancing SQL RPCs reach only
  //    pending_review (Research A2/A4). ───────────────────────────────────────
  it("finalize_wizard_strategy advances to pending_review, never published", () => {
    const body = readFileSync(latestDefFile("finalize_wizard_strategy"), "utf8");
    expect(
      /\bstatus\s*=\s*'pending_review'/i.test(body),
      "finalize_wizard_strategy no longer writes status='pending_review' — verify the status-advance path.",
    ).toBe(true);
    expect(
      sqlHasPublishWrite(body),
      "finalize_wizard_strategy now WRITES status='published' — it must only reach pending_review.",
    ).toBe(false);
  });

  it("process_key_long never writes strategies.status='published'", () => {
    const body = readFileSync(latestDefFile("process_key_long"), "utf8");
    expect(
      sqlHasPublishWrite(body),
      "process_key_long now WRITES status='published' — it must never advance publish status.",
    ).toBe(false);
  });
});
