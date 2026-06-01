import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-published-predicate.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-published-predicate", rule, {
  valid: [
    // The canonical path.
    { code: "withPublishedOnly(supabase.from('strategies').select('*'));" },
    // Different column / value — unrelated predicates are fine.
    { code: "q.eq('id', strategyId);" },
    { code: "q.eq('status', 'pending_review');" },
    // File-level markers (the helper + the one sanctioned exception).
    {
      code: "// B10 visibility: the helper itself\nq.eq('status', 'published');",
    },
    {
      code: "// B10 sanctioned-exception: notes ownership strategy arm\nq.eq('status', 'published');",
    },
  ],
  invalid: [
    {
      code: "q.eq('status', 'published');",
      errors: [{ messageId: "raw" }],
    },
    // No-space, double-quote variant — AST is formatting-blind.
    {
      code: 'supabase.from("strategies").select("*").eq("status","published");',
      errors: [{ messageId: "raw" }],
    },
  ],
});
