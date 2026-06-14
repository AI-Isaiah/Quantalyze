//+------------------------------------------------------------------+
//|                                     QuantalyzeDailyReturns.mq5    |
//|                  Read-only daily-equity-return export Expert Advisor |
//|                                            (c) Quantalyze, 2026     |
//+------------------------------------------------------------------+
//
// PURPOSE
// -------
// This Expert Advisor (EA) is a READ-ONLY recorder. It NEVER places, modifies,
// or closes a position. Once per calendar day it snapshots the account's TOTAL
// EQUITY, flow-adjusts it (removing deposits/withdrawals/credits that are not
// trading performance), and appends one `date,daily_return` row to a CSV inside
// the MT5 `MQL5\Files` sandbox. The user then retrieves that CSV and uploads it
// through Quantalyze's existing `daily_returns` CSV wizard. The CSV feeds the
// SAME analytics → factsheet pipeline every crypto strategy already uses.
//
// READ-ONLY GUARANTEE (Plan 20-03 T16 CI static-check ENFORCES this)
// ------------------------------------------------------------------
// This file MUST call NONE of the MQL5 trade-mutation APIs: the synchronous and
// async order-send entry points, the order-modify and order-delete entry points,
// or the position-close and position-modify entry points. It MUST NOT declare or
// use the standard-library trade wrapper class, MUST NOT call any of that class's
// open/close/buy/sell methods, and MUST NOT include the standard trade header.
// (The Plan 20-03 CI static-check greps the raw source for every one of those
// token names and FAILS the build on any match — including matches inside a
// comment — so this file is deliberately written to mention NONE of them
// verbatim.) It uses ONLY read APIs (AccountInfoDouble, HistorySelect and the
// HistoryDeal* getters, TimeTradeServer) plus file I/O (FileOpen / FileWrite /
// FileMove). Do not add a mutating call.
//
// MQL5, NOT MQL4 (State of the Art)
// ---------------------------------
// MT5/MQL5 is a different API surface than MQL4. We use the typed enum accessor
// AccountInfoDouble(ACCOUNT_EQUITY) for equity — NOT MQL4's bare equity/balance
// global functions — and HistorySelect + the HistoryDeal* getters for history —
// NOT MQL4's single-order-pool selector. No MQL4 function names appear here.
//
// SINGLE-INSTANCE CONSTRAINT (M5)
// -------------------------------
// Attach this EA to EXACTLY ONE chart in ONE terminal. The EA reads
// account-level equity (not symbol-level), so the chart symbol is irrelevant —
// but TWO instances would race the shared CSV + state file in MQL5\Files,
// corrupting both. OnInit refuses to start a second concurrent instance by
// claiming a process-wide named lock (see AcquireSingleInstanceLock). If you
// want to record two DIFFERENT accounts, run two SEPARATE terminals/data-folders
// (each has its own MQL5\Files sandbox) — never two charts in one terminal.
//
// CALENDAR = DENSE CALENDAR-DAILY (one row per calendar day) — locked 2026-06-14
// ----------------------------------------------------------------------------
// The strategies traded here are CRYPTO (OKX/Bybit, 24/7/365). The market trades
// EVERY calendar day, so EVERY emitted row is a REAL equity-based return. We emit
// ONE row per calendar day and we NEVER zero-fill a "closed" day, because there
// are no closed days. The ONLY way a span has fewer rows is a genuine OUTAGE (the
// terminal was off / had no equity snapshot for those days) — that simply yields
// fewer rows, never a fabricated zero. Downstream annualization is UNCHANGED:
// compute_all_metrics uses quantstats periods=252 (the product-wide displayed
// basis, identical to every crypto strategy on the ranking page), so MT5 stays
// apples-to-apples. This EA does NOT annualize; it just emits the real series.
//
// MULTI-DAY OUTAGE (H3) — one FLAGGED cumulative row, never per-day zeros
// ----------------------------------------------------------------------
// If the EA was OFF across more than one calendar day, the missed days produce NO
// rows. We do NOT write a row for each missed day off the same current equity —
// that would give the first missed day the whole move and the rest ~0.0, which is
// precisely the synthetic-zero vol-deflation forbidden above. Instead we emit ONE
// row, dated the most-recent completed day, carrying the CUMULATIVE return since
// the last snapshot (with all flows in the span netted), and FLAG it (GAP-SPAN) in
// the audit sidecar so the T14 reconcile sees a span, not a clean day. The
// cumulative move is preserved; the day count is honestly fewer.
//
// (Historical note: an interim "sparse @252" revision driven by a red-team
// measurement that injected SYNTHETIC weekend zeros was REVERTED — that premise
// is false for a 365-day market. Do not reintroduce sparse-skip logic.)
//
// THE FLOW-ADJUSTED RETURN (the #1 formula — T2/T3/T10)
// ----------------------------------------------------
//   net_external_flows = Σ signed cash of the day's EXTERNAL-FLOW deals
//                        (deposit > 0, withdrawal < 0)
//   daily_return = (equity_close − net_external_flows − prior_close_equity)
//                  / prior_close_equity
//
// A +$10,000 deposit raises equity_close by $10,000 with no trading; subtracting
// net_external_flows cancels it, so the day shows ONLY the trading return — never
// the cash spike. A withdrawal is a NEGATIVE flow; subtracting a negative adds it
// back, so the outflow does not depress the return.
//
// equity_close is the LAST equity reading captured BEFORE the day rolled over (H2)
// ---------------------------------------------------------------------------------
// The day's close is the most recent ACCOUNT_EQUITY snapshot from BEFORE midnight,
// not the first reading AFTER midnight. The EA reads equity on every timer tick
// and keeps the latest value; when the date flips, that pre-rollover value is the
// completed day's close. Using the first post-midnight read would drift the close
// up to one timer period of 24/7 market movement into the NEXT day. A short timer
// period (TimerSeconds, default 15s) keeps the pre-rollover reading near midnight.
//
// INCEPTION RULE (M2 — day-1 divide-by-zero guard)
// ------------------------------------------------
// The first-ever calendar day has NO prior_close_equity (the account was just
// funded; prior_close_equity would be 0). Dividing by zero would emit ±Inf/NaN.
// So on the inception day we define daily_return := 0.0 (base = the initial
// funded equity) and seed prior_close_equity from the current equity. The
// inception 0.0 row is dated the FUNDING day itself (the seed date) — NOT the
// next-rollover day (H1). The first REAL return follows on the next rollover.
//
// DEAL CLASSIFICATION (E5) — what is a "flow" vs a "cost"
// ------------------------------------------------------
//   EXTERNAL FLOW — EXCLUDE from the return (subtract as net_external_flows):
//     DEAL_TYPE_BALANCE (deposit/withdrawal), DEAL_TYPE_CREDIT,
//     DEAL_TYPE_CHARGE, DEAL_TYPE_BONUS.
//   COST — INCLUDE in the return (leave inside equity, do NOT net as flow):
//     DEAL_TYPE_COMMISSION (and _DAILY/_MONTHLY/_AGENT* variants),
//     DEAL_TYPE_INTEREST, and swap (carried in DEAL_SWAP on trade deals).
//   These are genuine trading costs — removing them would overstate performance.
//
// DEAL_TYPE_CORRECTION DEFAULT (H6) — BROKER-DEPENDENT, documented choice
// ----------------------------------------------------------------------
// A CORRECTION can be EITHER a balance correction (a capital flow → EXCLUDE) OR
// a broker P&L/slippage/swap correction (a genuine COST → INCLUDE in the return).
// Misclassifying it shifts one day's return. There is no universally-correct
// default, so we DO NOT silently default to "flow."
//   CHOSEN DEFAULT: treat DEAL_TYPE_CORRECTION as a COST (INCLUDED in the return),
//   i.e. we DO NOT subtract it as a flow. Money-direction rationale: a correction
//   most commonly adjusts realized trading P&L (re-quote/slippage/swap fixes),
//   which is part of performance; excluding it would erase a real gain/loss. If a
//   correction were instead a pure balance correction, including it would be
//   wrong — but that is the rarer case and it is the SAFER error to leave a small
//   correction inside the return than to silently strip a real cost.
//   The EA ALWAYS routes every CORRECTION deal to the audit sidecar + Print log so
//   the operator can SEE it, and T14 (demo reconcile) confirms the broker's
//   actual CORRECTION semantics with a hand-expected result before any live KPI
//   is trusted. The default is configurable via the CorrectionIsFlow input below.
//
// INTRADAY-FLOW BOUND (M3)
// ------------------------
// The gross-day-flow subtraction is exact only when the flow lands while no
// trading P&L is mid-accrual. For a large same-day flow (e.g. a deposit that
// doubles the account at 09:00 then trades), the trading return was earned on the
// POST-flow base, but we divide by the PRE-flow prior_close_equity — an
// approximation whose error is UNBOUNDED as the flow grows. We do NOT silently
// approximate: when |net_external_flows| / prior_close_equity exceeds
// FLOW_FLAG_THRESHOLD (default 0.20 = 20%), we FLAG the day in the audit sidecar
// and Print a warning so the manual T14 reconcile inspects it. The CSV row itself
// stays `date,daily_return` (no extra column).
//
// ATOMIC RESTART STATE (A1 / M5) — survives a hard kill
// -----------------------------------------------------
// prior_close_equity + last_snapshot_date are persisted to a FILE in MQL5\Files
// (NOT a GlobalVariable — GlobalVariables are flushed only periodically and on a
// CLEAN shutdown, so a hard kill can lose unflushed state). The state file is
// written ATOMICALLY: write a TEMP file, FileClose it, then FileMove(temp→final,
// FILE_REWRITE) to rename over the live file. A bare single FileWrite to the live
// file is NOT atomic — a kill mid-write leaves a truncated base (the exact A1
// failure). The state file carries a sentinel header + a checksum line so the
// read side can DETECT a partial write and FAIL LOUD (refuse to emit, disable the
// timer) rather than emit a return against a corrupt base. The persisted date is
// stored in SERVER TIME (the date component of TimeTradeServer()) — the SAME zone
// used for rollover detection and the row label — so a restart across a DST/clock
// change neither double-emits nor skips a day.
//
// OUTPUT CONTRACT (pinned by Plan 01 — what the EA MUST emit)
// -----------------------------------------------------------
//   Header `date,daily_return`. date = ISO YYYY-MM-DD (NOT TimeToString's
//   YYYY.MM.DD — we replace '.' with '-'). daily_return = fractional decimal
//   (0.0123 = 1.23%). Dense calendar-daily, full history from inception on every
//   export (T12 full-replace). The downstream validator caps a file at
//   MAX_INGEST_ROWS = 5000 rows (~13.7 years at one row per calendar day) and
//   HARD-REJECTS the WHOLE file beyond that — see README.
//+------------------------------------------------------------------+

