const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

export const metadata = {
  title: `Risk Disclaimer — ${PLATFORM_NAME}`,
};

/**
 * Long-form risk disclaimer. Referenced from the in-flow AccreditedInvestorGate
 * and from the footer on every page. Sprint 7 lawyer review will tighten the
 * jurisdictional language.
 */
export default function RiskDisclaimerPage() {
  return (
    <>
      <h1 className="text-3xl font-display text-text-primary">Risk Disclaimer</h1>
      <p className="text-xs text-text-muted">Last updated: 2026-04-07</p>

      <h2>Past performance is not indicative of future results</h2>
      <p>
        All strategies shown on {PLATFORM_NAME} include historical performance
        data computed from exchange APIs. Past performance is not a reliable
        indicator of future results. Market conditions change. Strategies that
        worked in one regime may underperform or lose capital in another.
      </p>

      <h2>Cryptocurrency-specific risks</h2>
      <ul>
        <li>
          <strong>Volatility.</strong> Cryptocurrency markets can experience
          drawdowns of 30% or more in a single day.
        </li>
        <li>
          <strong>Liquidity.</strong> Markets for smaller tokens may be thin;
          strategies that work at small size may be impossible to execute at
          larger size.
        </li>
        <li>
          <strong>Exchange counterparty risk.</strong> Assets remain in the
          custody of the manager&apos;s exchange of choice. An exchange failure
          or insolvency could result in total loss of assets irrespective of
          strategy performance.
        </li>
        <li>
          <strong>Regulatory risk.</strong> Cryptocurrency regulation is still
          evolving globally. Changes in regulation could restrict or prohibit
          certain strategies at any time.
        </li>
        <li>
          <strong>Technology risk.</strong> Exchange API outages, smart
          contract bugs, and custody software failures can cause losses
          independent of trading strategy performance.
        </li>
      </ul>

      <h2>Custody and platform scope</h2>
      <p>
        {PLATFORM_NAME} does <strong>not</strong> hold client assets. Strategy
        performance is monitored via <strong>read-only</strong> exchange APIs.
        Managers retain full custody of their assets and are solely responsible
        for their operational security. {PLATFORM_NAME} does <strong>not</strong>
        operate a fund, act as a broker-dealer, or execute trades on your
        behalf.
      </p>

      <h2>No investment advice</h2>
      <p>
        Information on this platform is provided for informational purposes
        only. It does not constitute investment, legal, tax, or accounting
        advice. You should consult your own professional advisors before making
        any investment decision.
      </p>

      <h2>Accredited investor requirement</h2>
      <p>
        Use of the authenticated portions of the platform requires you to
        self-attest to being an accredited or qualified investor. You are
        responsible for determining your eligibility under the laws of your
        jurisdiction.
      </p>

      <h2>You could lose everything</h2>
      <p>
        Never invest money you cannot afford to lose. Only invest amounts
        consistent with your personal risk tolerance and investment horizon.
      </p>
    </>
  );
}
