import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-localstorage.mjs";

// Wire ESLint's built-in RuleTester to vitest's runner (@typescript-eslint/
// rule-tester is not installed; the built-in tester is framework-agnostic).
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-localstorage", rule, {
  valid: [
    // Routes through the primitive — no raw access.
    { code: "const [v, set] = useCrossTabStorage(key, codec);" },
    // Bare + qualified SSR/feature probes are not a use of the API — not flagged.
    { code: "if (typeof localStorage !== 'undefined') {}" },
    { code: "if (typeof window.localStorage !== 'undefined') {}" },
    // sessionStorage is a deliberately-different (sanctioned) class — not banned.
    { code: "sessionStorage.getItem('flag');" },
    // A non-localStorage member of a global object must not be flagged.
    { code: "globalThis.fetch('/x');" },
    // File-level sanctioned-exception marker disables the rule for the whole file.
    { code: "// B7 sanctioned-exception: legacy back-compat helper\nlocalStorage.getItem('k');" },
    { code: "/* B7 sanctioned-exception: test-mock surface */\nwindow.localStorage.setItem('k', 'v');" },
  ],
  invalid: [
    { code: "localStorage.getItem('k');", errors: [{ messageId: "raw" }] },
    { code: "localStorage.setItem('k', 'v');", errors: [{ messageId: "raw" }] },
    { code: "localStorage.removeItem('k');", errors: [{ messageId: "raw" }] },
    // window form reports exactly once (no double-report on the trailing .setItem).
    {
      code: "window.localStorage.setItem('k', 'v');",
      errors: [{ messageId: "raw" }],
    },
    // Alternate global-object spellings (the idiomatic cross-environment forms)
    // and the computed-property form must NOT escape the gate.
    { code: "globalThis.localStorage.getItem('k');", errors: [{ messageId: "raw" }] },
    { code: "self.localStorage.setItem('k', 'v');", errors: [{ messageId: "raw" }] },
    { code: "window['localStorage'].getItem('k');", errors: [{ messageId: "raw" }] },
    { code: "globalThis['localStorage'].removeItem('k');", errors: [{ messageId: "raw" }] },
  ],
});
