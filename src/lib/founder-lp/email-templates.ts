/**
 * Phase 18 / LP-01 / round-2 — founder LP email templates.
 *
 * Email is a customer-facing surface (the founder receives one a month
 * for the success path, plus a failure alert when the cron breaks).
 * The previous inline templates were the plainest possible HTML — a
 * single `<p>Monthly LP factsheet attached.</p>` for success and a
 * `<p>...</p><pre>...</pre>` pair for failure. This file replaces both
 * with refined, institutional financial-report-style emails aligned to
 * DESIGN.md.
 *
 * Aesthetic: industrial/utilitarian, FactSet/Bloomberg-quarterly-factsheet
 * reference. Mostly typography. Hairline dividers. Color is rare and
 * meaningful — a thin accent stripe at the top is the only chrome.
 * Mirrors DESIGN.md tokens via inline styles (HTML email cannot consume
 * CSS variables reliably across clients).
 *
 * Constraints (HTML email, vs. the app):
 *  - No web fonts. Resend/Gmail/Apple Mail strip @font-face most of the
 *    time. Fall back to a system-serif stack that reads as editorial:
 *    `Charter, Cambria, Georgia, 'Times New Roman', serif`. DESIGN.md
 *    blesses Instrument Serif for editorial gravitas; system Charter is
 *    the closest faithful fallback when web fonts are unavailable.
 *  - No JavaScript. No CSS variables. No flexbox in older clients.
 *    Tables for layout.
 *  - Inline `style=` only — `<style>` blocks are stripped by Gmail web.
 *
 * Tokens (mirrored from DESIGN.md, do NOT drift):
 *  - bg-page:        #F8F9FA
 *  - surface:        #FFFFFF
 *  - border:         #E2E8F0   (hairline)
 *  - text-primary:   #1A1A2E
 *  - text-secondary: #4A5568
 *  - text-muted:     #64748B
 *  - accent:         #1B6B5A   (success stripe; "verified")
 *  - negative:       #DC2626   (failure stripe; "losses, errors,
 *                                permanent failures" per DESIGN.md)
 *  - negative-50:    #FEF2F2   (failure error-block fill)
 */

const TOKENS = {
  bgPage: "#F8F9FA",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  textPrimary: "#1A1A2E",
  textSecondary: "#4A5568",
  textMuted: "#64748B",
  accent: "#1B6B5A",
  negative: "#DC2626",
  negative50: "#FEF2F2",
} as const;

const FONT_SERIF =
  "Charter, Cambria, Georgia, 'Times New Roman', serif";
const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO =
  "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** HTML escape for any value interpolated into the email body. Mirrors the
 *  exported helper in `@/lib/email`; emails cannot import that file
 *  without pulling Resend at module-load, so the function is duplicated
 *  here intentionally and kept identical. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface BaseInputs {
  /** Cron correlation_id, surfaced as the trace id at the email footer. */
  correlationId: string;
  /** "May 2026" — derived from the firing month. */
  monthLabel: string;
}

export interface SuccessEmailInputs extends BaseInputs {
  /** Strategy name from `strategies.name`. Optional — falls back to a
   *  generic "your strategy" when readiness didn't surface it. */
  strategyName?: string | null;
  /** PDF byte size — surfaces in the metadata table for trust ("the
   *  attachment that just landed is N KB"). */
  pdfBytes: number;
}

export interface FailureEmailInputs extends BaseInputs {
  /** Stable failure tag from `ERROR_CLASS` (e.g. `StrategyNotReady`,
   *  `PdfTooSmall`, `AlertTimeout`). */
  errorClass: string;
  /** Human error message — already bounded by `buildBoundedCtx` upstream
   *  so a multi-MB upstream error doesn't bloat the email body. */
  errorMessage: string;
}

/** Render the monthly success email. Brand stripe is `accent` (verified +
 *  delivered as scheduled). */
export function renderSuccessEmailHtml(input: SuccessEmailInputs): string {
  const strategy = input.strategyName?.trim()
    ? esc(input.strategyName)
    : "your strategy";
  const monthLabel = esc(input.monthLabel);
  const correlation = esc(input.correlationId);
  const pdfKb = Math.round(input.pdfBytes / 1024);
  return wrapShell({
    accentColor: TOKENS.accent,
    title: `Founder LP Report — ${monthLabel}`,
    body: `
      <h1 style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:30px;line-height:1.15;letter-spacing:-0.01em;color:${TOKENS.textPrimary};">
        Founder LP Report
      </h1>
      <p style="margin:8px 0 0;font-family:${FONT_SERIF};font-size:18px;line-height:1.3;color:${TOKENS.textSecondary};">
        ${strategy}
      </p>
      <p style="margin:32px 0 0;font-family:${FONT_SANS};font-size:14px;line-height:1.65;color:${TOKENS.textPrimary};">
        The ${monthLabel} factsheet is attached as a PDF. It captures the
        equity curve, key performance indicators, and trade-level analytics
        through the end of the reporting period.
      </p>
      <p style="margin:14px 0 0;font-family:${FONT_SANS};font-size:14px;line-height:1.65;color:${TOKENS.textSecondary};">
        Open it in any PDF reader. The institutional layout is single-column,
        print-ready, and unchanged month-to-month so trends are easy to scan
        side-by-side.
      </p>
    `,
    metadataRows: [
      ["delivered", `scheduled cron · 09:15 UTC`],
      ["attachment", `${pdfKb.toLocaleString()} KB · application/pdf`],
      ["trace id", correlation],
    ],
  });
}

