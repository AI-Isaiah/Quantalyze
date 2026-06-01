/**
 * Tests for `check-gdpr-export-coverage.ts` — the CI hook that fails
 * when a migration adds a user-owned table without extending
 * `USER_EXPORT_TABLES` in `src/lib/gdpr-export.ts`.
 *
 * Audit C-0291 (CHAIN-8) closeout. These tests exercise:
 *
 *   1. CREATE TABLE regex edge cases (IF NOT EXISTS, schema-qualified
 *      names, multi-line bodies) — proves the BEST-EFFORT parser
 *      covers the cases the codebase actually uses.
 *   2. A new migration-declared table missing from both the manifest
 *      and EXCLUDED_TABLES — proves the script fails LOUD with the
 *      offending table name in the error message.
 *   3. A complete manifest+migration pair — proves exit 0 path.
 *   4. (Audit C-0291 specific) detection of a stale EXCLUDED_TABLES
 *      entry that references a no-longer-declared table — proves the
 *      structural replacement for the deleted `addedIn` provenance
 *      field works.
 *
 * The script's helpers are pure functions over string content, so the
 * tests drive them directly without touching the filesystem.
 */

import { describe, expect, it } from "vitest";
import {
  EXCLUDED_TABLES,
  EXCLUSION_CLASSES,
  SANITIZE_PARITY_ALLOWLIST,
  collectAllDeclaredTables,
  extractAllDeclaredTablesFromContent,
  extractManifestEntries,
  extractManifestTables,
  extractManifestTablesForParity,
  extractProjectedEntries,
  extractSanitizeCoverageFromContent,
  extractUserTablesFromMigration,
  runCoverageCheck,
} from "./check-gdpr-export-coverage";
import type { UserExportTable } from "@/lib/gdpr-export-manifest";

/**
 * Minimal TYPED manifest fixtures. B13: the extractors now derive from
 * the imported `USER_EXPORT_TABLES` typed array (not a source-text
 * regex), so the tests drive them with synthetic `UserExportTable[]`
 * values. The objects must satisfy the real interfaces — a missing or
 * mistyped field fails `tsc`, which is the by-construction guarantee
 * the regex scrape never had.
 */
const MANIFEST_DIRECT_ENTRY: UserExportTable = {
  kind: "direct",
  table: "profiles",
  user_column: "id",
};
const MANIFEST_INDIRECT_ENTRY: UserExportTable = {
  kind: "indirect",
  table: "trades",
  via_column: "strategy_id",
  parent_table: "strategies",
  parent_user_column: "user_id",
};
const MANIFEST_PROJECTED_ENTRY: UserExportTable = {
  kind: "projected",
  table: "audit_log_for_user",
  source_table: "audit_log",
  user_column: "user_id",
  project: (rows) => rows as Array<Record<string, unknown>>,
};

