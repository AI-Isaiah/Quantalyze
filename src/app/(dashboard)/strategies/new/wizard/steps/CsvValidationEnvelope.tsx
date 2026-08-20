"use client";

import { type ReactNode } from "react";
import {
  CSV_RULE_LABELS,
  WIZARD_ERROR_COPY,
  formatCsvRuleCauseSingle,
  formatColumnInDataframeMessage,
} from "@/lib/wizardErrors";

/**
 * Phase 15 / CSV-01..CSV-02 — server validation error envelope for the
 * CSV branch of the strategy onboarding wizard.
 *
 * Visual contract is locked by 15-UI-SPEC.md §7.3 (envelope shell) and
 * §8.8 (per-rule label table). Mirrors the ConnectKeyStep error block.
 *
 * The correlation_id null slot is rendered as a dash in Phase 15. Phase
 * 16 / OBSERV-06 wires real values via the seam client in analytics-client.ts without
 * changing the DOM shape.
 *
 * Phase 17 / DESIGN-05: rule-label map and cause-string templates live
 * in @/lib/wizardErrors as the canonical source of truth.
 */

/**
 * ⛔ 140.5-05 / SEAMPROSE-07 — CODES WHOSE `WIZARD_ERROR_COPY` CAUSE IS FALSE AT
 * THE CSV ROUTES' EMISSION SITE, AND MUST THEREFORE NOT BE PASTED UNDER THE
 * ROUTE'S OWN SENTENCE.
 *
 * ── FOUND BY A NEGATIVE CONTROL, ON THE UNTOUCHED TREE ───────────────────────
 * `human_message` is a claim about THIS EMISSION; the table's `cause` is a claim
 * about the CODE. When a route corrects its copy for a site where the code's
 * table entry is false, this panel rendered BOTH and printed a contradiction.
 * The measured specimen, verbatim from the DOM before this fix:
 *
 *   "Our rate limiter is unavailable, so we stopped before checking your file.
 *    … Nothing was saved and nothing was validated — try again in a minute."
 *   "A setting on our side is wrong, so we stopped before sending the request.
 *    Nothing was submitted and nothing was changed. Retrying will not clear it:
 *    the setting stays wrong until we fix it and redeploy. …"
 *
 * Line 1 says try again in a minute; line 2 says retrying will not clear it.
 * Line 1 is true here; line 2 is false in three separate clauses.
 *
 * ── WHY IT IS FALSE, SPECIFICALLY ───────────────────────────────────────────
 * `WIZARD_ERROR_COPY.SEAM_MISCONFIGURED` was authored (140.3-15 / TS-38) for a
 * `SeamConfigError` raised BEFORE any store or network I/O — its own docblock
 * says the "Nothing was submitted" clause is safe there *because* of that
 * ordering. Both CSV routes emit the same code from `rateLimitDenyJson`'s
 * misconfigured arm instead, which sits ~50 lines BELOW `req.formData()`: the
 * user's whole file has already crossed the wire and been buffered. 140.4-16 /
 * WR-07 corrected the route's sentence for exactly this reason; 140.4-16 /
 * CR-02 then started rendering the table cause, which silently re-imported the
 * clause WR-07 had just removed. Neither change was wrong on its own.
 *
 * ── WHY NOT FIX THE COPY TABLE INSTEAD ──────────────────────────────────────
 * The entry is TRUE at its other emitters (`finalize-wizard`, and every
 * `SeamConfigError` site), and weakening it there to satisfy this surface would
 * trade a false sentence here for a vaguer one everywhere. Minting a second
 * code for one fact is the drift the vocabulary exists to prevent, and 140.5-02
 * refused that shape by name. The honest scope of the problem is the PANEL that
 * pairs a per-emission sentence with a per-code one.
 *
 * ── COVERAGE-LAW ROW, STATED (CONTEXT §2) ───────────────────────────────────
 * A hand-typed set — **row 2, PARTIAL BY CONSTRUCTION**. It is fail-louded
 * rather than trusted: `seam-wire-vocabulary.invariant.test.ts` derives the CSV
 * routes' emitted codes from disk, intersects them with the copy table's
 * domain, and asserts that intersection is EXACTLY the union of the two sets
 * below. A newly-emitted code that has table copy therefore cannot arrive
 * without someone deciding, in that commit, which side it falls on.
 */
export const CSV_CAUSE_FALSE_AT_EMISSION: ReadonlySet<string> = new Set<string>([
  "SEAM_MISCONFIGURED",
]);

/**
 * The counterpart, and it is not decoration: without it the partition assertion
 * in the guard could be satisfied by suppressing everything, which would delete
 * the panel's second line — the thing CR-02 built.
 *
 * Each member is here because its table cause was READ against the route's own
 * emitter and found true there:
 *   · `CSV_FILE_TOO_LARGE` — "We cap CSV uploads at 10 MB to keep validation
 *     fast." True at both `content-length` and `file.size` guards.
 *   · `CSV_UPSTREAM_FAIL`  — the §4a founder cause. Verified in the copy table's
 *     own docblock (three layers: no writes in the Next route, `validate()` only
 *     in Python, `strategies` row created at FINALIZE).
 */
