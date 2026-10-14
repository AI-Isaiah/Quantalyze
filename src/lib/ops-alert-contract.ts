/**
 * The ops-alert contract (Phase 164.6.8 OUTAGEALERT, plan 01), TypeScript half.
 *
 * Defined ONCE per language. The Python half is `OPS_ALERT_SOURCES`,
 * `OPS_ALERT_EVENTS` and `OPS_ALERT_CAUSE_RE` in
 * `analytics-service/services/ops_alert.py`;
 * `src/__tests__/ops-alert-contract-parity.test.ts` fails when the two
 * disagree, because a source added on one side only makes the route answer
 * 400 to that source's emails.
 *
 * Lives in a lib module rather than the route file: a Next.js route file may
 * export only route handlers and config.
 */

export const OPS_ALERT_SOURCES = [
  "mt5_jobs_terminal",
  "mt5_validation_terminal",
  "mt5_terminal_scrub",
  "mt5_relaunch_debt",
  "cron_sync",
  "backfill",
  "prod_prober",
  "drill",
  "unrecognised",
] as const;

export const OPS_ALERT_EVENTS = ["outage", "recovered"] as const;

/** The cause charset, as the pattern string Python feeds `re.fullmatch`. */
export const OPS_ALERT_CAUSE_RE = "[a-z0-9_:.-]{1,64}";

export type OpsAlertSource = (typeof OPS_ALERT_SOURCES)[number];
export type OpsAlertEvent = (typeof OPS_ALERT_EVENTS)[number];
