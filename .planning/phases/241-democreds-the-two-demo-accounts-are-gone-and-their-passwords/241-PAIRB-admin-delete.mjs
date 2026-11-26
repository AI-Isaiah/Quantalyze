// Phase 241 plan 03 - the GoTrue admin-API delete of Pair B, resolved by login digest.
// The same file runs on the lane (rehearsal) and on PROD (plan 04).
//
// Usage: node 241-PAIRB-admin-delete.mjs --target lane|prod --login-sha256 <64 hex> [--confirm-prod]
// Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Requires exactly one user whose sha256(lower(email)) equals the digest, hard-deletes it
// through auth.admin.deleteUser, re-lists, and requires zero matches.
// Prints only `matches-before=1 deleted=1 matches-after=0`. Every failure prints a named
// reason (and an HTTP status where there is one), never an id, an email or a key.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const fail = (msg) => {
  console.error(`admin-delete: ${msg}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const target = flag("--target");
const digest = flag("--login-sha256");
const confirmProd = argv.includes("--confirm-prod");

if (target !== "lane" && target !== "prod") fail("input:target must be lane or prod");
if (!digest || !/^[0-9a-f]{64}$/.test(digest)) fail("input:digest must be 64 lowercase hex chars");
if (target === "prod" && !confirmProd) fail("input:--confirm-prod is required for target prod");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("input:SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("input:SUPABASE_URL is not a URL");
}
const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
if (target === "lane" && !loopback) fail("target-mismatch: lane requires a loopback host");
if (target === "prod" && (loopback || parsed.protocol !== "https:")) {
  fail("target-mismatch: prod requires an https non-loopback host");
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function matches() {
  const ids = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`list-users failed (status ${error.status ?? "?"})`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email) continue;
      const h = createHash("sha256").update(u.email.toLowerCase(), "utf8").digest("hex");
      if (h === digest) ids.push(u.id);
    }
    if (users.length < 1000) return ids;
  }
}

const before = await matches();
if (before.length !== 1) fail(`matches-before=${before.length} (expected exactly 1)`);

const { error: delError } = await admin.auth.admin.deleteUser(before[0], false);
if (delError) fail(`delete-user failed (status ${delError.status ?? "?"})`);

const after = await matches();
if (after.length !== 0) fail(`matches-after=${after.length} (expected 0)`);

console.log("matches-before=1 deleted=1 matches-after=0");
