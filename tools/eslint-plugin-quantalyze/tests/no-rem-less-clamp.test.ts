import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-rem-less-clamp.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-rem-less-clamp", rule, {
  valid: [
    // A zoom-safe clamp string: the preferred (middle) term carries a rem.
    {
      code: "const style = { fontSize: 'clamp(2rem, 1.5rem + 2.5vw, 3rem)' };",
    },
    // Preferred term is rem-only (no vw) — also zoom-safe.
    {
      code: "const style = { width: 'clamp(1rem, 1.5rem, 2rem)' };",
    },
    // Pitfall-3 regression pin: a NUMERIC Math-style clamp(a, b, c)
    // CallExpression is NOT CSS and must NOT be flagged. The rule only
    // inspects string/template content, never call expressions, so this
    // helper call is invisible to it.
    { code: "const x = clamp(2, n, 9);" },
    { code: "const r = clamp(round(Math.cbrt(n)), 2, n);" },
    // A clamp in a string where the middle anchors with rem even though min/max
    // also use rem (the canonical spine shape).
    {
      code: "const t = `font-size: clamp(0.875rem, 0.85rem + 0.125vw, 1rem)`;",
    },
    // File-level sanctioned-exception marker exempts the whole file.
    {
      code:
        "// DS-04 sanctioned-exception: legacy port keeps a vw-only clamp\n" +
        "const style = { fontSize: 'clamp(1px, 2vw, 3px)' };",
    },
  ],
  invalid: [
    // rem-less, vw-only preferred term in a style string — the F94 shape.
    {
      code: "const style = { fontSize: 'clamp(1px, 2vw, 3px)' };",
      errors: [{ messageId: "raw" }],
    },
    // The subtle case the constraint calls out: rem in min/max bounds, but the
    // PREFERRED (middle) term is vw-only → still a violation.
    {
      code: "const style = { width: 'clamp(2rem, 3vw, 4rem)' };",
      errors: [{ messageId: "raw" }],
    },
    // vh is equally zoom-unsafe as vw — the viewport, not the text, drives it.
    {
      code: "const style = { fontSize: 'clamp(2rem, 3vh, 4rem)' };",
      errors: [{ messageId: "raw" }],
    },
    // Same shape inside a template-literal chunk.
    {
      code: "const css = `width: clamp(1px, 4vw, 5px)`;",
      errors: [{ messageId: "raw" }],
    },
  ],
});
