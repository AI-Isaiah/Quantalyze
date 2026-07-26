import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-analytics-fetch.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

/**
 * REG-2 (SEAM-01) — the rule that keeps "ONE resilience core" true AFTER the
 * merge, not merely at it.
 *
 * The fixtures below are chosen to pin the detection STRATEGY, not just the
 * outcome. The rule tracks which identifiers were INITIALIZED from the
 * analytics base-URL environment variable and then flags fetches of those
 * identifiers — it does not match on identifier NAMES. Fixture "renamed
 * binding" is the discriminator: an implementation that looked for a variable
 * called ANALYTICS_URL would pass every other invalid case and still miss the
 * one an author is most likely to write by accident.
 *
 * TWO DISCRIMINATORS, one per detection property (140.2-04):
 *   - "renamed binding" (invalid #3) pins INIT-TRACKING — nothing in it is
 *     called ANALYTICS_URL, so a name-matcher fails it.
 *   - "untainted two-hop alias" (valid, last) pins the FIXED POINT's seed. It
 *     builds `const url = ...` off a DIFFERENT env var, so a fixed-point pass
 *     that had degraded into "anything called url" would report it. Without
 *     this one, widening the taint could not be told apart from widening the
 *     name match.
 *
 * The five URL shapes are pinned as separate invalid fixtures because they fail
 * for different reasons, and two of them (3 and 4) were MISSED until 140.2-04:
 * they are two hops from the env read, and pass (a) used to run with taint
 * checking off, so a tainted name never tainted a second binding. Those two are
 * this file's ledger-row M57 targets — see the marker comments below.
 */
