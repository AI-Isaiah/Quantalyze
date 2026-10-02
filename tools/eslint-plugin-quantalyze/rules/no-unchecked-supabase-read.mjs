/**
 * SEAMRIM-11 (Phase 140.4) — ban an `await`ed PostgREST read whose result is
 * destructured for `data`/`count` without ever binding `error`.
 *
 * THE PREDICATE, verbatim (this is the rule's published contract):
 *
 *   Flag an `await`ed PostgREST call expression whose result is destructured —
 *   in EITHER the object form (`const { data } = await …`) or the ARRAY form
 *   inside a `Promise.all` — where no binding for `error` is introduced, and the
 *   chain is not terminated by `.throwOnError()`.
 *
 * WHY IT EXISTS. supabase-js (2.110.1) resolves a PostgREST failure AS A VALUE
 * rather than throwing. An RLS denial or a statement timeout therefore arrives
 * as `{ data: null, count: null, error: <PostgrestError> }`, and a destructure
 * that never binds `error` is byte-for-byte indistinguishable from a genuinely
 * empty table. Coerced through the usual `?? 0` / `?? []` it becomes a
 * *measurement the product never took* — C-3 rendered "We found only 0 filled
 * trade(s) on this key." on a read that failed, and the same fail-open at the
 * admin publish gate let `spanDays !== null &&` skip the 7-day history check,
 * publishing an under-history track record as verified.
 *
 * WHY THE ARRAY FORM IS LOAD-BEARING, and not an optional extra. The phase's
 * top finding lives at SyncPreviewStep.tsx:1058-1119, which ARRAY-destructures
 * a seven-member `Promise.all`. An object-destructure-only predicate returns
 * **zero** on that file — object form closed, array form open, in the same
 * source file. A rule that saw only the object form would report the converted
 * files clean while the exact defect class walked back in, which is how this
 * finding survived every prior census.
 *
 * In the array form each element is judged INDEPENDENTLY: a `Promise.all` where
 * one member binds `error` and another does not reports only the unchecked
 * member. A rule that went quiet as soon as any member was checked would be the
 * instance-not-class shape this phase exists to close.
 *
 * ── DELIBERATE NON-GOALS ────────────────────────────────────────────────────
 * These are limits chosen on purpose, not oversights. A rule with false
 * positives gets disabled repo-wide, taking its true positives with it.
 *
 * 1. THE WHOLE-RESULT BINDING IS VALID AND UNSEEN.
 *      const res = await supabase.from("t").select("c");
 *      if (res.error) throw res.error;
 *    There is no destructuring pattern here, so the rule does not look at it.
 *    Deciding whether `res.error` is read later needs cross-statement (and in
 *    the general case, type) reasoning this rule does not have; over-flagging
 *    it is how a rule gets turned off. NOTE the consequence honestly: a file
 *    written entirely in this style has ZERO rule-visible sites, so `error` on
 *    such a file is a RATCHET against re-introducing the destructure form, not
 *    a check on the code as it stands today.
 *
 * 2. `supabase.storage.…getPublicUrl()` IS EXCLUDED BY NAME.
 *      const { data } = supabase.storage.from("b").getPublicUrl(p);
 *    That API returns `{ data }` with NO `error` field at all, so demanding an
 *    `error` binding would be demanding a field that does not exist. It is a
 *    MEASURED false positive of the naive predicate (140.4-PATTERNS §1,
 *    src/app/api/portfolio-documents/route.ts:61). It is excluded twice over:
 *    it is not `await`ed (the call is synchronous), and any `storage` segment
 *    or a `getPublicUrl` terminal in the chain is excluded explicitly.
 *
 * 3. A CONDITIONAL MEMBER IS NOT DESCENDED INTO.
 *      apiKeyId ? supabase.from("api_keys")… : Promise.resolve({ data: null })
 *    The synthetic else-branch has no `error` property, so flagging the
 *    ternary would demand a binding that is unrepresentable on one arm — the
 *    keyless-draft outage SyncPreviewStep.tsx:1162-1166 documents.
 *
 * DETECTION, precisely. A call is treated as a PostgREST read when its
 * member/call chain contains a `.from(…)` or `.rpc(…)` call and contains no
 * `storage` segment. The destructure is judged unchecked when it binds a `data`
 * or `count` KEY (the fields whose coercion fabricates the measurement) and
 * binds no `error` KEY. `error` must be the KEY, never the local name: a
 * pattern like `{ data: error }` binds a local called `error` that is not the
 * error field, and IS reported — otherwise the rule would be satisfiable by a
 * rename. A `...rest` element satisfies the check, because `error` genuinely
 * remains reachable through it. `.throwOnError()` anywhere in the chain
 * satisfies the check, because it changes the awaited type such that no
 * `error` binding is possible.
 *
 * Escape hatch: a file-level `SEAMRIM-11 sanctioned-exception:` comment, in the
 * same greppable/auditable shape the sibling rules use.
 */
import { fileHasMarker } from "./_shared.mjs";

/** Fields whose silent coercion fabricates a measurement. */
const CONSUMED_FIELDS = new Set(["data", "count"]);

/** Chain methods that mark the call as a PostgREST query builder. */
const POSTGREST_ROOTS = new Set(["from", "rpc"]);

/**
 * Storage markers. `supabase.storage.from("b").getPublicUrl(p)` also contains a
 * `.from(` segment, so the storage namespace must be excluded explicitly or the
 * naive predicate reports a measured false positive (non-goal 2).
 */
