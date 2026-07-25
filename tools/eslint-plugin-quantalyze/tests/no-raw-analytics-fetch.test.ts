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
  ],
});
