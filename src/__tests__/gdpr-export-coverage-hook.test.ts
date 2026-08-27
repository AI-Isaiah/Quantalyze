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
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EXCLUDED_TABLES,
  extractManifestEntries,
  extractManifestTables,
  extractSanitizeCoverageFromContent,
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
 * The sandbox needs `sentry-capture.ts` AND everything it relatively imports.
 *
 * ⚠️ DISCOVERED, NOT LISTED, AND THAT IS THE POINT. This used to copy exactly
 * one file, on the premise that `sentry-capture` was "self-contained". Phase
 * 140.2 / SEAMCORE-06 folded secret scrubbing into it — one new
 * `import "./seam-redaction"` — and every mutation case in this file started
 * failing with `Cannot find module './seam-redaction'`, i.e. for a reason that
 * had nothing to do with what they assert. Re-listing the deps by hand would
 * leave the same trap armed for the next edit, so they are read out of the
 * module's own source and the copy fails LOUD if one cannot be resolved.
 */
function sentryCaptureDeps(): string[] {
  const src = readFileSync(join(REPO_ROOT, SENTRY_CAPTURE_REL), "utf8");
  const deps: string[] = [];
  const pattern = /^\s*import\s[^\n]*?from\s+["'](\.[^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    const rel = match[1].replace(/^\.\//, "");
    deps.push(join("src", "lib", `${rel}.ts`));
  }
  return deps;
}

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
  for (const rel of [SENTRY_CAPTURE_REL, ...sentryCaptureDeps()]) {
    const from = join(REPO_ROOT, rel);
    if (!existsSync(from)) {
      throw new Error(
        `Sandbox dependency ${rel} does not exist. sentry-capture.ts imports a ` +
          `module this sandbox cannot resolve, so every case in this file would ` +
          `fail for the wrong reason — see sentryCaptureDeps().`,
      );
    }
    cpSync(from, join(scratch, rel));
  }

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
 * B3 (2026-08-27) — EXCLUDED_TABLES may not be used to SILENCE a user-owned
 * table, and this is the gate that says so.
 *
 * THE HOLE THIS CLOSES. When a migration declares a new user-owned table, the
 * hook exits 1 until a `USER_EXPORT_TABLES` entry lands. That entry is typed
 * against the GENERATED `src/lib/database.types.ts`, so it cannot even compile
 * until the migration is applied — a four-step remedy. Meanwhile
 * `EXCLUDED_TABLES` is `Record<string, {class, reason}>`: a PLAIN STRING key.
 * Adding one line there compiles today, flips the hook to exit 0, and turns
 * every red case in this file green. It is strictly LESS work than the correct
 * fix, and until this block existed nothing anywhere discriminated the two.
 * The failing script's own stderr used to RECOMMEND it. Result: an engineer or
 * agent hits red tests, takes the cheap path, CI goes green, the PR merges,
 * PROD auto-applies — and a user-owned table is permanently and silently
 * absent from every Art. 15 export, with no red anywhere.
 *
 * WHAT IS PINNED, and why in this shape. Two general rules plus one specific
 * pin. The general rules are preferred (a name list rots; a rule does not) and
 * both were MEASURED against the live corpus before being written:
 *
 *   (1) CLASS COHERENCE. A table whose owner column is `NOT NULL REFERENCES`
 *       or `PRIMARY KEY REFERENCES` `profiles | auth.users ... ON DELETE
 *       CASCADE` has exactly one data
 *       subject per row, which CONTRADICTS four of the five exclusion classes
 *       by their own definitions: `system` ("no per-user, row-level
 *       ownership"), `cross-party` ("multi-owner surface"), `pre-auth` ("no
 *       user FK"), and `scoped` ("indirect-owned via a user-FK parent" — the
 *       FK here is direct). So those four are refused outright. `ephemeral` is
 *       the one class that can honestly coexist with a CASCADE owner FK, and
 *       exactly one live entry relies on it (`scenario_commit_idempotency`, a
 *       server-side dedup cache) — measured, 25 CASCADE-owned tables exist and
 *       it is the ONLY one in EXCLUDED_TABLES.
 *
 *       ⚠️ THE `PRIMARY KEY` ARM IS LOAD-BEARING, not cosmetic. Until
 *       2026-08-27 this rule demanded the literal token `NOT NULL`, which
 *       silently exempted the canonical one-row-per-user shape
 *       `user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE`
 *       — a STRICTLY STRONGER ownership declaration (a PK implies NOT NULL
 *       *and* uniqueness). Re-measured on the live corpus: strict = 22
 *       tables, this rule = 25. The three it had been missing are `profiles`,
 *       `allocator_preferences` and `investor_attestations`, none of which is
 *       in EXCLUDED_TABLES today — so there was no live offender, but the
 *       rule left THREE unguarded shapes for a future table rather than the
 *       one (`ephemeral`) this docblock documents.
 *
 *   (2) `scoped` STOPS BEING PROSE. The class asserts the table "appears in
 *       USER_EXPORT_TABLES as an IndirectUserTable". No code path checked
 *       that, so the claim was decoration: a `scoped` entry naming a table
 *       absent from the manifest read as covered while exporting nothing.
 *       Now the manifest is consulted.
 *
 *   (3) A SPECIFIC PIN on `strategy_shares` (Phase 164). Rule (1) leaves
 *       `ephemeral` reachable, and this table is the live target of the
 *       advertised shortcut, so it is named outright as well. Belt and
 *       braces, deliberately: the general rule is the durable mechanism, the
 *       pin is what makes the known-live attempt impossible rather than
 *       merely implausible.
 *
 * ⚠️ NON-VACUITY. These cases are meaningless unless the scan really SEES
 * `strategy_shares` as CASCADE-owned, so that is asserted directly below
 * rather than assumed — otherwise a regex drift would leave every case here
 * passing over an empty set.
 */