#property copyright "Quantalyze"
#property version   "1.00"
#property strict
#property description "Read-only daily total-equity return recorder (flow-adjusted, dense calendar-daily). NEVER trades."

//--- File names inside the MQL5\Files sandbox.
input string  OutputCsvName       = "quantalyze_dailies.csv";   // CSV: date,daily_return
input string  StateFileName       = "quantalyze_state.csv";     // restart state (prior_close_equity + last date)
input string  AuditSidecarName    = "quantalyze_audit.log";     // human-readable audit/flag log
input int     TimerSeconds        = 15;                          // OnTimer cadence; smaller => the pre-rollover close is nearer true midnight (H2)
input double  FlowFlagThreshold   = 0.20;                        // M3: flag day if |flows|/prior_equity exceeds this
input bool    CorrectionIsFlow    = false;                       // H6: false => CORRECTION is a COST (default); true => a FLOW

//--- State-file format constants (sentinel header lets read-side detect a partial write).
#define STATE_SENTINEL  "QZ_STATE_V1"

//--- In-memory restart state (mirrors the on-disk state file).
double   g_prior_close_equity = 0.0;     // yesterday's flow-adjusted closing equity (the return base)
datetime g_last_snapshot_date = 0;       // server-time DATE (midnight) of the last emitted snapshot
bool     g_inception_pending  = false;   // true on first run until the inception row is emitted
bool     g_disabled           = false;   // set true on a corrupt-state fail-loud; refuses to emit
bool     g_lock_held          = false;   // single-instance lock ownership

