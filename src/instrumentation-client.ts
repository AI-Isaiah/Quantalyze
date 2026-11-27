import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

// Phase 221 SENTRYSCRUB2 / SCRB-02: the browser Sentry init (Next's
// `instrumentation-client` convention: no exports required, runs after the HTML
// loads and before hydration). Until now every `captureToSentry` call in browser
// code was a silent no-op ([167.2.1-CLIENT-SENTRY-NOOP]); this makes them report.
// (That TODOS.md entry is closed by this phase and deleted, 2026-11-27; the id
// survives here as lineage only.)
//
// CONTEXT [Client channel shape], option (a), founder-booked ROADMAP goal.
// The option set mirrors `register()` in src/instrumentation.ts and opens no
// channel the server init does not have. The DSN is inlined into the public
// bundle by `next.config.ts` (a DSN authorises sending only); Next inlines
// LITERAL `process.env.X` reads only, so both reads below must stay literal.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // The browser SDK files every event as "production" when this is absent, so
    // a preview deployment would page as production. `next.config.ts` inlines
    // the build's VERCEL_ENV; development is the no-inline fallback.
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    // Phase 209 / CR-01: the SDK default streams spans, and streamed spans never
    // reach `beforeSendTransaction`. Pinned to the static lifecycle so the scrub
    // below still sees every transaction.
    traceLifecycle: "static",
    // Research correction: this SDK has no `sendDefaultPii`. `dataCollection`
    // drops IP inference and every URL query parameter (a PKCE `?code=` included)
    // from request.url, the referrer and breadcrumb URLs, fetch and XHR ones too.
    // URL FRAGMENTS survive this and the scrub; accepted, the app is PKCE-only.
    dataCollection: { userInfo: false, urlQueryParams: false },
    // BrowserTracing adds spans and trace-header injection (@sentry/nextjs always
    // pushes it), BrowserSession sends a session envelope on every page load.
    // Neither is wanted. There is deliberately no trace sample rate or sampler
    // (a value of 0 still switches the span machinery on), no Replay and no
    // tunnel. GlobalHandlers stays on purpose: uncaught browser errors are the
    // point of the channel, and the SCRB-01 arm covers a rejected PostgREST object.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "BrowserTracing" && i.name !== "BrowserSession"),
    // Phase 209 / CR-02: console breadcrumbs would copy seam log lines, which
    // keep `details`/`hint` on purpose, into every browser event.
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
    // The same function as the server, for both hooks (CONTEXT [Code layout]).
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
  });
}
