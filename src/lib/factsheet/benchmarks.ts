import type { DailyPrice } from "./types";
import btcDaily from "./data/btc-daily.json";
import spxDaily from "./data/spx-daily.json";
import ethDaily from "./data/eth-daily.json";
import gldDaily from "./data/gld-daily.json";
import iefDaily from "./data/ief-daily.json";

/**
 * Bundled benchmark price series. Sourced from Yahoo Finance daily closes,
 * covering 2023-04-26 onwards. The mockup generator's `/tmp/btc_daily.csv`
 * and `/tmp/spx_daily.csv` are the upstream snapshot.
 *
 * Strategy returns observed outside this window are silently clipped to the
 * overlap by the payload builder — the chart still renders, just over the
 * window where comparator data exists. Extending coverage is a follow-on
 * (either expand the static fixture or add a server-side fetcher).
 */
export const BTC_DAILY: DailyPrice[] = btcDaily as DailyPrice[];
export const SPX_DAILY: DailyPrice[] = spxDaily as DailyPrice[];
export const ETH_DAILY: DailyPrice[] = ethDaily as DailyPrice[];
export const GLD_DAILY: DailyPrice[] = gldDaily as DailyPrice[];
export const IEF_DAILY: DailyPrice[] = iefDaily as DailyPrice[];

export const BENCH_START = BTC_DAILY[0]?.date ?? null;
export const BENCH_END = BTC_DAILY[BTC_DAILY.length - 1]?.date ?? null;