const STORAGE_SEGMENTS = new Set(["storage"]);
const STORAGE_TERMINALS = new Set(["getPublicUrl"]);

const MESSAGE =
  "Unchecked PostgREST read: this destructure takes `data`/`count` but never " +
  "binds `error`. supabase-js resolves a failed read AS A VALUE, so an " +
  "unchecked destructure is indistinguishable from real data — a null count " +
  "coerced by `?? 0` renders as a measurement nobody took (SEAMRIM-11 / C-3). " +
  "Use the checked-read shape the codebase already uses: bind it and fail " +
  "loud — `const { data, error } = await …; if (error) throw …` (or the " +
  "whole-result form `const res = await …; if (res.error) throw …`) — or " +
  "terminate the chain with `.throwOnError()`. If this is a deliberate " +
  "exception, add a `SEAMRIM-11 sanctioned-exception:` comment in this file.";

/**
 * Walk a call/member chain from its outermost CallExpression down to the root,
 * collecting every non-computed property name that appears in it.
 *
 * @param {object} node
 * @returns {{ methods: Set<string>, segments: Set<string>, terminal: string | null }}
 */
function describeChain(node) {
  const methods = new Set();
  const segments = new Set();
  let terminal = null;
  let current = node;

  while (current) {
    if (current.type === "CallExpression") {
      const callee = current.callee;
      if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
        methods.add(callee.property.name);
        if (terminal === null) terminal = callee.property.name;
      }
      current = callee;
    } else if (current.type === "MemberExpression") {
      if (!current.computed && current.property.type === "Identifier") {
        segments.add(current.property.name);
      }
      current = current.object;
    } else {
      break;
    }
  }

  return { methods, segments, terminal };
}

/**
 * Is this expression an awaited PostgREST read whose failure channel matters?
 *
 * @param {object} node
 * @returns {{ isRead: boolean, satisfiedByThrowOnError: boolean }}
 */
function classifyCall(node) {
  const miss = { isRead: false, satisfiedByThrowOnError: false };
  if (!node || node.type !== "CallExpression") return miss;

  const { methods, segments, terminal } = describeChain(node);

  // Non-goal 2 — the storage namespace returns `{ data }` with no `error`.
  for (const marker of STORAGE_SEGMENTS) if (segments.has(marker)) return miss;
  if (terminal !== null && STORAGE_TERMINALS.has(terminal)) return miss;

  let isRead = false;
  for (const root of POSTGREST_ROOTS) if (methods.has(root)) isRead = true;
  if (!isRead) return miss;

  return { isRead: true, satisfiedByThrowOnError: methods.has("throwOnError") };
}

/**
 * Does this ObjectPattern consume `data`/`count` without binding an `error` KEY?
 *
 * @param {object} pattern
 * @returns {boolean}
 */
function isUncheckedPattern(pattern) {
  if (!pattern || pattern.type !== "ObjectPattern") return false;

  let consumes = false;
  let bindsError = false;

  for (const prop of pattern.properties) {
    // `...rest` genuinely keeps `error` reachable — treat it as satisfying.
    if (prop.type === "RestElement") return false;
    if (prop.type !== "Property" || prop.computed) continue;

    const key = prop.key;
    const name =
      key.type === "Identifier" ? key.name : key.type === "Literal" ? String(key.value) : null;
    if (name === null) continue;

    // The KEY, never the local name — `{ data: error }` binds a local called
    // `error` that is not the error field, so the rule is not rename-satisfiable.
    if (name === "error") bindsError = true;
    if (CONSUMED_FIELDS.has(name)) consumes = true;
  }

  return consumes && !bindsError;
}

/** Is this `Promise.all([...])`? Returns the element array, or null. */
function promiseAllElements(node) {
  if (!node || node.type !== "CallExpression") return null;
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "Promise" ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "all"
  ) {
    return null;
  }
  const arg = node.arguments[0];
  return arg && arg.type === "ArrayExpression" ? arg.elements : null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an awaited PostgREST read destructured for data/count without binding error, in both the object and Promise.all array forms (SEAMRIM-11).",
      recommended: true,
    },
    schema: [],
    messages: { unchecked: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["SEAMRIM-11 sanctioned-exception:"])) return {};

    return {
      VariableDeclarator(node) {
        const init = node.init;
        if (!init || init.type !== "AwaitExpression") return;
        const awaited = init.argument;

        // ── ARRAY FORM — `const [ {…}, {…} ] = await Promise.all([...])`.
        // Each element is judged INDEPENDENTLY against its own positional
        // member, so a partially-checked Promise.all reports only the
        // unchecked members.
        if (node.id.type === "ArrayPattern") {
          const members = promiseAllElements(awaited);
          if (!members) return;
          node.id.elements.forEach((element, index) => {
            if (!element || element.type !== "ObjectPattern") return;
            const { isRead, satisfiedByThrowOnError } = classifyCall(members[index]);
            if (!isRead || satisfiedByThrowOnError) return;
            if (isUncheckedPattern(element)) {
              context.report({ node: element, messageId: "unchecked" });
            }
          });
          return;
        }

        // ── OBJECT FORM — `const { data } = await supabase.from(…)…`.
        if (node.id.type === "ObjectPattern") {
          const { isRead, satisfiedByThrowOnError } = classifyCall(awaited);
          if (!isRead || satisfiedByThrowOnError) return;
          if (isUncheckedPattern(node.id)) {
            context.report({ node: node.id, messageId: "unchecked" });
          }
        }
      },
    };
  },
};
