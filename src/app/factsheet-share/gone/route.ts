// SECURITY BOUNDARY:
// This handler is the ONLY thing every miss on the `/factsheet-share/[token]`
// lane resolves to — unknown token, malformed token, revoked token, and a DB
// error on the share read all land here. It therefore must be CONTENT-FREE:
// no strategy name, no metrics, no id, no owner identity, nothing that would
// let the holder of a dead link learn anything about what it used to point at.
//
// WHY A ROUTE HANDLER RATHER THAN A PAGE (ruling D-08). App Router pages cannot
// emit HTTP 410 — the only status-setting escape hatches available to a page
// are `notFound()` (404), `forbidden()` (403) and `unauthorized()` (401),
// verified against the bundled Next 16 docs. So the token page `redirect()`s
// here and this handler returns the genuine 410.
//
// ⚠️ The recipient sees ONE EXTRA HOP in the URL bar (`/factsheet-share/gone`).
// That is the accepted cost of an honest status line, not a bug — flagged for
// UAT so a reviewer does not report it as one. The rejected alternative was
// rendering the dead-link page with HTTP 200, i.e. a status line that says
// "fine" about a link that is not.
//
// WHY 410 HERE BUT 404 ON THE BARE-ID LANE. Telling a token holder their token
// is dead leaks nothing — they already held it. Telling an ID holder that an id
// EXISTS is an existence oracle, which is why `/factsheet/[id]` keeps its
// uniform 404 for every miss class and MUST NOT adopt this status.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The entire body. Deliberately short, deliberately specific about the CAUSE
 * (someone turned it off) and the REMEDY (ask them for a new one), and
 * deliberately silent about everything else. Extracted so the test can pin the
 * exact copy rather than a paraphrase of it.
 */
export const GONE_HEADING = "This link is no longer active";
export const GONE_BODY =
  "The person who shared it turned it off. Ask them for a new link.";

const BODY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Link no longer active</title>
</head>
<body>
<main>
<h1>${GONE_HEADING}</h1>
<p>${GONE_BODY}</p>
</main>
</body>
</html>
`;

/**
 * ⚠️ NO LOGGING HERE, ON PURPOSE. This handler takes no input, reads nothing,
 * and cannot fail, so there is no error to track. The DIAGNOSTIC value lives
 * one hop upstream: `/factsheet-share/[token]` logs each miss class (malformed
 * / no match / DB error) server-side with the detail redacted before it
 * redirects here. Logging again at this endpoint would only count scraper hits
 * on a public URL, and the token is not in this URL to log anyway.
 */
export async function GET(): Promise<Response> {
  return new Response(BODY_HTML, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A shared cache is keyed on the URL, not on any token's revocation
      // state. This response must never be stored and replayed — and equally,
      // a previously-cached 200 for a token URL must never be what a recipient
      // sees after revocation (the token page carries the same discipline).
      "Cache-Control": "no-store, no-cache, must-revalidate",
      // Belt-and-braces with the <meta> above: a crawler that ignores the meta
      // still sees the header, and a 410 body is exactly what should never be
      // indexed under a share URL.
      "X-Robots-Tag": "noindex, nofollow",
      // The token arrived as a PATH segment, so `Referrer-Policy` on the origin
      // does not strip it. Suppress the referrer entirely on this hop so the
      // dead-link page cannot forward the token anywhere.
      "Referrer-Policy": "no-referrer",
    },
  });
}
