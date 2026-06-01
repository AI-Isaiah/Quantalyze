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
import {
  extractManifestEntries,
  extractManifestTables,
  extractUserTablesFromMigration,
} from "../../scripts/check-gdpr-export-coverage";
import { USER_EXPORT_TABLES } from "@/lib/gdpr-export-manifest";

const REPO_ROOT = process.cwd();
const HOOK_SCRIPT = join(REPO_ROOT, "scripts", "check-gdpr-export-coverage.ts");
// B13: USER_EXPORT_TABLES (and the redactors the hook's checks reference)
// live in the server-only-free manifest MODULE, which the hook imports as
// typed data. The mutation tests below therefore edit THIS file, not
// gdpr-export.ts.
const MANIFEST_REL = join("src", "lib", "gdpr-export-manifest.ts");
const MANIFEST_ABS = join(REPO_ROOT, MANIFEST_REL);
const SENTRY_CAPTURE_REL = join("src", "lib", "sentry-capture.ts");
const MIGRATIONS_REL = join("supabase", "migrations");

/**
 * Build a scratch sandbox the copied hook can run inside.
 *
 * B13: the hook `import`s `@/lib/gdpr-export-manifest` instead of
 * regex-scraping the manifest text, so the sandbox must contain the
 * manifest MODULE (verbatim or mutated), its self-contained
 * `sentry-capture` value dep, and a `tsconfig.json` that resolves the
 * `@/*` alias to the sandbox's own `src/` — otherwise `npx tsx` cannot
 * load the manifest and the subprocess fails for the wrong reason. The
 * `Database` import in the manifest is type-only and erased by tsx, so
 * `database.types.ts` is not needed. Migrations are read
 * script-relative, exactly as the live hook reads them.
 */