ruleTester.run("no-raw-analytics-fetch", rule, {
  valid: [
    // The canonical call: the core owns the base URL, the budget and the breaker.
    {
      code: 'const res = await resilientFetch("bridge", "/api/bridge", init);',
    },
    // Fetching an unrelated URL is none of this rule's business.
    { code: 'const res = await fetch("https://example.com/other");' },
    // A different env var that happens to be a service URL.
    {
      code: 'const other = process.env.SOME_OTHER_SERVICE_URL;\nconst res = await fetch(`${other}/health`);',
    },
    // READING the env var is fine — it is FETCHING it raw that is banned. A
    // presence check plus a core call is the shape several routes legitimately use.
    {
      code: 'if (!process.env.ANALYTICS_SERVICE_URL) throw new Error("analytics service URL not configured");\nconst res = await resilientFetch("bridge", "/api/bridge");',
    },
    // The env var named in prose or in an operator-facing string, with an
    // unrelated fetch in the same file. Comments must never trip the rule —
    // this phase was bitten twice by prose defeating a guard.
    {
      code: '// ANALYTICS_SERVICE_URL is owned by @/lib/resilient-fetch.\nconst label = "ANALYTICS_SERVICE_URL not set";\nconst res = await fetch("/api/local");',
    },
    // Initialized from the env var but never fetched — no seam call, no finding.
    {
      code: "const base = process.env.ANALYTICS_SERVICE_URL;\nconsole.log(base);",
    },
    // UNTAINTED TWO-HOP ALIAS — the fixed point's discriminator. Structurally
    // identical to invalid shape 3 (a `url` built from a base, then fetched),
    // differing ONLY in which env var seeded it. A fixed-point pass that had
    // slipped into flagging bindings by name — and `url` is the single most
    // likely name to collide — reports this. The seed must stay the analytics
    // env member and nothing else.
    {
      code: "const other = process.env.SOME_OTHER_SERVICE_URL;\nconst url = `${other}/health`;\nconst res = await fetch(url);",
    },
  ],
  invalid: [
    // 1. The core's own shape: `??` fallback chain, then a template-literal fetch.
    {
      code: 'const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";\nconst res = await fetch(`${ANALYTICS_URL}/api/x`);',
      errors: [{ messageId: "raw" }],
    },
    // 2. Direct member reference concatenated at the call site — no intermediate
    //    binding at all.
    {
      code: 'const res = await fetch(process.env.ANALYTICS_SERVICE_URL + "/process-key");',
      errors: [{ messageId: "raw" }],
    },
    // 3. RENAMED BINDING — the fixture a name-matching rule fails. Nothing here
    //    is called ANALYTICS_URL; only the initializer betrays it.
    {
      code: 'const base = process.env.ANALYTICS_SERVICE_URL;\nconst res = await fetch(base + "/internal/keys/1/permissions");',
      errors: [{ messageId: "raw" }],
    },
    // 4. Bare identifier argument, `||` fallback chain.
    {
      code: 'const svc = process.env.ANALYTICS_SERVICE_URL || "http://localhost:8002";\nconst res = await fetch(svc);',
      errors: [{ messageId: "raw" }],
    },
    // 5. DECLARATION ORDER — the fetch is lexically BEFORE the binding it uses.
    //    A rule that tracked declarators as it encountered them would miss this.
    {
      code: "async function probe() {\n  return fetch(`${base}/health`);\n}\nconst base = process.env.ANALYTICS_SERVICE_URL;",
      errors: [{ messageId: "raw" }],
    },
    // 6. `globalThis.fetch` — the member-expression callee spelling that the
    //    critical-regressions bypass guard already watches for.
    {
      code: 'const svc = process.env.ANALYTICS_SERVICE_URL;\nconst res = await globalThis.fetch(`${svc}/api/x`);',
      errors: [{ messageId: "raw" }],
    },
    // 7. Destructured out of process.env under a new local name.
    {
      code: "const { ANALYTICS_SERVICE_URL: svcUrl } = process.env;\nconst res = await fetch(`${svcUrl}/api/x`);",
      errors: [{ messageId: "raw" }],
    },
    // 8. Computed env access.
    {
      code: 'const svc = process.env["ANALYTICS_SERVICE_URL"];\nconst res = await fetch(`${svc}/api/x`);',
      errors: [{ messageId: "raw" }],
    },
    // ---- The four documented URL shapes, one fixture each (140.2-04) --------
    // 9. SHAPE 1 — the env member read INLINE in the fetch's template literal,
    //    with no binding at all. The simplest way to write a new seam.
    {
      code: "const res = await fetch(`${process.env.ANALYTICS_SERVICE_URL}/api/x`);",
      errors: [{ messageId: "raw" }],
    },
    // 10. SHAPE 2 — one binding, fetched through a template slot. (Invalid #1
    //     covers this too, via a `??` chain; kept separate because #1's point is
    //     the fallback chain and this one's point is the shape.)
    {
      code: "const base = process.env.ANALYTICS_SERVICE_URL;\nconst res = await fetch(`${base}/api/x`);",
      errors: [{ messageId: "raw" }],
    },
    // 11. SHAPE 3 — the seam URL is built into a SECOND binding and THAT is
    //     fetched. Two hops from the env read, so the pre-140.2-04 one-hop
    //     ceiling missed it entirely.
    //     >>> M57 TARGET #1: reverting the fixed point to one-hop taint must
    //     >>> turn this fixture RED.
    {
      code: "const base = process.env.ANALYTICS_SERVICE_URL;\nconst url = `${base}/api/x`;\nconst res = await fetch(url);",
      errors: [{ messageId: "raw" }],
    },
    // 12. SHAPE 4 — the same two-hop ceiling reached via `new URL(path, base)`.
    //     >>> M57 TARGET #2: reverting the fixed point to one-hop taint must
    //     >>> turn this fixture RED.
    {
      code: 'const base = process.env.ANALYTICS_SERVICE_URL;\nconst u = new URL("/api/x", base);\nconst res = await fetch(u);',
      errors: [{ messageId: "raw" }],
    },
    // 13. REGRESSION — `new URL()` constructed INLINE as the fetch argument.
    //     This shape was already caught before 140.2-04 (pass (b) recurses the
    //     whole NewExpression subtree and finds the tainted base), contrary to
    //     CONTEXT's claim that it was missed. Pinned so a later refactor of the
    //     recursion cannot quietly lose it.
    {
      code: 'const base = process.env.ANALYTICS_SERVICE_URL;\nconst res = await fetch(new URL("/api/x", base));',
      errors: [{ messageId: "raw" }],
    },
    // 14. DECLARATION ORDER, TWO HOPS — the alias is declared AFTER the fetch
    //     that uses it. Invalid #5 pins the one-hop version of this; this one
    //     pins that the FIXED POINT is also resolved at Program:exit, which is
    //     the property an "iterate as you traverse" implementation would lose
    //     while keeping every other fixture green.
    {
      code: "async function probe() {\n  return fetch(u);\n}\nconst base = process.env.ANALYTICS_SERVICE_URL;\nconst u = `${base}/health`;",
      errors: [{ messageId: "raw" }],
    },
    // 15. THE WARMERS' EXACT SHAPE — `fetch(`${url.replace(/\/+$/, "")}/health`)`
    //     with `url` off the env read, as written in src/lib/warmup-analytics.ts
    //     and src/app/api/cron/warm-analytics/route.ts. Those two files are
    //     legal only because they are PATH-allowlisted in eslint.config.mjs, so
    //     the rule's verdict on the shape itself is invisible there. Pinned here
    //     instead, independent of the allowlist: if the allowlist were ever
    //     narrowed, this is the behaviour the two warmers would meet.
    {
      code: 'const url = process.env.ANALYTICS_SERVICE_URL;\nconst res = await fetch(`${url.replace(/\\/+$/, "")}/health`);',
      errors: [{ messageId: "raw" }],
    },
  ],
});