/** Render the failure-alert email. Brand stripe is `negative` (DESIGN.md:
 *  "losses, errors, permanent failures") plus a tinted error block. */
export function renderFailureAlertHtml(input: FailureEmailInputs): string {
  const monthLabel = esc(input.monthLabel);
  const errorClass = esc(input.errorClass);
  const errorMessage = esc(input.errorMessage);
  const correlation = esc(input.correlationId);
  return wrapShell({
    accentColor: TOKENS.negative,
    title: `[ALERT] Founder LP cron FAILED — ${monthLabel}`,
    body: `
      <h1 style="margin:0;font-family:${FONT_SERIF};font-weight:400;font-size:28px;line-height:1.2;letter-spacing:-0.01em;color:${TOKENS.textPrimary};">
        Founder LP cron failed
      </h1>
      <p style="margin:8px 0 0;font-family:${FONT_SERIF};font-size:16px;line-height:1.3;color:${TOKENS.textSecondary};">
        ${monthLabel} delivery did not complete.
      </p>
      <p style="margin:28px 0 0;font-family:${FONT_SANS};font-size:14px;line-height:1.65;color:${TOKENS.textPrimary};">
        The monthly cron raised a fatal error before the factsheet PDF could
        be sent. Both Sentry and this email path were attempted; both
        succeeding means at minimum one signal made it out, but the
        scheduled delivery did not.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border:1px solid ${TOKENS.border};background:${TOKENS.negative50};border-radius:6px;">
        <tr>
          <td style="padding:14px 18px;">
            <div style="font-family:${FONT_SANS};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${TOKENS.textMuted};">
              error class
            </div>
            <div style="margin-top:4px;font-family:${FONT_MONO};font-size:13px;color:${TOKENS.negative};">
              ${errorClass}
            </div>
            <div style="margin-top:14px;font-family:${FONT_SANS};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${TOKENS.textMuted};">
              message
            </div>
            <div style="margin-top:4px;font-family:${FONT_MONO};font-size:13px;line-height:1.55;color:${TOKENS.textPrimary};white-space:pre-wrap;word-break:break-word;">
              ${errorMessage}
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:24px 0 0;font-family:${FONT_SANS};font-size:13px;line-height:1.6;color:${TOKENS.textSecondary};">
        Runbook:
        <a href="https://github.com/AI-Isaiah/Quantalyze" style="color:${TOKENS.accent};text-decoration:none;border-bottom:1px solid ${TOKENS.border};">
          .planning/phase-18/founder-lp-runbook.md
        </a>
      </p>
    `,
    metadataRows: [
      ["scheduled", `cron · 09:15 UTC, 1st of month`],
      ["trace id", correlation],
    ],
  });
}

/** Shared chassis: 560px card, brand strip top, hairline divider, generous
 *  padding, micro-cap brand mark, footer-meta in mono. Both success +
 *  failure share this so a future restyle is one edit. */
function wrapShell(input: {
  accentColor: string;
  title: string;
  body: string;
  metadataRows: ReadonlyArray<readonly [string, string]>;
}): string {
  const metaRows = input.metadataRows
    .map(([label, value]) => {
      return `
        <tr>
          <td style="padding:5px 0;width:120px;vertical-align:top;font-family:${FONT_SANS};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${TOKENS.textMuted};">
            ${esc(label)}
          </td>
          <td style="padding:5px 0;font-family:${FONT_MONO};font-size:12px;color:${TOKENS.textSecondary};word-break:break-all;">
            ${value /* already escaped by callers */}
          </td>
        </tr>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light only" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${esc(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${TOKENS.bgPage};color:${TOKENS.textPrimary};-webkit-font-smoothing:antialiased;font-family:${FONT_SANS};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.bgPage};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${TOKENS.surface};border:1px solid ${TOKENS.border};border-radius:8px;overflow:hidden;">
            <tr>
              <td style="height:3px;background:${input.accentColor};line-height:3px;font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:22px 32px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${TOKENS.textMuted};">
                      QUANTALYZE
                    </td>
                    <td align="right" style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.04em;color:${TOKENS.textMuted};">
                      Founder LP
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <div style="height:1px;background:${TOKENS.border};line-height:1px;font-size:0;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 4px;">
                ${input.body}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 12px;">
                <div style="height:1px;width:48px;background:${TOKENS.border};line-height:1px;font-size:0;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${metaRows}
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;font-family:${FONT_MONO};font-size:11px;letter-spacing:0.06em;color:${TOKENS.textMuted};">
            QUANTALYZE · institutional analytics
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
