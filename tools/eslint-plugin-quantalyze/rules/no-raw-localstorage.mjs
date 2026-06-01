/**
 * B7 — ban raw `localStorage` access outside the cross-tab storage primitive.
 *
 * `src/lib/storage/cross-tab.ts` (`useCrossTabStorage`) is the ONE place
 * persistent client state touches `localStorage` — it owns SSR-safe hydration,
 * version trichotomy, debounced persist + flush, cross-tab `storage`-event
 * sync, poison-key stripping, and fail-loud recovery breadcrumbs. A hand-rolled
 * `localStorage.getItem`/`setItem` re-opens the whole class (no version guard,
 * no cross-tab adoption, silent corruption) the B7 refactor closed.
 *
 * Scope: bans `localStorage.<x>` and `window.localStorage.<x>` MEMBER access
 * (the actual read/write/remove). A bare `typeof localStorage` SSR probe is NOT
 * a member access and is not flagged. `sessionStorage` is intentionally NOT
 * banned — the ephemeral session-flag class (`useSessionStorageBoolean`) is a
 * documented B7 sanctioned exception, a different class.
 *
 * Exemptions: the primitive's own directory (`src/lib/storage/**`, via an
 * eslint.config override) and any file carrying a `B7 sanctioned-exception:`
 * comment (e.g. the retained-for-back-compat helpers in scenario-state.ts whose
 * bare `localStorage` is the test-mock surface).
 */
import { fileHasMarker } from "./_shared.mjs";

const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

/**
 * Is `node` a `<global>.localStorage` member access — i.e. `window.localStorage`,
 * `globalThis.localStorage`, `self.localStorage`, or their computed-string
 * (`window["localStorage"]`) forms? `globalThis`/`self` are the idiomatic
 * cross-environment global-access spellings, so missing them leaves a silent
 * escape route the B7 backstop must cover (mirrors the sibling rules being
 * formatting-blind).
 */
function isQualifiedLocalStorage(node) {
  const { object, property, computed } = node;
  if (object.type !== "Identifier" || !GLOBAL_OBJECTS.has(object.name)) return false;
  if (!computed && property.type === "Identifier") return property.name === "localStorage";
  if (computed && property.type === "Literal") return property.value === "localStorage";
  return false;
}

/** A `typeof window.localStorage`-style SSR/feature probe is not a use of the
 *  API — don't flag it (mirrors leaving bare `typeof localStorage` alone). */
function isTypeofOperand(node) {
  return node.parent.type === "UnaryExpression" && node.parent.operator === "typeof";
}

const MESSAGE =
  "Raw localStorage access. Route persistent client state through " +
  "useCrossTabStorage from @/lib/storage (B7) — it owns versioning, cross-tab " +
  "sync, debounce/flush, and fail-loud recovery. If this is a deliberate " +
  "exception, add a `B7 sanctioned-exception:` comment in this file.";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw localStorage access outside the useCrossTabStorage primitive (B7).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["B7 sanctioned-exception:"])) return {};

    return {
      // Bare global: `localStorage.getItem(...)` — the Identifier `localStorage`
      // sits in the `object` position of a member access. (In `window.localStorage`
      // the token `localStorage` is the PROPERTY, not the object, so it is not
      // matched here — the qualified forms are handled below, with no
      // double-report on `window.localStorage.getItem`.)
      "MemberExpression > Identifier.object[name='localStorage']"(node) {
        const member = node.parent;
        if (isTypeofOperand(member)) return;
        context.report({ node: member, messageId: "raw" });
      },
      // Qualified: `window.localStorage` / `globalThis.localStorage` /
      // `self.localStorage` (and their `["localStorage"]` computed forms) — the
      // inner member of e.g. `globalThis.localStorage.getItem(...)`.
      MemberExpression(node) {
        if (!isQualifiedLocalStorage(node)) return;
        if (isTypeofOperand(node)) return;
        context.report({ node, messageId: "raw" });
      },
    };
  },
};
