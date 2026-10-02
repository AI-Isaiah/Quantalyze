import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Phase 156 CONNECT-02b — wizard-RPC service-role sole-writer source-scan guard.
 *
 * INVARIANT: the two wizard write RPCs — `create_wizard_strategy` and
 * `add_wizard_composite_key` — are called from EXACTLY two files in `src/**`
 * (the create-with-key route and its composite add-key twin), and in BOTH the
 * `.rpc(` call hangs off a client bound from `createAdminClient()` (service
 * role), never from `createClient()` (the user-scoped, JWT-bearing client).
 *
 * Why this exists: plan 04 rewired both routes onto the admin client so the
 * server's attested venue — not a forgeable client-supplied one — is what the
 * RPC writes. The route unit tests prove the routes call the admin client
 * TODAY. They do not stop a future contributor adding a SECOND call site in a
 * `.tsx` server action or a `src/lib` helper, which would re-open the exact
 * door plan 04 closed while every existing test stayed green. That is the
 * Phase 142.1 finding-4 lesson: a gate that globs too narrowly lets a writer
 * added one directory over pass silently. So this walker takes ALL of `src/**`
 * — `.ts` AND `.tsx`, `src/lib/**` and `src/app/**` alike — not just the two
 * route directories.
 *
 * Why a source scan (mirrors src/__tests__/strategies-published-sole-writer-guard.test.ts):
 * it runs in the normal `npm run test` unit suite (so it fails locally before
 * push), needs no new CI step, and the failure message points the dev at the
 * offending file path.
 *
 * ── WHAT THE HEURISTIC CAN AND CANNOT SEE ──────────────────────────────────
 * It sees LEXICAL BINDING, not runtime. It cannot follow a client passed
 * through a function parameter, stored on an object, or returned from a
 * factory; it reads the identifier that literally precedes `.rpc(` and looks
 * for an assignment of THAT identifier from `createAdminClient(` in the same
 * file. Three consequences, each turned into an explicit failure rather than a
 * silent pass:
 *   • A member-expression receiver (`ctx.db.rpc("create_wizard_strategy"…)`)
 *     is NOT resolvable lexically → it FAILS with "unresolvable receiver".
 *   • A `.rpc(` whose receiver the regex cannot capture at all (e.g.
 *     `(await createClient()).rpc(…)`) makes the per-file receiver count
 *     diverge from the per-file name count → it FAILS.
 *   • A file that binds BOTH clients is fine — `create-with-key` legitimately
 *     binds `createClient()` (auth/session reads) AND `createAdminClient()`.
 *     The heuristic therefore keys on the RECEIVER IDENTIFIER, never on "does
 *     this file mention createClient".
 *
 * ⚠️ SUCCESSOR OBLIGATION: if either route is restructured so the RPC call
 * moves out of the route file (extracted helper, shared wizard-write module),
 * this guard MUST be updated in the same change — move the path into
 * ALLOWED_WRITERS and re-run the falsifiability mutations below. Deleting the
 * guard, or widening the allowlist without re-proving it reds, silently
 * re-opens CONNECT-02.
 *
 * ── FALSIFIABILITY RECORD ────────────────────────────────────────────────────
 * Both mutations below were ACTUALLY RUN on 2026-08-13 against the
 * post-plan-04 tree (commit a2a247f6), and the messages are pasted verbatim
 * from the vitest output. Baseline before and after each mutation:
 * `1 passed (1)` file, `10 passed (10)` tests.
 *
 * ── Mutation 1 → Scan A ("no unsanctioned file under src/** calls a wizard
 *    RPC"). Added a throwaway NON-test file `src/lib/wizard/__falsify_probe.ts`
 *    holding `await supabase.rpc("create_wizard_strategy", { p_user_id: userId })`
 *    with `const supabase = await createClient();` — i.e. exactly the second
 *    call site this guard exists to stop, placed in `src/lib/**` rather than in
 *    a route directory. Result: `1 failed | 9 passed (10)`, message:
 *
 *   AssertionError: Unsanctioned wizard-RPC call site(s):
 *   src/lib/wizard/__falsify_probe.ts. `create_wizard_strategy` /
 *   `add_wizard_composite_key` are service-role writers as of Phase 156 — they
 *   may be called ONLY from
 *   src/app/api/strategies/composite/add-key/route.ts,
 *   src/app/api/strategies/create-with-key/route.ts, through a
 *   createAdminClient() client. A new call site re-opens CONNECT-02.: expected
 *   [ 'src/lib/wizard/__falsify_probe.ts' ] to deeply equal []
 *
 *   - Expected
 *   + Received
 *
 *   - []
 *   + [
 *   +   "src/lib/wizard/__falsify_probe.ts",
 *   + ]
 *
 *    `rm src/lib/wizard/__falsify_probe.ts` → back to `10 passed (10)`, and
 *    `git status --porcelain` showed no leftover probe.
 *
 * ── Mutation 2 → Scan B ("every wizard-RPC receiver is bound from
 *    createAdminClient(), not createClient()"). In
 *    `src/app/api/strategies/create-with-key/route.ts:820` the receiver was
 *    re-pointed from `rpcAdmin.rpc("create_wizard_strategy"` to
 *    `supabase.rpc("create_wizard_strategy"` — `supabase` being that file's
 *    EXISTING `const supabase = await createClient();` binding at :540. This is
 *    the sharp case on purpose: the file still imports createAdminClient and
 *    still binds it as `rpcAdmin`, so a guard keyed on "does this file mention
 *    createAdminClient" would have stayed green. Result:
 *    `1 failed | 9 passed (10)`, message:
 *
 *   AssertionError: src/app/api/strategies/create-with-key/route.ts calls a
 *   wizard RPC on `supabase`, which is NOT bound from createAdminClient() in
 *   this file. The wizard RPCs are service-role writers (Phase 156 /
 *   CONNECT-02); a user-scoped receiver puts the write back on the caller's
 *   JWT.: expected false to be true // Object.is equality
 *
 *   - Expected
 *   + Received
 *
 *   - true
 *   + false
 *
 *    `git checkout -- src/app/api/strategies/create-with-key/route.ts` → back
 *    to `10 passed (10)`, working tree clean.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

/** The two wizard write RPCs that became service-role-only in Phase 156. */
const WIZARD_RPC_NAMES: readonly string[] = [
  "create_wizard_strategy",
  "add_wizard_composite_key",
];

/**
 * The ONLY sanctioned call sites, with the HAND-TYPED number of wizard-RPC
 * call sites each is expected to contain (Scan C, anti-vacuity). A regex that
 * silently stops matching would turn Scan A green forever — the same failure
 * mode as the SQL gate's SKIP trap. Pinning a non-zero literal per file means
 * the guard reds when it goes blind instead of passing.
 */
const ALLOWED_WRITERS: Readonly<Record<string, number>> = {
  "src/app/api/strategies/create-with-key/route.ts": 1,
  "src/app/api/strategies/composite/add-key/route.ts": 1,
};

const ALLOWED_WRITER_PATHS = Object.keys(ALLOWED_WRITERS).sort();

/**
 * Anchored call-site regex (idiom copied from
 * src/__tests__/audit-coverage.test.ts:220-226): the leading `\.rpc\(\s*`
 * anchors the match to a METHOD CALL, so a mention of the RPC name in prose,
 * in a comment, or in `src/lib/database.types.ts`'s generated `Functions` map
 * is never flagged. Built fresh per call — a `/g` regex carries `lastIndex`
 * state across `.test()` invocations, which is itself a way for a guard to go
 * quietly blind.
 */
function wizardRpcCallRe(): RegExp {
  return new RegExp(
    `\\.rpc\\(\\s*['"](?:${WIZARD_RPC_NAMES.join("|")})['"]`,
    "g",
  );
}

/**
 * Same anchor, plus the receiver identifier immediately preceding `.rpc(` and
 * the single character before that identifier (used to detect a member-
 * expression receiver such as `ctx.db.rpc(`, which the lexical heuristic
 * cannot resolve).
 */
function wizardRpcReceiverRe(): RegExp {
  return new RegExp(
    `(.?)([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\.rpc\\(\\s*['"](?:${WIZARD_RPC_NAMES.join("|")})['"]`,
    "g",
  );
}

/**
 * True when `ident` is assigned from `factory(` somewhere in the file. Accepts
 * every binding form the two routes actually use:
 *   `const rpcAdmin = createAdminClient();`      (declaration + init)
 *   `let rpcAdmin: T; … rpcAdmin = createAdminClient();`  (⭐ what BOTH routes
 *       do today — the try/catch that answers 503 SEAM_MISCONFIGURED forces
 *       the split declaration, so a `const`-only regex would red the tree)
 *   `const supabase = await createClient();`     (awaited factory)
 * The `(?:^|[^.\w$])` prefix stops `other.rpcAdmin = …` from counting.
 */
function bindsIdentFrom(src: string, ident: string, factory: string): boolean {
  const re = new RegExp(
    `(?:^|[^.\\w$])${ident}\\s*=\\s*(?:await\\s+)?${factory}\\s*\\(`,
  );
  return re.test(src);
}

const ADMIN_IMPORT_RE =
  /import\s*\{[^}]*\bcreateAdminClient\b[^}]*\}\s*from\s*["']@\/lib\/supabase\/admin["']/;

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

interface ReceiverHit {
  /** The identifier the `.rpc(` call hangs off. */
  ident: string;
  /** True when that identifier was itself a property access (`a.b.rpc(`). */
  memberExpression: boolean;
}

function receiverHits(src: string): ReceiverHit[] {
  return [...src.matchAll(wizardRpcReceiverRe())].map((m) => ({
    ident: m[2],
    memberExpression: m[1] === ".",
  }));
}

function countCallSites(src: string): number {
  return [...src.matchAll(wizardRpcCallRe())].length;
}

// Production (non-test) TypeScript under src/**, .tsx included. Test files are
// excluded for the same reason the analog excludes them: they mock the RPC by
// name and assert on it, which is harness code, not a production writer. This
// guard file itself lives under src/__tests__/ and is excluded by that rule.
const productionFiles = walk(SRC_DIR, [".ts", ".tsx"]).filter(
  (f) => !isTestPath(relative(REPO_ROOT, f)),
);

describe("Phase 156 CONNECT-02b — wizard RPCs are service-role writers with exactly two call sites", () => {
  // ── Scan C (part 1): the WALKER itself is not narrow ──────────────────────
  it("the walker covers .tsx and src/lib/** (not just the two route dirs)", () => {
    const rels = productionFiles.map((f) => relative(REPO_ROOT, f));
    expect(
      rels.some((r) => r.endsWith(".tsx")),
      "the walker found zero .tsx files — a wizard RPC called from a server action or client component would slip past. Re-check walk()'s extension list.",
    ).toBe(true);
    expect(
      rels.some((r) => r.startsWith(join("src", "lib"))),
      "the walker found zero src/lib/** files — a wizard RPC moved into a shared helper would slip past. Re-check SRC_DIR.",
    ).toBe(true);
    // A floor, not an exact count: this only has to catch a walker that has
    // stopped recursing, not to pin the repo's file census.
    expect(
      rels.length,
      `the walker scanned only ${rels.length} production files under src/ — it has stopped recursing.`,
    ).toBeGreaterThan(200);
  });

  // ── Scan C (part 2): the REGEX still matches the known writers ────────────
  it.each(ALLOWED_WRITER_PATHS)(
    "anti-vacuity: %s still contains its hand-typed number of wizard-RPC call sites",
    (rel) => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      const expected = ALLOWED_WRITERS[rel];
      expect(
        countCallSites(src),
        `${rel} was expected to contain exactly ${expected} wizard-RPC call site(s) and does not. Either the call moved (update ALLOWED_WRITERS and re-run the falsifiability mutations in this file's docblock) or the anchored regex has gone blind — in which case Scan A is passing vacuously.`,
      ).toBe(expected);
    },
  );

  // ── Scan A: no THIRD writer anywhere under src/** ─────────────────────────
  it("no unsanctioned file under src/** calls a wizard RPC", () => {
    const offenders = productionFiles
      .filter((f) => wizardRpcCallRe().test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO_ROOT, f))
      .filter((rel) => !(rel in ALLOWED_WRITERS))
      .sort();

    expect(
      offenders,
      `Unsanctioned wizard-RPC call site(s): ${offenders.join(
        ", ",
      )}. \`create_wizard_strategy\` / \`add_wizard_composite_key\` are service-role writers as of Phase 156 — they may be called ONLY from ${ALLOWED_WRITER_PATHS.join(
        ", ",
      )}, through a createAdminClient() client. A new call site re-opens CONNECT-02.`,
    ).toEqual([]);
  });

  // ── Scan B: the PAIRING heuristic, per allowlisted file ───────────────────
  describe.each(ALLOWED_WRITER_PATHS)("Scan B — %s", (rel) => {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");

    it("imports createAdminClient from @/lib/supabase/admin", () => {
      expect(
        ADMIN_IMPORT_RE.test(src),
        `${rel} calls a wizard RPC but no longer imports createAdminClient from @/lib/supabase/admin. The wizard RPCs are service-role writers (Phase 156 / CONNECT-02).`,
      ).toBe(true);
    });

    it("every wizard-RPC receiver is resolvable (no member-expression receivers)", () => {
      const hits = receiverHits(src);
      expect(
        hits.length,
        `${rel}: ${countCallSites(src)} wizard-RPC call site(s) but ${hits.length} resolvable receiver(s). A call whose receiver this lexical heuristic cannot capture (e.g. \`(await createClient()).rpc(...)\`) is NOT proof of a service-role write — restructure the call to bind the client to a named identifier first.`,
      ).toBe(countCallSites(src));

      const memberHits = hits.filter((h) => h.memberExpression).map((h) => h.ident);
      expect(
        memberHits,
        `${rel}: wizard RPC called on a member expression (…${memberHits.join(
          ", …",
        )}). This guard resolves LEXICAL bindings only and cannot prove such a receiver is the admin client — bind it to a local identifier from createAdminClient() first.`,
      ).toEqual([]);
    });

    it("every wizard-RPC receiver is bound from createAdminClient(), not createClient()", () => {
      for (const { ident } of receiverHits(src)) {
        expect(
          bindsIdentFrom(src, ident, "createAdminClient"),
          `${rel} calls a wizard RPC on \`${ident}\`, which is NOT bound from createAdminClient() in this file. The wizard RPCs are service-role writers (Phase 156 / CONNECT-02); a user-scoped receiver puts the write back on the caller's JWT.`,
        ).toBe(true);
        expect(
          bindsIdentFrom(src, ident, "createClient"),
          `${rel} calls a wizard RPC on \`${ident}\`, and \`${ident}\` is ALSO bound from createClient() somewhere in this file. The receiver is ambiguous, so this guard cannot prove the write runs as service_role — use a distinct identifier for the admin client.`,
        ).toBe(false);
      }
    });
  });
});