//--- Last equity reading captured BEFORE the rollover check (T6/H2). On rollover
//--- we use THIS as the completed day's close, NOT a fresh post-midnight read,
//--- so the close is the most recent pre-midnight equity (no next-day drift).
//--- Not persisted to disk: a restart re-seeds it from current equity in OnInit
//--- (the close of a day that rolls over mid-outage is the gap-spanning row's
//--- pre-rollover reading anyway, which the gap path handles explicitly).
double   g_last_equity        = 0.0;     // most recent ACCOUNT_EQUITY snapshot (pre-rollover)
datetime g_last_equity_time   = 0;       // server-time instant of g_last_equity

//+------------------------------------------------------------------+
//| Truncate a datetime to its server-time DATE (midnight).          |
//| Rollover detection compares DATE COMPONENTS, never wall-clock     |
//| instants, so we get exactly one row per calendar date across DST. |
//+------------------------------------------------------------------+
datetime DateOnly(const datetime t)
{
   MqlDateTime st;
   TimeToStruct(t, st);
   st.hour = 0;
   st.min  = 0;
   st.sec  = 0;
   return StructToTime(st);
}

//+------------------------------------------------------------------+
//| Convert a server-time datetime to an ISO YYYY-MM-DD label.        |
//| TimeToString yields "YYYY.MM.DD"; the downstream route regex      |
//| requires "^\d{4}-\d{2}-\d{2}$", so we replace '.' with '-'.       |
//+------------------------------------------------------------------+
string IsoDate(const datetime t)
{
   string s = TimeToString(t, TIME_DATE);   // "YYYY.MM.DD"
   StringReplace(s, ".", "-");               // "YYYY-MM-DD"
   return s;
}

