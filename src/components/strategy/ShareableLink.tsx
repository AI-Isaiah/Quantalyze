"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Phase 164 (SHARE-04) — THE ONE SHARE PREDICATE, and its two consequences.
 *
 * The defect this closes: three surfaces hand out a "share" URL and each one
 * decided for itself what that URL should be. `ShareLinkButton` on the factsheet
 * built `<origin><pathname>?share=1` UNCONDITIONALLY, so an owner viewing an
 * unpublished strategy copied a link that 404s for its recipient. The strategies
 * page hid the control entirely for unpublished rows. Discovery detail had a
 * third opinion. Point-fixing any one of them leaves the class alive, so the
 * decision itself lives here, once, and all three call it.
 *
 * TWO MECHANISMS IS THE INTENDED END STATE, not a smell to collapse (ruling
 * D-09). They differ because their SUBJECTS differ:
 *
 *   published   → the public id URL. The id is already public, so a revocable
 *                 capability token would be revocation theatre over public data.
 *   unpublished → `/factsheet-share/<token>`. The id must stay a non-secret and
 *                 the payload is private, so access needs a revocable capability.
 *
 * ⛔ Do NOT "simplify" this by minting for both. That would replace a working,
 * byte-stable public URL with a capability whose revocation promises nothing,
 * and D-09 exists precisely because an earlier draft of the phase context said
 * the opposite of the ruling.
 */
export type ShareAffordanceMode = "public-url" | "mint-token";

/**
 * The predicate. Deliberately a named function rather than an inline
 * `published ? … : …` at three call sites: a grep for this identifier is the
 * drift check, and a fourth surface that wants a share control has exactly one
 * obvious thing to call.
 */
export function shareAffordanceMode(published: boolean): ShareAffordanceMode {
  return published ? "public-url" : "mint-token";
}

/** `status` values are `text` in the DB; anything that is not the published
 *  literal is treated as unpublished (fail-CLOSED — an unrecognised status must
 *  not be handed a public URL that may 404). */
export function isPublishedStatus(status: string | null | undefined): boolean {
  return status === "published";
}

/**
 * Mint-or-REUSE the private share URL for a strategy (plan 164-03's route).
 *
 * The route is idempotent by construction — the token re-derives from the stored
 * (nonce, generation) pair, so two mints in two sessions return the SAME url
 * until a revoke. That is why no caller caches the url: re-minting on every click
 * is correct AND cheap, unlike the scenario-share precedent
 * (`SavedScenariosList`), whose storage makes the raw token unrecoverable and
 * which therefore has to keep a session cache.
 *
 * ⛔ THROWS on every non-happy path — non-2xx, unparseable body, missing or
 * empty `url`. That is the whole point: the callers' failure arms must be
 * reachable from a mint failure exactly as they are from a clipboard failure,
 * because both mean the same thing to the user — no working link reached your
 * clipboard. A resolver that returned `undefined` here would let a caller
 * "succeed" with an empty string and flash "Link copied!" for nothing (T-164-15).
 */
export async function mintShareUrl(strategyId: string): Promise<string> {
  const res = await fetch(`/api/strategies/${strategyId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`share mint failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  const url = body?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("share mint returned no url");
  }
  return url;
}

/**
 * ⛔ THERE IS DELIBERATELY NO `resolveShareUrl(published, …)` HELPER.
 *
 * An async "give me the URL for either lane" wrapper is the obvious shape and it
 * is the wrong one: it forces an `await` onto the PUBLISHED path, where the URL
 * is already known synchronously. That await inserts a microtask between the
 * click and `navigator.clipboard.writeText`, and Safari has historically dropped
 * transient user activation across exactly that boundary — so the tidier
 * abstraction would trade a working copy button for a symmetrical call site.
 *
 * Both consumers therefore branch on `shareAffordanceMode` themselves and share
 * `mintShareUrl` for the half that genuinely is asynchronous. That is the whole
 * of the duplication, and it is two lines at each site.
 */

