import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guards for CRITICAL findings from the 2026-04-10 deep audit
// and CSO security findings (SEC-001 through SEC-005).
// Each test fails against the code state at commit 9930829 (baseline) and
// is expected to pass after the corresponding fix in the same PR.
//
// Findings:
//   CRITICAL-01   audit/tech-debt-round-1.md       portfolio-pdf IDOR
//   CRITICAL-02   audit/tech-debt-round-1.md       VERSION / package.json drift
//   SD-CRITICAL-01 audit/system-design-round-1.md  analytics-client no timeout
//   SD-CRITICAL-02 audit/system-design-round-1.md  vercel.json missing crons
//   SD-CRITICAL-03 audit/system-design-round-1.md  no production error telemetry
//   SEC-002       CSO audit                        alert-digest timing-safe compare
//   SEC-003       CSO audit                        Content-Disposition sanitizer
//   SEC-004       CSO audit                        Content-Security-Policy headers

const REPO_ROOT = join(__dirname, "..", "..");
const readText = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");
const readJson = <T>(relPath: string): T => JSON.parse(readText(relPath)) as T;

describe("Critical regression guards", () => {
  describe("[CRITICAL-01] portfolio-pdf IDOR", () => {
    it("portfolio-pdf page must gate admin-client access with auth or signed token", () => {
      const src = readText("src/app/portfolio-pdf/[id]/page.tsx");
      const usesAdminClient = /createAdminClient\s*\(/.test(src);
      if (!usesAdminClient) {
        // Fix landed via a different route (e.g. switched to anon client under RLS).
        // That's a valid fix — the test is satisfied.
        return;
      }
      // If it still uses the admin client, it MUST have an auth/token gate.
      const hasAuthGate =
        /\.auth\.getUser\s*\(/.test(src) ||
        /verifyDemoPdfToken|verifyPdfToken|verifyPortfolioPdfToken|verifyPdfRenderToken/.test(src) ||
        /timingSafeEqual/.test(src);
      expect(
        hasAuthGate,
        "src/app/portfolio-pdf/[id]/page.tsx uses createAdminClient() without an auth/token gate (IDOR)",
      ).toBe(true);
    });
  });

  describe("[CRITICAL-02] VERSION / package.json drift", () => {
    it("VERSION file must equal package.json version", () => {
      const versionFile = readText("VERSION").trim();
      const pkg = readJson<{ version: string }>("package.json");
      expect(pkg.version, "package.json version does not match VERSION file").toBe(versionFile);
    });
  });

  describe("[SD-CRITICAL-01] analytics-client must have a fetch timeout", () => {
    it("src/lib/analytics-client.ts must wire a fetch abort signal", () => {
      const src = readText("src/lib/analytics-client.ts");
      const hasTimeout =
        /AbortSignal\.timeout/.test(src) ||
        /new\s+AbortController/.test(src) ||
        /signal\s*:/.test(src);
      expect(
        hasTimeout,
        "analytics-client has no timeout/abort — a hung Railway worker will hang the lambda until platform kill",
      ).toBe(true);
    });
  });

  describe("[SD-CRITICAL-02] vercel.json must register Vercel Crons", () => {
    type VercelConfig = {
      crons?: ReadonlyArray<{ path: string; schedule: string }>;
    };

    it("vercel.json must have a crons array", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      expect(
        Array.isArray(cfg.crons),
        "vercel.json has no `crons` — warm-analytics and alert-digest never run",
      ).toBe(true);
    });

    it("vercel.json crons must include warm-analytics", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      const paths = (cfg.crons ?? []).map((c) => c.path);
      expect(paths).toContain("/api/cron/warm-analytics");
    });

    it("vercel.json crons must include alert-digest", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      const paths = (cfg.crons ?? []).map((c) => c.path);
      expect(paths).toContain("/api/alert-digest");
    });
  });

  describe("[SEC-002] alert-digest must use timing-safe secret comparison", () => {
    it("alert-digest route must import safeCompare, not use !== for secret check", () => {
      const src = readText("src/app/api/alert-digest/route.ts");
      expect(
        /safeCompare/.test(src),
        "alert-digest route does not import/use safeCompare — timing side-channel on cron secret",
      ).toBe(true);
      // The route must NOT have a bare `auth !== expected` comparison
      const hasBareComparison = /auth\s*!==\s*expected/.test(src);
      expect(
        hasBareComparison,
        "alert-digest route still uses `auth !== expected` — replace with safeCompare(auth, expected)",
      ).toBe(false);
    });
  });

  describe("[SEC-003] PDF routes must sanitize Content-Disposition filenames", () => {
    const pdfRoutes = [
      "src/app/api/factsheet/[id]/pdf/route.ts",
      "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts",
      "src/app/api/portfolio-pdf/[id]/route.ts",
      "src/app/api/demo/portfolio-pdf/[id]/route.ts",
    ];

    for (const route of pdfRoutes) {
      it(`${route} must use sanitizeFilename`, () => {
        const src = readText(route);
        expect(
          /sanitizeFilename/.test(src),
          `${route} does not use sanitizeFilename — Content-Disposition header injection risk`,
        ).toBe(true);
      });
    }
  });

  describe("[SEC-004] next.config.ts must set security headers", () => {
    it("must include Content-Security-Policy header", () => {
      const src = readText("next.config.ts");
      expect(
        /Content-Security-Policy/.test(src),
        "next.config.ts has no Content-Security-Policy header",
      ).toBe(true);
    });

    it("must include X-Frame-Options DENY", () => {
      const src = readText("next.config.ts");
      expect(/X-Frame-Options/.test(src) && /DENY/.test(src)).toBe(true);
    });

    it("must include X-Content-Type-Options nosniff", () => {
      const src = readText("next.config.ts");
      expect(
        /X-Content-Type-Options/.test(src) && /nosniff/.test(src),
      ).toBe(true);
    });
  });

  describe("[SD-CRITICAL-03] production error telemetry must be wired", () => {
    it("package.json must include an error-telemetry dependency", () => {
      const pkg = readJson<{
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>("package.json");
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hasErrorTelemetry = Object.keys(deps).some(
        (name) =>
          name.startsWith("@sentry/") ||
          name.startsWith("@datadog/") ||
          name.startsWith("@axiomhq/") ||
          name.startsWith("@highlight-run/") ||
          name === "@opentelemetry/api",
      );
      expect(
        hasErrorTelemetry,
        "no error telemetry library installed — production errors are invisible",
      ).toBe(true);
    });
  });

  // Phase 08 Plan 01 — atomic rename of portfolio_note.update → user_note.*.update.
  // D-23 mandates the rename lands in a single atomic commit with migration 071,
  // the audit enum, the route emitter, and ADR-0023 all in lockstep. This guard
  // asserts the legacy quoted literals are absent from the route emitter and
  // the audit enum so a future accidental reintroduction fails fast. Comments
  // referencing the old name for historical context are allowed — the guard
  // matches only quoted string literals (the forms used by the enum + emitter).
  describe("[PHASE-08-01] portfolio_note literal absent from route.ts + audit.ts", () => {
    const watchedFiles = ["src/app/api/notes/route.ts", "src/lib/audit.ts"];

    for (const rel of watchedFiles) {
      it(`${rel} must not contain the quoted literal "portfolio_note.update"`, () => {
        const src = readText(rel);
        const hasQuotedLiteral =
          /"portfolio_note\.update"/.test(src) ||
          /'portfolio_note\.update'/.test(src);
        expect(
          hasQuotedLiteral,
          `${rel} still references the legacy audit action "portfolio_note.update" — the Phase 08 rename to user_note.{scope}.update must remove all in-repo call sites atomically (D-23).`,
        ).toBe(false);
      });

      it(`${rel} must not contain the quoted legacy entity_type literal "portfolio_note"`, () => {
        const src = readText(rel);
        // Match the quoted literal only (enum/emitter form). Comments
        // referencing the old name for historical context are allowed.
        const hasLiteral =
          /"portfolio_note"/.test(src) || /'portfolio_note'/.test(src);
        expect(
          hasLiteral,
          `${rel} still references the legacy entity_type "portfolio_note" — should be "user_note" per Phase 08 reshape.`,
        ).toBe(false);
      });
    }
  });

  // Audit-2026-05-07 #53 — Plausible analytics is pre-emptively whitelisted
  // in the CSP so a future integration does not silently break under a
  // strict default-src. The directive must appear in BOTH script-src AND
  // connect-src; missing connect-src would let the page load the script
  // but block the events POST.
  describe("[AUDIT-2026-05-07 #53] Plausible CSP whitelist", () => {
    it("next.config.ts script-src must allow https://plausible.io", () => {
      const src = readText("next.config.ts");
      // The CSP value contains nested single quotes (e.g. 'self'), so
      // the capture group must terminate on the outer double-quote only.
      const cspMatch = src.match(
        /Content-Security-Policy[\s\S]*?value:\s*"([^"]+)"/,
      );
      expect(cspMatch, "next.config.ts has no CSP value to inspect").not.toBeNull();
      const cspValue = cspMatch![1];
      const scriptSrc = cspValue
        .split(";")
        .find((d) => d.trim().startsWith("script-src"));
      expect(
        scriptSrc && /https:\/\/plausible\.io/.test(scriptSrc),
        "next.config.ts CSP script-src does not include https://plausible.io",
      ).toBe(true);
    });

    it("next.config.ts connect-src must allow https://plausible.io", () => {
      const src = readText("next.config.ts");
      const cspMatch = src.match(
        /Content-Security-Policy[\s\S]*?value:\s*"([^"]+)"/,
      );
      expect(cspMatch).not.toBeNull();
      const cspValue = cspMatch![1];
      const connectSrc = cspValue
        .split(";")
        .find((d) => d.trim().startsWith("connect-src"));
      expect(
        connectSrc && /https:\/\/plausible\.io/.test(connectSrc),
        "next.config.ts CSP connect-src does not include https://plausible.io — Plausible script will load but events will be blocked",
      ).toBe(true);
    });
  });

  // Audit-2026-05-07 #28 — partner_tag CHECK constraint migration.
  // The CHECK lives in migration 101. We can't apply it at unit-test
  // time (no Postgres), but we CAN assert the migration file is shape-
  // correct: pre-flight scrub, four ALTER TABLE statements, and a
  // self-verifying assertion that fails loudly if any CHECK is missing.
  describe("[AUDIT-2026-05-07 #28] migration 101 partner_tag CHECK constraint", () => {
    const MIGRATION_PATH =
      "supabase/migrations/20260510172412_partner_tag_check_constraint.sql";

    it("migration file exists", () => {
      expect(() => readText(MIGRATION_PATH)).not.toThrow();
    });

    it("contains the pre-flight scrub guard", () => {
      const sql = readText(MIGRATION_PATH);
      expect(/Migration 101 cannot apply/.test(sql)).toBe(true);
      expect(/SELECT count\(\*\) INTO bad_count/i.test(sql)).toBe(true);
    });

    const TABLES = ["profiles", "strategies", "contact_requests", "match_batches"];
    for (const table of TABLES) {
      it(`adds CHECK constraint on ${table}.partner_tag matching ^[a-z0-9-]+$`, () => {
        const sql = readText(MIGRATION_PATH);
        const constraintRe = new RegExp(
          `ALTER TABLE\\s+${table}[\\s\\S]*?ADD CONSTRAINT\\s+${table}_partner_tag_format_check[\\s\\S]*?CHECK\\s*\\([\\s\\S]*?\\^\\[a-z0-9-\\]\\+\\$`,
          "i",
        );
        expect(
          constraintRe.test(sql),
          `migration 101 missing CHECK constraint for ${table}.partner_tag`,
        ).toBe(true);
      });
    }

    it("ends with the self-verifying assertion that all four constraints landed", () => {
      const sql = readText(MIGRATION_PATH);
      // The trailing DO $$ block expands the expected_constraints array
      // and RAISE EXCEPTIONs if pg_constraint count != 4. Without this
      // guard a soft no-op (the failure mode that bit migration 017)
      // would land silently.
      expect(/expected_constraints\s+text\[\]/.test(sql)).toBe(true);
      expect(/Migration 101 failed/.test(sql)).toBe(true);
    });
  });

  // Audit-2026-05-07 #43 / #44 — defensive UI branches that surface
  // previously-silent failures. The component-level tests live alongside
  // the components; these guards prevent regression at the source-text
  // level so a future refactor cannot silently strip the safety net.
  describe("[AUDIT-2026-05-07 #43] ShareableLink surfaces clipboard failures", () => {
    it("ShareableLink.tsx must track fallbackSucceeded and render copyFailed UI", () => {
      const src = readText("src/components/strategy/ShareableLink.tsx");
      // The fix introduces an explicit success flag for the fallback
      // path so we don't fire the success badge when both paths failed.
      expect(
        /fallbackSucceeded/.test(src),
        "ShareableLink.tsx no longer tracks the fallback outcome — copy-failed regression possible",
      ).toBe(true);
      expect(
        /copyFailed/.test(src) && /Copy failed/.test(src),
        "ShareableLink.tsx no longer renders the 'Copy failed' state",
      ).toBe(true);
    });
  });

  describe("[AUDIT-2026-05-07 C-0135 + C-0136] PendingIntros routes through /api/intro-response", () => {
    // Supersedes #44 (RLS-zero detection on direct browser-client UPDATE).
    // The 2026-05-07 audit identified two compound defects on the direct
    // path: (1) C-0135 — notifyAllocatorIntroStatus never fired on
    // manager-driven transitions (allocators silently uninformed); (2)
    // C-0136 — no RLS WITH CHECK + no column-level grant meant a manager
    // UI could mutate admin_note / founder_notes / allocation_amount on
    // rows for their strategies. The fix routes through a server
    // endpoint that whitelists columns and triggers the notify.
    const PENDING_INTROS_SRC = "src/components/strategy/PendingIntros.tsx";

    it("PendingIntros.tsx must NOT import the Supabase browser client (no direct manager UPDATE)", () => {
      const src = readText(PENDING_INTROS_SRC);
      expect(
        /from\s+["']@\/lib\/supabase\/client["']/.test(src),
        "PendingIntros.tsx re-introduced the Supabase browser client — C-0135 (silent notify drop) + C-0136 (column-write surface) regressions possible",
      ).toBe(false);
    });
    it("PendingIntros.tsx must NOT reference contact_requests directly (server-route enforcement)", () => {
      const src = readText(PENDING_INTROS_SRC);
      expect(
        /contact_requests/.test(src),
        "PendingIntros.tsx writes to contact_requests directly — manager-side direct UPDATE bypasses server validation",
      ).toBe(false);
    });
    it("PendingIntros.tsx must POST to /api/intro-response", () => {
      const src = readText(PENDING_INTROS_SRC);
      expect(
        /\/api\/intro-response/.test(src),
        "PendingIntros.tsx no longer targets /api/intro-response — notifyAllocatorIntroStatus path is bypassed",
      ).toBe(true);
    });
    it("PendingIntros.tsx must still surface a permission-style error on 401/403", () => {
      const src = readText(PENDING_INTROS_SRC);
      expect(
        /may not have permission/.test(src),
        "PendingIntros.tsx no longer surfaces the permission-style error copy — silent-403 regression possible",
      ).toBe(true);
    });
  });

  // Audit-2026-05-07 #24 — ContactRequestStatus type drift. The DB write
  // is `status: "intro_made"` (NOT "accepted"); a stale type definition
  // would let a typo'd literal slip through at compile time.
  describe("[AUDIT-2026-05-07 #24] ContactRequestStatus union", () => {
    it("types.ts must export the ContactRequestStatus alias with intro_made/completed/declined values", () => {
      const src = readText("src/lib/types.ts");
      expect(/ContactRequestStatus/.test(src)).toBe(true);
      expect(/"intro_made"/.test(src)).toBe(true);
      expect(/"completed"/.test(src)).toBe(true);
      expect(/"declined"/.test(src)).toBe(true);
      // Defensive: the legacy "accepted" literal must NOT remain on the
      // ContactRequestStatus alias — DB writes use "intro_made".
      const aliasMatch = src.match(
        /(?:export\s+)?type\s+ContactRequestStatus\s*=\s*([^;\n]+)/,
      );
      expect(aliasMatch).not.toBeNull();
      expect(
        /"accepted"/.test(aliasMatch![1]),
        "ContactRequestStatus alias still includes legacy 'accepted' literal — DB writes use 'intro_made'",
      ).toBe(false);
    });
  });

  // Audit-2026-05-07 #35 — explicit staging project-ref allowlist. The
  // legacy guard relied on substring match against /prod|production/i,
  // which never matched a real Supabase URL (project refs are 8-char
  // alphanumerics). Replace with an explicit allowlist of known staging
  // refs, with a SEED_ALLOW_SUPABASE_PROJECT_REF override.
  describe("[AUDIT-2026-05-07 #35] seed-full-app-demo staging allowlist guard", () => {
    it("scripts/seed-full-app-demo.ts must hardcode the staging project ref allowlist", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      expect(
        /STAGING_PROJECT_REF_ALLOWLIST/.test(src),
        "scripts/seed-full-app-demo.ts no longer defines an explicit staging allowlist set",
      ).toBe(true);
      expect(
        /qmnijlgmdhviwzwfyzlc/.test(src),
        "scripts/seed-full-app-demo.ts no longer pins the documented staging project ref",
      ).toBe(true);
    });

    it("scripts/seed-full-app-demo.ts must support SEED_ALLOW_SUPABASE_PROJECT_REF env override", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      expect(/SEED_ALLOW_SUPABASE_PROJECT_REF/.test(src)).toBe(true);
    });

    it("scripts/seed-full-app-demo.ts must exit with code 3 when project ref is unparseable or absent from allowlist", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // The allowlist guard exits with code 3 — same exit code as the
      // legacy /prod/production/ guard so existing CI checks keep working.
      const hasExit3 = /process\.exit\(3\)/.test(src);
      expect(hasExit3).toBe(true);
    });
  });

  // Audit-2026-05-07 #47 — wipeLegacySeed surfaces auth.admin.deleteUser
  // failures at WARN. Pre-fix, `.catch(() => {})` swallowed every error —
  // an orphaned auth.users row could not be detected because the FK
  // lookup by id missed (the profile was already gone).
  describe("[AUDIT-2026-05-07 #47] wipeLegacySeed surfaces auth-delete failures", () => {
    it("scripts/seed-full-app-demo.ts must NOT swallow deleteUser errors with .catch(() => {})", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // A literal `.catch(() => {})` directly after deleteUser is the
      // pre-fix pattern. The fix uses try/catch + console.warn, so this
      // exact substring must be gone.
      const hasSwallowedCatch =
        /admin\.auth\.admin\.deleteUser\([^)]*\)\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(
          src,
        );
      expect(
        hasSwallowedCatch,
        "scripts/seed-full-app-demo.ts still swallows auth.admin.deleteUser errors with .catch(() => {}) — orphan trail invisible",
      ).toBe(false);
    });

    it("scripts/seed-full-app-demo.ts must surface deleteUser failures via console.warn", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // Both the {error}-returned path and the throws path must call
      // console.warn so an operator sees the orphan.
      expect(
        /auth\.admin\.deleteUser[\s\S]*?console\.warn/.test(src),
        "scripts/seed-full-app-demo.ts no longer logs auth.admin.deleteUser failures",
      ).toBe(true);
    });
  });

  // PR #179 / C-0293 — CI hardening invariants.
  //
  // PR #179 pinned every `uses:` to a 40-char SHA, added workflow-level
  // permissions blocks, and switched the frontend-build artifact to
  // placeholder-only NEXT_PUBLIC_* values. The runbook prescribes
  // verification (actionlint + manual `gh run download` grep) but
  // nothing automated catches a regression at PR-review time. The
  // retroactive specialist sequence (pr-test-analyzer) flagged three
  // HIGH-conf gaps:
  //
  //   retro-PR179-H2 — no CI gate for SHA-pin policy
  //   retro-PR179-H3 — no CI gate for placeholder-env-in-artifact
  //   retro-PR179-H4 — no contract test for the rebuild step shape
  //
  // These guards encode the invariants at the source-text level, the
  // same pattern as [CRITICAL-02] VERSION/package.json drift. Each test
  // fails locally + in CI BEFORE any workflow runs, catching the
  // exact regressions a future PR could silently land.
  describe("[CRITICAL-C0293] CI hardening invariants (PR #179)", () => {
    // B24 (workflow-security parity): discover EVERY workflow under
    // .github/workflows/ dynamically rather than enumerating a fixed list.
    // The prior hardcoded 6-file list silently omitted cassette-refresh.yml
    // (added after the list was written) — so its two unpinned actions went
    // unchecked until B24 caught them by hand. A static list is itself the
    // gap: a new workflow escapes every invariant below. Dynamic discovery
    // closes the class by construction — any future workflow is automatically
    // held to the SHA-pin / permissions / concurrency / persist-credentials
    // baseline.
    const WORKFLOW_DIR = ".github/workflows";
    const WORKFLOW_FILES = readdirSync(join(REPO_ROOT, WORKFLOW_DIR))
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort()
      .map((f) => `${WORKFLOW_DIR}/${f}`);

    // Push-capable workflows legitimately KEEP the persisted GITHUB_TOKEN
    // credential: peter-evans/create-pull-request needs it to `git push` the
    // auto-PR branch. They are EXEMPT from the persist-credentials:false rule
    // ONLY — still held to SHA-pin, permissions, and concurrency invariants.
    const PERSIST_CRED_EXEMPT = new Set([`${WORKFLOW_DIR}/cassette-refresh.yml`]);

    // Test helpers — collapse the repeated regex-assertion pattern below.
    function expectMatch(haystack: string, re: RegExp, msg: string): void {
      expect(re.test(haystack), msg).toBe(true);
    }
    function expectNoMatch(haystack: string, re: RegExp, msg: string): void {
      expect(re.test(haystack), msg).toBe(false);
    }
    // Locate a substring via regex, fail with a clear message if missing,
    // and return the first capture group (or full match if no group).
    function findOrFail(src: string, re: RegExp, msg: string): string {
      const m = src.match(re);
      expect(m, msg).not.toBeNull();
      return m![1] ?? m![0];
    }

    // B24: fail loud if dynamic discovery breaks (empty glob) or a
    // known-critical workflow is deleted — a silently-empty WORKFLOW_FILES
    // would make every per-file loop below vacuously pass, recreating the
    // exact silent gap B24 exists to close.
    it("discovers every workflow file dynamically (no silent omissions)", () => {
      expect(
        WORKFLOW_FILES.length,
        "WORKFLOW_FILES is empty/short — readdirSync glob over .github/workflows broke",
      ).toBeGreaterThanOrEqual(8);
      for (const required of [
        `${WORKFLOW_DIR}/cassette-refresh.yml`,
        `${WORKFLOW_DIR}/migration-drift-check.yml`,
        `${WORKFLOW_DIR}/ci.yml`,
        `${WORKFLOW_DIR}/supabase-migrate.yml`,
      ]) {
        expect(
          WORKFLOW_FILES,
          `${required} missing from discovered workflow set — discovery broke or the file is gone`,
        ).toContain(required);
      }
    });

    // retro-PR179-H2: SHA-pin policy. Every `uses:` must reference a
    // 40-character lowercase hex SHA — never a mutable tag (vN, main,
    // latest) or a partial SHA. First-party reusable workflows (`./...`)
    // are exempt; there are none in this repo today.
    describe("SHA-pin policy: every `uses:` must reference a 40-char SHA", () => {
      const SHA_RE = /^[a-f0-9]{40}$/;

      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — every uses: ref is a 40-char SHA`, () => {
          const src = readText(rel);
          const usesLineRe = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
          const offenders: string[] = [];
          let match: RegExpExecArray | null;
          while ((match = usesLineRe.exec(src)) !== null) {
            const fullRef = match[1];
            // Skip first-party reusable workflows (./...) — none today.
            if (fullRef.startsWith("./")) continue;
            const atIdx = fullRef.lastIndexOf("@");
            // No `@` at all is invalid for non-local refs.
            if (atIdx < 0) {
              offenders.push(`${fullRef} (no @ref)`);
              continue;
            }
            const ref = fullRef.slice(atIdx + 1);
            if (!SHA_RE.test(ref)) {
              offenders.push(`${fullRef} (ref "${ref}" is not a 40-char SHA)`);
            }
          }
          expect(
            offenders.length,
            `${rel} contains non-SHA-pinned uses references — C-0293(b) regression:\n  ${offenders.join("\n  ")}`,
          ).toBe(0);
        });
      }
    });

    // retro-PR179-H2: workflow-level permissions block. Every workflow
    // MUST declare `permissions:` at workflow level (defaulting to
    // contents: read), so a missing/typo'd block can't fall back to
    // the GITHUB_TOKEN repo default (contents: write etc.).
    describe("Workflow-level permissions: every workflow declares the minimum scope", () => {
      const PERMISSIONS_BLOCK_RE = /^permissions:\s*\n(?:\s+\S+:[\s\S]*?)(?=\n[^\s])/m;

      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — declares a top-level permissions: block with contents: read`, () => {
          const src = readText(rel);
          const block = findOrFail(
            src,
            PERMISSIONS_BLOCK_RE,
            `${rel} has no top-level permissions: block — GITHUB_TOKEN would inherit repo default (writes)`,
          );
          expectMatch(
            block,
            /contents:\s*read/,
            `${rel} top-level permissions block does not include 'contents: read'`,
          );
        });
      }
    });

    // retro-PR179-H3: frontend-build artifact MUST be built with
    // placeholder NEXT_PUBLIC_* values UNCONDITIONALLY. The previous
    // seed-aware ternary leaked TEST_SUPABASE_URL/ANON_KEY into the
    // uploaded artifact. A regression that re-introduces the ternary
    // (or any non-placeholder value) re-opens the exfil pivot.
    describe("frontend-build env: placeholder NEXT_PUBLIC_* values only", () => {
      it("ci.yml frontend-build env block uses placeholder NEXT_PUBLIC_* values and does not reference secrets.TEST_SUPABASE_*", () => {
        const src = readText(".github/workflows/ci.yml");
        // Find the frontend-build job's `npm run build` step env block.
        // The placeholder MUST appear directly in the env literal, not
        // via a secret/var expression.
        //
        // retro-PR188-F5 (red-team #36): the previous regex boundary
        // `(?=\n\s{0,6}-\s|\n[a-z])` over-captured past the env block into
        // following YAML comments. A benign doc comment mentioning
        // `secrets.TEST_SUPABASE_URL` would have triggered a false-positive.
        // Tighter approach — walk lines from the `env:` line forward,
        // collecting only indented KEY: VALUE lines (no comments, no shell
        // continuation lines), and stop at the first non-indented line or
        // dash-prefixed step. That mirrors the real YAML semantics.
        const buildStepRe =
          /frontend-build:[\s\S]*?-\s*run:\s*npm run build[\s\S]*?env:\s*\n/;
        const m = src.match(buildStepRe);
        expect(
          m,
          "ci.yml: could not locate frontend-build npm run build env block",
        ).not.toBeNull();
        const envStart = m!.index! + m![0].length;
        const tail = src.slice(envStart).split("\n");
        const envLines: string[] = [];
        // Indented YAML key lines look like `          KEY: VALUE` —
        // require at least one leading space (the env block is a YAML map
        // nested under `env:`). Stop at first non-indented line, dash-step,
        // or comment.
        for (const line of tail) {
          if (line.trim() === "") break;
          // Step boundary: a line starting with `<spaces>-` is the next step.
          if (/^\s+-\s/.test(line)) break;
          // Stop at any non-indented line (e.g. next job).
          if (/^\S/.test(line)) break;
          // Skip pure comment lines but DO NOT include them in the block.
          if (/^\s+#/.test(line)) continue;
          envLines.push(line);
        }
        const envBlock = envLines.join("\n");
        expect(
          envBlock.length,
          "ci.yml: frontend-build env block walked empty — env block format drifted",
        ).toBeGreaterThan(0);
        expectMatch(
          envBlock,
          /NEXT_PUBLIC_SUPABASE_URL:\s*https:\/\/placeholder\.supabase\.co/,
          "frontend-build env NEXT_PUBLIC_SUPABASE_URL is not the literal placeholder — C-0293(c) regression",
        );
        expectMatch(
          envBlock,
          /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*placeholder\b/,
          "frontend-build env NEXT_PUBLIC_SUPABASE_ANON_KEY is not the literal placeholder — C-0293(c) regression",
        );
        // retro-PR188-F1 (red-team #34): defensive — NO test-Supabase
        // secret may appear in the frontend-build env block. The prior
        // check only banned TEST_SUPABASE_URL; ANON_KEY + SERVICE_ROLE_KEY
        // are equally load-bearing leak vectors (the URL+anon pair is
        // enough to auth against the test project; SERVICE_ROLE_KEY bypasses
        // RLS entirely). Broaden to a prefix match so any current or future
        // TEST_SUPABASE_* secret addition is caught.
        expectNoMatch(
          envBlock,
          /secrets\.TEST_SUPABASE_/,
          "frontend-build env references a secrets.TEST_SUPABASE_* — C-0293(c) seed-aware ternary regression (URL/ANON_KEY/SERVICE_ROLE_KEY all banned)",
        );
      });

      // retro-PR179-H4: seed-gated rebuild step contract. The step
      // MUST (a) be gated on vars.E2E_TEST_DB_CONFIGURED, (b) wipe
      // .next/server + .next/static + the 3 manifests, (c) re-run
      // `npm run build` with the REAL secrets in env.
      it("ci.yml seed-gated rebuild step has the required shape (contract for C-0293(c) Path 2)", () => {
        const src = readText(".github/workflows/ci.yml");
        // The rebuild step's identifying name is unique in the file.
        const step = findOrFail(
          src,
          /-\s*name:\s*Rebuild Next\.js with real test-Supabase env[\s\S]*?(?=\n\s{0,6}-\s)/,
          "ci.yml: rebuild step name not found — Path 2 contract drifted",
        );
        // (a) gated on vars.E2E_TEST_DB_CONFIGURED
        expectMatch(
          step,
          /if:\s*\$\{\{\s*vars\.E2E_TEST_DB_CONFIGURED\s*==\s*'true'\s*\}\}/,
          "rebuild step not gated on vars.E2E_TEST_DB_CONFIGURED — would run on fork PRs and burn rebuild cost",
        );
        // (b) wipes the placeholder manifests before rebuild
        expectMatch(
          step,
          /rm\s+-rf\s+\.next\/server\s+\.next\/static/,
          "rebuild step no longer wipes .next/server + .next/static — placeholder chunks could leak through",
        );
        // (c) re-runs `npm run build` with REAL secrets in env (not
        // placeholder values). secrets.TEST_SUPABASE_URL must appear
        // in the env block.
        expectMatch(step, /npm run build/, "rebuild step no longer runs `npm run build`");
        expectMatch(
          step,
          /NEXT_PUBLIC_SUPABASE_URL:\s*\$\{\{\s*secrets\.TEST_SUPABASE_URL\s*\}\}/,
          "rebuild step env no longer wires secrets.TEST_SUPABASE_URL — seed-gated specs would run against placeholder bundle",
        );
        expectMatch(
          step,
          /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*\$\{\{\s*secrets\.TEST_SUPABASE_ANON_KEY\s*\}\}/,
          "rebuild step env no longer wires secrets.TEST_SUPABASE_ANON_KEY",
        );
      });
    });

    // retro-PR179-M (#20/#21): include-hidden-files: true on the
    // frontend-build upload step. Without this flag, upload-artifact@v4
    // silently excludes the dotfile-prefixed `.next/` directory and the
    // e2e job crashes with "Could not find a production build". This is
    // operational knowledge captured in YAML comments; the regression
    // test pins the invariant.
    describe("upload-artifact invariants", () => {
      it("ci.yml frontend-build upload step must set include-hidden-files: true", () => {
        const src = readText(".github/workflows/ci.yml");
        const step = findOrFail(
          src,
          /-\s*name:\s*Upload \.next \+ public artifact for e2e[\s\S]*?(?=\n\s{0,6}-\s|\n[a-z])/,
          "ci.yml: frontend-build upload step name not found",
        );
        expectMatch(
          step,
          /include-hidden-files:\s*true/,
          "frontend-build upload step missing include-hidden-files: true — .next/ silently excluded, e2e crashes",
        );
      });

      // retro-PR188-F2 (pr-test-analyzer #41, HIGH/9) + F6/F7
      // (red-team #26/#37, HIGH/8-9): the playwright-report artifact
      // upload MUST be gated so it does not fire on the seed-gated path
      // (where the rebuilt `.next/` contains real TEST_SUPABASE_URL /
      // ANON_KEY and Playwright's on-failure trace captures the JS
      // chunks). A future PR could trivially revert the conditional to
      // bare `if: failure()`, re-opening the exfil pivot. Pin the gate.
      //
      // Fail-CLOSED semantics: the gate should be checked against the
      // literal 'true' string only. A fail-OPEN inverted gate
      // (!= 'false') would open the upload on the seed-gated path.
      it("ci.yml Upload Playwright report on failure is gated against the seed-gated path", () => {
        const src = readText(".github/workflows/ci.yml");
        // Locate the step by its unique name, then walk to the next step
        // boundary (`<spaces>-`) or non-indented line, or EOF. The previous
        // attempt's lookahead boundary `(?=\n\s{0,6}-\s|\n[a-z])` did not
        // match this step because it is the LAST step in the e2e job —
        // there is no trailing step or next job to anchor on.
        const stepStart = src.search(/-\s*name:\s*Upload Playwright report on failure/);
        expect(
          stepStart,
          "ci.yml: Upload Playwright report on failure step not found — retro-PR179-H1 fix reverted?",
        ).toBeGreaterThanOrEqual(0);
        const stepTail = src.slice(stepStart).split("\n");
        const stepLines: string[] = [];
        for (let i = 0; i < stepTail.length; i++) {
          const line = stepTail[i];
          if (i > 0 && /^\s+-\s/.test(line)) break;
          if (i > 0 && /^\S/.test(line)) break;
          stepLines.push(line);
        }
        const step = stepLines.join("\n");
        expect(
          step.length,
          "ci.yml: Upload Playwright report on failure step body walked empty",
        ).toBeGreaterThan(0);
        // Must reference the seed-gate variable explicitly.
        expectMatch(
          step,
          /vars\.E2E_TEST_DB_CONFIGURED/,
          "Upload Playwright report step lost the vars.E2E_TEST_DB_CONFIGURED gate — retro-PR179-H1 / C-0293(c) exfil re-opens",
        );
        // Accept either an explicit allow-list (== '' || == 'false') OR
        // the documented `!= 'true'` form. Both deny upload when the
        // seed-gated rebuild ran. Reject other gate variants.
        const hasFailClosedAllowlist =
          /E2E_TEST_DB_CONFIGURED\s*==\s*''|E2E_TEST_DB_CONFIGURED\s*==\s*'false'/.test(step);
        const hasNegationGate = /E2E_TEST_DB_CONFIGURED\s*!=\s*'true'/.test(step);
        expect(
          hasFailClosedAllowlist || hasNegationGate,
          "Upload Playwright report step gate must check vars.E2E_TEST_DB_CONFIGURED against 'true' — current expression does not match either accepted form",
        ).toBe(true);
        // Anti-pattern explicitly forbidden: a `!= 'false'` negation
        // (the inverse of the intent) would open the upload on the
        // seed-gated path. If a future refactor flips the operator this
        // test fails loud.
        expectNoMatch(
          step,
          /E2E_TEST_DB_CONFIGURED\s*!=\s*'false'/,
          "Upload Playwright report step uses the INVERTED gate (!= 'false') — opens uploads on the seed-gated REAL-creds path",
        );
      });
    });

    // H-1024 (pr-test-analyzer): the non-seeded ("placeholder-env") e2e
    // lane MUST carry at least one assertion that an
    // allocator/strategy-manager-protected route redirects an
    // unauthenticated visitor to /login. That is the only signal in the
    // CI lane that route protection / middleware wiring still works when
    // no seeded staging Supabase is configured (forks, fresh clones).
    // The seeded authenticated flows are gated behind
    // vars.E2E_TEST_DB_CONFIGURED, so without this fallback the entire
    // protected surface ships with zero e2e signal on the default lane.
    //
    // The invariant is split across two artifacts:
    //   (1) ci.yml's UNCONDITIONAL `npx playwright test ...` invocation
    //       must include the spec that carries the redirect assertion
    //       (auth.spec.ts today), and
    //   (2) that spec must actually assert a protected route → /login
    //       redirect.
    // Pinning BOTH stops a regression that either drops the spec from
    // the CI command or guts the redirect assertion inside it.
    describe("H-1024 — placeholder-env e2e lane covers protected-route redirect", () => {
      // The first `npx playwright test e2e/...` line in the e2e job is
      // the UNCONDITIONAL invocation (the seed-gated one is wrapped in a
      // separate, vars-gated step). We isolate it so a seed-gated-only
      // addition of auth coverage can't satisfy this test.
      function unconditionalPlaywrightCmd(src: string): string {
        return findOrFail(
          src,
          /npx playwright test (e2e\/[^\n]*)/,
          "ci.yml: could not locate the unconditional `npx playwright test e2e/...` command in the e2e job — e2e lane shape drifted",
        );
      }

      it("ci.yml unconditional e2e command includes the protected-route-redirect spec (auth.spec.ts)", () => {
        const src = readText(".github/workflows/ci.yml");
        const cmd = unconditionalPlaywrightCmd(src);
        expectMatch(
          cmd,
          /\be2e\/auth\.spec\.ts\b/,
          "ci.yml unconditional e2e command no longer runs e2e/auth.spec.ts — the only placeholder-env carrier of the protected-route → /login redirect assertion (H-1024). Authenticated surface would ship with zero route-protection signal on the non-seeded lane.",
        );
      });

      it("e2e/auth.spec.ts asserts an allocator-protected route redirects an unauthenticated visitor to /login", () => {
        const spec = readText("e2e/auth.spec.ts");
        // Must navigate to a protected route (the strategies dashboard /
        // allocator surface) AND assert the resulting URL is /login.
        // Without the goto, a redirect assertion proves nothing; without
        // the /login URL assertion, the protection isn't verified.
        expectMatch(
          spec,
          /page\.goto\(\s*["'`]\/(?:strategies|allocator)[^"'`]*["'`]\s*\)/,
          "e2e/auth.spec.ts no longer navigates to a protected /strategies or /allocator route — H-1024 redirect coverage gutted",
        );
        expectMatch(
          spec,
          /toHaveURL\(\s*\/[^/]*login/,
          "e2e/auth.spec.ts no longer asserts the protected-route navigation redirects to /login — H-1024 route-protection signal lost",
        );
      });
    });

    // retro-PR188-F3 (pr-test-analyzer #42, red-team #39/#42, HIGH/9):
    // every actions/checkout invocation across the discovered workflow
    // files MUST set `persist-credentials: false`. Without it, GITHUB_TOKEN
    // is written to .git/config and stays readable to every subsequent
    // step in the same job — including pinned third-party actions
    // (gitleaks-action, lycheeverse/lychee-action, supabase/setup-cli)
    // whose SHAs could in principle be compromised. The PR-188 fix
    // applied the flag at all sites; this test prevents a future
    // PR from quietly dropping it from a new checkout site or an
    // existing one. PERSIST_CRED_EXEMPT workflows (which push via
    // create-pull-request and need the credential) are excluded here but
    // remain bound to every other invariant in this block.
    describe("persist-credentials policy: every actions/checkout sets persist-credentials: false", () => {
      for (const rel of WORKFLOW_FILES.filter((r) => !PERSIST_CRED_EXEMPT.has(r))) {
        it(`${rel} — every actions/checkout invocation sets persist-credentials: false`, () => {
          const src = readText(rel);
          // Find each `uses: actions/checkout@...` and the immediate
          // `with:` block that follows. The with block is the indented
          // YAML map at the next line; we collect lines until the next
          // step boundary (`-` prefix) or non-indented line.
          const checkoutRe = /-\s*uses:\s*actions\/checkout@[a-f0-9]+[^\n]*\n/g;
          const matches: { idx: number; matchText: string }[] = [];
          let m: RegExpExecArray | null;
          while ((m = checkoutRe.exec(src)) !== null) {
            matches.push({ idx: m.index + m[0].length, matchText: m[0] });
          }
          expect(
            matches.length,
            `${rel} has zero actions/checkout invocations — workflow may have lost the checkout step entirely`,
          ).toBeGreaterThan(0);
          const offenders: string[] = [];
          for (const { idx, matchText } of matches) {
            // Walk lines after the `uses:` line. Stop at the next step
            // (`<spaces>-`) or non-indented line.
            const after = src.slice(idx).split("\n");
            const blockLines: string[] = [];
            for (const line of after) {
              if (line.trim() === "") {
                blockLines.push(line);
                continue;
              }
              if (/^\s+-\s/.test(line)) break;
              if (/^\S/.test(line)) break;
              blockLines.push(line);
            }
            const block = blockLines.join("\n");
            if (!/persist-credentials:\s*false/.test(block)) {
              offenders.push(matchText.trim());
            }
          }
          expect(
            offenders.length,
            `${rel} has actions/checkout site(s) missing persist-credentials: false — retro-PR179-M-persist-chain regression. Offenders:\n  ${offenders.join("\n  ")}`,
          ).toBe(0);
        });
      }
    });

    // retro-PR188-F4 (pr-test-analyzer #43, HIGH/8): both jobs in
    // supabase-migrate.yml MUST declare `environment: Production` so
    // the SUPABASE_DB_PASSWORD secret routes through the same
    // required-reviewer gate. PR #188 commit 4 made the plan job
    // mirror apply; without a test the asymmetry can re-emerge in a
    // future rebase.
    describe("supabase-migrate plan/apply env-gate symmetry", () => {
      it("supabase-migrate.yml plan job declares environment: Production", () => {
        const src = readText(".github/workflows/supabase-migrate.yml");
        // Anchor on the start-of-line `  plan:` job key followed by its
        // body. Stop at the next top-level job key (2-space indent + name).
        const planJob = findOrFail(
          src,
          /^ {2}plan:\s*\n([\s\S]*?)(?=\n {2}[a-z])/m,
          "supabase-migrate.yml: plan job not found",
        );
        expectMatch(
          planJob,
          /environment:\s*Production/,
          "supabase-migrate plan job lost the environment: Production gate — SUPABASE_DB_PASSWORD plan/apply gate-skew (red-team #38 threat)",
        );
      });
      it("supabase-migrate.yml apply job declares environment: Production", () => {
        const src = readText(".github/workflows/supabase-migrate.yml");
        // Apply is the last top-level job; capture from `^  apply:` to EOF.
        // The `$` anchor in multiline mode only matches end-of-line, so use
        // a lookahead that matches either the next top-level job or EOL+EOF.
        const applyIdx = src.search(/^ {2}apply:\s*\n/m);
        expect(
          applyIdx,
          "supabase-migrate.yml: apply job not found",
        ).toBeGreaterThanOrEqual(0);
        const applyJob = src.slice(applyIdx);
        expectMatch(
          applyJob,
          /environment:\s*Production/,
          "supabase-migrate apply job lost the environment: Production gate — required-reviewer protection bypass",
        );
      });
    });

    // retro-PR188-F8 (red-team #35, HIGH/9): the SHA-pin regex test
    // operates on source text. YAML anchors (&name) + aliases (*name)
    // could in theory be used to indirect a uses: value through an
    // alias, bypassing the per-line regex assertion. Add a defensive
    // negative assertion: no anchors or aliases may appear in
    // workflow files. None do today; the test refuses to allow them
    // to creep in until a proper YAML-AST walker lands.
    describe("YAML anchor/alias guard (defensive)", () => {
      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — no YAML anchors or aliases at value position`, () => {
          const src = readText(rel);
          // Restrict to YAML "value" position: after a `:` and whitespace.
          // This avoids false positives on `**/*.js` glob patterns or
          // `&&` shell operators inside run: blocks.
          const anchorRe = /:\s+&[A-Za-z_][\w-]*/;
          const aliasRe = /:\s+\*[A-Za-z_][\w-]*/;
          expectNoMatch(
            src,
            anchorRe,
            `${rel} contains a YAML anchor — SHA-pin invariant test does not dereference anchors`,
          );
          expectNoMatch(
            src,
            aliasRe,
            `${rel} contains a YAML alias — SHA-pin invariant test does not dereference aliases`,
          );
        });
      }
    });

    // retro-PR188-F10 (red-team #40, MEDIUM/8): every workflow must
    // declare EXACTLY ONE top-level `permissions:` block. The
    // existing PERMISSIONS_BLOCK_RE matches greedily; a future PR
    // splitting the block could pass undetected. Pin the cardinality.
    describe("permissions block cardinality: exactly one top-level permissions block per workflow", () => {
      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — declares exactly one top-level permissions: block`, () => {
          const src = readText(rel);
          // Top-level = column-0 `permissions:` (multiline anchor).
          const topLevel = src.match(/^permissions:/gm) ?? [];
          expect(
            topLevel.length,
            `${rel} top-level permissions: block count = ${topLevel.length} (expected 1) — split or missing block can confuse GH Actions defaults`,
          ).toBe(1);
        });
      }
    });

    // B24 — concurrency on merge-path workflows. A workflow triggered by
    // `pull_request` or `push` MUST declare a top-level `concurrency:` group
    // so overlapping runs on the same ref cancel/serialize instead of
    // racing — wasted CI minutes, and on supabase-migrate two racing
    // `db push` runs are a real correctness hazard. Schedule- /
    // workflow_dispatch-only workflows (nightly, phase-19-stability) are
    // exempt: overlapping scheduled runs are rare and their jobs (issue
    // dedup, probes) are idempotent.
    describe("concurrency: PR/push-triggered workflows declare a concurrency group", () => {
      // Extract the top-level `on:` value (block body OR inline value). The
      // parser must be robust to: the quoted key (`"on":` / `'on':` — YAML
      // 1.1's "Norway problem", since bare `on` is the boolean true), blank
      // lines inside the block, the inline-array (`on: [push]`) and inline
      // flow-map (`on: {push: …}`) forms, and the single-string form
      // (`on: push`). A brittle parser here lets a PR/push workflow silently
      // escape the concurrency invariant — the one rule whose enforcement
      // keys off parsing `on:` (B24 review finding + red-team).
      const onValue = (src: string): string => {
        const lines = src.split("\n");
        const startRe = /^(?:on|"on"|'on'):(.*)$/;
        const i = lines.findIndex((l) => startRe.test(l));
        if (i < 0) return "";
        const inlineVal = lines[i].match(startRe)![1].trim();
        if (inlineVal) return inlineVal; // inline: string / [array] / {flow-map}
        // Block form: collect indented AND blank lines until the next
        // column-0 key (a non-indented, non-blank line ends the block).
        const body: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];
          if (line.trim() === "" || /^[ \t]/.test(line)) {
            body.push(line);
            continue;
          }
          break;
        }
        return body.join("\n");
      };
      // pull_request_target listed first so its `pull_request` substring
      // doesn't shadow it; all four are merge-path / write-class triggers.
      const MERGE_TRIGGERS = "(pull_request_target|pull_request|push|merge_group)";
      const isMergePathTriggered = (src: string): boolean => {
        const val = onValue(src);
        if (!val) return false;
        // Inline form (single line): `on: push` | `on: [push, pr]` | `on: {push: …}`
        if (!val.includes("\n")) return new RegExp(`\\b${MERGE_TRIGGERS}\\b`).test(val);
        // Block form: an event key at indent, e.g. `  push:` / `  pull_request:`
        return new RegExp(`^[ \\t]+${MERGE_TRIGGERS}:`, "m").test(val);
      };
      const mergePathWorkflows = WORKFLOW_FILES.filter((rel) =>
        isMergePathTriggered(readText(rel)),
      );
      // Pin the EXACT merge-path set by name — if the parser silently
      // under-detects (a quoted-`on:` / blank-line regression drops a
      // workflow) or a new PR/push workflow is added, this fails and forces a
      // conscious update rather than a silent gap.
      it("classifies exactly the known PR/push-triggered workflows", () => {
        expect([...mergePathWorkflows].sort()).toEqual([
          `${WORKFLOW_DIR}/ci.yml`,
          `${WORKFLOW_DIR}/migration-drift-check.yml`,
          `${WORKFLOW_DIR}/migration-policy-self-test.yml`,
          `${WORKFLOW_DIR}/migration-policy.yml`,
          `${WORKFLOW_DIR}/supabase-migrate.yml`,
        ]);
      });
      // Parser robustness — synthetic fixtures proving the `on:` classifier
      // is not spelling-/whitespace-sensitive (B24 review + red-team).
      it("isMergePathTriggered handles quoted, blank-line, inline, and string on: forms", () => {
        const T = isMergePathTriggered;
        // quoted key ("Norway problem")
        expect(T(`"on":\n  pull_request:\n    branches: [main]\n`)).toBe(true);
        expect(T(`'on':\n  push:\n`)).toBe(true);
        // a blank line inside the on: block must not truncate detection
        expect(T(`on:\n  workflow_dispatch:\n\n  push:\n    branches: [main]\n`)).toBe(true);
        // inline array / flow-map / single-string forms
        expect(T(`on: [push, pull_request]\n`)).toBe(true);
        expect(T(`on: {push: {branches: [main]}}\n`)).toBe(true);
        expect(T(`on: push\n`)).toBe(true);
        // merge_group + pull_request_target are merge-path / write-class
        expect(T(`on:\n  merge_group:\n`)).toBe(true);
        expect(T(`on:\n  pull_request_target:\n`)).toBe(true);
        // schedule/dispatch-only must NOT be classified merge-path
        expect(T(`on:\n  schedule:\n    - cron: "0 8 * * *"\n  workflow_dispatch:\n`)).toBe(false);
      });
      for (const rel of mergePathWorkflows) {
        it(`${rel} — declares a top-level concurrency: group`, () => {
          const src = readText(rel);
          expect(
            /^concurrency:/m.test(src),
            `${rel} is pull_request/push-triggered but has no top-level concurrency: group — overlapping runs on the same ref race/waste CI (B24 workflow-security baseline)`,
          ).toBe(true);
        });
      }
    });

    // B24 — nightly fail-loud canary guard (H-1026 / B23 M-0849). The
    // demo-pdf probe's missing-DEMO_PDF_SECRET branch must `::error::` +
    // `exit 1` so the `if: failure()` issue path fires. A silent `exit 0`
    // there re-opens the regression this workflow exists to catch (a
    // rotated/lost secret silently disabling the cold-start canary). Pin the
    // fail-loud contract at the source-text level so a rebase can't quietly
    // revert it.
    describe("nightly demo-pdf canary fails loud on missing DEMO_PDF_SECRET", () => {
      it("nightly.yml missing-secret guard emits ::error:: + exit 1, never exit 0", () => {
        const src = readText(".github/workflows/nightly.yml");
        const guard = findOrFail(
          src,
          /if \[ -z "\$DEMO_PDF_SECRET" \]; then([\s\S]*?)\n\s*fi/m,
          "nightly.yml: DEMO_PDF_SECRET missing-secret guard block not found",
        );
        expectMatch(
          guard,
          /::error::/,
          "nightly DEMO_PDF_SECRET guard must emit ::error:: (fail loud, not ::warning::)",
        );
        expectMatch(
          guard,
          /exit 1/,
          "nightly DEMO_PDF_SECRET guard must `exit 1` so the if: failure() issue path fires",
        );
        expectNoMatch(
          guard,
          /exit 0/,
          "nightly DEMO_PDF_SECRET guard must NOT `exit 0` — silent-green regression (H-1026 / M-0849)",
        );
      });
    });

    // retro-PR193-M-4 (migration-reviewer MEDIUM/8): the
    // migration-policy.yml reject + malformed branches had never been
    // exercised in CI before this PR; only the early-exit branch ran
    // on PR #193 itself. Three guards pin the algorithm at the source
    // level so future regressions can't silently elide a branch:
    //
    //   1. The workflow YAML contains the literal timestamp-comparison
    //      `if [[ "$ts" < "$REMOTE_TIP" ]]` (reject decision point)
    //      AND the literal `grep -qFx` allowlist match. Removing
    //      either expression would skip the reject path entirely.
    //   2. The workflow YAML contains the malformed-filename regex
    //      check `[[ "$ts" =~ ^[0-9]{14}$ ]]`. Removing it would
    //      skip the malformed branch.
    //   3. The byte-equivalent algorithm is also extracted into
    //      `scripts/test-migration-policy-algorithm.sh`, which the
    //      `migration-policy-self-test.yml` workflow drives against
    //      a 6-case matrix (early-exit, forward, allowlisted, reject,
    //      malformed, mixed). The shell script MUST contain the same
    //      literals; if a regression removes a branch from EITHER the
    //      real workflow OR the self-test script, the matrix or this
    //      test fails.
    //
    // This mirrors the [CRITICAL-02] VERSION/package.json drift and
    // SHA-pin source-text invariants — pin the contract at the text
    // level so it can't drift unnoticed.
    describe("retro-PR193-M-4 — migration-policy algorithm source-text invariants", () => {
      it("migration-policy.yml contains the reject-path timestamp comparison literal", () => {
        const src = readText(".github/workflows/migration-policy.yml");
        expect(
          /if \[\[ "\$ts" < "\$REMOTE_TIP" \]\]/.test(src),
          "migration-policy.yml: reject-path comparison literal `if [[ \"$ts\" < \"$REMOTE_TIP\" ]]` missing — backdated migrations would not be detected",
        ).toBe(true);
      });
      it("migration-policy.yml contains the allowlist exact-match grep literal", () => {
        const src = readText(".github/workflows/migration-policy.yml");
        expect(
          /grep -qFx "\$ts"/.test(src),
          "migration-policy.yml: allowlist exact-match `grep -qFx \"$ts\"` missing — allowlist entries would be ignored or partial-match (security hole: substring match would allowlist any timestamp containing an entry as a substring)",
        ).toBe(true);
      });
      it("migration-policy.yml contains the malformed-filename 14-digit regex", () => {
        const src = readText(".github/workflows/migration-policy.yml");
        expect(
          /\[\[ "\$ts" =~ \^\[0-9\]\{14\}\$ \]\]/.test(src),
          "migration-policy.yml: malformed-filename regex `[[ \"$ts\" =~ ^[0-9]{14}$ ]]` missing — files without a 14-digit prefix would pass silently",
        ).toBe(true);
      });
      it("migration-policy.yml policy job does NOT pin environment: Production (retro-PR193 H-1)", () => {
        const src = readText(".github/workflows/migration-policy.yml");
        // Locate the `policy:` job body, stop at the next top-level
        // key (column 0) or EOF. The policy job is the only job in
        // this workflow so we anchor on `  policy:` and read to EOF.
        const m = src.match(/^ {2}policy:\s*\n([\s\S]*)/m);
        expect(
          m,
          "migration-policy.yml: policy job not found",
        ).not.toBeNull();
        expect(
          /^\s*environment:\s*Production/m.test(m![1]),
          "migration-policy.yml policy job inherited `environment: Production` — PR-gate would block on future ADR-0009 required-reviewer protection, defeating the automated-gate property (retro-PR193 H-1)",
        ).toBe(false);
      });
      it("scripts/test-migration-policy-algorithm.sh contains the byte-equivalent reject + malformed literals", () => {
        const src = readText("scripts/test-migration-policy-algorithm.sh");
        expect(
          /if \[\[ "\$ts" < "\$REMOTE_TIP" \]\]/.test(src),
          "test-migration-policy-algorithm.sh: missing reject-path comparison — self-test would not exercise the reject branch",
        ).toBe(true);
        expect(
          /grep -qFx "\$ts"/.test(src),
          "test-migration-policy-algorithm.sh: missing allowlist exact-match — self-test would not exercise the allowlisted branch",
        ).toBe(true);
        expect(
          /\[\[ "\$ts" =~ \^\[0-9\]\{14\}\$ \]\]/.test(src),
          "test-migration-policy-algorithm.sh: missing malformed-filename regex — self-test would not exercise the malformed branch",
        ).toBe(true);
      });
      it("migration-policy-self-test.yml drives all six algorithm cases", () => {
        const src = readText(".github/workflows/migration-policy-self-test.yml");
        // Each case is a named step; pin the case-name literals so
        // a future PR can't quietly drop one.
        const required = [
          /Case 1 — early-exit/,
          /Case 2 — forward-only/,
          /Case 3 — allowlisted backdated/,
          /Case 4 — REJECT path/,
          /Case 5 — MALFORMED filename/,
          /Case 6 — MIXED/,
        ];
        for (const re of required) {
          expect(
            re.test(src),
            `migration-policy-self-test.yml missing required case step matching ${re}`,
          ).toBe(true);
        }
      });
    });
  });
});
