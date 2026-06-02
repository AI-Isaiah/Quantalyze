/**
 * Shared E2E selector + Page-type contract for the discovery / watchlist /
 * preferences specs.
 *
 * audit-2026-05-07 findings H-1039 + H-1040:
 *
 *  H-1039 (type-design-analyzer): helpers across the discovery specs typed
 *  `page` via an inline `import("@playwright/test").Page` expression. That
 *  sidesteps the import list, hides the dependency, and yields no
 *  jump-to-source. `E2EPage` below is the single named alias every helper
 *  imports, so a future page-object pattern can widen ONE type instead of
 *  N inline annotations.
 *
 *  H-1040 (type-design-analyzer): the same raw selector string literals
 *  (login-form triplet, the Customize cog aria-label, the Save-preferences
 *  aria-label, `table tbody tr`, the watchlist star aria-label) were
 *  copy-pasted verbatim across four specs. A rename of any one of the
 *  underlying component aria-labels (e.g. CustomizeDrawer changes the cog
 *  to "Open customize panel") turned the spec's `locator(...)` into a
 *  silent no-op: `count() === 0` passes the optional `if (await x.count())`
 *  branches, so the spec stays green while the surface it claims to guard
 *  is gone.
 *
 *  `SELECTORS` is a single `as const` object — the literal types are pinned,
 *  so a typo at a CALL site (`SELECTORS.customizeCgo`) is a compile error,
 *  not a runtime 0-match. The aria-label values here are the contract the
 *  component must honour; the matching `*.test.tsx` unit specs
 *  (CustomizeDrawer.test.tsx :135/:139, StarToggle.test.tsx :89/:103,
 *  WatchlistTabs.test.tsx :60) assert the component still EMITS these exact
 *  strings, so a component rename fails CI at the unit layer and this
 *  constant is the one place to update in lockstep.
 */
import type { Page } from "@playwright/test";

/**
 * Project-wide alias for the Playwright `Page` fixture used in helper
 * signatures. Widen here if a page-object wrapper is ever introduced.
 */
export type E2EPage = Page;

export const SELECTORS = {
  /** /login email field — name attr OR placeholder (LoginForm.tsx:43). */
  loginEmail: 'input[name="email"], input[placeholder*="email" i]',
  /** /login password field (LoginForm.tsx:53, type="password"). */
  loginPassword: 'input[type="password"]',
  /** /login submit button (LoginForm.tsx:71 visible text "Sign in"). */
  loginSubmit: 'button:has-text("Sign in")',
  /** Discovery table rows. */
  tableRows: "table tbody tr",
  /**
   * Customize cog — StrategyFilters.tsx:374 aria-label.
   * Pinned by CustomizeDrawer/StrategyFilters render contract.
   */
  customizeCog: 'button[aria-label="Customize discovery view"]',
  /** CustomizeDrawer save button — CustomizeDrawer.tsx:282 aria-label. */
  savePreferences: 'button[aria-label="Save preferences"]',
  /** StarToggle "add" state — StarToggle.tsx aria-label "...to watchlist". */
  starAddButton: 'button[aria-label*="to watchlist"]',
  /** StarToggle "remove" state — aria-label "...from watchlist". */
  starRemoveButton: 'button[aria-label*="from watchlist"]',
} as const;

export type SelectorKey = keyof typeof SELECTORS;