describe("extractUserTablesFromMigration — CREATE TABLE parser edge cases", () => {
  it("matches a plain CREATE TABLE with a user_id FK", () => {
    const sql = `
CREATE TABLE foo (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
    const out = extractUserTablesFromMigration(sql, "20260101_test.sql");
    expect(out.get("foo")).toBe("20260101_test.sql");
  });

  it("matches CREATE TABLE IF NOT EXISTS", () => {
    const sql = `
CREATE TABLE IF NOT EXISTS bar (
  id UUID PRIMARY KEY,
  allocator_id UUID NOT NULL REFERENCES profiles(id)
);
`;
    const out = extractUserTablesFromMigration(sql, "20260102_test.sql");
    expect(out.get("bar")).toBe("20260102_test.sql");
  });

  it("matches schema-qualified `public.<name>` form", () => {
    const sql = `
CREATE TABLE public.baz (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
`;
    const out = extractUserTablesFromMigration(sql, "20260103_test.sql");
    expect(out.get("baz")).toBe("20260103_test.sql");
  });

  it("matches a multi-line CREATE TABLE body with intermediate blank lines", () => {
    const sql = `
CREATE TABLE qux (
  id UUID PRIMARY KEY,

  user_id UUID NOT NULL REFERENCES profiles(id),

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
    const out = extractUserTablesFromMigration(sql, "20260104_test.sql");
    expect(out.get("qux")).toBe("20260104_test.sql");
  });

  it("does NOT match a CREATE TABLE without a user-ID-intent FK", () => {
    const sql = `
CREATE TABLE strategy_only (
  id UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  payload JSONB
);
`;
    const out = extractUserTablesFromMigration(sql, "20260105_test.sql");
    expect(out.size).toBe(0);
  });

  it("does NOT match a CREATE TABLE that's in EXCLUDED_TABLES", () => {
    // `trades` is excluded by EXCLUDED_TABLES. Even if a migration
    // added a user_id FK, the regex sweep skips it.
    const sql = `
CREATE TABLE trades (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id)
);
`;
    const out = extractUserTablesFromMigration(sql, "20260106_test.sql");
    expect(out.has("trades")).toBe(false);
  });

  it("keeps the FIRST declaration when a table appears in multiple migrations", () => {
    const declarations = new Map<string, string>();
    extractUserTablesFromMigration(
      `CREATE TABLE foo (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id)
);`,
      "20260101_first.sql",
      declarations,
    );
    extractUserTablesFromMigration(
      `CREATE TABLE foo (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id)
);`,
      "20260102_second.sql",
      declarations,
    );
    expect(declarations.get("foo")).toBe("20260101_first.sql");
  });
});

describe("extractAllDeclaredTablesFromContent", () => {
  it("collects every CREATE TABLE name regardless of FK shape", () => {
    const sql = `
CREATE TABLE a (id UUID);
CREATE TABLE IF NOT EXISTS public.b (id UUID, user_id UUID REFERENCES auth.users(id));
CREATE TABLE c (id UUID, strategy_id UUID REFERENCES strategies(id));
`;
    const out = extractAllDeclaredTablesFromContent(sql);
    expect(out.has("a")).toBe(true);
    expect(out.has("b")).toBe(true);
    expect(out.has("c")).toBe(true);
  });
});

describe("extractManifestTables / extractManifestEntries", () => {
  it("extracts table + source_table names", () => {
    const names = extractManifestTables([
      MANIFEST_DIRECT_ENTRY,
      MANIFEST_PROJECTED_ENTRY,
    ]);
    expect(names.has("profiles")).toBe(true);
    expect(names.has("audit_log_for_user")).toBe(true);
    expect(names.has("audit_log")).toBe(true); // from source_table
  });

  it("reports hasUserFilter=false for a direct entry missing user_column", () => {
    // The typed manifest makes this impossible at compile time — a
    // DirectUserTable REQUIRES user_column. We deliberately cast a
    // malformed entry past the type system to prove the runtime
    // defense-in-depth check (the P698 gate) still catches drift.
    const malformed = {
      kind: "direct",
      table: "leak_risk",
    } as unknown as UserExportTable;
    const entries = extractManifestEntries([malformed]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      table: "leak_risk",
      kind: "direct",
      hasUserFilter: false,
    });
  });

  it("reports hasUserFilter=true for an indirect entry with parent_user_column", () => {
    const entries = extractManifestEntries([MANIFEST_INDIRECT_ENTRY]);
    expect(entries[0]).toMatchObject({
      table: "trades",
      kind: "indirect",
      hasUserFilter: true,
    });
  });

  it("extracts projected (bundle, source) pairs", () => {
    const pairs = extractProjectedEntries([MANIFEST_PROJECTED_ENTRY]);
    expect(pairs).toEqual([
      { bundleName: "audit_log_for_user", sourceTable: "audit_log" },
    ]);
  });

  it("extractManifestTablesForParity includes parent_table and source_table", () => {
    const set = extractManifestTablesForParity([
      MANIFEST_DIRECT_ENTRY,
      MANIFEST_INDIRECT_ENTRY,
      MANIFEST_PROJECTED_ENTRY,
    ]);
    expect(set.has("profiles")).toBe(true);
    expect(set.has("trades")).toBe(true);
    expect(set.has("strategies")).toBe(true); // parent_table
    expect(set.has("audit_log_for_user")).toBe(true);
    expect(set.has("audit_log")).toBe(true); // source_table
  });

  it("defaults to the real imported USER_EXPORT_TABLES when no array is passed", () => {
    // By-construction guarantee: the live manifest is the default
    // source, so the gate reads exactly what the runtime exports.
    const names = extractManifestTables();
    expect(names.has("profiles")).toBe(true);
    expect(names.has("audit_log")).toBe(true); // projected source_table
    expect(names.size).toBeGreaterThan(20);
  });
});

describe("extractSanitizeCoverageFromContent", () => {
  it("captures matrix comment-block lines", () => {
    const sql = `
-- profiles                | ANONYMIZE    | Identifying columns blanked, id preserved.
-- trades                  | ANONYMIZE    | Strategy-scoped historical.
-- api_keys                | PURGE        | Encrypted credentials.
`;
    const out = extractSanitizeCoverageFromContent(sql);
    expect(out.has("profiles")).toBe(true);
    expect(out.has("trades")).toBe(true);
    expect(out.has("api_keys")).toBe(true);
  });

  it("captures DELETE FROM and UPDATE statements", () => {
    const sql = `
DELETE FROM public.api_keys WHERE user_id = subject_user;
UPDATE profiles SET display_name = '[deleted]' WHERE id = subject_user;
`;
    const out = extractSanitizeCoverageFromContent(sql);
    expect(out.has("api_keys")).toBe(true);
    expect(out.has("profiles")).toBe(true);
  });

  it("filters auth.users/sessions/refresh_tokens", () => {
    const sql = `
DELETE FROM users WHERE id = subject_user;
DELETE FROM sessions WHERE user_id = subject_user;
`;
    const out = extractSanitizeCoverageFromContent(sql);
    expect(out.has("users")).toBe(false);
    expect(out.has("sessions")).toBe(false);
  });
});

describe("runCoverageCheck — exit-code contract", () => {
  function captureLogs() {
    const errors: string[] = [];
    const logs: string[] = [];
    return {
      errors,
      logs,
      errorLog: (m: string) => errors.push(m),
      log: (m: string) => logs.push(m),
    };
  }

  it("returns 0 when manifest + migrations + sanitize matrix all align", () => {
    const cap = captureLogs();
    // To exercise the happy path without tripping the C-0291 stale-
    // EXCLUDED_TABLES check, the mocked `scanAllDeclaredTables` must
    // include EVERY key in the real `EXCLUDED_TABLES`. Same for
    // SANITIZE_PARITY_ALLOWLIST keys, which must all appear in
    // `readManifestForParity`.
    const allDeclared = new Set<string>([
      "profiles",
      "trades",
      "strategies",
      ...Object.keys(EXCLUDED_TABLES),
    ]);
    const parity = new Set<string>([
      "profiles",
      "trades",
      "strategies",
      ...Object.keys(SANITIZE_PARITY_ALLOWLIST),
    ]);
    const code = runCoverageCheck({
      readManifest: () => new Set(["profiles", "trades"]),
      readManifestForParity: () => parity,
      readManifestEntries: () => [
        { table: "profiles", kind: "direct", hasUserFilter: true },
        { table: "trades", kind: "indirect", hasUserFilter: true },
      ],
      readProjectedEntries: () => [],
      scanMigrations: () =>
        new Map([
          ["profiles", "20260101_init.sql"],
          ["trades", "20260101_init.sql"],
        ]),
      scanSanitize: () => new Set(["profiles", "trades", "strategies"]),
      scanAllDeclaredTables: () => allDeclared,
      errorLog: cap.errorLog,
      log: cap.log,
    });
    expect(code, `unexpected errors:\n${cap.errors.join("\n")}`).toBe(0);
    expect(cap.logs.join("\n")).toMatch(/OK - manifest covers all/);
    expect(cap.errors).toHaveLength(0);
  });

  it("returns 1 and NAMES the offending table when migrations declare a table absent from the manifest", () => {
    const cap = captureLogs();
    const code = runCoverageCheck({
      readManifest: () => new Set(["profiles"]),
      readManifestForParity: () => new Set(["profiles"]),
      readManifestEntries: () => [
        { table: "profiles", kind: "direct", hasUserFilter: true },
      ],
      readProjectedEntries: () => [],
      scanMigrations: () =>
        new Map([
          ["profiles", "20260101_init.sql"],
          ["new_leak_table", "20260202_missing.sql"],
        ]),
      scanSanitize: () => new Set(["profiles"]),
      scanAllDeclaredTables: () => new Set(["profiles", "new_leak_table"]),
      errorLog: cap.errorLog,
      log: cap.log,
    });
    expect(code).toBe(1);
    const errBlob = cap.errors.join("\n");
    expect(errBlob).toMatch(/FAIL - GDPR export manifest is missing 1/);
    expect(errBlob).toMatch(/new_leak_table/);
    expect(errBlob).toMatch(/20260202_missing\.sql/);
    expect(errBlob).toMatch(/USER_EXPORT_TABLES/);
  });

  it("returns 1 when a manifest entry lacks a user-id filter (P698)", () => {
    const cap = captureLogs();
    const code = runCoverageCheck({
      readManifest: () => new Set(["leak_risk"]),
      readManifestForParity: () => new Set(["leak_risk"]),
      readManifestEntries: () => [
        { table: "leak_risk", kind: "direct", hasUserFilter: false },
      ],
      readProjectedEntries: () => [],
      scanMigrations: () => new Map(),
      scanSanitize: () => new Set(["leak_risk"]),
      scanAllDeclaredTables: () => new Set(["leak_risk"]),
      errorLog: cap.errorLog,
      log: cap.log,
    });
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toMatch(/FAIL \(P698\)/);
    expect(cap.errors.join("\n")).toMatch(/leak_risk/);
  });

  it("returns 1 when an EXCLUDED_TABLES key has no matching migration (audit C-0291)", () => {
    const cap = captureLogs();
    const code = runCoverageCheck({
      readManifest: () => new Set(["profiles"]),
      readManifestForParity: () => new Set(["profiles"]),
      readManifestEntries: () => [
        { table: "profiles", kind: "direct", hasUserFilter: true },
      ],
      readProjectedEntries: () => [],
      scanMigrations: () => new Map([["profiles", "20260101_init.sql"]]),
      scanSanitize: () => new Set(["profiles"]),
      // Real EXCLUDED_TABLES has e.g. "trades" — simulate the case
      // where the migrations no longer declare it (rename/drop).
      // We provide ONLY `profiles` here, so every other key in
      // EXCLUDED_TABLES (including "trades", "organizations", …)
      // is stale.
      scanAllDeclaredTables: () => new Set(["profiles"]),
      errorLog: cap.errorLog,
      log: cap.log,
    });
    expect(code).toBe(1);
    const errBlob = cap.errors.join("\n");
    expect(errBlob).toMatch(/C-0291/);
    expect(errBlob).toMatch(/EXCLUDED_TABLES has stale entry/);
    // The first key in EXCLUDED_TABLES happens to be
    // organization_invites — but the check naming is what matters,
    // so we assert the structure not a specific name.
    expect(errBlob).toMatch(/no migration declares this table/);
  });

  it("returns 1 when SANITIZE_PARITY_ALLOWLIST has a stale entry", () => {
    const cap = captureLogs();
    const code = runCoverageCheck({
      readManifest: () => new Set(["profiles"]),
      // Manifest-for-parity does NOT contain `audit_log_for_user`
      // (one of the SANITIZE_PARITY_ALLOWLIST keys), so it's stale.
      readManifestForParity: () => new Set(["profiles"]),
      readManifestEntries: () => [
        { table: "profiles", kind: "direct", hasUserFilter: true },
      ],
      readProjectedEntries: () => [],
      scanMigrations: () => new Map([["profiles", "20260101_init.sql"]]),
      scanSanitize: () => new Set(["profiles"]),
      scanAllDeclaredTables: () =>
        new Set(Object.keys(EXCLUDED_TABLES).concat(["profiles"])),
      errorLog: cap.errorLog,
      log: cap.log,
    });
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toMatch(
      /SANITIZE_PARITY_ALLOWLIST has stale entry/,
    );
  });
});

describe("real-repo integration smoke", () => {
  // The colocated test suite asserts the live repo state passes:
  // if these fail, a recent migration / manifest change has broken
  // GDPR coverage and the CI gate should catch it BEFORE merge.
  it("the live repo passes runCoverageCheck() with default helpers", () => {
    const cap = (() => {
      const errors: string[] = [];
      const logs: string[] = [];
      return {
        errors,
        logs,
        errorLog: (m: string) => errors.push(m),
        log: (m: string) => logs.push(m),
      };
    })();
    const code = runCoverageCheck({
      errorLog: cap.errorLog,
      log: cap.log,
    });
    if (code !== 0) {
      // Surface the captured errors so the test failure is actionable.
      throw new Error(
        `runCoverageCheck returned ${code}. Captured errors:\n${cap.errors.join("\n")}`,
      );
    }
    expect(code).toBe(0);
  });

  it("EXCLUDED_TABLES has no stale keys against real migrations", () => {
    const declared = collectAllDeclaredTables();
    const stale = Object.keys(EXCLUDED_TABLES).filter(
      (k) => !declared.has(k),
    );
    expect(stale).toEqual([]);
  });

  it("SANITIZE_PARITY_ALLOWLIST has no addedIn drift (field removed in C-0291)", () => {
    for (const [key, entry] of Object.entries(SANITIZE_PARITY_ALLOWLIST)) {
      expect(entry).toHaveProperty("reason");
      expect(entry).not.toHaveProperty("addedIn");
      // reason is non-empty
      expect((entry as { reason: string }).reason.length).toBeGreaterThan(0);
      // key is lowercase snake_case
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("EXCLUDED_TABLES has no addedIn drift (field removed in C-0291)", () => {
    for (const [key, entry] of Object.entries(EXCLUDED_TABLES)) {
      expect(entry).toHaveProperty("reason");
      expect(entry).not.toHaveProperty("addedIn");
      expect((entry as { reason: string }).reason.length).toBeGreaterThan(0);
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  // B10 (plan test #8): excluding a table from the Art. 15 export is an
  // opt-in decision with a CHECKED rationale class, not free text.
  it("every EXCLUDED_TABLES entry declares a recognised exclusion class (B10 #8)", () => {
    const allowed = EXCLUSION_CLASSES as readonly string[];
    for (const [key, entry] of Object.entries(EXCLUDED_TABLES)) {
      expect(
        allowed.includes(entry.class),
        `${key} has class "${entry.class}" — must be one of: ${EXCLUSION_CLASSES.join(", ")}`,
      ).toBe(true);
    }
  });

  it("runCoverageCheck() FAILS ONLY via the class guard when an entry has an unknown class (B10 #8)", () => {
    const errors: string[] = [];
    // Corrupt the class of an EXISTING entry (cron_runs) and stub every OTHER
    // check to pass cleanly — no stale-allowlist (readManifestForParity ⊇ the
    // allowlist keys), no stale-excluded (scanAllDeclaredTables ⊇ all excluded
    // keys), no projection-parity gap (no projected entries). The unrecognised-
    // class guard is then the SOLE failure path, so exit-1 is genuinely
    // guard-dependent: remove the EXCLUSION_CLASSES.includes() check and this
    // returns 0. (A phantom key would ALSO trip staleExcludedKeys and mask it.)
    const originalClass = EXCLUDED_TABLES.cron_runs.class;
    (EXCLUDED_TABLES.cron_runs as { class: string }).class = "not-a-real-class";
    try {
      const code = runCoverageCheck({
        readManifest: () => new Set(["profiles"]),
        readManifestForParity: () =>
          new Set(["profiles", ...Object.keys(SANITIZE_PARITY_ALLOWLIST)]),
        readManifestEntries: () => [
          { table: "profiles", kind: "direct", hasUserFilter: true },
        ],
        readProjectedEntries: () => [],
        scanMigrations: () => new Map([["profiles", "20260101_init.sql"]]),
        scanSanitize: () => new Set(["profiles"]),
        scanAllDeclaredTables: () =>
          new Set([...Object.keys(EXCLUDED_TABLES), "profiles"]),
        errorLog: (m: string) => errors.push(m),
        log: () => {},
      });
      expect(code).toBe(1);
      const blob = errors.join("\n");
      expect(blob).toMatch(/unrecognised exclusion class/);
      expect(blob).toContain("cron_runs");
    } finally {
      (EXCLUDED_TABLES.cron_runs as { class: string }).class = originalClass;
    }
  });
});