interface ShareableLinkProps {
  strategyId: string;
  /**
   * Phase 164 (SHARE-04) — REQUIRED, and required on purpose.
   *
   * Before this phase the component had no idea whether the strategy it was
   * sharing was published, so `/strategies` hid the control entirely for
   * unpublished rows (an owner with a private strategy simply had no way to show
   * it to anyone) while the factsheet's sibling control handed out a URL that
   * 404s. Making the caller state the fact is what closes the class: a new
   * surface cannot mount this component while leaving the question unanswered.
   */
  published: boolean;
  variant?: "primary" | "secondary";
}

export function ShareableLink({ strategyId, published, variant = "secondary" }: ShareableLinkProps) {
  const [copied, setCopied] = useState(false);

  const [copyFailed, setCopyFailed] = useState(false);
  // Phase 164 (SHARE-04) — a mint failure gets its OWN state rather than reusing
  // `copyFailed`, because the two need different advice. "Copy the URL manually"
  // is actionable when a URL exists and the clipboard refused it; it is useless
  // when no URL was ever produced.
  const [mintFailed, setMintFailed] = useState(false);
  const [minting, setMinting] = useState(false);

  const handleCopy = useCallback(async () => {
    setMintFailed(false);
    let url: string;
    if (shareAffordanceMode(published) === "public-url") {
      // Synchronous — see the note above `ShareableLinkProps` on why this arm
      // must not be routed through an async resolver. Byte-identical to the
      // pre-phase-164 URL.
      url = `${window.location.origin}/factsheet/${strategyId}`;
    } else {
      setMinting(true);
      try {
        url = await mintShareUrl(strategyId);
      } catch {
        // The honest-failure discipline this component already models for the
        // clipboard (audit-#43), extended to cover the mint identically: a
        // failure here must never reach the success badge.
        setCopied(false);
        setMintFailed(true);
        setMinting(false);
        setTimeout(() => setMintFailed(false), 4000);
        return;
      }
      setMinting(false);
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
      return;
    } catch {
      // Fall through to the legacy execCommand path.
    }
    let fallbackSucceeded = false;
    const input = document.createElement("input");
    try {
      input.value = url;
      document.body.appendChild(input);
      input.select();
      fallbackSucceeded = document.execCommand("copy");
    } catch {
      fallbackSucceeded = false;
    } finally {
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    if (fallbackSucceeded) {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Audit-2026-05-07 #43: previously the success badge fired even when
      // both clipboard paths failed silently. Surface the failure so the
      // user can copy the URL manually.
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  }, [strategyId, published]);

  return (
    <Button
      variant={variant === "primary" ? "primary" : "secondary"}
      onClick={handleCopy}
      disabled={minting}
    >
      {copied ? (
        <>
          <svg className="h-4 w-4 mr-1.5 text-positive" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd" />
          </svg>
          Link copied!
        </>
      ) : copyFailed ? (
        <>
          <svg className="h-4 w-4 mr-1.5 text-negative" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-10a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5zm0 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
          Copy failed — copy the URL manually
        </>
      ) : mintFailed ? (
        <>
          <svg className="h-4 w-4 mr-1.5 text-negative" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-10a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5zm0 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
          Couldn&apos;t create the link — try again
        </>
      ) : minting ? (
        <>
          <svg className="h-4 w-4 mr-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3M8.25 4.75L9.5 3.5a2.12 2.12 0 013 3L11.25 7.75M7.75 11.25L6.5 12.5a2.12 2.12 0 01-3-3l1.25-1.25" />
          </svg>
          Creating link…
        </>
      ) : (
        <>
          <svg className="h-4 w-4 mr-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3M8.25 4.75L9.5 3.5a2.12 2.12 0 013 3L11.25 7.75M7.75 11.25L6.5 12.5a2.12 2.12 0 01-3-3l1.25-1.25" />
          </svg>
          {/* An unpublished strategy has no public factsheet to "share", so the
              published label would be a false description of what the click
              does. "Get private link" is true whether the route mints a new
              capability or reuses the live one. */}
          {published ? "Share Factsheet" : "Get private link"}
        </>
      )}
    </Button>
  );
}
