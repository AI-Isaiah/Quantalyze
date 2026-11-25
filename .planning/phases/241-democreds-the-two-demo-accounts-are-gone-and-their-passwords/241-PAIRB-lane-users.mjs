// Phase 241 plan 03 - LANE ONLY. Creates synthetic fixture users on the local-stack lane
// through the GoTrue admin API and signs each in once, so a real auth.sessions row exists.
//
// Usage: node 241-PAIRB-lane-users.mjs create <label>... --out <file>
// Env:   API_URL, ANON_KEY, SERVICE_ROLE_KEY (the lane handoff, exported by the driver)
//
// Prints only `created <label>` lines. Never prints a login, password, id or key.
// The output file is mode 600 and holds {label: {id, loginSha256}}.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const fail = (msg) => {
  console.error(`lane-users: ${msg}`);
  process.exit(1);
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== "create") fail("usage: create <label>... --out <file>");
const outIdx = rest.indexOf("--out");
if (outIdx < 0 || !rest[outIdx + 1]) fail("--out <file> is required");
const out = rest[outIdx + 1];
const labels = rest.filter((_, i) => i !== outIdx && i !== outIdx + 1);
if (labels.length === 0) fail("at least one label is required");

const url = process.env.API_URL;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
if (!url || !anon || !service) fail("API_URL, ANON_KEY and SERVICE_ROLE_KEY must be set");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") fail("refusing a non-loopback API_URL");

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, service, opts);
const result = {};

for (const label of labels) {
  const login = `lane-${randomBytes(12).toString("hex")}@example.test`;
  const password = `P${randomBytes(18).toString("base64url")}9a`;
  const { data, error } = await admin.auth.admin.createUser({
    email: login,
    password,
    email_confirm: true,
  });
  if (error || !data?.user?.id) fail(`createUser failed for ${label} (status ${error?.status ?? "?"})`);
  const anonClient = createClient(url, anon, opts);
  const { error: signInError } = await anonClient.auth.signInWithPassword({ email: login, password });
  if (signInError) fail(`signIn failed for ${label} (status ${signInError.status ?? "?"})`);
  result[label] = {
    id: data.user.id,
    loginSha256: createHash("sha256").update(login.toLowerCase(), "utf8").digest("hex"),
  };
  console.log(`created ${label}`);
}

writeFileSync(out, JSON.stringify(result), { mode: 0o600 });
chmodSync(out, 0o600);
