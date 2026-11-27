/**
 * Phase 244 DBACC-06 - keep the discovery watchlist e2e spec where a failure is
 * red, and keep its RLS proof able to fail.
 *
 * WHY THIS FILE EXISTS. `e2e/discovery-watchlist.spec.ts` holds the only e2e
 * proof that one user cannot read another user's `user_favorites` rows (the
 * migration 024 policy), and it ran nowhere for its whole life: no workflow
 * listed it. Phase 244 DBACC-06 put it in the `e2e-seeded` job, which the
 * `frontend` aggregator judges. This test pins five ways that placement and the
 * spec's content can quietly stop meaning anything:
 *   1. the spec drops out of the seeded list,
 *   2. it is added to the advisory list (the unseeded `e2e` job's step has
 *      `continue-on-error` and no aggregator needs it),
 *   3. the spec grows a skip besides its one `HAS_SEED_ENV` precondition, or a
 *      fixme or an only, so it can pass without running,
 *   4. the primary RLS proof regains its silent skip when the anon key is unset,
 *   5. a load-bearing RLS or auth anchor disappears (the policy-leak message,
 *      the sign-in, the `user_favorites` read, the proxy's 307 on anonymous PUT).
 *   Round-1 review (WR-02 / SFH-M2) added the arms that stop an anchor being
 *   satisfied by unrelated text: the user-B bare SELECT statement shape, the
 *   `toHaveLength(0)` on the visible-rows array, the `toBe(307)` on the status
 *   assertion, the `HAS_SEED_ENV` definition against the names the lane handoff
 *   exports, the exact `test.skip(!HAS_SEED_ENV,` form, and no early return or
 *   `if` between the anon-key assertion and the RLS LEAK assertion.
 *   Round-2 (SFH2-M2) added the seed and session arms: user-A's favorite is upserted and its
 *   `insertError` asserted null, and the bare SELECT runs on `userBClient`'s own sign-in.
 *
 * WHAT IT DELIBERATELY DOES NOT PIN. The seeded step's tolerance
 * (`continue-on-error`, errexit off, anything chained after the invocation):
 * `manager-keys-e2e-wiring.test.ts` pins that once for every listed spec. And
 * the runtime `HAS_SEED_ENV` skip: a source scan cannot see it, so the evidence
 * is the `e2e-seeded` log on the PR head SHA showing the watchlist tests passed
 * and none skipped. What the scan CAN do is keep the skip condition the exact
 * two env names the lane exports, so the skip cannot be widened into a no-op.
 *
 * The seeded-list parser is a local copy of the one in
 * manager-keys-e2e-wiring.test.ts: importing a test file would register its
 * tests a second time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CI_WORKFLOW = ".github/workflows/ci.yml";
const SPEC = "e2e/discovery-watchlist.spec.ts";
const SEEDED_STEP_NAME = "- name: Run seed-gated specs (MA-8 / BLOCK-3)";
/** The advisory list is the unseeded `e2e` job's line that carries the smoke spec. */
const ADVISORY_ANCHOR = "e2e/smoke.spec.ts";

