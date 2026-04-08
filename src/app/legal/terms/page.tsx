const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

export const metadata = {
  title: `Terms of Service — ${PLATFORM_NAME}`,
};

/**
 * Templated baseline terms of service. Sprint 7 T19.2 lawyer review gates
 * the final version.
 */
export default function TermsOfServicePage() {
  return (
    <>
      <h1 className="text-3xl font-display text-text-primary">Terms of Service</h1>
      <p className="text-xs text-text-muted">Last updated: 2026-04-07</p>

      <h2>1. Acceptance</h2>
      <p>
        By accessing {PLATFORM_NAME}, you agree to these Terms of Service. If
        you do not agree, do not use the platform.
      </p>

      <h2>2. Nature of the service</h2>
      <p>
        {PLATFORM_NAME} is an analytics and introduction platform. We do{" "}
        <strong>not</strong> hold client assets, operate a pooled fund, provide
        investment advice, or act as a broker-dealer. All strategies are
        monitored via read-only exchange APIs and the underlying assets remain
        under the manager&apos;s custody at their exchange of choice.
      </p>

      <h2>3. Eligibility</h2>
      <p>
        The authenticated portions of the platform are reserved for accredited
        or qualified investors (or equivalent under your jurisdiction). You
        self-attest to this status at sign-up and on entering the discovery
        section. {PLATFORM_NAME} reserves the right to request additional
        verification at any time.
      </p>

      <h2>4. No investment advice</h2>
      <p>
        Nothing on {PLATFORM_NAME} — including analytics, rankings, factsheets,
        tear sheets, or introduction requests — constitutes investment,
        financial, legal, or tax advice. Past performance is not indicative of
        future results. You are solely responsible for your own investment
        decisions.
      </p>

      <h2>5. Strategy manager obligations</h2>
      <p>
        Managers who publish strategies warrant that (a) the API keys they
        provide are legitimately authorized, (b) their disclosed performance
        reflects real trading, and (c) they will respond to good-faith
        introduction requests in a timely manner. {PLATFORM_NAME} may suspend
        strategies or accounts found to be in breach.
      </p>

      <h2>6. Prohibited conduct</h2>
      <ul>
        <li>Scraping or automated data extraction without written consent.</li>
        <li>
          Attempts to circumvent the platform&apos;s introduction flow (i.e.
          contacting managers or allocators outside the platform after meeting
          them through it).
        </li>
        <li>
          Publishing fabricated performance data or impersonating another
          manager.
        </li>
      </ul>

      <h2>7. Fees</h2>
      <p>
        The platform is currently free for allocators. Managers may be subject
        to a success fee on matched allocations; the fee structure is disclosed
        in individual manager agreements.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may terminate your account at any time by requesting deletion in
        your profile. {PLATFORM_NAME} may suspend or terminate accounts that
        breach these terms with reasonable notice except in cases of clear
        fraud.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {PLATFORM_NAME} shall not be
        liable for any indirect, incidental, consequential, or special damages
        arising out of or in connection with your use of the platform or any
        investment decision you make based on information obtained from it.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of the jurisdiction where{" "}
        {PLATFORM_NAME} is incorporated. Disputes shall be resolved in the
        competent courts of that jurisdiction.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these terms from time to time. Material changes will be
        communicated via email or an in-product notice.
      </p>
    </>
  );
}
