/**
 * Explicit `localStorage` / `sessionStorage` doubles for the wizard-persistence
 * specs — the ONE copy.
 *
 * ⛔ NOT OPTIONAL AND NOT STYLISTIC. The reason is a MEASURED disagreement
 * between boxes, not a preference. On Node 25 the runtime shadows jsdom's
 * `window.localStorage` with an implementation whose `setItem` IS NOT A
 * FUNCTION. `writeWizardState` catches that, warns, and stores nothing — so a
 * seed written through the REAL `saveWizardState` silently never exists,
 * `loadWizardState` answers `null`, and every "the stored payload did not come
 * back" assertion downstream passes for the wrong reason. CI runs Node 22, where
 * jsdom's own implementation works, so the two boxes disagree in exactly the
 * direction that hides a vacuous spec locally. These doubles make both read the
 * same.
 *
 * ⚠️ WHY IT IS SHARED RATHER THAN PASTED. This function existed in three specs
 * with the paragraph above paraphrased three times. A future jsdom or Node
 * change would have needed three coordinated edits, and the spec that missed one
 * would have gone quietly vacuous — which is the precise failure mode the
 * doubles exist to prevent, so the duplication was self-defeating.
 *
 * Callers own the lifecycle: build a fresh pair per test (a `beforeEach` call)
 * rather than clearing a shared one, so no state can leak between `it`s.
 */

/** The backing objects behind the installed `Storage` doubles. */
export interface WizardStorageDoubles {
  /**
   * Backs `window.localStorage`. Read it directly to assert on the stored bytes
   * (the wizard's signed `{v,p,h}` envelope lives at
   * `quantalyze_wizard_state_v1`).
   */
  localStore: Record<string, string>;
  /**
   * Backs `window.sessionStorage`, which is where the per-tab HMAC signing nonce
   * lives — the reason a hand-built envelope cannot verify and every seed must
   * be written through the real writer.
   */
  sessionStore: Record<string, string>;
}

/**
 * Install fresh `localStorage` / `sessionStorage` doubles on `window` and hand
 * back their backing objects.
 *
 * ⚠️ Each call REPLACES the previously installed pair, so a `beforeEach` call
 * both installs and resets — there is no separate clear step to forget.
 */
export function installWizardStorageDoubles(): WizardStorageDoubles {
  const localStore: Record<string, string> = {};
  const sessionStore: Record<string, string> = {};

  const mk = (store: Record<string, string>) =>
    ({
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      /**
       * Clears IN PLACE rather than rebinding to a fresh object, which is what
       * the three pasted copies did. In-place is what a real `Storage` does, and
       * it is what keeps the objects this function RETURNS valid for the life of
       * the double: a rebinding `clear()` would leave a caller holding a stale
       * reference and reading a populated store as empty (or the reverse).
       * Nothing calls `.clear()` on these doubles today — the specs build a
       * fresh pair per test — so adopting it changes no observed behaviour.
       */
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: () => null,
      length: 0,
    }) as unknown as Storage;

  Object.defineProperty(window, "localStorage", {
    value: mk(localStore),
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: mk(sessionStore),
    configurable: true,
  });

  return { localStore, sessionStore };
}
