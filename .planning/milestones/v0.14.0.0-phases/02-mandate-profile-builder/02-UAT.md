---
status: complete
phase: 02-mandate-profile-builder
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 2026-04-19 post-fix re-verification (slider, chip color, chip race, Profile tab wiring)
started: 2026-04-19T15:20:00Z
updated: 2026-04-19T15:35:00Z
verified_by: conversational (user confirmed each step)
result: 8/8 pass
---

## Current Test

(complete — all 8 tests passed)

## Tests

1. **Reach Mandate via Profile** — [status: pass]
   Expected: /profile shows 4-tab row including Mandate; clicking Mandate updates URL to ?tab=mandate; legacy /preferences redirects to /profile?tab=mandate.

2. **Max weight slider responds to drag and keyboard** — [status: pass]
   Expected: drag the Max weight thumb or use arrow keys after clicking it. The thumb moves live during interaction. Value pill updates live (e.g. "10%"). On release, "Mandate saved" flashes and "Last saved: just now" updates. Reload keeps the new value.

3. **Preferred strategy types chips — cumulative + green** — [status: pass]
   Expected: click Long-Only then Market Neutral in quick succession. Both chips stay selected (both aria-checked, both rendered with green accent styling). Reload keeps both selected.

4. **Excluded exchanges chips — cumulative + red** — [status: pass]
   Expected: click Binance then OKX. Both stay selected and rendered in RED. Click Reset next to "Excluded exchanges" — both unselect. Reload shows them cleared.

5. **Advanced accordion expand + Advanced sliders respond** — [status: pass]
   Expected: click "Advanced constraints" → accordion expands, caret rotates. Correlation ceiling (0–1) and Max drawdown tolerance (0–1) sliders appear. Both drag/keyboard-respond the same way Max weight does. Liquidity shows 3 radio options (High / Medium / Low). Style exclusions shows 8 chips.

6. **Excluded styles chips — RED (parity with excluded exchanges)** — [status: pass]
   Expected: in Advanced, click Trend Following + Momentum. Both chips turn RED (not green). Same color treatment as Excluded exchanges. Reload keeps both selected, still RED.

7. **"Last saved" timestamp counts up without reload** — [status: pass]
   Expected: after any save, label reads "Last saved: just now". Leave the tab idle for ~70 seconds. Label auto-updates to "Last saved: 1 min ago" without you touching anything. Should continue to advance past additional minute boundaries.

8. **Non-allocator users don't see Mandate tab** — [status: pass]
   Expected: an account with role `asset_manager` (non-allocator) visiting /profile sees only Personal Info / Organizations / Account. Mandate tab hidden. Deep-link /profile?tab=mandate for such a user falls back to Personal Info.

## Gaps Found

(empty — to be populated if tests surface issues)