function readRepoFile(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

/** Uncommented lines of `text`, original indentation kept. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*#/.test(line));
}

/** The seeded step's text, from its name to the next step. Empty when missing. */
function seededStep(workflow: string): string {
  const start = workflow.indexOf(SEEDED_STEP_NAME);
  if (start === -1) return "";
  const rest = workflow.slice(start + SEEDED_STEP_NAME.length);
  const nextStep = rest.search(/\n\s*- name:/);
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}

/** The specs named by the seeded `else` arm's invocation, up to `--timeout`. */
function parseSeededSpecs(step: string): string[] {
  const elseArm = step.match(/\belse\s*\n\s*npx playwright test\b([\s\S]*?)--timeout/);
  if (!elseArm) return [];
  return [...new Set(elseArm[1].match(/e2e\/[\w.-]+\.spec\.ts/g) ?? [])];
}

describe("the discovery watchlist e2e spec stays in the blocking lane (Phase 244 DBACC-06)", () => {
  const workflow = readRepoFile(CI_WORKFLOW);
  const step = seededStep(workflow);
  const code = stripCommentsPreserveLines(readRepoFile(SPEC));

  it("the seeded list names the watchlist spec", () => {
    const seeded = parseSeededSpecs(step);
    expect(
      seeded.length,
      `Parsed no specs from the "${SEEDED_STEP_NAME}" step of ${CI_WORKFLOW}. The parser lost the list: ` +
        "fix the parser, because an empty list would pass the membership check below as 'absent'.",
    ).toBeGreaterThan(0);
    expect(
      seeded,
      `${SPEC} is not in the e2e-seeded list. Without it the only e2e proof of the user_favorites RLS scope ` +
        "runs nowhere that can fail a merge (Phase 244 DBACC-06).",
    ).toContain(SPEC);
  });

  it("the advisory `e2e` job's list does not carry the watchlist spec", () => {
    const advisory = codeLines(workflow).filter(
      (l) => /^\s*npx playwright test\b/.test(l) && l.includes(ADVISORY_ANCHOR),
    );
    expect(
      advisory.length,
      `Found no uncommented \`npx playwright test\` line naming ${ADVISORY_ANCHOR}: the advisory list moved, ` +
        "so this check would pass over nothing. Update ADVISORY_ANCHOR.",
    ).toBeGreaterThan(0);
    for (const line of advisory) {
      expect(
        line.includes(SPEC),
        `${SPEC} is in the advisory unseeded list, whose step has continue-on-error and which no aggregator needs`,
      ).toBe(false);
    }
  });

  it("the spec skips only on its seed precondition and carries no fixme or only", () => {
    // Regexes, so a skip on any receiver is caught. Written with an escaped dot so
    // this source holds no disabled-spec token for
    // src/__tests__/contracts/spec-disabling.invariant.test.ts.
    expect(
      (code.match(/\.skip\(/g) ?? []).length,
      `${SPEC} has a skip besides the one HAS_SEED_ENV precondition: a test could pass without running`,
    ).toBe(1);
    expect(
      /\btest\.skip\(\s*!HAS_SEED_ENV\s*,/.test(code),
      `${SPEC}'s one skip is no longer exactly \`test.skip(!HAS_SEED_ENV,\` - something is ORed into the condition, so the whole describe, RLS proof included, could skip`,
    ).toBe(true);
    expect(/\.fixme\(/.test(code), `${SPEC} carries a disabled test`).toBe(false);
    expect(/\.only\(/.test(code), `${SPEC} carries a focused test, so the rest of the file would not run`).toBe(false);
  });

  it("the primary RLS proof cannot skip on a missing anon key", () => {
    expect(
      /if\s*\(\s*anonKey\s*\)/.test(code),
      "the primary RLS proof would silently skip when TEST_SUPABASE_ANON_KEY is unset",
    ).toBe(false);
    expect(
      code.includes("TEST_SUPABASE_ANON_KEY missing"),
      "the spec no longer fails loudly on a missing TEST_SUPABASE_ANON_KEY, so the bare-SELECT RLS proof has no guard",
    ).toBe(true);
  });

  it("HAS_SEED_ENV is exactly the two env names the lane handoff exports", () => {
    const def = code.match(/const\s+HAS_SEED_ENV\s*=([^;]*);/);
    expect(def, `${SPEC} no longer defines HAS_SEED_ENV as a const`).not.toBeNull();
    const names = [...def![1].matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]).sort();
    expect(
      names,
      "HAS_SEED_ENV names a different set of env vars than TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY: " +
        "an env the lane does not export turns the whole describe, RLS proof included, into a skip",
    ).toEqual(["TEST_SUPABASE_SERVICE_ROLE_KEY", "TEST_SUPABASE_URL"]);
    expect(
      def![1].replace(/\s+/g, " ").trim(),
      "HAS_SEED_ENV is no longer a plain `!!a && !!b` over those two names (an OR, a negation or a literal would change what skips)",
    ).toBe("!!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY");
    const exported = codeLines(workflow).join("\n");
    for (const name of names) {
      expect(
        exported.includes(`printf '${name}=%s`),
        `the lane handoff in ${CI_WORKFLOW} no longer exports ${name}, so HAS_SEED_ENV is false on the lane and the describe skips`,
      ).toBe(true);
    }
  });

  it("nothing between the anon-key assertion and the RLS LEAK assertion can return early or branch", () => {
    const from = code.search(/const\s+anonKey\s*=/);
    const to = code.indexOf("RLS LEAK on migration 024 policy");
    expect(from, `${SPEC} lost \`const anonKey =\``).toBeGreaterThan(-1);
    expect(to, `${SPEC} lost the RLS LEAK message`).toBeGreaterThan(from);
    const between = code.slice(from, to);
    expect(
      /\bexpect\(\s*anonKey\b[^;]*\.toBeTruthy\(\)/.test(between),
      "the missing-anon-key assertion (`expect(anonKey, ...).toBeTruthy()`) is gone from the primary RLS proof",
    ).toBe(true);
    expect(
      /\breturn\b/.test(between),
      "a `return` sits between the anon-key assertion and the RLS LEAK assertion: the RLS proof can be skipped while the test passes",
    ).toBe(false);
    expect(
      /\bif\s*\(/.test(between),
      "an `if` sits between the anon-key assertion and the RLS LEAK assertion (e.g. `if (!anonKey)`): the RLS proof can be skipped while the test passes",
    ).toBe(false);
  });

  it("user-B's SELECT is bare and the RLS assertion reads the unfiltered result", () => {
    // The chain from userBClient's from("user_favorites") to its `;` must be
    // `.select("<one string>")` and nothing else: no .eq/.filter/.match/.in/.limit.
    // The comment-stripped `code` keeps line structure, so match across lines.
    expect(
      /\buserBClient\s*\.from\("user_favorites"\)\s*\.select\(\s*"[^"]*"\s*\)\s*;/.test(code),
      "user-B's user_favorites read is no longer a bare `.from(\"user_favorites\").select(\"...\");`. A client-side filter " +
        "(.eq/.filter/.match/.in) or a head/count option would empty the result whatever RLS does (rls-masked-by-explicit-filter)",
    ).toBe(true);
    // The proof is only a proof if user-A's row exists and the SELECT runs as user-B.
    expect(
      /\.from\("user_favorites"\)\s*\.upsert\(\s*\{\s*user_id:\s*userAId!/.test(code),
      "user-A's favorite is no longer seeded by `.from(\"user_favorites\").upsert({ user_id: userAId!`: the bare SELECT would return " +
        "zero rows with nothing to leak, so the RLS proof could pass over an empty table",
    ).toBe(true);
    expect(
      /\bexpect\(\s*insertError\b[^;]*\)\s*\.toBeNull\(\)\s*;/.test(code),
      "the seed upsert's `expect(insertError, ...).toBeNull()` is gone: a failed seed would leave user-A with no row and the RLS proof green",
    ).toBe(true);
    expect(
      /\buserBClient\s*\.auth\s*\.signInWithPassword\(/.test(code),
      "the sign-in is no longer `userBClient.auth.signInWithPassword(`: the bare SELECT would run on a client that is not user-B's session",
    ).toBe(true);
    expect(
      /const\s+aRowsVisibleToB\s*=\s*\(\s*leakRows\s*\?\?\s*\[\]\s*\)\s*\.filter\(\s*\(r\)\s*=>\s*r\.user_id\s*===\s*userAId\s*,?\s*\)\s*;/.test(code),
      "aRowsVisibleToB is no longer `(leakRows ?? []).filter((r) => r.user_id === userAId)`",
    ).toBe(true);
    expect(
      /expect\(\s*aRowsVisibleToB\s*,[^;]*\)\s*\.toHaveLength\(0\)\s*;/.test(code),
      "the RLS proof no longer asserts `expect(aRowsVisibleToB, ...).toHaveLength(0)`",
    ).toBe(true);
  });

  it("the anonymous PUT arm asserts the status itself is 307", () => {
    expect(
      /expect\(\s*res\.status\(\)\s*,[^;]*\)\s*\.toBe\(307\)\s*;/.test(code),
      "no `expect(res.status(), ...).toBe(307)`: the proxy-gate arm no longer pins the response status to 307 (another toBe(307) elsewhere does not count)",
    ).toBe(true);
  });

  it("the RLS and auth anchors are present", () => {
    const anchors: Array<[string, string]> = [
      ["RLS LEAK on migration 024 policy", "the failure message naming the migration 024 policy leak"],
      ["signInWithPassword(", "the sign-in that mints user-B's scoped session"],
      ['.from("user_favorites")', "the user_favorites read the RLS proof depends on"],
      ["maxRedirects: 0", "the unfollowed redirect on the anonymous PUT"],
      ["toBe(307)", "the proxy's 307 to /login assertion"],
    ];
    for (const [anchor, what] of anchors) {
      expect(code.includes(anchor), `${SPEC} lost \`${anchor}\`: ${what}`).toBe(true);
    }
  });
});
