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
      // B9 — ban Zod .passthrough()/.catchall() at boundary parsers. Enforced
      // repo-wide (not file-scoped) because passthrough only ever appears at a
      // boundary in this codebase, so a global ban with a greppable per-site
      // `// eslint-disable-line ... -- B9 sanctioned-exception:` escape is a
      // stronger lock than a file allowlist that could go stale when a new
      // boundary module is added.
      "quantalyze/no-passthrough-on-ipc": "error",
      // B14 — ban re-deriving sync staleness from a raw `last_sync_at` vs cutoff
      // comparison; route through deriveSyncFreshness() (@/lib/sync-freshness) so
      // the 24h cutoff lives in one place (two-sync-time max/sort is still fine).
      "quantalyze/no-raw-staleness-derivation": "error",
      // DS-04 (Phase 49) — fluid type spine guards. SCOPED, NOT big-bang: unlike
      // the B-series rules above (clean baselines → repo-wide error), the raw-px
      // baseline is DIRTY (recon: 558 `text-[NNpx]` + 355 hex sites across 54
      // files). A repo-wide `error` here would red-CI the whole tree and force
      // the deferred strangler migration (phases 52/53) into Phase 49. So:
      //   - no-rem-less-clamp → repo-wide ERROR: recon proved a CLEAN baseline
      //     (zero rem-less clamp STRINGS in TSX today; the numeric Math-style
      //     clamp() helpers are call expressions the rule deliberately ignores),
      //     so it fails CI by construction on a future zoom-unsafe clamp string.
      //   - no-raw-font-px → repo-wide WARN here (dirty baseline stays visible
      //     but non-blocking); hard ERROR only on the proven-clean
      //     `src/lib/design-tokens/**` surface (override block below). The 52/53
      //     strangler ratchets the remaining ~53/54 dirty surfaces to error one
      //     at a time. Chart / designer-bundle ports are turned off by glob; a
      //     one-off carries a greppable `DS-04 sanctioned-exception:` comment.
      "quantalyze/no-rem-less-clamp": "error",
      "quantalyze/no-raw-font-px": "warn",
    },
  },
  // DS-04 hard gate on the proven-clean new token/primitive surface. The
  // design-tokens dir has ZERO `text-[NNpx]` / `fontSize:'NNpx'` sites today
  // (recon), so escalating it to `error` locks the clean surface without
  // touching the dirty 53/54 the strangler migration owns.
  {
    files: ["src/lib/design-tokens/**"],
    rules: { "quantalyze/no-raw-font-px": "error" },
  },
  // Context allow-list: Recharts axis colors / designer-bundle chart ports pin
  // raw px sizes legitimately. Turn BOTH DS-04 rules off here (mirrors how
  // no-raw-localstorage is off for src/lib/storage/**).
  {
    files: ["src/components/charts/**"],
    rules: {
      "quantalyze/no-raw-font-px": "off",
      "quantalyze/no-rem-less-clamp": "off",
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
  {
    files: ["src/lib/sync-freshness/**"],
    rules: { "quantalyze/no-raw-staleness-derivation": "off" },
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
      "quantalyze/no-passthrough-on-ipc": "off",
      "quantalyze/no-raw-staleness-derivation": "off",
      // DS-04: test fixtures deliberately author raw px / vw-only clamps to
      // assert the rules fire — the rules guard PRODUCTION source, not tests.
      "quantalyze/no-raw-font-px": "off",
      "quantalyze/no-rem-less-clamp": "off",
    },
  },
]);

export default eslintConfig;
