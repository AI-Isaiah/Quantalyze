import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-unchecked-supabase-read.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

// BOTH POLARITIES ARE MANDATORY. The `valid` block is not padding: it is what
// stops the next author "fixing" a false positive by weakening the rule — the
// discipline seam-ssr-exposure.pin.test.ts:238-241 states as "a scan that
// flagged those would be 'fixed' by weakening it." Every `valid` case below is
// either a documented non-goal or a MEASURED false positive of the naive
// predicate, and every `invalid` case is a shape observed in this repo.
ruleTester.run("no-unchecked-supabase-read", rule, {
  valid: [
    // V1 — the canonical checked read. The shape the message points at.
    { code: "const { data, error } = await supabase.from('t').select('c');" },
    // V2 — `.throwOnError()` changes the awaited type such that no `error`
    // binding is possible, so demanding one would be demanding the impossible.
    { code: "const { data } = await supabase.from('t').select('c').throwOnError();" },
    // V3 — NON-GOAL 1: the whole-result binding, read in a later statement.
    // Following that needs cross-statement reasoning the rule does not have;
    // over-flagging it is how a rule gets disabled repo-wide. This is the shape
    // 140.4-02 left SyncPreviewStep.tsx in.
    {
      code: "const res = await supabase.from('t').select('c'); if (res.error) throw res.error;",
    },
    // V4 — NON-GOAL 2, a MEASURED false positive: getPublicUrl returns `{data}`
    // with NO `error` field at all. Correct API usage
    // (portfolio-documents/route.ts:61), and it is not even awaited.
    { code: "const { data } = supabase.storage.from('b').getPublicUrl(p);" },
    // V5 — the awaited spelling of the same storage call is excluded too, by
    // the `storage` segment, so the exclusion does not rest on the missing await.
    { code: "const { data } = await supabase.storage.from('b').getPublicUrl(p);" },
    // V6 — a destructure of something that is not a PostgREST call at all.
    { code: "const { data } = await axios.get('/x');" },
    // V7 — array form where EVERY member binds `error`. This is the shape
    // 140.4-01 left admin/strategy-review/route.ts in, and the rule must stay
    // silent on it or the phase's own converted file reds CI.
    {
      code: "const [{ data: a, error: aErr }, { count: b, error: bErr }] = await Promise.all([supabase.from('t').select('c'), supabase.from('u').select('id', { count: 'exact', head: true })]);",
    },
    // V8 — binding ONLY `error` consumes no fabricable field, so there is
    // nothing to coerce and nothing to report.
    { code: "const { error } = await supabase.from('t').delete().eq('id', id);" },
    // V9 — a `...rest` element keeps `error` genuinely reachable.
    { code: "const { data, ...rest } = await supabase.from('t').select('c');" },
    // V10 — NON-GOAL 3: a conditional member. The synthetic else-branch has no
    // `error` property, so flagging it would demand an unrepresentable binding
    // (the keyless-draft outage SyncPreviewStep.tsx:1162-1166 documents).
    {
      code: "const [{ data: k }] = await Promise.all([id ? supabase.from('api_keys').select('exchange').eq('id', id).maybeSingle() : Promise.resolve({ data: null })]);",
    },
    // V11 — the file-level sanctioned-exception escape hatch, same greppable
    // shape the sibling rules use.
    {
      code: "// SEAMRIM-11 sanctioned-exception: fixture\nconst { data } = await supabase.from('t').select('c');",
    },
  ],
  invalid: [
    // I1 — OBJECT FORM, `data`. The base case.
    {
      code: "const { data } = await supabase.from('t').select('c').eq('id', id).maybeSingle();",
      errors: [{ messageId: "unchecked" }],
    },
    // I2 — OBJECT FORM, `count`. Counts are part of the class: a null count
    // with no error coerced by `?? 0` is the same fabrication by another route.
    {
      code: "const { count } = await supabase.from('t').select('id', { count: 'exact', head: true }).eq('id', id);",
      errors: [{ messageId: "unchecked" }],
    },
    // I3 — THE ARRAY FORM. The shape an object-only predicate returns ZERO on,
    // in the file carrying this phase's top finding (SyncPreviewStep.tsx:
    // 1058-1119). Both members are unchecked, so both are reported.
    {
      code: "const [{ data: a }, { count: b }] = await Promise.all([supabase.from('t').select('c'), supabase.from('u').select('id', { count: 'exact', head: true })]);",
      errors: [{ messageId: "unchecked" }, { messageId: "unchecked" }],
    },
    // I4 — ARRAY FORM, PARTIALLY CHECKED: member one binds `error`, member two
    // does not. EXACTLY ONE error is expected. A rule that went quiet as soon
    // as any member was checked is the instance-not-class shape — and RuleTester
    // fails on an error-count mismatch, so this case pins the count, not just
    // the presence.
    {
      code: "const [{ data: a, error: aErr }, { count: b }] = await Promise.all([supabase.from('t').select('c'), supabase.from('u').select('id', { count: 'exact', head: true })]);",
      errors: [{ messageId: "unchecked" }],
    },
    // I5 — THE RENAME CASE. `{ data: error }` binds a local NAMED `error` that
    // is not the error field. It must STILL be reported: a rule satisfiable by
    // renaming a binding is the "could a broken implementation return this same
    // value?" failure, and would let the whole class walk back in behind a
    // cosmetic edit.
    {
      code: "const { data: error } = await supabase.from('t').select('c');",
      errors: [{ messageId: "unchecked" }],
    },
    // I6 — an `.rpc()` read is a PostgREST read too.
    {
      code: "const { data } = await supabase.rpc('sanitize_user', { p_id: id });",
      errors: [{ messageId: "unchecked" }],
    },
    // I7 — the client's local name is not load-bearing. Plan 140.4-01's file
    // uses `admin`, 140.4-02's uses `supabase`, others use `serviceClient`; a
    // root-name requirement would make the rule brittle and silently blind.
    {
      code: "const { count } = await admin.from('trades').select('id', { count: 'exact', head: true }).eq('strategy_id', id);",
      errors: [{ messageId: "unchecked" }],
    },
  ],
});
