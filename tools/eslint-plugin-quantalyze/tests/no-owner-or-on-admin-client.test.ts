import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-owner-or-on-admin-client.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-owner-or-on-admin-client", rule, {
  valid: [
    // The canonical owner-inclusive path — the helper does the .or() for you.
    {
      code: "withPublishedOrOwner(supabase.from('strategies').select('*'), user.id);",
    },
    // A `.or()` with NO owner leg — an unrelated predicate is fine.
    { code: "q.or('status.eq.published,is_example.eq.true');" },
    // A `.or()` whose arg is a helper CALL (mirrors gdpr-export's real
    // `.or(spec.or_filter(userId))`): the arg text carries `userId` but NOT the
    // `user_id.eq.` predicate shape, so it is not an owner-OR leak.
    { code: "filtered.or(spec.or_filter(userId));" },
    // File-level markers exempt the helper itself + any sanctioned exception.
    {
      code: "// B10 visibility: the helper itself\nq.or('status.eq.published,user_id.eq.' + id);",
    },
    {
      code: "// B10 sanctioned-exception: a deliberate different shape\nq.or(`user_id.eq.${id}`);",
    },
  ],
  invalid: [
    // String-concatenation owner-OR (the `+ id` shape from the behavior block).
    {
      code: "q.or('status.eq.published,user_id.eq.' + id);",
      errors: [{ messageId: "rawOwnerOr" }],
    },
    // TemplateLiteral owner-OR — the real-world pattern embedding the id.
    {
      code: "q.or(`status.eq.published,user_id.eq.${id}`);",
      errors: [{ messageId: "rawOwnerOr" }],
    },
    // The admin-client leak scenario (Pitfall 4): a raw owner-OR on a
    // service-role client bypasses RLS and leaks every user's private rows.
    {
      code: 'createAdminClient().from("strategies").select().or("user_id.eq.x");',
      errors: [{ messageId: "rawOwnerOr" }],
    },
    // Plain literal owner leg.
    {
      code: "q.or('user_id.eq.abc');",
      errors: [{ messageId: "rawOwnerOr" }],
    },
  ],
});
