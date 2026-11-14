# MT5 parity founder session (Phase 155.2)

This is the script the founder runs at the terminal. It collects the oracle for the parity comparison: numbers read from the terminal itself, the terminal's own export and the broker's statement. Nothing the Quantalyze gateway, the soak reconcile or our own database says is ever an oracle. The list of readings below is one list, `required-readings.json` in this directory, and the intake check that fails a worksheet reads the same file, so the script and the check cannot drift apart.

## Before the session

1. Use the terminal in English. The report parser matches column headers by their English text and refuses any other language by name.
2. The live accounts are MM2, MM3 and FX-AI_V, and only those. A demo account or the v1.15 soak account does not count as the run (MT5-08); if `trade_mode` reads demo, stop and say so.
3. Do the session on a trading day with the terminal connected. The weekend reading and the broker statements are collected separately, as the table says.
4. Use account labels only (MM2, MM3, FX-AI_V) everywhere a label is needed. Never write a login, a server name or a broker name into the worksheet or anywhere else tracked.

## Readings

For each account, record every reading below. Each value goes into the worksheet with the provenance in the third column, exactly spelled.

| Reading | Where to read it | Provenance to record | As-of day |
|---|---|---|---|
| `account_currency` | Read the account deposit currency in the Navigator, under Accounts, or in the header of the account's Report. | `terminal_reading` | none |
| `trade_mode` | Record real or demo, as the terminal's account properties state it (right-click the account in the Navigator, then Properties). | `terminal_reading` | none |
| `credit` | Read Credit in the Toolbox, Trade tab, in the account's balance line (zero when the line shows no Credit); 0.00 is a reading. | `terminal_reading` | none |
| `summary_instant_utc` | Write down the UTC time, to the second and ending in Z, at which you read the other readings that start with summary_. | `terminal_reading` | none |
| `summary_balance_at_t` | Read Balance in the Toolbox, Trade tab, at the instant you recorded. | `terminal_reading` | none |
| `summary_equity_at_t` | Read Equity in the Toolbox, Trade tab, at the instant you recorded. | `terminal_reading` | none |
| `summary_floating_pl_at_t` | Read the floating profit and loss (the open-positions total in the Toolbox, Trade tab) at the instant you recorded. | `terminal_reading` | none |
| `summary_credit_facility_at_t` | Read Credit Facility from the Summary block of a freshly generated Report at the instant you recorded. | `terminal_reading` | none |
| `weekend_close_balance` | On the Saturday or Sunday after the Friday edge, read the frozen Balance in the Toolbox, Trade tab, and record it with that Friday as the as-of day. | `terminal_reading` | the Friday (or statement day) it applies to |
| `weekend_close_equity` | On the Saturday or Sunday after the Friday edge, read the frozen Equity in the Toolbox, Trade tab, and record it with that Friday as the as-of day. | `terminal_reading` | the Friday (or statement day) it applies to |
| `statement_equity` | From the broker's statement, read the account equity at the close of each statement day you hold, and record one reading per day with that day as the as-of day. | `broker_statement` | the Friday (or statement day) it applies to |
| `all_history_report_sha256` | After saving the All-History Report, compute its sha256 as the export section below says and record the 64 hex characters. | `terminal_report_export` | none |
| `near_midnight_deal_display_time` | In the Toolbox, History tab, find the deal Phase 155.1 preselected and read the time the terminal displays for it, in the form YYYY.MM.DD HH:MM:SS. | `terminal_reading` | none |

## Export the All-History Report

For each account, in the terminal open the History tab, set the period to All history, and save the Report as HTML into the gitignored capture directory (`/.mt5-parity/<run>/`). Keep the file exactly as the terminal wrote it; do not open it in an editor and save it again. Then compute its sha256 and record it as `all_history_report_sha256`:

```
shasum -a 256 <the saved Report file>
```

The intake binds the Report to the worksheet by that sha256, so a Report that was edited or swapped after the reading is refused.

## Where values go

The worksheet is a JSON file inside the gitignored capture directory, one block of readings per account label. Values never go into tracked text: not into this file, not into the planning record, not into a pull request. A synthetic worksheet carries `synthetic: true` and can only ever produce a rehearsal; a real one is never marked synthetic.