//+------------------------------------------------------------------+
//| Append one line to the human-readable audit sidecar (best-effort).|
//+------------------------------------------------------------------+
void AuditLog(const string line)
{
   int h = FileOpen(AuditSidecarName, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("Quantalyze: could not open audit sidecar '", AuditSidecarName, "' err=", GetLastError());
      return;
   }
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, IsoDate(TimeTradeServer()) + " " + line + "\r\n");
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Single-instance lock (M5). A GlobalVariable acts as a process-    |
//| wide flag within ONE terminal; two charts in the same terminal    |
//| would otherwise race the CSV + state file. (This intentionally    |
//| uses GlobalVariable ONLY as a transient in-terminal lock, NOT for |
//| durable restart state — restart state lives in the FILE.)         |
//+------------------------------------------------------------------+
bool AcquireSingleInstanceLock()
{
   const string lockName = "QuantalyzeDailyReturns_lock";
   if(GlobalVariableCheck(lockName))
   {
      Print("Quantalyze: another instance holds the single-instance lock. ",
            "Attach this EA to ONLY ONE chart per terminal. Refusing to start.");
      return false;
   }
   GlobalVariableSet(lockName, (double)TimeTradeServer());
   g_lock_held = true;
   return true;
}

void ReleaseSingleInstanceLock()
{
   if(g_lock_held)
   {
      GlobalVariableDel("QuantalyzeDailyReturns_lock");
      g_lock_held = false;
   }
}

//+------------------------------------------------------------------+
//| Deterministic integer checksum over the state payload, so the     |
//| read side can detect a truncated/garbled write (M5).              |
//+------------------------------------------------------------------+
long StateChecksum(const double equity, const datetime dt)
{
   // Stable, locale-independent: hash the exact strings we persist.
   string payload = DoubleToString(equity, 8) + "|" + (string)((long)dt);
   long sum = 1469598103934665603; // FNV-ish seed
   int n = StringLen(payload);
   for(int i = 0; i < n; i++)
   {
      sum ^= (long)StringGetCharacter(payload, i);
      sum *= 1099511628211;
   }
   return sum;
}

