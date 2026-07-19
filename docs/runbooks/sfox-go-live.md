# Runbook — sFOX Go-Live (GOLIVE, Phase 130)

**Owner:** founder (every leg is a LIVE op — no autonomous run can execute it) ·
**Audience:** whoever flips sFOX live ·
**Risk:** flipping the flags on an ASSUMED-green gate, or whitelisting a PARTIAL IP
set at sFOX, → intermittent sFOX auth failures on the load-balanced egress. The
mitigation is the explicit Step-3 gate (never assumed) + the whole-set whitelist
rule (Steps 0–1) + a rollback so trivial it removes all flip risk (Step 5).

## Why this document exists (the locked egress decision)

sFOX shipped **dormant** at v1.12 (both flags empty, tag `v1.12`). This runbook
takes it from dormant to **LIVE on native Railway static egress** — offerable in the
add-key wizard, with a real IP-whitelisted key rendering `api_verified` across every
surface.

**⭐ Egress decision (founder 2026-07-19, LOCKED):** Railway Pro static outbound IS
the egress path. **NO Fly. NO proxy.** `WORKER_EGRESS_PROXY_URL` stays **UNSET** on
the worker service; the `fly-egress-proxy/` directory stays dormant and unwired.
Native Railway static egress covers BOTH sFOX AND ccxt with ZERO build work — nothing
to install, wire, or migrate. The ONLY permitted proxy reference in this whole
runbook is the single-IP fallback note in Step 2, and even that is explicitly "NOT
Fly" (a QuotaGuard-type addon, only if sFOX cannot bind 3 IPs to one key).

The two sFOX flags this runbook flips (both empty today):

| Flag | Plane | Effect | Redeploy needed |
|------|-------|--------|-----------------|
| `SFOX_ENABLED` | Railway worker/server env | enables the sFOX adapter server-side | yes — redeploy the worker service |
| `NEXT_PUBLIC_SFOX_ENABLED` | Vercel prod client env | shows sFOX in the add-key wizard picker | yes — `NEXT_PUBLIC_*` is baked into the client bundle at BUILD time; an un-redeployed Vercel env change is a **silent no-op** |

**Standing rule: abort at ANY step → jump to [Step 5 — ROLLBACK].** The gate is
explicit and the flip is env-only, so aborting is always safe and always cheap.

---

## Step 0 — EGRESS-01: read the FULL Railway static-outbound IP set

Railway dashboard → project `quantalyze-analytics` → the worker service →
**Settings → Networking**. Confirm the service is on **Pro** with **static outbound
ACTIVE**.

- If the dashboard says static outbound **activates on next deploy**, REDEPLOY the
  worker FIRST — cross-reference `railway-worker.md` for the redeploy flow, the
  `/health` `git_sha` convergence check, and the silent skipped-deploy-on-red-CI
  gotcha (Railway skips the deploy if the merge commit's CI check-suite is red, and
  prod stays on stale code with no error).
- Record the **FULL 3-IP set** (Amsterdam/NL, load-balanced). Railway assigns a
  FIXED SET of 3 static outbound IPs — it cannot be reduced to 1.

**⭐ Whitelist rule (stated once, applies everywhere below): ALWAYS whitelist the
WHOLE dashboard set — NEVER one observed IP.** Railway load-balances egress across
all 3; a single observed IP (e.g. the known `152.55.184.85`, AS400940, NL) is one of
three, and binding only it guarantees intermittent auth failures when egress lands on
a sibling.

- **Verify:** all 3 IPs recorded from the dashboard, verbatim.
- **Abort path:** not on Pro / static outbound absent from Settings → Networking →
  STOP. Fix the plan/networking state in the dashboard first; do not probe or
  whitelist against a non-static egress.

## Step 1 — EGRESS-02: verify realized egress stays in-set (repeated probes)

Do NOT trust a single probe — one probe misses the load-balanced sibling IPs. Run
**repeated** probes from the worker's native egress:

```bash
railway ssh "cd /app && curl -s ipinfo.io"
```

Run this **at least 5 times**, spaced over time and ideally across a redeploy. For
EVERY probe:

- Assert the payload's `country` is **NL** (Amsterdam).
- Collect the distinct observed `ip` values.

**Gate assertion (explicit):** the observed IP set ⊆ the dashboard 3-IP set from
Step 0, and every probe is NL.

- **Verify:** ≥ 5 probes logged; every probe country NL; no observed IP outside the
  Step-0 dashboard set.
- **Abort path:** any observed IP OUTSIDE the dashboard set, or any non-NL country →
  STOP, do NOT whitelist. Re-read the dashboard set and/or contact Railway support —
  never proceed on a drifting egress.

## Step 2 — EGRESS-03: whitelist ALL 3 at sFOX + prove native-egress key auth

Hand the **FULL 3-IP set** (per the Step-0 whole-set rule) to sFOX via the
`security@quantalyze.com` handoff / the sFOX dashboard.

- **Note:** sFOX's per-key IP-restriction count is undocumented — the founder
  confirms with the sFOX trading team that 3 IPs are accepted on one key. If sFOX
  requires a **single** IP, the fallback is a proxy addon (QuotaGuard-type), **NOT
  Fly** (locked decision) — that is the only proxy path this milestone permits, and
  it is a fallback only.

Then PROVE an IP-whitelisted sFOX key authenticates end-to-end from the worker's
**NATIVE** Railway egress — with **no proxy in the path**:

