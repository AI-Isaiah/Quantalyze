import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-retry-after-parse.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-retry-after-parse", rule, {
  valid: [
    // The canonical parser.
    { code: "const s = parseRetryAfterSeconds(res.headers);" },
    // Unrelated numeric coercions are fine (bare AND Number.* member form).
    { code: "const n = Number(body.count);" },
    { code: "const i = parseInt(input.value, 10);" },
    { code: "const j = Number.parseInt(body.count, 10);" },
    // File-level sanctioned-exception marker.
    {
      code: "// B20 sanctioned-exception: e2e fixture\nconst n = Number(first.headers()['retry-after'] ?? '10');",
    },
  ],
  invalid: [
    {
      code: "const n = Number(res.headers.get('retry-after'));",
      errors: [{ messageId: "raw" }],
    },
    {
      code: "const n = parseInt(h['Retry-After'], 10);",
      errors: [{ messageId: "raw" }],
    },
    // The real e2e violation shape.
    {
      code: "const n = Number(first.headers()['retry-after'] ?? '10');",
      errors: [{ messageId: "raw" }],
    },
    // camelCase body field still references retry-after.
    {
      code: "const n = Number(body.retryAfter);",
      errors: [{ messageId: "raw" }],
    },
    // ES2015 static-method form `Number.parseInt`/`Number.parseFloat` — the
    // idiomatic spelling that previously escaped the gate (the founder-lp-report
    // holdout used exactly this). MemberExpression callee, still banned.
    {
      code: "const n = Number.parseInt(retryAfterRaw, 10);",
      errors: [{ messageId: "raw" }],
    },
    {
      code: "const n = Number.parseFloat(res.headers.get('retry-after'));",
      errors: [{ messageId: "raw" }],
    },
  ],
});
