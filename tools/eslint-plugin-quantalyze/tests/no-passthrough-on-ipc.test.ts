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
    // Unrelated chained methods must not trip the rule.
    { code: "z.object({ a: z.string() }).partial();" },
    { code: "schema.optional().nullable();" },
    // Computed member access with the same name is not a Zod method call.
    { code: "obj['passthrough'];" },
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
    // Multi-line `})\n  .passthrough()` form — AST is formatting-blind. This is
    // the exact shape both boundary files use, so it MUST be caught.
    {
      code: "const S = z\n  .object({ a: z.string() })\n  .passthrough();",
      errors: [{ messageId: "raw" }],
    },
  ],
});