function setupScratchRepo(
  prefix: string,
  opts: { manifestModule?: string; hook?: string } = {},
): string {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  mkdirSync(join(scratch, "src", "lib"), { recursive: true });
  mkdirSync(join(scratch, MIGRATIONS_REL), { recursive: true });

  if (opts.hook !== undefined) {
    writeFileSync(
      join(scratch, "scripts", "check-gdpr-export-coverage.ts"),
      opts.hook,
    );
  } else {
    cpSync(
      HOOK_SCRIPT,
      join(scratch, "scripts", "check-gdpr-export-coverage.ts"),
    );
  }

  cpSync(join(REPO_ROOT, MIGRATIONS_REL), join(scratch, MIGRATIONS_REL), {
    recursive: true,
  });

  if (opts.manifestModule !== undefined) {
    writeFileSync(join(scratch, MANIFEST_REL), opts.manifestModule);
  } else {
    cpSync(MANIFEST_ABS, join(scratch, MANIFEST_REL));
  }
  cpSync(
    join(REPO_ROOT, SENTRY_CAPTURE_REL),
    join(scratch, SENTRY_CAPTURE_REL),
  );

  writeFileSync(
    join(scratch, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
        moduleResolution: "bundler",
        module: "esnext",
        target: "esnext",
      },
    }),
  );

  return scratch;
}

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

  it("B10 #8: exits 1 via the class guard when an EXCLUDED_TABLES entry has an unrecognised class", () => {
    // Excluding a table from the Art. 15 export must be an opt-in decision with
    // a CHECKED rationale class. The hook's `ExclusionClass` type makes a bad
    // class a tsc error, but `tsx` does NOT typecheck — so the RUNTIME guard in
    // runCoverageCheck() is the real CI gate (ci.yml runs the hook via `npx tsx`).
    //
    // We corrupt the class of cron_runs — an EXISTING, migration-declared entry
    // — rather than injecting a phantom key. A phantom key would ALSO trip the
    // independent staleExcludedKeys guard (no migration declares it), keeping
    // exit=1 even with the class check removed, so exit-1 wouldn't prove the
    // class guard fired. cron_runs IS declared, so the unrecognised-class guard
    // is the ONLY remaining failure path: delete that guard and this drops to
    // exit 0 — i.e. the assertions below are genuinely mutation-discriminating.
    const originalHook = readFileSync(HOOK_SCRIPT, "utf8");
    const mutatedHook = originalHook.replace(
      '  cron_runs: {\n    class: "system",',
      '  cron_runs: {\n    class: "not-a-real-class",',
    );
    expect(mutatedHook).not.toBe(originalHook);
    const scratch = setupScratchRepo("gdpr-b10-class-test-", {
      hook: mutatedHook,
    });
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/check-gdpr-export-coverage.ts"],
      { encoding: "utf8", cwd: scratch },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unrecognised exclusion class");
    expect(result.stderr).toContain("cron_runs");
  }, 30_000);

  it("H-0455/H-0457: exits 1 when a manifest entry has no matching sanitize_user policy", () => {
    // Add a brand-new manifest entry whose name does NOT appear in
    // the sanitize_user matrix or DELETE/UPDATE body — and is NOT in
    // SANITIZE_PARITY_ALLOWLIST. The parity check should fail loud.
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
    const scratch = setupScratchRepo("gdpr-parity-test-", {
      manifestModule: mutated,
    });

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
    const scratch = setupScratchRepo("gdpr-rt9-test-", {
      manifestModule: mutated,
    });

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
    const scratch = setupScratchRepo("gdpr-rt9-stale-", { hook: mutatedHook });

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
    // Manifest copied VERBATIM (by the helper) — the gap is on the
    // migration side.
    const scratch = setupScratchRepo("gdpr-hook-scan-all-");

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
    // Mutate the manifest module: delete the 'user_notes' entry so the
    // hook should report it as missing. The helper sandboxes the script
    // + migrations + (mutated) manifest so the working tree is untouched.
    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      "// (user_notes removed by coverage-hook test)",
    );
    // Sanity-check that the mutation actually fired
    expect(mutated).not.toBe(originalManifest);
    const scratch = setupScratchRepo("gdpr-hook-test-", {
      manifestModule: mutated,
    });

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

    const originalManifest = readFileSync(MANIFEST_ABS, "utf8");
    const mutated = originalManifest.replace(
      /\{\s*kind:\s*"direct",\s*table:\s*"user_notes",\s*user_column:\s*"user_id"\s*\},?/,
      "// (user_notes removed by M-0009 coverage-hook test)",
    );
    expect(mutated).not.toBe(originalManifest);
    const scratch = setupScratchRepo("gdpr-hook-derived-", {
      manifestModule: mutated,
    });

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

  // Finding 4 (red-team, 2026-05-25) — quoted-AND-schema-qualified escape
  // vector. The H-1020 fix added quoted-bare-identifier support, but a
  // user-owned table still escaped when the identifier was QUOTED AND
  // SCHEMA-QUALIFIED (`CREATE TABLE "public"."secret_data" (...)`) or
  // bare-schema + quoted-table (`CREATE TABLE app."secret5" (...)`),
  // because the prior regex only handled a bare `public.` prefix OR a
  // quoted bare name. The schema-qualifier is now a generalized OPTIONAL
  // NON-capturing prefix, so these forms are detected and the table name
  // is keyed unqualified + unquoted. These drive the exported pure helper
  // directly and FAIL against the pre-Finding-4 regex.

  it(
    "Finding 4: a CREATE TABLE with a quoted-AND-schema-qualified name (\"public\".\"x\") and a user_id FK must be discovered",
    () => {
      const sql = [
        'CREATE TABLE "public"."secret_data" (',
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,",
        "  note TEXT",
        ");",
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(
        sql,
        "20260607_quoted_qualified_create.sql",
      );
      // Keyed by the UNQUALIFIED, UNQUOTED table name.
      expect(out.has("secret_data")).toBe(true);
      // The schema name must NOT leak in as a table key.
      expect(out.has("public")).toBe(false);
    },
  );

  it(
    "Finding 4: a CREATE TABLE with a bare-schema + quoted-table name (app.\"x\") and a user_id FK must be discovered",
    () => {
      const sql = [
        'CREATE TABLE app."secret5" (',
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE",
        ");",
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(
        sql,
        "20260608_bareschema_quoted_create.sql",
      );
      expect(out.has("secret5")).toBe(true);
      expect(out.has("app")).toBe(false);
    },
  );

  it(
    "Finding 4: ALTER TABLE on a quoted-AND-schema-qualified name (\"public\".\"x\") adding a user_id FK must be discovered",
    () => {
      const sql = [
        'CREATE TABLE "public"."secret_late" (',
        "  id UUID PRIMARY KEY",
        ");",
        'ALTER TABLE "public"."secret_late" ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);',
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(
        sql,
        "20260609_quoted_qualified_alter.sql",
      );
      expect(out.has("secret_late")).toBe(true);
      expect(out.has("public")).toBe(false);
    },
  );

  it(
    "Finding 4: ALTER TABLE on a bare-schema + quoted-table name (app.\"x\") adding a user_id FK must be discovered",
    () => {
      const sql = [
        'CREATE TABLE app."secret_late5" (',
        "  id UUID PRIMARY KEY",
        ");",
        'ALTER TABLE app."secret_late5" ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);',
        "",
      ].join("\n");
      const out = extractUserTablesFromMigration(
        sql,
        "20260610_bareschema_quoted_alter.sql",
      );
      expect(out.has("secret_late5")).toBe(true);
      expect(out.has("app")).toBe(false);
    },
  );
});

/**
 * NEW-C16-06 (audit 2026-05-26, MED conf-8): the coverage regex previously
 * only matched user-ownership columns that carried an inline REFERENCES FK.
 * Tables like `audit_log` / `audit_log_cold` that use a bare
 * `user_id UUID NOT NULL` (no inline REFERENCES) were invisible to the drift
 * guard — a user-owned table of that shape would escape detection with green
 * CI.  The widened regex now matches bare `user_id|allocator_id UUID NOT NULL`
 * as well, relying on EXCLUDED_TABLES to suppress legitimate non-owned cases.
 */
describe("NEW-C16-06: extractUserTablesFromMigration — bare UUID NOT NULL (no inline FK)", () => {
  it("matches a bare `user_id UUID NOT NULL` column (no inline REFERENCES)", () => {
    const sql = `
CREATE TABLE audit_log_like (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
    const out = extractUserTablesFromMigration(sql, "20260526_test.sql");
    expect(out.get("audit_log_like")).toBe("20260526_test.sql");
  });

  it("matches a bare `allocator_id UUID NOT NULL` column (no inline REFERENCES)", () => {
    const sql = `
CREATE TABLE allocator_event_log (
  id UUID PRIMARY KEY,
  allocator_id UUID NOT NULL,
  event TEXT NOT NULL
);
`;
    const out = extractUserTablesFromMigration(sql, "20260526_test2.sql");
    expect(out.get("allocator_event_log")).toBe("20260526_test2.sql");
  });

  it("does NOT match a bare `strategy_id UUID NOT NULL` (not a canonical user-owner column)", () => {
    // strategy_id is not in the bare-UUID arm — only user_id / allocator_id
    // trigger the bare match.  This keeps the false-positive surface narrow.
    const sql = `
CREATE TABLE strategy_thing (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL,
  payload JSONB
);
`;
    const out = extractUserTablesFromMigration(sql, "20260526_test3.sql");
    expect(out.size).toBe(0);
  });

  it("bare-UUID table in EXCLUDED_TABLES (not SANITIZE_PARITY_ALLOWLIST) is suppressed at extraction", () => {
    // organization_invites is in EXCLUDED_TABLES.  Simulate it gaining a bare
    // user_id UUID NOT NULL column — the EXCLUDED_TABLES guard fires inside
    // extractUserTablesFromMigration before it lands in declarations.
    const sql = `
CREATE TABLE organization_invites (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL
);
`;
    const out = extractUserTablesFromMigration(sql, "20260526_test4.sql");
    // organization_invites is in EXCLUDED_TABLES — must not appear in output.
    expect(out.has("organization_invites")).toBe(false);
  });

  it("bare-UUID table covered by SANITIZE_PARITY_ALLOWLIST IS detected at extraction (allowlist handles it downstream)", () => {
    // audit_log_cold is in SANITIZE_PARITY_ALLOWLIST (not EXCLUDED_TABLES).
    // extractUserTablesFromMigration only checks EXCLUDED_TABLES — so the
    // wider regex now correctly surfaces audit_log_cold; the downstream
    // runCoverageCheck SANITIZE_PARITY_ALLOWLIST gate handles it.
    const sql = `
CREATE TABLE audit_log_cold (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL
);
`;
    const out = extractUserTablesFromMigration(sql, "20260526_test5.sql");
    // The wider regex detects it; EXCLUDED_TABLES does not suppress it.
    // This is the correct behavior — runCoverageCheck allowlist handles it.
    expect(out.has("audit_log_cold")).toBe(true);
  });
});

/**
 * B13: the coverage hook now derives its checks from the imported typed
 * `USER_EXPORT_TABLES` array (not a source-text regex). These tests pin
 * the by-construction guarantees that the typed seam buys us, against the
 * REAL live manifest — so they fail in CI the moment the manifest drifts,
 * not just when a hand-written fixture does.
 */
describe("B13: typed-manifest coverage derivation (live USER_EXPORT_TABLES)", () => {
  it("P698: EVERY manifest entry declares a user-scoping filter column", () => {
    // The single contractual guarantee that a service-role SELECT cannot
    // leak cross-tenant rows: direct/projected -> user_column,
    // indirect -> parent_user_column. The runCoverageCheck() gate fails
    // CI if this is ever false; this assertion surfaces the same invariant
    // directly over the typed array so a regression is named, not buried
    // in a subprocess exit code.
    const entries = extractManifestEntries();
    expect(entries.length).toBe(USER_EXPORT_TABLES.length);
    const offenders = entries.filter((e) => !e.hasUserFilter);
    expect(
      offenders,
      `manifest entries missing a user-scoping filter: ${offenders
        .map((o) => `${o.table} (${o.kind})`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("covered-table derivation includes every entry's table plus projected source_table", () => {
    // The default (no-arg) derivation reads the live manifest — proving
    // the gate sees exactly what the runtime exports. Spot-check a direct
    // table, a projected bundle name, and its underlying source table.
    const names = extractManifestTables();
    expect(names.has("profiles")).toBe(true); // direct
    expect(names.has("audit_log_for_user")).toBe(true); // projected bundle name
    expect(names.has("audit_log")).toBe(true); // projected source_table
    // Every entry's bundle-facing `table` is present.
    for (const spec of USER_EXPORT_TABLES) {
      expect(
        names.has(spec.table),
        `derived coverage set is missing manifest entry "${spec.table}"`,
      ).toBe(true);
    }
  });
});
