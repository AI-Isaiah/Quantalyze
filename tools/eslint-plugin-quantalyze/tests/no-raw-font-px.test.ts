import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-font-px.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-font-px", rule, {
  valid: [
    // A named fluid tier utility — the canonical zoom-safe shape.
    { code: 'const cls = "text-body font-semibold";' },
    { code: 'const cls = "text-hero text-page-title text-micro";' },
    // A non-font arbitrary value is not a font-size.
    { code: 'const cls = "w-[14px] gap-[8px]";' },
    // A rem font-size IS the zoom-safe shape this rule steers toward.
    { code: 'const cls = "text-[0.875rem]";' },
    // line-height in arbitrary px is not a font-size (matches `leading-`, not `text-`).
    { code: 'const cls = "leading-[14px]";' },
    // A px value in pure arithmetic / a non-style string is not a font-size.
    { code: "const margin = 14;" },
    { code: 'const label = "13px label";' },
    // File-level sanctioned-exception marker exempts the whole file.
    {
      code:
        "// DS-04 sanctioned-exception: designer-bundle port pins 14px\n" +
        'const cls = "text-[14px]";',
    },
  ],
  invalid: [
    // Arbitrary px font-size in a className string.
    {
      code: 'const cls = "text-[14px] text-secondary";',
      errors: [{ messageId: "raw" }],
    },
    // Decimal px must still be caught (the rule is ERROR on design-tokens/**).
    {
      code: 'const cls = "text-[14.5px]";',
      errors: [{ messageId: "raw" }],
    },
    // Uppercase PX is the same regression in disguise.
    {
      code: 'const cls = "text-[16PX]";',
      errors: [{ messageId: "raw" }],
    },
    // Decimal px in an inline style object.
    {
      code: "const style = { fontSize: '14.5px' };",
      errors: [{ messageId: "raw" }],
    },
    // Arbitrary px font-size in a template literal chunk.
    {
      code: "const cls = `flex text-[18px] ${extra}`;",
      errors: [{ messageId: "raw" }],
    },
    // Inline style object fontSize in px.
    {
      code: "const style = { fontSize: '14px' };",
      errors: [{ messageId: "raw" }],
    },
    {
      code: 'const style = { fontSize: "20px", color: "red" };',
      errors: [{ messageId: "raw" }],
    },
  ],
});
