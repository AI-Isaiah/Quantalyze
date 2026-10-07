import Link from "next/link";
import { CONTACT_FORM_LINK_TEXT } from "@/lib/contact";

/**
 * Phase 164.6.6.3.5 DOMAINONE (AD-05) — the one renderer behind every contact
 * pointer. A pointer is a sentence that contains the exact phrase `contact form`;
 * this component links the FIRST occurrence of that phrase to `href` and leaves
 * every other character alone. A string without the phrase is returned as is, so
 * a copy constant that has not been rewritten yet renders exactly as it did.
 *
 * `text` is plain text and is rendered as React text nodes plus one `Link`, never
 * as markup (T-164.6.6.3.5-19): envelope `cause` / `debug_context` come from the
 * server. `href` is built by the caller with `contactHref`, the one encoder.
 *
 * `newTab` is for surfaces that sit over unsaved state (the error envelope, the
 * wizard; AD-04): the `rel` pair (noopener, noreferrer) is the reverse-tabnabbing
 * mitigation (T-164.6.6.3.5-20), and the visually hidden suffix makes the
 * accessible name `contact form (opens in a new tab)`.
 */
export function ContactPointerText({
  text,
  href,
  newTab = false,
}: {
  text: string;
  href: string;
  newTab?: boolean;
}) {
  const at = text.indexOf(CONTACT_FORM_LINK_TEXT);
  if (at === -1) return <>{text}</>;

  const before = text.slice(0, at);
  const after = text.slice(at + CONTACT_FORM_LINK_TEXT.length);

  return (
    <>
      {before}
      <Link
        href={href}
        className="text-accent underline underline-offset-4"
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {CONTACT_FORM_LINK_TEXT}
        {newTab && <span className="sr-only"> (opens in a new tab)</span>}
      </Link>
      {after}
    </>
  );
}