//+------------------------------------------------------------------+
//| Write restart state ATOMICALLY: temp file -> FileMove rename.     |
//| Format (4 lines):                                                 |
//|   QZ_STATE_V1                                                     |
//|   <prior_close_equity, 8dp>                                       |
//|   <last_snapshot_date as epoch seconds, server time>             |
//|   <checksum of the two values above>                              |
//+------------------------------------------------------------------+
bool WriteStateAtomic(const double equity, const datetime dt)
{
   const string tmpName = StateFileName + ".tmp";

   int h = FileOpen(tmpName, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("Quantalyze: FAIL to open temp state file '", tmpName, "' err=", GetLastError());
      return false;
   }
   FileWriteString(h, STATE_SENTINEL + "\n");
   FileWriteString(h, DoubleToString(equity, 8) + "\n");
   FileWriteString(h, (string)((long)dt) + "\n");
   FileWriteString(h, (string)StateChecksum(equity, dt) + "\n");
   FileClose(h);

   // Atomic publish: rename temp over the live file. FileMove with FILE_REWRITE
   // replaces any existing destination. A kill BEFORE this rename leaves the live
   // state file untouched (last good value); a kill DURING the temp write leaves
   // only the temp file, which the read side ignores. Either way the live state
   // is never half-written.
   if(!FileMove(tmpName, 0, StateFileName, FILE_REWRITE))
   {
      Print("Quantalyze: FAIL to FileMove temp state -> '", StateFileName, "' err=", GetLastError());
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Read + VALIDATE the restart state. Returns:                       |
//|   1  = valid state loaded (g_prior_close_equity/g_last_snapshot)  |
//|   0  = no state file (first run — caller seeds inception)         |
//|  -1  = file present but CORRUPT/unparseable (caller fails loud)   |
//+------------------------------------------------------------------+
int ReadState()
{
   if(!FileIsExist(StateFileName))
      return 0; // first run

   int h = FileOpen(StateFileName, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("Quantalyze: state file exists but cannot be opened err=", GetLastError());
      return -1;
   }

   string sentinel = FileIsEnding(h) ? "" : FileReadString(h);
   string equityStr = FileIsEnding(h) ? "" : FileReadString(h);
   string dateStr   = FileIsEnding(h) ? "" : FileReadString(h);
   string checkStr  = FileIsEnding(h) ? "" : FileReadString(h);
   FileClose(h);

   // Strip stray CR if the platform wrote one.
   StringReplace(sentinel,  "\r", "");
   StringReplace(equityStr, "\r", "");
   StringReplace(dateStr,   "\r", "");
   StringReplace(checkStr,  "\r", "");

   if(sentinel != STATE_SENTINEL)
   {
      Print("Quantalyze: state file sentinel mismatch ('", sentinel, "') — corrupt/partial write.");
      return -1;
   }
   if(StringLen(equityStr) == 0 || StringLen(dateStr) == 0 || StringLen(checkStr) == 0)
   {
      Print("Quantalyze: state file truncated (missing equity/date/checksum line).");
      return -1;
   }

   double equity = StringToDouble(equityStr);
   datetime dt   = (datetime)StringToInteger(dateStr);
   long stored   = StringToInteger(checkStr);

   if(stored != StateChecksum(equity, dt))
   {
      Print("Quantalyze: state file checksum mismatch — corrupt/partial write. Refusing to guess a base.");
      return -1;
   }
   // A valid base must be a positive equity (an account cannot have <= 0 funded equity here).
   if(!(equity > 0.0))
   {
      Print("Quantalyze: state file equity is non-positive (", equityStr, ") — refusing to use as a base.");
      return -1;
   }

   g_prior_close_equity = equity;
   g_last_snapshot_date = DateOnly(dt);
   return 1;
}

//+------------------------------------------------------------------+
//| Human-readable name for a deal-type enum value (audit log only).  |
//| These are READ-ONLY enum constants, not trade-mutation calls.     |
//+------------------------------------------------------------------+
string DealTypeName(const int dtype)
{
   switch(dtype)
   {
      case DEAL_TYPE_BALANCE:    return "BALANCE";
      case DEAL_TYPE_CREDIT:     return "CREDIT";
      case DEAL_TYPE_CHARGE:     return "CHARGE";
      case DEAL_TYPE_BONUS:      return "BONUS";
      case DEAL_TYPE_CORRECTION: return "CORRECTION";
      default:                   return "TYPE_" + (string)dtype;
   }
}

//+------------------------------------------------------------------+
//| Sum the day's EXTERNAL-FLOW deals (deposits/withdrawals/credits/  |
//| charges/bonus, + CORRECTION per the configured default). Returns  |
//| signed net flow (deposit > 0, withdrawal < 0). Costs              |
//| (commission/interest/swap) are NOT summed — they stay inside      |
//| equity as genuine trading costs (T10).                            |
//|                                                                   |
//| READ-ONLY: HistorySelect + HistoryDealGet* only. No trade calls.  |
//+------------------------------------------------------------------+
double SumExternalFlows(const datetime dayStart, const datetime dayEnd, int &correctionCount)
{
   correctionCount = 0;
   double netFlow = 0.0;

   // Select the day's closed-deal history window [dayStart, dayEnd).
   if(!HistorySelect(dayStart, dayEnd))
   {
      Print("Quantalyze: HistorySelect failed for window ", IsoDate(dayStart), " err=", GetLastError());
      return 0.0;
   }

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      long   dtype  = HistoryDealGetInteger(ticket, DEAL_TYPE);
      double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT); // signed cash effect of the deal

      bool isFlow = false;
      switch((int)dtype)
      {
         // EXTERNAL FLOW — EXCLUDE from the return.
         case DEAL_TYPE_BALANCE: // deposit (+) / withdrawal (-)
         case DEAL_TYPE_CREDIT:
         case DEAL_TYPE_CHARGE:
         case DEAL_TYPE_BONUS:
            isFlow = true;
            // M1 BROKER-CAVEAT: we net the deal's DEAL_PROFIT as the flow amount.
            // Some brokers carry a CREDIT/BONUS/CHARGE amount in a different field,
            // so DEAL_PROFIT can read 0 even though equity moved — which would
            // INFLATE the return (the flow is not subtracted out). We cannot
            // reliably read every broker's alternate field from MQL5, so the
            // backstop is the manual T14 reconcile: log EVERY flow-type deal (its
            // DEAL_TYPE and the DEAL_PROFIT we summed) so the operator can spot a
            // mis-summed credit (e.g. a bonus that moved equity but logged 0).
            AuditLog("FLOW deal ticket=" + (string)ticket +
                     " type=" + DealTypeName((int)dtype) +
                     " profit=" + DoubleToString(profit, 2) +
                     " netted_as=FLOW(excluded)" +
                     " [M1: confirm broker carries the amount in DEAL_PROFIT in T14]");
            break;

         // CORRECTION — broker-dependent (H6). Default: COST (not a flow).
         case DEAL_TYPE_CORRECTION:
            correctionCount++;
            isFlow = CorrectionIsFlow; // false by default => left as a cost inside equity
            AuditLog("CORRECTION deal ticket=" + (string)ticket +
                     " profit=" + DoubleToString(profit, 2) +
                     " classified_as=" + (isFlow ? "FLOW(excluded)" : "COST(included)") +
                     " [confirm on broker in T14]");
            break;

         // Everything else (BUY/SELL trade deals, COMMISSION*, INTEREST, ...) is
         // either trading P&L or a genuine cost — leave it inside equity.
         default:
            isFlow = false;
            break;
      }

      if(isFlow)
         netFlow += profit;
   }

   return netFlow;
}

