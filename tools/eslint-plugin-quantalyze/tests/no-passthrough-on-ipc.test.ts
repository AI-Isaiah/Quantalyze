import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-passthrough-on-ipc.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-passthrough-on-ipc", rule, {
  valid: [
    // Canonical safe shapes.
    { code: "z.object({ a: z.string() }).strict();" },
    { code: "z.object({ a: z.string() });" }, // Zod default = strip
    { code: "z.object({ a: z.string() }).strip();" },
    { code: "z.strictObject({ a: z.string() });" },
    // Unrelated chained methods must not trip the rule.
    { code: "z.object({ a: z.string() }).partial();" },
    { code: "schema.optional().nullable();" },
    // Computed member access with the same name is not a Zod method call.
    { code: "obj['passthrough'];" },
    { code: "obj['loose']();" },
  ],
  invalid: [
    {
      code: "z.object({ a: z.string() }).passthrough();",
      errors: [{ messageId: "raw" }],
    },
    {
      code: "z.object({ a: z.string() }).catchall(z.unknown());",
      errors: [{ messageId: "raw" }],
    },
    // Zod v4 canonical passthrough — MUST be caught (the form a v4 dev reaches for).
    {
      code: "z.object({ a: z.string() }).loose();",
      errors: [{ messageId: "raw" }],
    },
    // Zod v4 factory forms.
    {
      code: "z.looseObject({ a: z.string() });",
      errors: [{ messageId: "raw" }],
    },
    {
      code: "looseObject({ a: z.string() });", // bare-imported factory
      errors: [{ messageId: "raw" }],
    },
    // Multi-line `})\n  .loose()` form — AST is formatting-blind. This is the
    // exact shape the boundary files use; the report MUST land on the call line
    // (line 3 here), since that is the line an inline eslint-disable-line escape
    // sits on. A refactor that moved the report to the CallExpression's opening
    // line would silently break all ~22 production escapes — so pin the line.
    {
      code: "const S = z\n  .object({ a: z.string() })\n  .loose();",
      errors: [{ messageId: "raw", line: 3 }],
    },
    {
      code: "const S = z\n  .object({ a: z.string() })\n  .passthrough();",
      errors: [{ messageId: "raw", line: 3 }],
    },
  ],
});
