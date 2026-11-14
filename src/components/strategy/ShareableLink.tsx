"use client";

import { useState, useCallback, useEffect, useId, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { LiveRegion } from "@/components/ui/LiveRegion";

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
// ⛔ DECLARED IN `@/lib/share-affordance`, NOT HERE — that module carries no
// `"use client"` directive. This file does, and a Server Component may not CALL
// an export of a client module (only render it, or pass it as a prop). The
// strategies page is a server component and calls `isPublishedStatus`, which
// threw on every request until the declarations moved. Re-exported so the
// existing consumers of this path keep working and there is still ONE
// declaration to grep for.
export {
  shareAffordanceMode,
  isPublishedStatus,
  type ShareAffordanceMode,
} from "@/lib/share-affordance";
import { shareAffordanceMode } from "@/lib/share-affordance";

// Phase 164.6.6.3.1 D-05 — the share panel the "Manage private link" Modal
// holds. ⛔ A STATIC import would be a cycle (`FactsheetView.tsx` already
// imports from this file) and would pull the whole factsheet module into
// /strategies and the discovery detail page, so it loads lazily, on the first
// open only. The `{ default }` wrapper is the repo idiom for a named export. The `loading` block is aria-hidden, fixed height, no copy and
// no spinner (DESIGN.md Motion), so the Modal does not jump when the chunk
// arrives.
const OwnerUnpublishedPanel = dynamic(
  () =>
    import("@/app/factsheet/[id]/v2/FactsheetView").then((m) => ({
      default: m.OwnerUnpublishedPanel,
    })),
  {
    ssr: false,
    loading: () => <div className="h-24" aria-hidden="true" />,
  },
);

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
 *
 * Phase 208 (D-06, D-13) — every throw is a `ShareMintError`, so the UI can map
 * the status to an honest label. A signed-out POST never reaches the route's 401:
 * `src/proxy.ts` answers it with a 307 to `/login`, which `fetch` follows to an
 * HTML 200. The redirect is therefore the real signed-out signal and is mapped to
 * 401 here, before the `res.ok` check would read the HTML as a success.
 */
export class ShareMintError extends Error {
  /** What the UI maps to a label; `null` when no HTTP status applies. */
  readonly status: number | null;

  /**
   * The message carries the status only, never the URL or a token: the minted
   * URL is a capability and this error is logged.
   */
  constructor(status: number | null, message: string) {
    super(message);
    this.name = "ShareMintError";
    this.status = status;
  }
}

export async function mintShareUrl(strategyId: string): Promise<string> {
  const res = await fetch(`/api/strategies/${strategyId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  // A missing `redirected` or `url` (a bare mock, an older runtime) reads as
  // "not redirected". The base argument makes an empty `res.url` parse to the
  // origin root instead of throwing.
  if (
    res.redirected === true &&
    new URL(res.url, window.location.origin).pathname === "/login"
  ) {
    throw new ShareMintError(401, "share mint redirected to login");
  }
  if (!res.ok) {
    throw new ShareMintError(res.status, `share mint failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  const url = body?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new ShareMintError(null, "share mint returned no url");
  }
  return url;
}

type MintFailure = "signed-out" | "forbidden" | "other";

const MINT_FAILURE_LABEL: Record<MintFailure, string> = {
  "signed-out": "Signed out — sign in again to share",
  forbidden: "You can't share this strategy here",
  other: "Couldn't create the link — try again",
};

const COPY_FAILED_LABEL = "Copy failed — copy the URL manually";

/**
 * 403 (same-origin refusal) and 404 (lost ownership; the route hides row
 * existence) share one non-revealing string, so the client never distinguishes
 * "not yours" from "unknown id" (T-164-03). Everything else, including a
 * non-`ShareMintError`, keeps the retryable wording.
 */
function mintFailureKind(err: unknown): MintFailure {
  if (!(err instanceof ShareMintError)) return "other";
  if (err.status === 401) return "signed-out";
  if (err.status === 403 || err.status === 404) return "forbidden";
  return "other";
}

/**
 * Phase 170.6.1 plan 06 round 2 — how long the async clipboard API gets before
 * this component stops waiting for it.
 *
 * `navigator.clipboard.writeText` can stay pending forever (a permission prompt
 * nobody answers, a focus-gated browser). Awaited bare, that left the UI
 * exactly as silent as a click that did nothing, with a live private link
 * already minted. A timeout is treated as a rejection: the synchronous
 * `execCommand` fallback gets its turn, and if that fails too the URL is shown.
 * Three seconds is long enough for a prompt to be read and short enough that
 * the user is not left wondering whether the click registered.
 */
const CLIPBOARD_WAIT_MS = 3000;

async function writeClipboardBounded(text: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("clipboard write timed out")),
        CLIPBOARD_WAIT_MS,
      );
    });
    // `navigator.clipboard` may be absent: the TypeError is thrown inside this
    // async function, so the caller sees a rejection like any other refusal.
    await Promise.race([navigator.clipboard.writeText(text), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Phase 208 (D-08, D-15, D-05) — the ONE copy path for the row, the copy-failed
 * dialog and the factsheet's `ShareLinkButton`. The logic is not copied: each
 * caller passes the URL and learns only whether it landed on the clipboard.
 *
 * The async clipboard API gets 3 s (`CLIPBOARD_WAIT_MS`), then the synchronous
 * `execCommand` fallback gets its turn. A hanging, refused or absent clipboard
 * therefore always ends in `false`, never in a promise nobody settles.
 *
 * It logs `{ strategyId, err }` and NEVER `text`: the text can be a capability
 * URL, and `console.warn` feeds Sentry breadcrumbs. A refused `execCommand`
 * returns `false` without throwing, so it is not a catch; it is logged anyway,
 * with `err: null`, because a silent refusal is exactly the failure support
 * could not see.
 *
 * `host` overrides where the fallback's temporary input lives. By default it is
 * the open `<dialog>` when there is one, else `document.body`.
 */
export async function copyTextBounded(
  text: string,
  ctx: { strategyId: string; host?: HTMLElement | null },
): Promise<boolean> {
  try {
    await writeClipboardBounded(text);
    return true;
  } catch (err) {
    console.warn("[ShareableLink] clipboard write failed", {
      strategyId: ctx.strategyId,
      err,
    });
  }
  let fallbackSucceeded = false;
  let fallbackError: unknown = null;
  const input = document.createElement("input");
  try {
    input.value = text;
    // While `showModal()` is open the rest of the page is inert, and in WebKit
    // an `execCommand("copy")` input appended to the inert body returns false
    // (RESEARCH Pitfall 2, measured); appended inside the dialog it returns
    // true. Resolving the open dialog here makes every caller correct, including
    // `FactsheetView`'s `mintAndCopy`, which renders inside the open Private
    // link Modal. `host` stays an explicit override.
    const host: HTMLElement =
      ctx.host ??
      document.querySelector<HTMLElement>("dialog[open]") ??
      document.body;
    host.appendChild(input);
    input.select();
    fallbackSucceeded = document.execCommand("copy");
  } catch (err) {
    fallbackSucceeded = false;
    fallbackError = err;
  } finally {
    if (input.parentNode) input.parentNode.removeChild(input);
  }
  if (!fallbackSucceeded) {
    console.warn("[ShareableLink] execCommand copy failed", {
      strategyId: ctx.strategyId,
      err: fallbackError,
    });
  }
  return fallbackSucceeded;
}

type DialogCopyPhase = "idle" | "working" | "copied" | "failed";

const DIALOG_COPY_LABEL: Record<DialogCopyPhase, string> = {
  idle: "Copy link",
  working: "Copying link…",
  copied: "Copied",
  failed: "Copy failed",
};

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
  /**
   * Phase 164.6.6.3.1 D-05 — the server-CONFIRMED fact that this unpublished
   * strategy has a live (non-revoked) private link. Absent means unknown, which
   * is today's behaviour: the row reads "Get private link". Ignored for a
   * published strategy, whose link is the public URL and cannot be revoked.
   */
  hasActiveShare?: boolean;
  variant?: "primary" | "secondary";
  /** Default `md` keeps the discovery detail page byte-identical. `/strategies` passes `sm`. */
  size?: "sm" | "md";
}

export function ShareableLink({
  strategyId,
  published,
  hasActiveShare,
  variant = "secondary",
  size = "md",
}: ShareableLinkProps) {
  const [copied, setCopied] = useState(false);
  // Phase 164.6.6.3.1 D-05 — seeded ONCE from `hasActiveShare` by the `useState`
  // initialiser: later prop changes are NOT re-read, so after mount the row's
  // own mint and revoke results are the source of truth, and a server re-render
  // that remounts the row re-seeds it. Absent reads as NOT live (D-06's
  // fail-closed value), never as live.
  const [shareLive, setShareLive] = useState(hasActiveShare === true);
  // The Modal mounts on the first Manage click and then STAYS mounted, so every
  // close path (Close button, Esc, a successful revoke) goes through Modal's
  // `open={false}` effect, which calls the native `dialog.close()`; the browser
  // then returns focus to the row button. Unmounting an open dialog would skip
  // that and drop focus to the body.
  const [modalMounted, setModalMounted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // The URL the copy-failed dialog shows, held ONLY when the copy did not land,
  // so "copy the URL manually" always points at something on screen. On the
  // published lane it holds the public URL (that lane has no revoke); on the
  // private lane it holds the minted URL, cleared when the link is revoked: the
  // URL is dead then, and a later clean mint must not resurrect it.
  const [dialogUrl, setDialogUrl] = useState<string | null>(null);
  const [dialogCopy, setDialogCopy] = useState<DialogCopyPhase>("idle");
  const urlFieldRef = useRef<HTMLInputElement>(null);
  const helperId = useId();
  // Phase 208 (D-09) — focus() and select() alone are ignored by iOS outside a
  // gesture, so the whole range is also set explicitly.
  const selectUrlField = useCallback(() => {
    const field = urlFieldRef.current;
    if (!field) return;
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
  }, []);
  // Modal's `open` effect (showModal) runs before this one in the same commit,
  // because a child's effects run first; showModal moves focus to the Close
  // button, so the field takes focus and selects the URL AFTER it, ready for one
  // Ctrl/Cmd-C.
  useEffect(() => {
    if (panelOpen && dialogUrl) selectUrlField();
  }, [panelOpen, dialogUrl, selectUrlField]);
  const managing = !published && shareLive;

  const [copyFailed, setCopyFailed] = useState(false);
  // Phase 164 (SHARE-04) — a mint failure gets its OWN state rather than reusing
  // `copyFailed`, because the two need different advice. "Copy the URL manually"
  // is actionable when a URL exists and the clipboard refused it; it is useless
  // when no URL was ever produced.
  const [mintFailure, setMintFailure] = useState<MintFailure | null>(null);
  const [minting, setMinting] = useState(false);

  const handleCopy = useCallback(async () => {
    setMintFailure(null);
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
      } catch (err) {
        // Phase 208 (D-05) — log first: this catch decides the UI, so it is
        // where support must be able to see the failure. The error message
        // carries a status only, never the URL or a token.
        console.warn("[ShareableLink] share mint failed", { strategyId, err });
        // The honest-failure discipline this component already models for the
        // clipboard (audit-#43), extended to cover the mint identically: a
        // failure here must never reach the success badge.
        setCopied(false);
        setMintFailure(mintFailureKind(err));
        setMinting(false);
        setTimeout(() => setMintFailure(null), 4000);
        return;
      }
      // Phase 164.6.6.3.1 D-05/D-06 (orchestrator decision 2) — the mint itself
      // CONFIRMED a live link, so the row reads "Manage private link" once the
      // copy feedback clears, never "Get private link" over a live link. Set
      // AFTER the mint resolved (a failed mint returns above and never claims a
      // live link) and BEFORE the clipboard write: a clipboard failure after a
      // mint still leaves the link live.
      setShareLive(true);
      setMinting(false);
    }
    // The first awaited expression after the published lane built `url`
    // synchronously, so that lane still reaches `writeText` inside the click.
    const ok = await copyTextBounded(url, { strategyId });
    if (ok) {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Audit-2026-05-07 #43: previously the success badge fired even when
      // both clipboard paths failed silently. Surface the failure so the
      // user can copy the URL manually.
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
      // Phase 170.6.1 plan 06 round 2 — "copy the URL manually" needs a URL on
      // screen. Open the dialog with it on BOTH lanes (Phase 208 D-10): the
      // minted private URL, or the public URL a published strategy copies.
      setDialogUrl(url);
      setModalMounted(true);
      setPanelOpen(true);
    }
  }, [strategyId, published]);

  // Phase 208 (D-08) — the dialog's own Copy link. The URL is already on screen,
  // so there is no mint and no `fetch`: `copyTextBounded` is the first awaited
  // expression, and the tap's user activation is still live when it runs.
  const copyFromField = useCallback(async () => {
    if (!dialogUrl) return;
    setDialogCopy("working");
    const ok = await copyTextBounded(dialogUrl, { strategyId });
    if (ok) {
      setDialogCopy("copied");
      setTimeout(() => setDialogCopy("idle"), 2000);
    } else {
      setDialogCopy("failed");
      selectUrlField();
      setTimeout(() => setDialogCopy("idle"), 4000);
    }
  }, [dialogUrl, strategyId, selectUrlField]);

  // sm matches StrategyActions in the same row. sm has no min-height, so a
  // coarse pointer still gets 44px. md omits the extra class so its output
  // stays byte-identical.
  const iconClass = size === "sm" ? "h-3.5 w-3.5 mr-1.5" : "h-4 w-4 mr-1.5";

  // The same sentence the row button shows while a failure label is up (mirrors
  // the render ternary), announced politely. Success is not announced.
  const rowFailureText = copied
    ? null
    : copyFailed
      ? COPY_FAILED_LABEL
      : mintFailure
        ? MINT_FAILURE_LABEL[mintFailure]
        : null;

  return (
    <>
    <Button
      variant={variant === "primary" ? "primary" : "secondary"}
      size={size}
      className={size === "sm" ? "pointer-coarse:min-h-[44px]" : undefined}
      onClick={
        managing
          ? () => {
              setModalMounted(true);
              setPanelOpen(true);
            }
          : handleCopy
      }
      disabled={minting}
      aria-haspopup={managing ? "dialog" : undefined}
    >
      {copied ? (
        <>
          <svg className={`${iconClass} text-positive`} viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd" />
          </svg>
          Link copied!
        </>
      ) : copyFailed ? (
        <>
          <svg className={`${iconClass} text-negative`} viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-10a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5zm0 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
          {COPY_FAILED_LABEL}
        </>
      ) : mintFailure ? (
        <>
          <svg className={`${iconClass} text-negative`} viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-10a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5zm0 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
          {MINT_FAILURE_LABEL[mintFailure]}
        </>
      ) : minting ? (
        <>
          <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3M8.25 4.75L9.5 3.5a2.12 2.12 0 013 3L11.25 7.75M7.75 11.25L6.5 12.5a2.12 2.12 0 01-3-3l1.25-1.25" />
          </svg>
          Creating link…
        </>
      ) : (
        <>
          <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 9.5l3-3M8.25 4.75L9.5 3.5a2.12 2.12 0 013 3L11.25 7.75M7.75 11.25L6.5 12.5a2.12 2.12 0 01-3-3l1.25-1.25" />
          </svg>
          {/* An unpublished strategy has no public factsheet to "share", so the
              published label would be a false description of what the click
              does. "Get private link" is true whether the route mints a new
              capability or reuses the live one. */}
          {published
            ? "Share Factsheet"
            : managing
              ? "Manage private link"
              : "Get private link"}
        </>
      )}
    </Button>
    {/* Outside the Modal: showModal() makes everything outside the dialog
        inert, so the row's region stays a separate sibling. */}
    <LiveRegion message={rowFailureText} />
    {modalMounted && (
      <Modal
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={published ? "Public link" : "Private link"}
      >
        {panelOpen && dialogUrl && (
          <div className="mb-4 flex flex-col gap-2">
            <p id={helperId} className="text-caption text-text-muted">
              {published
                ? "This browser would not copy the link for you. Use Copy link, or select the link and copy it yourself."
                : "Your private link is live, but this browser would not copy it for you. Use Copy link, or select the link and copy it yourself."}
            </p>
            <div className="flex items-end gap-2">
              <Input
                ref={urlFieldRef}
                label={published ? "Public link URL" : "Private link URL"}
                readOnly
                value={dialogUrl}
                aria-describedby={helperId}
                wrapperClassName="min-w-0 flex-1"
                onFocus={(e) => {
                  e.currentTarget.select();
                  e.currentTarget.setSelectionRange(
                    0,
                    e.currentTarget.value.length,
                  );
                }}
                className="font-mono text-caption"
              />
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={dialogCopy === "working"}
                onClick={copyFromField}
              >
                {DIALOG_COPY_LABEL[dialogCopy]}
              </Button>
            </div>
            <LiveRegion
              message={dialogCopy === "failed" ? "Copy failed" : null}
            />
          </div>
        )}
        {panelOpen && !published && (
          <OwnerUnpublishedPanel
            strategyId={strategyId}
            hasActiveShare={shareLive}
            // Decision 1 (RESEARCH Q2): a live-to-not-live transition only
            // arrives after a successful revoke (2xx, or 404 as convergence),
            // so the Modal closes and the row flips; a failed revoke never
            // calls this, so the Modal stays open with its alert.
            // ShareRevokeControl clears its own confirm state before calling
            // back, so closing in the same tick sets no state after unmount.
            onShareLiveChange={(live) => {
              setShareLive(live);
              if (!live) {
                setPanelOpen(false);
                setDialogUrl(null);
              }
            }}
          />
        )}
      </Modal>
    )}
    </>
  );
}
