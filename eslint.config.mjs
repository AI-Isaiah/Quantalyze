import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import quantalyze from "./tools/eslint-plugin-quantalyze/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Honor the underscore-prefix convention for intentionally unused
      // params/vars (Supabase mock signatures, Next.js route handlers
      // that don't read the request, etc.).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // B25 — local by-construction lint capstone (eslint-plugin-quantalyze).
  // Each rule is the edit-time backstop for a finding-class the cross-cutting
  // refactor program closed via a single source of truth; offenders are pointed
  // at the canonical helper. Set to "error" (not "warn") because the recon
  // proved a clean baseline, so these fail CI by construction on a future raw
  // offender — the literal goal of the capstone. A deliberate exception carries
  // a greppable `B<n> sanctioned-exception:` (or `B10 visibility:`) comment in
  // the file. See .planning/audit-2026-05-07/B25-PLAN.md.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { quantalyze },
    rules: {
      "quantalyze/no-raw-localstorage": "error",
      "quantalyze/no-raw-published-predicate": "error",
      "quantalyze/no-raw-retry-after-parse": "error",
    },
  },
  // Directory exemptions: the canonical helpers' own homes legitimately contain
  // the raw pattern they encapsulate.
  {
    files: ["src/lib/storage/**"],
    rules: { "quantalyze/no-raw-localstorage": "off" },
  },
  {
    files: ["src/lib/retry/**"],
    rules: { "quantalyze/no-raw-retry-after-parse": "off" },
  },
  // Test/spec files are exempt: they deliberately exercise the raw patterns to
  // set up fixtures and assert behaviour (e.g. SignOutButton.test.tsx seeds raw
  // localStorage keys to prove the purge removes them; a parser test feeds a
  // hostile Retry-After value). This mirrors the established by-construction
  // grep tests, which skip `*.test.*`/`*.spec.*` themselves (see
  // visibility.test.ts). The rules guard PRODUCTION state drift, not tests.
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "quantalyze/no-raw-localstorage": "off",
      "quantalyze/no-raw-published-predicate": "off",
      "quantalyze/no-raw-retry-after-parse": "off",
    },
  },
]);

export default eslintConfig;
