/**
 * Phase 185 (DERIBITFLOWTIME) plan 04, SC-3 and D-04: the interim options caveat.
 *
 * A Deribit allocator book values open options at cash today: the key-mode
 * derive runs only the cash-settlement basis, so an option premium books as a
 * loss on the buy day and the payout as a gain on the close day, against a cash
 * wallet that leaves the option book out. D-04 keeps a caveat on the book until
 * options are valued at market in key mode.
 *
 * The derive writes the caveat into the key's `key_inputs` payload as a bool,
 * present only when true (`job_worker.py`, `_run_key_mode_compose_epilogue`).
 * This module is the one home of the stored key and of the strict read, so the
 * reader looks it up under the same literal the writer sets.
 *
 * The JSONB crosses from the worker into a typed value here, so it is
 * untrusted: only the boolean `true` raises the caveat. A string "true", a 1 or
 * an absent key raise nothing.
 */

/**
 * The key the Python analytics writer sets inside the key's `key_inputs`
 * payload. It is pinned against `job_worker.py` by
 * `src/__tests__/options-cash-basis-literal-pin.test.ts`, so the writer and this
 * reader cannot drift apart unnoticed.
 */
export const OPTIONS_CASH_BASIS_FLAG = "options_cash_basis" as const;

/**
 * 185 WR-03 / D-13. The key the writer stamps on EVERY Deribit key-mode `key_inputs`
 * payload, `true` when the key has option activity and `false` when it does not. A
 * drawn Deribit key whose row lacks a boolean here was never classified (a departed
 * key, or one whose derive keeps failing), so the reader raises the caveat for it.
 * Pinned against `job_worker.py` by the same literal-pin test.
 */
export const OPTIONS_ACTIVITY_FLAG = "options_activity" as const;

/** Strict read of the stored flag: true only for the boolean `true`. */
export function isOptionsCashBasis(value: unknown): boolean {
  return value === true;
}