describe("B3: EXCLUDED_TABLES cannot silence a user-owned table", () => {
  /**
   * An owner column that makes every row belong to exactly one data subject:
   * `<col> UUID NOT NULL REFERENCES profiles|auth.users(...) ON DELETE CASCADE`,
   * or the same shape declared as `PRIMARY KEY` instead of `NOT NULL` — the
   * one-row-per-user table. A PK is not a weaker claim than NOT NULL, it is a
   * stronger one (non-null AND unique), so both arms are accepted. The CASCADE
   * is what proves the DB itself treats the row as the user's — erasing the
   * user erases the row.
   */
  const CASCADE_OWNER_COLUMN_RE =
    /\b([a-z_]+)\s+UUID\s+(?:NOT\s+NULL|PRIMARY\s+KEY)\s+REFERENCES\s+(?:auth\.users|public\.profiles|profiles)\s*(?:\([a-z_]+\))?\s*ON\s+DELETE\s+CASCADE/i;

  /** Same CREATE TABLE shape the hook's own scanner uses (quoted / qualified). */
  const CREATE_TABLE_RE =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[a-z0-9_]+"|[a-z0-9_]+)\.)?(?:"([a-z0-9_]+)"|([a-z0-9_]+))\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

  /** Comments must not count as DDL — the H-1019 phantom-match lesson. */
  function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");
  }

  /** table name -> { migration, ownerColumn } for every CASCADE-owned table. */
  function scanCascadeOwnedTables(): Map<
    string,
    { migration: string; ownerColumn: string }
  > {
    const dir = join(REPO_ROOT, MIGRATIONS_REL);
    const out = new Map<string, { migration: string; ownerColumn: string }>();
    for (const filename of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = stripSqlComments(readFileSync(join(dir, filename), "utf8"));
      CREATE_TABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
        const table = m[1] ?? m[2];
        const hit = CASCADE_OWNER_COLUMN_RE.exec(m[3]);
        if (hit && !out.has(table)) {
          out.set(table, { migration: filename, ownerColumn: hit[1] });
        }
      }
    }
    return out;
  }

  const CASCADE_OWNED = scanCascadeOwnedTables();

  // The four classes whose own definitions are contradicted by a NOT NULL
  // CASCADE owner FK. `ephemeral` is deliberately absent — see the docblock.
  const CLASSES_INCOMPATIBLE_WITH_DIRECT_OWNERSHIP = [
    "scoped",
    "system",
    "cross-party",
    "pre-auth",
  ] as const;

  it("non-vacuity: the scan actually sees strategy_shares as CASCADE-owned", () => {
    // Everything below quantifies over CASCADE_OWNED. If the regex drifts and
    // the set empties, every case in this block passes while asserting
    // nothing — the failure mode this repo calls a test that cannot fail.
    expect(
      CASCADE_OWNED.size,
      "no CASCADE-owned tables found at all — the DDL scan is broken, and the " +
        "B3 cases below are quantifying over an empty set",
    ).toBeGreaterThan(10);
    const found = CASCADE_OWNED.get("strategy_shares");
    expect(
      found,
      "strategy_shares was not detected as user-owned. It declares `created_by " +
        "UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE` (Phase 164, " +
        "migration 20260827120000). If that migration was renamed or its column " +
        "changed, re-derive this gate — do NOT delete it.",
    ).toBeDefined();
    expect(found!.ownerColumn).toBe("created_by");
  });

  it("the `PRIMARY KEY REFERENCES` ownership shape is in scope, not just `NOT NULL`", () => {
    // Guards the 2026-08-27 widening. `user_id UUID PRIMARY KEY REFERENCES
    // profiles(id) ON DELETE CASCADE` is the canonical one-row-per-user table
    // and a STRONGER ownership claim than NOT NULL, but the original rule
    // demanded the literal token `NOT NULL` and so waved all three of these
    // through. Reverting the regex to the NOT NULL-only form re-opens exactly
    // that bypass, and this case is what makes the revert red instead of
    // silent. These are live tables, not fixtures — if one is genuinely
    // dropped or reshaped, re-derive the list from the migration, do not
    // delete the case.
    for (const table of [
      "profiles",
      "allocator_preferences",
      "investor_attestations",
    ]) {
      expect(
        CASCADE_OWNED.get(table),
        `${table} declares a \`UUID PRIMARY KEY REFERENCES profiles|auth.users ` +
          `ON DELETE CASCADE\` owner column but the CASCADE scan did not see it. ` +
          `CASCADE_OWNER_COLUMN_RE has probably lost its \`PRIMARY KEY\` arm, ` +
          `which silently exempts every one-row-per-user table from the class-` +
          `coherence rule below.`,
      ).toBeDefined();
    }
  });

  it("strategy_shares is NOT in EXCLUDED_TABLES", () => {
    // The specific pin (3). strategy_shares records that the owner created /
    // revoked a factsheet share link, and when — personal data Art. 15
    // entitles them to. The correct remedy for the hook's failure is the
    // four-step order of operations at the PENDING block in
    // src/lib/gdpr-export-manifest.ts, NOT an exclusion.
    expect(
      Object.keys(EXCLUDED_TABLES),
      "strategy_shares was added to EXCLUDED_TABLES. That silences the GDPR " +
        "coverage hook instead of satisfying it, and permanently drops a " +
        "user-owned table from every Art. 15 export with green CI. Remove the " +
        "entry and follow the four-step remedy in src/lib/gdpr-export-manifest.ts " +
        "(apply migration -> regenerate database.types.ts -> USER_EXPORT_TABLES " +
        "entry -> SANITIZE_PARITY_ALLOWLIST key).",
    ).not.toContain("strategy_shares");
  });

  it("no CASCADE-owned table is excluded as scoped / system / cross-party / pre-auth", () => {
    // The general rule (1). Each of these four classes asserts something the
    // FK contradicts, so an entry pairing them is self-refuting.
    const offenders: string[] = [];
    for (const [table, meta] of Object.entries(EXCLUDED_TABLES)) {
      const owned = CASCADE_OWNED.get(table);
      if (!owned) continue;
      if (
        (CLASSES_INCOMPATIBLE_WITH_DIRECT_OWNERSHIP as readonly string[]).includes(
          meta.class,
        )
      ) {
        offenders.push(
          `${table} (class="${meta.class}", owner column "${owned.ownerColumn}" ` +
            `declared in ${owned.migration})`,
        );
      }
    }
    expect(
      offenders,
      "EXCLUDED_TABLES entry/entries exclude a DIRECTLY user-owned table under a " +
        "class whose own definition rules that out. A `<owner> UUID NOT NULL` (or " +
        "`PRIMARY KEY`) `REFERENCES profiles|auth.users ON DELETE CASCADE` column " +
        "means every row " +
        "belongs to exactly one data subject, so the table is not `system` (no " +
        "row-level ownership), not `cross-party` (multi-owner), not `pre-auth` " +
        "(no user FK) and not `scoped` (indirect via a parent — this FK is " +
        "direct). Put the table in USER_EXPORT_TABLES instead. Offenders: " +
        offenders.join("; "),
    ).toEqual([]);
  });

  it("every `scoped` exclusion really appears in USER_EXPORT_TABLES", () => {
    // The general rule (2). `scoped` means "the data IS exported, just not
    // directly" — a checkable claim that nothing checked, so it could be
    // asserted about a table the manifest never mentions.
    const manifestTables = extractManifestTables();
    const unbacked = Object.entries(EXCLUDED_TABLES)
      .filter(([, meta]) => meta.class === "scoped")
      .map(([table]) => table)
      .filter((table) => !manifestTables.has(table));
    expect(
      unbacked,
      "EXCLUDED_TABLES entry/entries are classed `scoped` — which asserts the " +
        "table appears in USER_EXPORT_TABLES as an IndirectUserTable, i.e. that " +
        "its rows ARE exported via a parent — but the manifest does not list " +
        "them. The rationale is therefore false and the rows are exported " +
        "nowhere. Either add the manifest entry the class claims exists, or pick " +
        "the class that is actually true. Unbacked: " + unbacked.join(", "),
    ).toEqual([]);
    // Guard the guard: `scoped` must be a class in live use, or the loop above
    // is vacuous and would stay green if the check were deleted.
    const scopedCount = Object.values(EXCLUDED_TABLES).filter(
      (m) => m.class === "scoped",
    ).length;
    expect(
      scopedCount,
      "no EXCLUDED_TABLES entry is classed `scoped` any more, so the assertion " +
        "above ran over an empty set and proves nothing",
    ).toBeGreaterThan(0);
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

/**
 * Phase 164 re-review (2026-08-27) — the Art. 15/17 parity gate must not be
 * satisfiable by PROSE that merely quotes a statement.
 *
 * MEASURED before the fix. The reviewer deleted the live 5-line
 * `UPDATE strategy_shares ...` arm (153 bytes) from migration 20260827130000
 * and re-ran the hook: 0 live statements remained, and the hook still reported
 * `strategy_shares` Art. 17-covered, because
 * `extractSanitizeCoverageFromContent` scanned RAW file text. A header comment
 * (`--   UPDATE strategy_shares`) and two RAISE EXCEPTION messages quoting the
 * arm verbatim inside string literals all matched the statement regex. An
 * engineer could satisfy an erasure gate by DESCRIBING the erasure.
 *
 * The fix blanks comments and single-quoted literals before the statement
 * scan. Re-measured with the same neuter: prose feeds no longer count, and the
 * table falls out of the covered set once its matrix row is removed too.
 *
 * ⚠️ WHAT IS STILL DELIBERATELY ACCEPTED. A matrix row (`-- <table> |
 * ANONYMIZE | ...`) IS a comment and DOES still count — that is the documented
 * design (see the docblock on scanSanitizeUserCoverage): the matrix is the
 * declared erasure policy, and some strategies (PRESERVE, CASCADE) have no
 * statement to find. Only the STATEMENT limb is prose-blind now. The guarantee
 * that the live UPDATE arm actually exists is enforced separately, by the
 * verification DO block inside migration 20260827130000 itself.
 *
 * The over-stripping cases below matter as much as the under-stripping ones: a
 * stripper that also blinded the scan to real statements would make this gate
 * vacuous in the opposite direction, and every case here would still pass.
 */
describe("sanitize parity: prose cannot satisfy the statement scan", () => {
  it("a comment quoting an UPDATE does not count as coverage", () => {
    const sql = [
      "-- This migration is where we would normally write:",
      "--   UPDATE phantom_table SET revoked_at = now() WHERE created_by = p_user_id;",
      "-- ...but we have not written it yet.",
    ].join("\n");
    expect(
      extractSanitizeCoverageFromContent(sql).has("phantom_table"),
      "a commented-out UPDATE was accepted as proof of an Art. 17 erasure " +
        "policy — the parity gate is satisfiable by describing the work",
    ).toBe(false);
  });

  it("a statement quoted inside a string literal does not count as coverage", () => {
    // The exact shape that kept strategy_shares green under the neuter: a
    // RAISE EXCEPTION whose message names the arm it is checking for.
    const sql = [
      "DO $$",
      "BEGIN",
      "  IF v_body !~* 'UPDATE phantom_table' THEN",
      "    RAISE EXCEPTION 'sanitize_user lacks the live `UPDATE phantom_table SET revoked_at = now()` arm.';",
      "  END IF;",
      "END $$;",
    ].join("\n");
    expect(
      extractSanitizeCoverageFromContent(sql).has("phantom_table"),
      "an UPDATE quoted inside a string literal was accepted as proof of an " +
        "Art. 17 erasure policy",
    ).toBe(false);
  });

  it("a REAL statement inside a dollar-quoted function body still counts", () => {
    // Anti-over-strip #1. The sanitize_user body IS dollar-quoted, so treating
    // `$$ ... $$` as an opaque literal would blind the scan to every real
    // statement in the repo and leave the two cases above passing vacuously.
    const sql = [
      "CREATE OR REPLACE FUNCTION sanitize_user(p_user_id UUID) RETURNS void AS $$",
      "BEGIN",
      "  UPDATE phantom_table SET revoked_at = now() WHERE created_by = p_user_id;",
      "  DELETE FROM other_phantom WHERE user_id = p_user_id;",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n");
    const covered = extractSanitizeCoverageFromContent(sql);
    expect(covered.has("phantom_table")).toBe(true);
    expect(covered.has("other_phantom")).toBe(true);
  });

  it("a string literal containing `--` does not swallow a real statement after it", () => {
    // Anti-over-strip #2. A naive line-based `--` sweep run BEFORE literal
    // handling would treat the `--` inside the literal as a comment start and
    // delete the rest of the line, including the real statement.
    const sql =
      "UPDATE audit_note SET body = 'redacted -- by request'; DELETE FROM phantom_table WHERE user_id = p_user_id;";
    const covered = extractSanitizeCoverageFromContent(sql);
    expect(covered.has("audit_note")).toBe(true);
    expect(
      covered.has("phantom_table"),
      "a real DELETE was lost because a string literal contained `--` — the " +
        "stripper is eating executable SQL",
    ).toBe(true);
  });

  it("an apostrophe inside a comment does not desync literal pairing", () => {
    // Anti-over-strip #3. `don't` inside a comment leaves one unmatched quote.
    // Handled in a prior pass it would desync every literal after it and
    // swallow the real statement below.
    // The trailing literal is what makes this case able to FAIL: with only one
    // stray quote there is nothing to pair it with, so a literal-first sweep
    // would find no match and the case would pass vacuously.
    const sql = [
      "-- we don't purge here, we revoke",
      "UPDATE phantom_table SET revoked_at = now() WHERE created_by = p_user_id;",
      "UPDATE audit_note SET note = 'done';",
    ].join("\n");
    expect(
      extractSanitizeCoverageFromContent(sql).has("phantom_table"),
      "a real UPDATE was lost after a comment containing an apostrophe",
    ).toBe(true);
  });

  it("non-vacuity: the live corpus still reports strategy_shares covered", () => {
    // The fix must close the prose hole WITHOUT dropping the real arm that
    // migration 20260827130000 actually executes. If this flips false, the
    // stripper has become too aggressive against real SQL.
    const dir = join(REPO_ROOT, MIGRATIONS_REL);
    const covered = new Set<string>();
    for (const filename of readdirSync(dir).filter(
      (f) => f.endsWith(".sql") && /sanitize_user/i.test(f),
    )) {
      extractSanitizeCoverageFromContent(
        readFileSync(join(dir, filename), "utf8"),
        covered,
      );
    }
    expect(covered.has("strategy_shares")).toBe(true);
    expect(
      covered.size,
      "the sanitize coverage set collapsed — the prose stripper is removing " +
        "real statements, not just prose",
    ).toBeGreaterThan(30);
  });
});
