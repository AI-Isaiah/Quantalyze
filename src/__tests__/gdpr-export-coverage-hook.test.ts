/**
 * Coverage-hook regression test — Sprint 6 closeout Task 7.3.
 *
 * Invokes `scripts/check-gdpr-export-coverage.ts` as a subprocess to
 * assert:
 *   1. The hook exits 0 against the current checked-in manifest (the
 *      manifest is always meant to be complete — if this test fails
 *      the CI itself will also fail, but surfacing the failure in
 *      Vitest makes the fix loop local + fast).
 *   2. The hook exits 1 with a specific error message when a table is
 *      removed from the manifest.
 *
 * The subprocess runs with a temp-dir HOME so it cannot write outside
 * the scratch space. stdout and stderr are captured for the assertion.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  cpSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractUserTablesFromMigration } from "../../scripts/check-gdpr-export-coverage";

const REPO_ROOT = process.cwd();
const HOOK_SCRIPT = join(REPO_ROOT, "scripts", "check-gdpr-export-coverage.ts");
const MANIFEST_REL = join("src", "lib", "gdpr-export.ts");
const MANIFEST_ABS = join(REPO_ROOT, MANIFEST_REL);
const MIGRATIONS_REL = join("supabase", "migrations");

describe("scripts/check-gdpr-export-coverage.ts", () => {
  it("exits 0 against the current checked-in manifest", () => {
    const result = spawnSync("npx", ["tsx", HOOK_SCRIPT], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    if (result.status !== 0) {
      console.error("Hook stdout:", result.stdout);
      console.error("Hook stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("manifest covers all");
  }, 30_000);

  it("H-0455/H-0457: exits 1 when a manifest entry has no matching sanitize_user policy", () => {
    // Add a brand-new manifest entry whose name does NOT appear in
    // the sanitize_user matrix or DELETE/UPDATE body — and is NOT in
    // SANITIZE_PARITY_ALLOWLIST. The parity check should fail loud.
    const scratch = mkdtempSync(join(tmpdir(), "gdpr-parity-test-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });

    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-gdpr-export-coverage.ts"));
    cpSync(
      join(REPO_ROOT, MIGRATIONS_REL),
      join(scratch, MIGRATIONS_REL),
      { recursive: true },
    );

    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    // Inject a synthetic manifest entry whose table name is "xxx_orphan_table".
    // The sanitize_user matrix has no row for it AND the regex won't
    // find a DELETE FROM xxx_orphan_table or UPDATE xxx_orphan_table.
    // The migration-coverage check should NOT fail (there's no migration
    // declaring xxx_orphan_table either), but the parity check MUST fail.
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      `{ kind: "direct", table: "user_notes", user_column: "user_id" },
  { kind: "direct", table: "xxx_orphan_table", user_column: "user_id" },`,
    );
    expect(mutated).not.toBe(originalManifest);
    writeFileSync(join(scratch, MANIFEST_REL), mutated);

    const result = spawnSync("npx", ["tsx", "scripts/check-gdpr-export-coverage.ts"], {
      encoding: "utf8",
      cwd: scratch,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("H-0455/H-0457");
    expect(result.stderr).toContain("xxx_orphan_table");
  }, 30_000);

  it("red-team #9: exits 1 when a projected entry's source_table is no longer in the sanitize matrix", () => {
    // Audit 2026-05-07 red-team #9 (MED conf-8): the pre-fix parity
    // check happily skipped allowlisted projection names without
    // validating that their underlying source_table is still covered.
    // The new sub-check walks every projected entry where bundle-name
    // != source_table and asserts BOTH names are covered. A source-
    // table rename (audit_log → audit_events) without an allowlist
    // update would dangle the projection's provenance.
    //
    // Simulate this by injecting a synthetic projected entry whose
    // source_table doesn't exist anywhere — no matrix coverage, no
    // migration declaration, not in allowlist. The new check should
    // fail loud with a message naming the source_table.
    const scratch = mkdtempSync(join(tmpdir(), "gdpr-rt9-test-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });

    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-gdpr-export-coverage.ts"));
    cpSync(
      join(REPO_ROOT, MIGRATIONS_REL),
      join(scratch, MIGRATIONS_REL),
      { recursive: true },
    );

    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    // Inject a synthetic projected entry that names a non-existent
    // source_table. The bundle name is also synthetic (so it's not in
    // any sanitize matrix), but the bundle-name failure mode is
    // already exercised by the H-0455/H-0457 test above — the unique
    // payload here is the SOURCE_TABLE failure.
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      `{ kind: "direct", table: "user_notes", user_column: "user_id" },
  {
    kind: "projected",
    table: "xxx_synthetic_projection",
    source_table: "xxx_renamed_source",
    user_column: "user_id",
    project: redactAuditLogForUser,
  },`,
    );
    expect(mutated).not.toBe(originalManifest);
    writeFileSync(join(scratch, MANIFEST_REL), mutated);

    const result = spawnSync(
      "npx",
      ["tsx", "scripts/check-gdpr-export-coverage.ts"],
      { encoding: "utf8", cwd: scratch },
    );
    expect(result.status).toBe(1);
    // Either the H-0455/H-0457 check OR the red-team #9 sub-check
    // surfaces this. The injected entry's source_table is missing
    // from every matrix; both checks ought to point at it.
    expect(result.stderr).toMatch(/xxx_renamed_source|xxx_synthetic_projection/);
  }, 30_000);

  it("red-team #9: exits 1 when SANITIZE_PARITY_ALLOWLIST has a stale entry", () => {
    // The allowlist documents WHY a manifest entry is intentionally
    // out of the sanitize matrix. If a future PR removes the manifest
    // entry but forgets the allowlist, the allowlist becomes a
    // dangling provenance comment. The new check surfaces this by
    // comparing every allowlist key against the manifest's
    // table/source_table/parent_table union and failing loud on any
    // miss.
    const scratch = mkdtempSync(join(tmpdir(), "gdpr-rt9-stale-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });

    const originalHook = readFileSync(HOOK_SCRIPT, "utf8");
    // Add a stale allowlist entry pointing at a non-existent table.
    // The manifest is untouched, so the new check fails with a
    // "stale allowlist entry" message.
    const mutatedHook = originalHook.replace(
      /const SANITIZE_PARITY_ALLOWLIST:[^=]*=\s*\{/,
      (m) =>
        `${m}\n  xxx_stale_dangling_entry: { reason: "test-injection", addedIn: "test" },`,
    );
    expect(mutatedHook).not.toBe(originalHook);
    writeFileSync(
      join(scratch, "scripts", "check-gdpr-export-coverage.ts"),
      mutatedHook,
    );
    cpSync(
      join(REPO_ROOT, MIGRATIONS_REL),
      join(scratch, MIGRATIONS_REL),
      { recursive: true },
    );
    cpSync(MANIFEST_ABS, join(scratch, MANIFEST_REL));

    const result = spawnSync(
      "npx",
      ["tsx", "scripts/check-gdpr-export-coverage.ts"],
      { encoding: "utf8", cwd: scratch },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("stale entry");
    expect(result.stderr).toContain("xxx_stale_dangling_entry");
  }, 30_000);

  it("H-0014: scans ALL migrations — a NEW migration adding a user-owned table absent from the manifest fails the hook", () => {
    // H-0014: the single negative test below only removes `user_notes`
    // from the manifest. That proves the hook reacts to ONE known
    // table, but not that its CREATE-TABLE scan actually visits every
    // migration file. This test proves the scan-breadth from the other
    // direction: add a BRAND-NEW migration declaring a user-owned table
    // (user_id UUID REFERENCES auth.users) that the manifest does NOT
    // list, leave the manifest untouched, and assert the hook discovers
    // the gap and names the new table. A regression that scanned only a
    // subset of migrations (e.g. globbed the wrong dir, or stopped at
    // the first file) would let this slip through with exit 0.
    const scratch = mkdtempSync(join(tmpdir(), "gdpr-hook-scan-all-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });

    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-gdpr-export-coverage.ts"));
    cpSync(
      join(REPO_ROOT, MIGRATIONS_REL),
      join(scratch, MIGRATIONS_REL),
      { recursive: true },
    );
    // Manifest copied VERBATIM — the gap is on the migration side.
    cpSync(MANIFEST_ABS, join(scratch, MANIFEST_REL));

    // A late-timestamp filename so it sorts after the real migrations;
    // the table name is unique so it cannot collide with any manifest
    // or EXCLUDED_TABLES entry. The user_id FK to auth.users is exactly
    // the codebase convention the scanner keys on.
    const newMigrationName = "29990101000000_zzz_orphan_user_table.sql";
    writeFileSync(
      join(scratch, MIGRATIONS_REL, newMigrationName),
      [
        "CREATE TABLE IF NOT EXISTS public.zzz_orphan_user_table (",
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,",
        "  note TEXT",
        ");",
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      "npx",
      ["tsx", "scripts/check-gdpr-export-coverage.ts"],
      { encoding: "utf8", cwd: scratch },
    );

    expect(result.status).toBe(1);
    // The hook must name the offending table AND the migration it was
    // declared in — proving it actually read that migration file.
    expect(result.stderr).toContain("zzz_orphan_user_table");
    expect(result.stderr).toContain(newMigrationName);
  }, 30_000);

  it("exits 1 with a specific error when a user-owned table is missing", () => {
    // Copy the script + manifest + migrations into a scratch dir so we
    // can mutate the manifest without polluting the working tree.
    const scratch = mkdtempSync(join(tmpdir(), "gdpr-hook-test-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });

    // Copy the hook
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-gdpr-export-coverage.ts"));
    // Copy migrations
    cpSync(
      join(REPO_ROOT, MIGRATIONS_REL),
      join(scratch, MIGRATIONS_REL),
      { recursive: true },
    );

    // Copy manifest, then mutate: delete the 'user_notes' entry so the
    // hook should report it as missing.
    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      "// (user_notes removed by coverage-hook test)",
    );
    // Sanity-check that the mutation actually fired
    expect(mutated).not.toBe(originalManifest);
    writeFileSync(join(scratch, MANIFEST_REL), mutated);

    const result = spawnSync("npx", ["tsx", "scripts/check-gdpr-export-coverage.ts"], {
      encoding: "utf8",
      cwd: scratch,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("user_notes");
    expect(result.stderr).toContain("20260412094453_user_notes.sql");
  }, 30_000);

  // M-0009 — same negative scenario as above, but the migration filename is
  // DERIVED at runtime rather than hardcoded. The hardcoded
  // "20260412094453_user_notes.sql" assertion encodes WHICH migration, not the
  // behavior under test (Rule 9): if user_notes is ever squashed/renamed into
  // a consolidation migration, the hardcoded test fails for the WRONG reason
  // (a stale filename string) while the hook is still correct. This case
  // asserts the invariant: the hook names whatever migration ACTUALLY declares
  // user_notes as a user-owned table — computed by scanning the migrations dir
  // for the CREATE TABLE statement — so it survives a future rename.
  it("M-0009: hook reports the migration that ACTUALLY declares user_notes (filename derived, not hardcoded)", () => {
    // Find the migration whose body CREATEs the user_notes table. This mirrors
    // the hook's own discovery logic from the test's side, so a rename moves
    // both in lockstep.
    const migDir = join(REPO_ROOT, MIGRATIONS_REL);
    const createUserNotesRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?user_notes\b/i;
    const declaringMigrations = readdirSync(migDir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => createUserNotesRe.test(readFileSync(join(migDir, f), "utf8")));
    // Exactly one migration should declare the table; if zero, the WHY of this
    // test (and the hardcoded sibling) is moot and we want a loud failure.
    expect(declaringMigrations.length).toBeGreaterThanOrEqual(1);
    const declaringMigration = declaringMigrations[0];

    const scratch = mkdtempSync(join(tmpdir(), "gdpr-hook-derived-"));
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    mkdirSync(join(scratch, "src", "lib"), { recursive: true });
    mkdirSync(join(scratch, "supabase"), { recursive: true });
    cpSync(HOOK_SCRIPT, join(scratch, "scripts", "check-gdpr-export-coverage.ts"));
    cpSync(join(REPO_ROOT, MIGRATIONS_REL), join(scratch, MIGRATIONS_REL), {
      recursive: true,
    });

    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      "// (user_notes removed by M-0009 coverage-hook test)",
    );
    expect(mutated).not.toBe(originalManifest);
    writeFileSync(join(scratch, MANIFEST_REL), mutated);

    const result = spawnSync(
      "npx",
      ["tsx", "scripts/check-gdpr-export-coverage.ts"],
      { encoding: "utf8", cwd: scratch },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("user_notes");
    // The hook must point at the migration that ACTUALLY declares the table —
    // whatever its filename is today.
    expect(result.stderr).toContain(declaringMigration);
  }, 30_000);

  // H-1019 — CREATE TABLE body parser over/under-match bugs. These drive
  // the exported pure helper `extractUserTablesFromMigration` directly
  // (the colocated scripts/check-gdpr-export-coverage.test.ts is NOT in
  // the vitest `include` globs, so its tests never run in CI — these
  // live here, in a collected file, instead). Both assert CORRECT
  // behaviour; both currently FAIL against the buggy regex, so they are
  // `it.fails` SURFACE markers pending a production-code fix.

  it(
    "H-1019: a table whose ONLY `user_id ... REFERENCES auth.users` text is in a SQL COMMENT must NOT be flagged user-owned",
    () => {
      // `userColumnRe.test(body)` runs against the ENTIRE CREATE TABLE
      // body as a single string, so a `-- comment` line that copies a
      // reference phrase (e.g. documenting a sibling table's FK) makes
      // the regex match even though the table has no real user column.
      // Effect: a sister table with no user FK is falsely demanded in
      // USER_EXPORT_TABLES (a phantom coverage gap), and the parser's
      // signal is no longer trustworthy. CORRECT: comment text must not
      // count — this table has no real user-id column.
      const sql = [
        "CREATE TABLE sister_table (",
        "  id UUID PRIMARY KEY,",
        "  -- mirrors the user_id UUID REFERENCES auth.users(id) column on the parent",
        "  parent_ref UUID NOT NULL REFERENCES other_table(id)",
        ");",
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(sql, "20260601_comment.sql");
      expect(out.has("sister_table")).toBe(false);
    },
  );

  it(
    "H-1019 (also-flagged security): a user_id FK added via ALTER TABLE ADD COLUMN must be discovered",
    () => {
      // The scan only inspects CREATE TABLE bodies. A migration that
      // turns an existing table into user-owned data via
      // `ALTER TABLE ... ADD COLUMN user_id UUID REFERENCES auth.users`
      // is invisible to it — so the GDPR manifest gap goes undetected
      // and the Art. 15 export silently omits the table's rows. CORRECT:
      // the late-added user column makes `late_added` user-owned and the
      // scan must surface it.
      const sql = [
        "CREATE TABLE late_added (",
        "  id UUID PRIMARY KEY",
        ");",
        "ALTER TABLE late_added ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);",
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(sql, "20260602_alter.sql");
      expect(out.has("late_added")).toBe(true);
    },
  );

  // H-1020 — double-quoted-identifier escape vector. The CREATE/ALTER
  // table-name regexes matched only a bare `([a-z0-9_]+)`, which does
  // NOT match a DOUBLE-QUOTED identifier. A quoted table therefore
  // escaped the user-FK scan → omitted from required GDPR-export
  // coverage → a potential user-data leak. Both paths (CREATE and the
  // H-1019 ALTER ... ADD COLUMN) are affected. These drive the exported
  // pure helper directly and assert the quoted table is now DETECTED as
  // user-owned. They FAIL against the pre-fix bare-identifier regex.

  it(
    "H-1020: a CREATE TABLE with a DOUBLE-QUOTED identifier whose body has a user_id FK must be discovered",
    () => {
      // `CREATE TABLE "quoted_user_tbl" (...)` is valid DDL. The bare
      // `([a-z0-9_]+)` table-name capture could not match the quoted
      // form, so the table silently dodged the coverage gate. CORRECT:
      // the quoted table has a real user_id FK to auth.users and must be
      // flagged (keyed unquoted, lowercase, to match the rest of the
      // script).
      const sql = [
        'CREATE TABLE "quoted_user_tbl" (',
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,",
        "  note TEXT",
        ");",
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(sql, "20260603_quoted_create.sql");
      // Keyed by the UNQUOTED name (no embedded quote chars).
      expect(out.has("quoted_user_tbl")).toBe(true);
    },
  );

  it(
    "H-1020: a user_id FK added via ALTER TABLE on a DOUBLE-QUOTED identifier must be discovered",
    () => {
      // Same escape vector on the H-1019 ALTER ... ADD COLUMN path:
      // `ALTER TABLE "quoted_late" ADD COLUMN user_id UUID REFERENCES
      // auth.users(id)`. The bare table-name capture missed the quoted
      // form, so a late-added user column on a quoted table escaped the
      // gate. CORRECT: the table is now flagged user-owned, keyed
      // unquoted.
      const sql = [
        'CREATE TABLE "quoted_late" (',
        "  id UUID PRIMARY KEY",
        ");",
        'ALTER TABLE "quoted_late" ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);',
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(sql, "20260604_quoted_alter.sql");
      expect(out.has("quoted_late")).toBe(true);
    },
  );

  it(
    "H-1020: UNquoted-identifier behavior is unchanged after the group-index shift",
    () => {
      // Guard against the capture-index shift (group 1 → group 2 for the
      // bare name; body/columnSpec shifted to group 3) regressing the
      // common UNquoted path. Both a bare CREATE and a bare ALTER must
      // still be detected exactly as before.
      const createSql = [
        "CREATE TABLE bare_create_tbl (",
        "  id UUID PRIMARY KEY,",
        "  user_id UUID NOT NULL REFERENCES auth.users(id)",
        ");",
        "",
      ].join("\n");
      const createOut = extractUserTablesFromMigration(
        createSql,
        "20260605_bare_create.sql",
      );
      expect(createOut.has("bare_create_tbl")).toBe(true);

      const alterSql = [
        "CREATE TABLE bare_alter_tbl (",
        "  id UUID PRIMARY KEY",
        ");",
        "ALTER TABLE bare_alter_tbl ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);",
        "",
      ].join("\n");
      const alterOut = extractUserTablesFromMigration(
        alterSql,
        "20260606_bare_alter.sql",
      );
      expect(alterOut.has("bare_alter_tbl")).toBe(true);
    },
  );
});
