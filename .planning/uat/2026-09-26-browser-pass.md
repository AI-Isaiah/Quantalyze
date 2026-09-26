# Browser UAT pass — 2026-09-26 (production, logged-in owner account)

Method: claude-in-chrome on the deployed site. The Chrome window cannot go below about 550 CSS px, so 320px was reproduced with CSS `zoom` scaling the layout to 320 CSS px. The site's smallest breakpoint is 640px (Tailwind `sm`), so 320 and 551 share one breakpoint and the layout is the same. 200% zoom was reproduced as a 640 CSS px layout (1280px ÷ 2). No write was performed: no share link minted, no delete dialog opened.

| Phase | Item | Result |
|---|---|---|
| 167.2.1 | /strategies share note on a computed-but-unbuildable row, 320px and 640px | **Note passes** at both widths (wraps, no clipping). **Row header fails at 320px**: "Get private link" overlaps the strategy name and cuts it to two letters. It is clean at 640px. Routed to 170 LAYOUT. |
| 167.2.1 | Owner factsheet pending panel, 320px and 640px | **Pass.** Wraps, no clipping or overlap. |
| 167.2.1 | Live consistency, list vs owner factsheet vs share link | **Copy mismatch.** The list note and the owner banner say the numbers appear "once a computation succeeds" (wait); the body says the computation finished and to contact support (act). Routed to 170.1 COPY. The share link was not checked, because that needs a mint (a write). |
| 167.2 | Owner view of a strategy whose compute did not produce a factsheet | **Pass.** It never says "being computed", and the owner sees the reason and a remedy. |
| 167.2 | Key card sync-status panel, 320px and 640px | **Card passes** at both widths. The delete-confirmation arm was not opened, because the destructive dialog is skipped on PROD. |
| 167.2 | Composite key-card note; share-page card; recipient view | **Not runnable.** The account has no composite strategy, and a share page needs a minted link. |
| 167.1 | AUM disclosure states A/B/C; Holdings footer note; includes/excludes copy | **Not runnable.** The account has no key needing attention and no blended allocation history (the page shows the "at least two days" empty state). |
| 164.5.3 | MT5 account line, Update password button and dialog | **Not runnable.** The account has no MT5 key. |
| — | /allocations at 320px | **New finding:** the floating "Tweaks" button overlaps the bottom navigation's "Strategies" and "Profile" labels. Routed to 170 LAYOUT. |
