const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

export const metadata = {
  title: `Privacy Policy — ${PLATFORM_NAME}`,
};

/**
 * Templated baseline privacy policy. Sprint 7 T19.2 has a fintech-lawyer
 * review slot scheduled before the live cap-intro partner demo — that review
 * replaces or amends this copy. Until then the language is intentionally
 * conservative (Termly/iubenda baseline).
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <h1 className="font-display text-3xl text-text-primary md:text-[32px]">Privacy Policy</h1>
      <p className="text-xs text-text-muted">Last updated: 2026-04-07</p>

      <h2>Who we are</h2>
      <p>
        {PLATFORM_NAME} operates a platform that connects institutional
        allocators with asset managers who publish exchange-verified trading
        strategies. For the purposes of this Privacy Policy, the data controller
        is {PLATFORM_NAME} Ltd.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — name, email, role (allocator, manager,
          or both), and optional profile fields you choose to share (company,
          bio, LinkedIn, mandate archetype).
        </li>
        <li>
          <strong>Exchange API data</strong> — read-only API keys you provide
          for strategy verification. Keys are encrypted at rest and never used
          to place orders. We store the resulting analytics, not the raw keys
          in plaintext.
        </li>
        <li>
          <strong>Usage data</strong> — pages visited, analytics computations
          requested, and introduction requests initiated. Used for aggregate
          product analytics and fraud prevention.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your data to: (a) provide the platform and the analytics you
        request; (b) facilitate introductions between allocators and managers;
        (c) detect and prevent abuse; (d) communicate product updates (you can
        opt out at any time). We do <strong>not</strong> sell your data and we
        do <strong>not</strong> share introduction-request content with any
        third party other than the manager you explicitly reached out to.
      </p>

      <h2>Legal basis</h2>
      <p>
        Our lawful basis for processing under GDPR is (a) contract performance
        when you sign up and use the platform, (b) legitimate interests for
        product analytics and fraud prevention, and (c) your explicit consent
        for optional communications.
      </p>

      <h2>Data retention</h2>
      <p>
        We retain account data for as long as your account is active. If you
        request deletion (see below), we complete it within 30 days except for
        records we are legally required to retain (e.g. transaction history for
        regulatory audits).
      </p>

      <h2>Your rights</h2>
      <p>
        Under GDPR Article 17 you may request deletion of your personal data at
        any time. Use the <em>Request account deletion</em> button in your
        profile, or email{" "}
        <a href="mailto:privacy@quantalyze.com">privacy@quantalyze.com</a>. We
        acknowledge requests within 72 hours and complete them within 30 days.
      </p>

      <h2>International transfers</h2>
      <p>
        Data may be processed in the United States and the European Union.
        Where transfers happen between jurisdictions, we rely on Standard
        Contractual Clauses approved by the European Commission.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Reach us at{" "}
        <a href="mailto:privacy@quantalyze.com">privacy@quantalyze.com</a>.
      </p>
    </>
  );
}