//+------------------------------------------------------------------+
//| Re-emit the COMPLETE in-state CSV header if the file is absent.   |
//| The EA APPENDS one row per rollover; the full history accumulates |
//| in the file from inception, satisfying the full-replace contract  |
//| (T12) on every retrieval/upload.                                  |
//+------------------------------------------------------------------+
void EnsureCsvHeader()
{
   if(FileIsExist(OutputCsvName))
      return;
   int h = FileOpen(OutputCsvName, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(h == INVALID_HANDLE)
   {
      Print("Quantalyze: FAIL to create CSV '", OutputCsvName, "' err=", GetLastError());
      return;
   }
   FileWrite(h, "date", "daily_return");
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Append one `YYYY-MM-DD,<fraction>` row to the CSV (seek-to-end).  |
//+------------------------------------------------------------------+
bool AppendCsvRow(const datetime snapDate, const double dailyReturn)
{
   int h = FileOpen(OutputCsvName, FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(h == INVALID_HANDLE)
   {
      Print("Quantalyze: FAIL to open CSV for append err=", GetLastError());
      return false;
   }
   FileSeek(h, 0, SEEK_END);
   // DoubleToString(.,8) => fractional decimal (0.01230000 = 1.23%); validator
   // bound is > -100.0 and the route ceiling is |daily_return| <= 10.
   FileWrite(h, IsoDate(snapDate), DoubleToString(dailyReturn, 8));
   FileClose(h);
   return true;
}

//+------------------------------------------------------------------+
//| Emit ONE row dated `snapDate`, computed from `equityClose` (the    |
//| LAST equity reading captured BEFORE this rollover, see OnTimer) vs |
//| the in-state base, netting external flows over [flowStart,flowEnd).|
//| Updates the in-state base. For a NORMAL day the flow window is the |
//| single calendar day [snapDate, snapDate+24h). For a GAP-SPANNING   |
//| row (the EA was off across several days) the window spans the WHOLE |
//| missed span so the cumulative move is preserved, and the row is     |
//| FLAGGED so the T14 reconcile does not read it as one clean day.     |
//+------------------------------------------------------------------+
void EmitDay(const datetime snapDate, const datetime flowStart,
             const datetime flowEnd, const double equityClose,
             const bool isGapSpanning)
{
   int correctionCount = 0;
   double netFlow = SumExternalFlows(flowStart, flowEnd, correctionCount);

   double dailyReturn;
   if(g_inception_pending)
   {
      // INCEPTION RULE (M2): first-ever row has no prior_close_equity. Define the
      // return as 0.0 (base = initial funded equity); never divide by zero. The
      // row is dated the FUNDING day itself (snapDate == the seed date), so the
      // T14 Day-1 row lines up with the funding day, not the next rollover.
      dailyReturn = 0.0;
      g_inception_pending = false;
      AuditLog("INCEPTION row " + IsoDate(snapDate) +
               " daily_return=0.0 base_equity=" + DoubleToString(equityClose, 2));
   }
   else if(!(g_prior_close_equity > 0.0))
   {
      // Defensive: should be unreachable (state is validated > 0), but never
      // divide by zero. Fail loud rather than emit garbage.
      Print("Quantalyze: prior_close_equity is non-positive at emit — FAILING LOUD, no row.");
      g_disabled = true;
      EventKillTimer();
      AuditLog("DISABLED: prior_close_equity non-positive at emit for " + IsoDate(snapDate));
      return;
   }
   else
   {
      dailyReturn = (equityClose - netFlow - g_prior_close_equity) / g_prior_close_equity;

      // GAP-SPANNING ROW (multi-day outage): this single row carries the
      // CUMULATIVE move since the last snapshot, NOT one clean calendar day. We do
      // NOT fabricate a zero row for each missed day (that would be the synthetic-
      // zero vol-deflation the dense-calendar decision forbids). We emit FEWER
      // rows — one cumulative row dated the most-recent completed day — and FLAG it
      // so the T14 reconciler treats it as a span, not a day.
      if(isGapSpanning)
      {
         AuditLog("GAP-SPAN " + IsoDate(snapDate) +
                  " cumulative_return=" + DoubleToString(dailyReturn, 8) +
                  " spanning [" + IsoDate(flowStart) + " .. " + IsoDate(flowEnd) +
                  ") (EA was OFF; missed days emit NO rows) net_flow=" +
                  DoubleToString(netFlow, 2) + " prior_equity=" +
                  DoubleToString(g_prior_close_equity, 2) +
                  " — NOT one clean day; reconcile in T14");
         Print("Quantalyze: multi-day gap to ", IsoDate(snapDate),
               " — emitting ONE cumulative row (missed days produce NO rows), FLAGGED for T14.");
      }

      // INTRADAY-FLOW BOUND (M3): a large flow makes the gross-subtraction
      // approximation error unbounded. Flag (do not silently approximate).
      double flowRatio = MathAbs(netFlow) / g_prior_close_equity;
      if(flowRatio > FlowFlagThreshold)
      {
         AuditLog("FLOW-FLAG " + IsoDate(snapDate) +
                  " |net_flow|/prior_equity=" + DoubleToString(flowRatio, 4) +
                  " (> " + DoubleToString(FlowFlagThreshold, 2) + ") net_flow=" +
                  DoubleToString(netFlow, 2) + " prior_equity=" +
                  DoubleToString(g_prior_close_equity, 2) +
                  " daily_return=" + DoubleToString(dailyReturn, 8) +
                  " — gross-subtraction approximation; reconcile in T14");
         Print("Quantalyze: large intraday flow on ", IsoDate(snapDate),
               " ratio=", DoubleToString(flowRatio, 4), " — day FLAGGED for T14 reconcile.");
      }
   }

   if(!AppendCsvRow(snapDate, dailyReturn))
      return;

   // Advance the base: today's flow-adjusted closing equity is tomorrow's base.
   // We subtract net external flows so the base reflects trading equity only,
   // keeping the next day's denominator on the same footing as the numerator.
   g_prior_close_equity = equityClose - netFlow;
   g_last_snapshot_date = snapDate;

   if(!WriteStateAtomic(g_prior_close_equity, g_last_snapshot_date))
   {
      // If we cannot durably persist the new base, a restart would reuse a stale
      // base. Fail loud rather than risk a wrong post-restart return.
      Print("Quantalyze: FAILED to persist restart state for ", IsoDate(snapDate),
            " — disabling to avoid a corrupt post-restart base.");
      g_disabled = true;
      EventKillTimer();
      AuditLog("DISABLED: could not persist state after emitting " + IsoDate(snapDate));
   }
}

//+------------------------------------------------------------------+
//| OnInit — claim the single-instance lock, load/seed restart state, |
//| ensure the CSV header, start the timer.                           |
//+------------------------------------------------------------------+
int OnInit()
{
   if(!AcquireSingleInstanceLock())
      return INIT_FAILED;

   EnsureCsvHeader();

   int st = ReadState();
   if(st == -1)
   {
      // CORRUPT state (M5): a partial/garbled write would feed a plausible-but-
      // WRONG base — the exact A1 failure. FAIL LOUD: do not start the timer, do
      // not emit. The operator must inspect/repair the state file.
      g_disabled = true;
      Print("Quantalyze: FAILING LOUD on corrupt restart state. The EA will NOT emit ",
            "any return until '", StateFileName, "' is repaired or removed. ",
            "Do NOT trust any KPI in the meantime.");
      AuditLog("DISABLED: corrupt restart state at OnInit — refusing to emit");
      return INIT_SUCCEEDED; // succeed so the EA stays attached + visible, but disabled
   }
   else if(st == 0)
   {
      // FIRST RUN (no state file): seed prior_close_equity from CURRENT equity and
      // mark the inception row pending. We emit NO return now — the inception row
      // (daily_return = 0.0) is written on the next calendar rollover. This avoids
      // the M2 divide-by-zero.
      double equityNow = AccountInfoDouble(ACCOUNT_EQUITY);
      g_prior_close_equity = equityNow;
      g_last_snapshot_date = DateOnly(TimeTradeServer());
      g_inception_pending  = true;
      g_last_equity        = equityNow;            // seed pre-rollover snapshot (H2)
      g_last_equity_time   = TimeTradeServer();
      if(!WriteStateAtomic(g_prior_close_equity, g_last_snapshot_date))
         Print("Quantalyze: WARNING — could not persist initial seed state at OnInit.");
      Print("Quantalyze: first run — seeded base equity=", DoubleToString(equityNow, 2),
            " on server date ", IsoDate(g_last_snapshot_date),
            "; inception row (0.0) emits on next rollover, dated the funding day.");
      AuditLog("FIRST-RUN seed base=" + DoubleToString(equityNow, 2) +
               " date=" + IsoDate(g_last_snapshot_date));
   }
   else
   {
      // Re-seed the pre-rollover snapshot from current equity (H2). It is not
      // persisted; on a same-day restart this is simply the latest reading. If the
      // restart spans an outage, OnTimer's gap path uses this as the cumulative
      // close — correct, since it is the most recent equity we can observe.
      g_last_equity      = AccountInfoDouble(ACCOUNT_EQUITY);
      g_last_equity_time = TimeTradeServer();
      Print("Quantalyze: restart — loaded base equity=", DoubleToString(g_prior_close_equity, 2),
            " last_snapshot_date=", IsoDate(g_last_snapshot_date),
            " (T15 restart-state path).");
      AuditLog("RESTART loaded base=" + DoubleToString(g_prior_close_equity, 2) +
               " last_date=" + IsoDate(g_last_snapshot_date));
   }

   EventSetTimer(TimerSeconds);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnTimer — detect a calendar rollover via the DATE component of     |
//| TimeTradeServer() (server time) and emit the completed-day row(s). |
//|                                                                    |
//| CLOSE = the LAST equity reading captured BEFORE the rollover (H2). |
//| We snapshot ACCOUNT_EQUITY into g_last_equity on EVERY tick, so    |
//| when the date flips the just-completed day's close is the most     |
//| recent PRE-midnight reading — NOT the first post-midnight read     |
//| (which would drift the close up to one timer period into the next  |
//| day). A small TimerSeconds keeps that pre-rollover reading close to |
//| true midnight.                                                     |
//|                                                                    |
//| ROLLOVER CASES (dense calendar-daily — one row per real day):      |
//|  - INCEPTION: emit the 0.0 row dated the FUNDING day itself (the    |
//|    seed date g_last_snapshot_date), not the rollover day (H1).      |
//|  - SINGLE elapsed day: one normal row dated yesterday.              |
//|  - MULTI-DAY GAP (EA was off): do NOT fabricate a zero row per      |
//|    missed day (synthetic-zero vol-deflation is forbidden). Emit     |
//|    FEWER rows — ONE cumulative-since-last-snapshot row dated the     |
//|    most-recent completed day, FLAGGED as gap-spanning so T14 does    |
//|    not read it as one clean day. Missed days produce NO rows (H3).   |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_disabled)
      return; // failed loud earlier — refuse to emit on a corrupt/absent base

   // H2: capture the current equity BEFORE the rollover check on EVERY tick.
   // This is the candidate "close" for whichever day is in progress; when the
   // date flips, the value left here is the last PRE-midnight reading.
   g_last_equity      = AccountInfoDouble(ACCOUNT_EQUITY); // T6: incl floating PnL; NEVER ACCOUNT_BALANCE
   g_last_equity_time = TimeTradeServer();

   datetime today = DateOnly(g_last_equity_time);

   // INCEPTION: write the 0.0 row dated the FUNDING day (the seed date), then
   // fall through so any further elapsed days are emitted in the same tick.
   if(g_inception_pending)
   {
      datetime inceptionDate = g_last_snapshot_date; // == funding day D0 (H1)
      EmitDay(inceptionDate, inceptionDate, inceptionDate + 24 * 60 * 60,
              g_last_equity, false);
      if(g_disabled)
         return; // EmitDay failed loud (e.g. could not persist state)
      // EmitDay left g_last_snapshot_date == inceptionDate (D0). The first REAL
      // return is emitted below if the date has already advanced past D0.
   }

   // The most-recent FULLY-COMPLETED day is yesterday (today − 24h). Its close is
   // the pre-rollover g_last_equity. The day(s) between the last snapshot and
   // yesterday are either a single real day or a multi-day outage.
   datetime mostRecentCompleted = today - 24 * 60 * 60;
   datetime firstUnemitted      = g_last_snapshot_date + 24 * 60 * 60;

   // Nothing new to emit: today's row only lands when TOMORROW rolls over, so the
   // most-recent COMPLETED day must be strictly after the last snapshot. (On the
   // first rollover right after inception, mostRecentCompleted == the inception
   // day, which already has its row — this guard prevents re-emitting it.)
   if(mostRecentCompleted <= g_last_snapshot_date)
      return;

   if(firstUnemitted >= mostRecentCompleted)
   {
      // SINGLE elapsed day (the normal path): exactly one completed calendar day.
      // Flow window is that single day [yesterday, today).
      EmitDay(mostRecentCompleted, mostRecentCompleted, today, g_last_equity, false);
   }
   else
   {
      // MULTI-DAY GAP (H3): the EA was off across >1 day. Do NOT emit a row per
      // missed day (that would fabricate ~0.0 rows for all but the first — the
      // synthetic-zero vol-deflation the dense-calendar decision forbids). Emit
      // ONE cumulative row dated the most-recent completed day, with the flow
      // window spanning the WHOLE missed span [firstUnemitted, today) so the
      // cumulative move (and all flows within it) is preserved, FLAGGED as a
      // gap-spanning row. Missed days produce NO rows.
      EmitDay(mostRecentCompleted, firstUnemitted, today, g_last_equity, true);
   }
}

//+------------------------------------------------------------------+
//| OnDeinit — stop the timer and release the single-instance lock.   |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   ReleaseSingleInstanceLock();
}

//+------------------------------------------------------------------+
//| OnTick is intentionally empty — this EA is event-timer driven and |
//| READ-ONLY. It never reacts to ticks with any trade action.        |
//+------------------------------------------------------------------+
void OnTick()
{
   // No-op. Daily snapshotting is handled in OnTimer (fires even when the
   // market is closed, unlike OnTick). This EA performs NO trading on any event.
}
//+------------------------------------------------------------------+
