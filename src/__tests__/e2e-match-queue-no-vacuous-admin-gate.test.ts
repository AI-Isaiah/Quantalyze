/**
 * Structural regression guard for the TESTABLE, in-repo half of H-1050 /
 * M-0876 (audit-2026-05-07, group G03 re-fix).
 *
 * WHAT H-1050 / M-0876 ARE ABOUT
 * ------------------------------
 * `e2e/match-queue.spec.ts` had three admin-path tests that SILENTLY no-op'd
 * when the test account was not admin:
 *   - the body wrapped in `if (hasDashboard) { ... }` (no assertion otherwise),
 *   - an early `return;` when the URL didn't end `/admin/match`,
 *   - a `Promise.race` whose branches swallowed timeouts.
 * Combined with a hardcoded committed credential, a credential rotation that
 * dropped the admin role flipped these tests from real coverage to vacuous
 * green — "CI is green, role is fine" while the admin path was never run.
 *
 * WHAT THIS GUARD CLOSES (and what it deliberately does NOT)
 * ---------------------------------------------------------
 * The admin-role-drop is only DETECTABLE when match-queue.spec.ts actually
 * executes against a seeded admin account — which is gated on CI infra
 * (the spec is NOT in the ci.yml Playwright allowlist, and E2E_ADMIN_* are
 * not wired). That detection cannot be delivered from a unit test, so it is
 * tracked as deferred infra on the finding.
 *
 * What IS closeable here, and runs in the vitest CI job, is the SPEC SHAPE:
 * this guard reads the spec source (the `fs.readFileSync` parity-test pattern
 * already used across `src/__tests__/`) and FAILS LOUD if anyone reverts the
 * remediation — re-introducing a hardcoded credential, a silent
 * `if (hasDashboard)` body, an early `return;` bail-out, or the env-gated
 * reported-skip. So the anti-pattern cannot silently creep back in.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function readSpec(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

/**
 * Strip line + block comments so assertions about the EXECUTABLE source are
 * not satisfied/violated by prose in doc comments (e.g. a comment that quotes
 * the old `if (hasDashboard)` pattern while describing the fix).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HARDCODED_CRED = "matratzentester24@gmail.com";
const HARDCODED_PW = "Test12";

describe("e2e/match-queue.spec.ts — admin-gate is not vacuous (H-1050 / M-0876)", () => {
  const raw = readSpec("e2e/match-queue.spec.ts");
  const code = stripComments(raw);

  it("contains no hardcoded plaintext credential in executable code", () => {
    // The committed-credential leg of the H-1050 chain. The reference inside
    // the file's doc comment (describing what was removed) is allowed; an
    // executable string literal is not.
    expect(
      code.includes(HARDCODED_CRED),
      `match-queue.spec.ts re-introduced the committed credential ` +
        `${HARDCODED_CRED} in executable code. Source creds from ` +
        `E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD instead (H-1050).`,
    ).toBe(false);
    expect(code.includes(`"${HARDCODED_PW}"`) || code.includes(`'${HARDCODED_PW}'`)).toBe(false);
  });

  it("sources admin creds from env, not from a literal", () => {
    expect(code).toContain("process.env.E2E_ADMIN_EMAIL");
    expect(code).toContain("process.env.E2E_ADMIN_PASSWORD");
    expect(code).toMatch(/const\s+HAS_ADMIN_CREDS\s*=/);
  });

  it("gates admin-path tests with a REPORTED skip (not a silent branch)", () => {
    // Every admin-path test must be skip-gated on HAS_ADMIN_CREDS so the CI
    // summary SAYS "skipped" rather than passing vacuously. The describe
    // blocks that exercise the admin UI / eval / preferences pages each carry
    // a `test.skip(!HAS_ADMIN_CREDS, ...)` gate.
    const skipGates = code.match(/test\.skip\(\s*!HAS_ADMIN_CREDS/g) ?? [];
    expect(
      skipGates.length,
      "expected the admin-path describe/test blocks to be gated by " +
        "`test.skip(!HAS_ADMIN_CREDS, ...)`; the reported-skip is what makes " +
        "a missing/rotated admin credential VISIBLE instead of silently green.",
    ).toBeGreaterThanOrEqual(3);
  });

  it("has no silent `if (hasDashboard)` wrapper or early-return bail-out in test bodies", () => {
    // The two vacuous shapes the finding named. Asserted against
    // comment-stripped source so the doc comments that quote the OLD pattern
    // (to explain the fix) do not trip the guard. The anti-pattern is the
    // CONTROL-FLOW wrapper `if (hasDashboard) {` (opening brace) — the
    // backtick-quoted reference inside an `expect(...)` failure-message
    // string ("Prior `if (hasDashboard)` wrapper ...") has no following
    // brace and is therefore not matched.
    expect(
      /if\s*\(\s*hasDashboard[^)]*\)\s*\{/.test(code),
      "a silent `if (hasDashboard) { ... }` wrapper reappeared in " +
        "match-queue.spec.ts — that body passes with NO assertion when the " +
        "account is not admin (M-0876). Assert the admin surface positively.",
    ).toBe(false);
    // A bare `return;` inside a Playwright test() callback was the early-out
    // bail. There are no legitimate early `return;` statements in this spec's
    // test bodies, so any occurrence is the regression.
    expect(
      /\breturn;\s*$/m.test(code),
      "an early `return;` bail-out reappeared in match-queue.spec.ts — that " +
        "silently skips the remaining assertions (M-0876). Use a reported " +
        "`test.skip(...)` gate instead.",
    ).toBe(false);
  });

  it("asserts the admin eval surface POSITIVELY (catches a dropped admin role when the spec runs)", () => {
    // When the spec DOES run with admin creds (staging), the eval test must
    // make a positive visibility assertion so a demoted admin (bounced to
    // /discovery) fails loud. This is the assertion the old `if`-wrapper
    // suppressed. We pin its presence so a future edit can't re-soften it.
    expect(code).toMatch(/await expect\(\s*\n?\s*page\.locator\("text=Match engine eval"\)/);
    expect(code).toContain('expect(page.url()).toContain("/admin/match/eval")');
  });
});
