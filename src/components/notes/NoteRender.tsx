"use client";

/**
 * Phase 08 Plan 03 — shared markdown render helper for all 4 note scopes.
 *
 * Security posture:
 *   - react-markdown ESCAPES raw HTML by default (no rehype-raw added).
 *   - rehype-sanitize is belt-and-suspenders against plugin-synthesized nodes.
 *   - <a> tags are rewritten to carry rel="noopener noreferrer" + target="_blank"
 *     — prevents tabnabbing on external links (T-08-12).
 *   - href is restricted to http/https via sanitize-schema.ts — drops
 *     javascript:, mailto:, irc:, xmpp: (D-13).
 *
 * Styling:
 *   - `.prose-note` CSS lives in globals.css (NOT @tailwindcss/typography —
 *     we do not want that dependency).
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { noteSanitizeSchema } from "./sanitize-schema";

const components = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    // If sanitization dropped the href (e.g. javascript:), render the children
    // as plain text rather than a dead <a>.
    if (!href) return <>{children}</>;
    return (
      <a
        href={href}
        rel="noopener noreferrer"
        target="_blank"
        className="text-accent underline hover:text-accent-hover"
      >
        {children}
      </a>
    );
  },
};

export function NoteRender({ content }: { content: string }) {
  return (
    <div className="prose-note text-sm text-text-primary leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, noteSanitizeSchema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