- Confirm `WORKER_EGRESS_PROXY_URL` is **UNSET** on the worker service env BEFORE the
  proof (native egress is the whole point; a proxy would defeat the IP-bind logic).
- Run a read-only sFOX key auth against the whitelisted IPs from the worker.

This step GATES the flag flip — no authenticating key from native egress, no flip.

- **Verify:** sFOX confirms all 3 IPs bound to the key; a whitelisted read-only sFOX
  key authenticates from the worker with `WORKER_EGRESS_PROXY_URL` unset.
- **Abort path:** auth fails from native egress → re-check the sFOX-bound IP set
  against the Step-0/Step-1 evidence BEFORE touching any flag. Do not flip on a
  failing key.

## Step 3 — GOLIVE-01: the EXPLICIT flip gate (never assumed), then the flip

The flip is **NEVER assumed green**. ALL 5 rows below must be checked before flipping
either flag:

| # | Gate row | Green condition |
|---|----------|-----------------|
| 1 | EGRESS-01 | the FULL 3-IP dashboard set is read (Step 0) |
| 2 | EGRESS-02 | observed egress ⊆ the dashboard set, every probe NL (Step 1) |
| 3 | EGRESS-03 | a whitelisted sFOX key AUTHENTICATES from native egress, `WORKER_EGRESS_PROXY_URL` unset (Step 2) |
| 4 | FACTSHEET | the Phase-126 **BLOCKING** `e2e-seeded` job (`e2e/sfox-badge.spec.ts`, owner/allocator/admin + axe) is GREEN, verified via `gh pr checks` on the milestone PR — **never assumed from a local run** |
| 5 | E2GT | the Phase-127 E2GT-01 live run is **TWO-PART** green: exit 0 **AND** `anchor_consistency.within_same_day_tolerance === true` in the emitted evidence JSON (exit 0 ALONE is NOT a pass — a drift-beyond-band divergence exits 0 with the verdict in the JSON field) |

- Row 4 is verified by reading the `gh pr checks` output on the milestone PR showing
  `e2e-seeded` green — not a local vitest/playwright run.
- Row 5: cross-reference `flipretry-derived-equity-go-live.md` **Step 4** for the full
  E2GT harness procedure (env, args, exit-code table). Do NOT restate its env/arg
  detail here — that runbook is the single source of truth. The gate wording is
  exactly two-part: **exit 0 AND `within_same_day_tolerance === true`**.

**ONLY when all 5 rows are checked**, flip both flags — LIVE env ops, NOT migrations:

1. Set `SFOX_ENABLED` on the Railway worker service, then **redeploy the worker**.
2. Set `NEXT_PUBLIC_SFOX_ENABLED` in Vercel prod env, then **redeploy Vercel** (the
   `NEXT_PUBLIC_*` value is baked into the client bundle at build time — an
   un-redeployed env change is a silent no-op).

- **Verify:** Railway `/health` returns fresh at the expected `git_sha` post-redeploy
  (cross-reference `railway-worker.md`); the sFOX card appears in the add-key wizard
  exchange picker on prod after the Vercel redeploy.
- **Abort path:** ANY gate row not green → **DO NOT FLIP**. The gate is explicit,
  never assumed — a missing row means the flip waits.

## Step 4 — GOLIVE-02: live proof — full flow, every surface, every role

With both flags on, a real user connects a LIVE IP-whitelisted sFOX key through the
add-key wizard **end-to-end**, and its `api_verified` strategy renders LIVE across ALL
THREE surfaces:

- **factsheet** (`/strategy/[id]`)
- **discovery** (the browse/discovery listing)
- **edit** (the strategy edit page)

…proven E2E across ALL THREE roles: **owner / allocator / admin**. This is the full
flow, not one surface — the v1.10 lesson: after ANY flag flip, test the WHOLE flow
E2E, not a single surface.

- **Verify:** the `api_verified` badge is observed on all 3 surfaces for all 3 roles,
  and the connect wizard completed without a fail-closed error.
- **Abort path:** any surface or role MISSING the `api_verified` render → go to
  [Step 5 — ROLLBACK], then root-cause with the flags safely off.

## Step 5 — ROLLBACK (trivial, executable at ANY step)

Set **BOTH** flags back to empty and redeploy both sides:

1. Clear `SFOX_ENABLED` on the Railway worker service → redeploy the worker.
2. Clear `NEXT_PUBLIC_SFOX_ENABLED` in Vercel prod env → redeploy Vercel.

This restores the **proven-safe DORMANT v1.12 state** (tag `v1.12`) — **zero user
impact**: sFOX simply disappears from the add-key wizard picker. The flip is
**env-only** — no data is written by flipping the flags, so there is nothing to clean
up. **No migrations, no SQL, no code revert.**

---

## Appendix — the honest culmination

The milestone ships **FLAG-OFF** (exactly as v1.12 did). This runbook IS the
deliverable: the founder's complete, explicitly-gated, rollback-safe go-live
execution path. The flip itself awaits the EXTERNAL sFOX IP-bind turnaround (the
long-pole, started day 1 in parallel) plus the founder's live run of Steps 0–5. Every
EGRESS/GOLIVE requirement stays `human_needed`-OPEN until the founder executes and
supplies the live evidence — the recorded 3-IP dashboard set (EGRESS-01), the
multi-probe NL/in-set log (EGRESS-02), the authenticating whitelisted key from native
egress (EGRESS-03), the observed flags + both redeploys (GOLIVE-01), and the
`api_verified` render on all 3 surfaces × 3 roles (GOLIVE-02). No simulation, no
CI-derived claim, no partial credit.
