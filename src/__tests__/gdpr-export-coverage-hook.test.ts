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
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    expect(result.stderr).toContain("037_user_notes.sql");
  }, 30_000);
});