export const CSV_CAUSE_TRUE_AT_EMISSION: ReadonlySet<string> = new Set<string>([
  "CSV_FILE_TOO_LARGE",
  "CSV_UPSTREAM_FAIL",
]);

interface CsvValidationEnvelopeProps {
  envelope: {
    code: string;
    human_message: string;
    debug_context: {
      pandera_errors?: { rule: string; row: number; message: string }[];
    };
    correlation_id: string | null;
  };
  /**
   * 146.2-08 / B1 — an optional remedy CTA, rendered BELOW the body and ABOVE
   * the per-rule accordion. That position is DESIGN.md's Error Envelope
   * contract for the retry CTA, and this panel is the CSV surface's stand-in
   * for that shell; a caller that rendered its own button underneath the panel
   * would sit outside the tinted box and read as unrelated to the sentence.
   *
   * A slot rather than a `code`-keyed table inside this component: WHICH codes
   * are recoverable and BY WHAT action is the calling step's knowledge (only
   * `CsvSubmitStep` can mint a wizard session), and baking a code list in here
   * would put that decision two files away from the state it mutates.
   */
  action?: ReactNode;
}

export function CsvValidationEnvelope({
  envelope,
  action,
}: CsvValidationEnvelopeProps) {
  const errors = envelope.debug_context?.pandera_errors ?? [];
  const byRule = errors.reduce<Record<string, typeof errors>>((acc, e) => {
    (acc[e.rule] ??= []).push(e);
    return acc;
  }, {});
  const ruleKeys = Object.keys(byRule);
  const ruleCount = ruleKeys.length;

  // ⚠️ 140.4-16 / CR-02 — THE SECOND LINE MUST SAY SOMETHING THE FIRST DOES
  // NOT. Until this, the final `else` below was `envelope.human_message` — the
  // same string the heading falls back to when `errors.length === 0` — so every
  // failure WITHOUT a per-row breakdown (every upstream fault, every transport
  // failure, every 401) printed one sentence twice. Reproduced in a browser on
  // a real founder CSV: qa-report-localhost-2026-07-29, ISSUE-003.
  //
  // The replacement reads the code's OWN authored `cause` from the ONE copy
  // table, and renders NOTHING when there is no entry. Falling back to
  // `formatKeyError`'s UNKNOWN cause would be worse than the duplication: it
  // would state a reason we never established, for a code we do not recognise.
  // `envelope.code` is typed `string` here (this panel is one of the surfaces
  // `ErrorEnvelope`'s `WizardErrorCode` fence never reached), so the lookup is
  // a plain-record read and must tolerate a miss.
  //
  // ⚠️ 140.5-05 — AND IT MUST NOT STATE SOMETHING THE FIRST LINE CONTRADICTS.
  // CR-02's rule was "the second line must say something the first does not";
  // the stronger rule this surface needs is that it must not say something the
  // first says is untrue. See `CSV_CAUSE_FALSE_AT_EMISSION` above for the
  // measured specimen and why the fix is here rather than in the copy table.
  const authoredCause = CSV_CAUSE_FALSE_AT_EMISSION.has(envelope.code)
    ? undefined
    : (WIZARD_ERROR_COPY as Record<string, { cause: string } | undefined>)[
        envelope.code
      ]?.cause;

  let causeText: string | null;
  if (ruleCount > 1) {
    // Phase 17 / DESIGN-05: "Across {n} rule categories: {labels}." — the keys
    // are humanized via CSV_RULE_LABELS first (this surface joins
    // human-readable labels rather than raw rule keys).
    const humanizedKeys = ruleKeys.map((r) => CSV_RULE_LABELS[r] ?? r);
    causeText = `Across ${ruleCount} rule categories: ${humanizedKeys.join(", ")}.`;
  } else if (ruleCount === 1 && errors.length > 0) {
    const onlyRule = ruleKeys[0];
    const human = CSV_RULE_LABELS[onlyRule] ?? onlyRule;
    causeText = formatCsvRuleCauseSingle(human);
  } else {
    causeText = authoredCause ?? null;
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
      data-testid="wizard-csv-error"
      data-error-code={envelope.code}
    >
      <p className="text-body font-semibold text-negative">
        {errors.length > 0
          ? `${errors.length} ${errors.length === 1 ? "row" : "rows"} failed validation`
          : envelope.human_message}
      </p>
      {causeText !== null && (
        <p className="mt-1 text-caption text-text-secondary">{causeText}</p>
      )}
      {action !== undefined && action !== null && (
        <div className="mt-3" data-testid="wizard-csv-error-action">
          {action}
        </div>
      )}
      {Object.entries(byRule).map(([rule, list]) => (
        <details key={rule} className="mt-2 text-caption">
          <summary className="cursor-pointer text-text-secondary">
            {CSV_RULE_LABELS[rule] ?? rule} ({list.length} rows)
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-muted">
            {list.map((e, i) => (
              <li key={i}>
                {rule === "column_in_dataframe"
                  ? formatColumnInDataframeMessage(e.message)
                  : `Row ${e.row}: ${e.message}`}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {/* Phase 16 / OBSERV-06 carrier marker — DOM shape stable. */}
      <p className="mt-2 text-micro text-text-muted">
        correlation_id: {envelope.correlation_id ?? "—"}
      </p>
    </div>
  );
}
