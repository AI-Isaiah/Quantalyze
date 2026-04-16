# Alert Routing Contract v1

**Status:** Design note (revisitable). Not an ADR — Sprint 6 Bridge will add alert types whose routing we cannot predict until their payload shape exists.

**Gates:** All alert-surface component work in Sprint 5 (AlertBanner, InsightStrip additions, email digest) MUST conform to this table.

## Severity → Surface matrix

| Severity | Banner (above peer strip) | InsightStrip (peer strip) | Email digest |
|---|---|---|---|
| **critical** — sync_failure on primary strategy, drawdown > breach | YES, **1 max, critical-only** (extras collapse to "+N more" chip) | NO (banner wins; no duplicate surface) | YES, immediate section at top |
| **high** — rebalance_drift >10%, correlation_spike, regime_shift | NO | YES, prioritized | YES, grouped under "Attention" |
| **medium** — rebalance_drift 5-10%, underperformance, concentration_creep | NO | YES, lower priority | YES, grouped under "Attention" |
| **info** — status_change, optimizer_suggestion | NO | No (peer strip full at 3 cards) | YES, grouped under "Info" |

## Hard rules

1. **1 critical banner at a time.** If two critical alerts are live, the most recent wins and the other becomes "+1 more" on the banner chip. Never stack two banners.
2. **Peer strip caps at 2 cards while a critical banner is live.** When the banner is dismissed/acked, peer strip returns to its normal cap (3).
3. **Every alert that appears in the email must also have a live in-app surface.** An alert surfaced in email but not in-app violates the contract — one acknowledgement path, not two.
4. **Critical alerts never go only to email.** A missed email must not silently hide a critical state.
5. **Ack from email is authoritative.** A one-time-use HMAC token acks the alert for every surface; subsequent in-app views reflect acked state.
6. **InsightStrip never renders a critical alert.** If the banner is broken or feature-flagged off, the alert simply does not appear in-app — it does not spill into the strip.

## Visual spec (critical banner)

- Full-width, 56px tall, above the peer strip (not floating).
- Background `#FEF2F2`. 1px top border `#DC2626`. No bottom border.
- Body text DM Sans 14px, color `#1A1A2E`.
- Dismiss/ack button right-aligned, 24px hit-target, label "Acknowledge". No icon.
- No motion. No elevation. No shadow.
- Mobile: `hidden md:flex` for Sprint 5 (mobile polish deferred to Sprint 10).

## Ack token contract (email)

- HMAC-SHA256. Secret in `ALERT_ACK_SECRET` env var (≥ 16 chars).
- Payload = `${alertId}.${expSeconds}`.
- Token format = `${expSeconds}.${hex_sig}`.
- TTL = 48 hours.
- One-time-use: each successful ack stores the token hash in `used_ack_tokens`, enforced before any mutation.
- GET `/api/alerts/ack?id=X&t=<token>` renders a confirm page (never auto-acks on GET — defeats Outlook Safe Links preloaders).
- POST from confirm page re-verifies HMAC + `Sec-Fetch-Site=same-origin` + per-IP rate limit 5/min.
- Redirect map: valid→`?ack=success`, replay/already→`?ack=already`, expired→`?ack=expired`, superseded→`?ack=superseded`.

## Rationale log

- **Why no critical in InsightStrip:** two surfaces for one signal = two acks = one stuck stale. Inbox UX.
- **Why banner is above (not below) strip:** critical is blocking; user must acknowledge before the peer strip's signal is meaningful.
- **Why peer strip caps at 2 when banner is live:** viewport budget — first screen is portfolio value + critical + 2 peer insights.
- **Why design note, not ADR:** Sprint 6 Bridge introduces replacement-related alerts (`replacement_matched`, `intro_contacted`) whose routing will need a revision. ADR-promotion should happen after Sprint 6 ships.

## Out of scope (v1)

- SMS/Telegram alert delivery — year 2.
- Mobile banner layout — Sprint 10.
- Per-user threshold customization — allocator-facing config is Sprint 8+.
- Banner on `/strategies` or `/portfolios` routes — v1 lives only on `/allocations`.
