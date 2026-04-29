/**
 * rehype-sanitize schema for NoteRender.
 *
 * Starts from hast-util-sanitize's defaultSchema (the "GitHub-style" allowlist
 * battle-tested in production) and applies two deltas:
 *   1. Strip <img>, <input>, <details>, <summary>, <picture>, <source> — notes
 *      are plain text with minimal formatting; media and form controls are
 *      out of scope.
 *   2. Restrict <a href> to http/https only — drops mailto:, javascript:,
 *      irc:, xmpp:.
 *
 * This schema MUST be module-scope (not re-created inline per render) —
 * inline schema re-creation causes ReactMarkdown subtree remount + visible
 * flicker on unrelated state changes.
 */

import { defaultSchema } from "hast-util-sanitize";
import type { Schema } from "hast-util-sanitize";

const ALLOWED_TAGS = (defaultSchema.tagNames ?? []).filter(
  (t) => !["img", "input", "details", "summary", "picture", "source"].includes(t),
);

export const noteSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: ALLOWED_TAGS,
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ["http", "https"],
  },
};
