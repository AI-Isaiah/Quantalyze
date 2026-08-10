# MT5 Multi-User Scaling — Cost Research

**All prices read 2026-08-08 unless otherwise stated. Prices change; re-verify before committing.**
Every figure below carries a URL. Anything I could not read on a vendor page is marked
**UNVERIFIED** or **NOT PUBLIC — requires sales contact**. Nothing is estimated silently;
where I compute a derived number from vendor rates I label it **[CALC]**.

FX assumption for all EUR→USD conversions: **1 EUR = 1.155182 USD**
(https://open.er-api.com/v6/latest/EUR, `time_last_update_utc` Sat 08 Aug 2026 00:02:31 UTC).

---

## 0. The constraint being priced

One MT5 terminal process = **one logged-in account at a time**. The `mt5linux` rpyc slave
shares a single `MetaTrader5` C-extension across all connections, so N concurrent users
requires N terminal processes or a managed provider. This is established, not re-derived.

Relevant repo seam (read-only inspection):
- `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/services/mt5_client.py`
  (483 lines) — `Mt5Client` exposes exactly `login`, `account_info`, `history_deals_get`,
  `order_check`, `close`, `restart`, `terminal_key`, plus `Mt5Session` (dataclass, line 457).
- `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/services/mt5_concurrency.py` (157 lines)
- `/Users/helios-mammut/claude-projects/quantalyze/deploy/mt5-gateway/railway-gateway.md` — current PRIMARY host template
- `/Users/helios-mammut/claude-projects/quantalyze/deploy/mt5-gateway/docker-compose.yml` — documented cheap-VPS fallback

**The "managed adapter ≈ one file" claim checks out.** The surface a managed provider must
satisfy is three read methods (`login` / `account_info` / `history_deals_get`) plus lifecycle.
That is a genuinely narrow seam.

---

## 1. Managed providers

### 1.1 MetaApi (metaapi.cloud) — the leading option

Rate card read from the JS-rendered pricing section at **https://metaapi.cloud/#pricing**
(scraped with a JS-capable renderer; plain fetch returns an empty shell), 2026-08-08.

**Cloud offering G2 (the default and recommended production tier):**

| Item | Price (verbatim) |
|---|---|
| Deployed (active) trading account hosting | **USD $0.012 per account per hour** |
| Account deployment (per start) | **USD $0.072 per trading account** |
| Undeployed (inactive) account hosting | **USD $0.00105 per account per hour** |
| Adding a trading account (one-off per unique account) | **USD $2.10 per unique account** |
| MetaApi API itself | **Free** |
| MetaStats API | **USD $0.001575 per account per hour** |
| CopyFactory API | USD $0.001575 per account per hour |
| Risk management API | USD $0.00315 per account per hour |
| Dedicated IP (IPv4) | USD $0.0063 per IP per hour |
| Dedicated frontend server | USD $0.0015 per account per hour |
| Extra MetaApi resource slot | USD $0.006 per resource slot per hour |
| Excessive failed add attempts | USD $0.105 per attempt |
| Trading account **replica discount** | **50%** |
| MT Manager API add-on | **USD $125 per MT server per month** |

**Cloud offering G1 (legacy / higher-cost tier):** deployed **USD $0.039376/account/hour**,
deployment **USD $0.23625**, undeployed $0.00105/hr, MetaStats **$0.1575/acct/hr**,
CopyFactory $0.1575/acct/hr. G1 is 3.3× G2 on hosting — **do not use G1**.
Per https://metaapi.cloud/docs/provisioning/api/account/createAccount/ the `regular`
reliability option is not offered for `cloud-g2`, i.e. G2 *is* the high-reliability tier.

**Independent confirmation of the headline number.** MetaApi's own cost estimator at
**https://metaapi.cloud/estimate-costs** (read 2026-08-08, Cloud G2, 24/7) returns verbatim:

> | Deployed (active) trading accounts hosting | USD $8.64 per account per month |
> | Total cost | USD $8.64 per deployed (active) account per month |

$8.64 = 720 h × $0.012. On a 730 h month it is **$8.76**. I use **$8.64** below because it is
MetaApi's own published monthly figure.

**Billing mechanics that change the answer — all verbatim from
https://metaapi.cloud/docs/client/faq/ (read 2026-08-08):**

- *"You will be charged for it only if API server is running (i.e. in deployed state).
  You can stop the API server any time."* → **billing is per deployed-hour, not per connected account.**
- ⚠️ ***"Please note that in current version you are billed for 6 hours each time you start
  your server."*** → **a 6-hour minimum charge per deployment.** This is the single most
  important line on the page and it caps how much duty-cycling can save.
- *"per-MT account uptime measured on production during trading session exceeds 99.5%"*
  (standard) / *"up to 99.96%"* (high reliability). **No public status page. No SLA except on
  the Business tier.**

**What "account" means for billing:** a *deployed* account-hour. An account you have added but
left undeployed costs $0.00105/hr ($0.77/month). Re-adding is protected:
*"We only charge once for each account added, even if multiple copies of the same account are
created. Additionally, no charges will be applied for re-creating an account within two billing
periods after its deletion"* (https://metaapi.cloud/estimate-costs).

**Demo vs live:** priced identically — the rate card has no demo/live split, and
https://metaapi.cloud/docs/provisioning treats *"both demo and live"* through the same
account-registration path.

**Investor (read-only) passwords: YES, billed identically, and explicitly recommended.**
From https://metaapi.cloud/docs/provisioning/api/account/createAccount/:
*"The password can be either investor password for read-only access or master password to
enable trading features."* And from https://metaapi.cloud/docs/metastats/faq/:
*"We recommend you to add your MT accounts to MetaApi using investor (read-only) password if
possible. This approach should work fine for most trade monitoring apps using MetaStats API."*
There is **no price difference** for investor vs master.

**Broker-agnostic:** yes — MetaApi runs its own headless terminals against any MT4/MT5 broker
server the user names. This is the same mechanism we run today, operated by them.

**Minimum commitment / subscription tier:**
- **Paid subscription** — features listed (*"Deploy as many trading accounts as you want to"*,
  *"Volume discounts"*, *"Dedicated API servers"*, *"Paid priority support channel option"*).
  ⚠️ **The monthly subscription fee is NOT rendered in the pricing-card markup I scraped.**
  Two independent web reads report **$30/month**, and the cost estimator's "Total" line adds
  **no** base fee (Total = $8.64 for 1 account). **Treat $30/mo as UNVERIFIED — confirm at
  signup.** I include it in the tables below as a conservative worst case; if it is actually $0
  the per-account figures at n=5 improve materially.
- **Business subscription** — *"Suitable for workloads larger than 250 trading accounts"*,
  *"Strict service-level agreement (SLA)"*. **NOT PUBLIC — requires sales contact.** The
  estimator states plainly: *"For workloads over 250 trading accounts, you may apply for a
  business subscription. Please contact us via online chat for details."*
- **No free tier is stated on the pricing page or FAQ.** Third-party sources mention a free
  usage tier and a signup bonus; **UNVERIFIED**.
- Prices are **excluding VAT/GST** (footnote 3 on the pricing page).

**Rate limits** (https://metaapi.cloud/docs/client/rateLimiting/): 6,000 credits/min per
application, scaled by deployed account count; *"One user can subscribe to more than 300
accounts on one server."*

**Entity / where the data lives:** HLC Cloud LLC (Wyoming) / MetaApi DMCC; API servers in
London and New York (per the pricing page region tabs and https://metaapi.cloud/docs/client/faq/).

---

### 1.2 Credible alternatives

| Provider | Price (read 2026-08-08) | Investor pwd | Broker-agnostic | Who holds credential |
|---|---|---|---|---|
| **MetaApi** | $0.012/acct/hr G2 → **$8.64/acct/mo** 24/7; 6h min per start; $2.10 one-off/acct | **Yes, documented + recommended** | Yes | MetaApi (UK+US servers) |
| **Tradesync** (tradesync.com/pricing) | **$6/mo per account (Readonly)**; $12/mo (Full) | **Yes** — `type: readonly`, `investor_mode` | Broker-server list, "any broker worldwide" | Tradesync (Ttech Solutions Ltd, HK) |
| **mtapi.io** | **$500/mo** (100 accts) · **$1,500/mo** (500) · **$3,000/mo** (3,000) · **$1,800/mo** on-premise unlimited | **NOT DOCUMENTED** — docs say only "password" | Yes (host+port) | Them, **or us on-premise** (`timurila/mt4rest` Docker) |
| **MT Connect API** (mtconnectapi.com) | **$0.01 per successful read**; first 1,000 calls free; min purchase $10 / 1,000 quota; failed reads free | **Yes, explicitly** | Claims 200 brokers | Them |
| **cTrader Open API** | **Free** (per ToS, help.ctrader.com/open-api/terms-of-use/) | **YES — real OAuth `accounts` view-only scope** | **cTrader brokers only** (~300 incl. IC Markets, Pepperstone, FxPro, Axi) | **Nobody — we never see a password** |
| **API2Trade** | €12/mo (1 acct) + €10/acct/mo extra; €549/mo Pro unlimited (MT4 *or* MT5); €949/mo Full Pro | Yes (per FAQ) | Yes | Them — ⚠️ see red flags |
| **MetaStats** | Not separable — $0.001575/acct/hr **on top of** a provisioned MetaApi account | Yes | via MetaApi | MetaApi |
| **MetaQuotes Web/Manager API** | **NOT PUBLIC — requires sales contact.** Brokers/banks only | n/a | n/a | n/a |
| **MQL5 VPS** | $15/mo (1mo) → $10/mo (12mo) — **one platform per subscription** | n/a | n/a | us |
| **Myfxbook API** | Account API free but *"any software you develop should be free"*; auth = user's Myfxbook email+password; history capped at last 50 txns | — | Curated list | ⛔ unusable commercially |
| Broker-native REST (OANDA, IG, Capital.com, Deriv, Saxo, IBKR) | Mostly free | Only **cTrader** and **Deriv** ship a true read-only scope | ⛔ **per-broker, not agnostic** | us |

**Notable per-provider caveats:**

- **Tradesync — cheapest transparent read-only price at $6/acct/mo (31% below MetaApi
  24/7).** But its ToS §13.2 reportedly forbids sublicensing/reselling the Service, which
  contradicts its own SaaS marketing. **Get written clarification before depending on it.**
- **MT Connect API** would be ~**$0.30/acct/mo** at one poll/day — an order of magnitude below
  everything else. But its docs page lists the **MT5 endpoint as "coming soon"** while the
  homepage claims MT5; no rate limits published, no status page, domain registered 2023.
  **Spike it, don't plan on it.**
- **mtapi.io on-premise at $1,800/mo unlimited** is the only managed-software option where
  **credentials never leave our infrastructure**. It breaks even against MetaApi 24/7 at
  ~208 accounts **[CALC]**, and against a packed VPS never. Its self-reported scale is small
  (~1,240 active accounts) and investor-password support is undocumented (likely works, since
  MT servers enforce investor read-only server-side, but that is inference).
- **⚠️ API2Trade — do not put user credentials here.** `api2trade.com` whois Creation Date is
  **2026-04-13** (under four months old), Wayback has zero snapshots, its status page holds
  ~5 hours of history, yet it claims *"10,000+ Active Accounts"*; the Imprint names Apex
  Vanguard Dynamics LLC at a known Sheridan WY mail-forwarding address while the FAQ names a
  different Cyprus entity.
- **cTrader Open API is the best security model in the survey and it is free** — the user
  OAuth-consents with a genuine view-only scope (*"View only access is given… performing
  trading operations will be impossible"*). Two caveats: Spotware must **approve our
  application** (human review — start early), and their ToS imposes a data-retention duty
  (personal data *"shall be removed after a maximum of 6 months following termination"*).
  It covers only the cTrader broker roster, so it is a **complement to**, not a replacement
  for, an MT5 path.
- **MetaQuotes offers no sanctioned third-party read path.** Every managed vendor is doing one
  of three things: running headless terminals with the investor password, having the user's
  own terminal push data out, or holding a broker-side Manager API licence. There is no fourth
  option.

---

## 2. Self-hosted fleet — resource requirements and infrastructure cost

### 2.1 What one MT5 terminal actually costs in resources

**MetaQuotes publishes NO explicit RAM/CPU/disk minimum.** This is a sourced refusal, not a
search gap. Verbatim from
https://www.metatrader5.com/en/terminal/help/start_advanced/installation (**DOCUMENTED**):

> *"The platform can run under Microsoft Windows 10/11. **Hardware requirements depend on
> specific platform use conditions** — load from running MQL5 applications, number of active
> instruments and charts, etc."*

Broker restatements of "2 GB RAM" contradict each other by up to 50× on disk (100 MB / 1 GB /
5 GB) and cite no MetaQuotes source — **ANECDOTAL, do not treat as authoritative**.

**MetaQuotes' own MQL5 VPS** (https://www.mql5.com/en/vps, **DOCUMENTED**) is the useful
vendor datapoint, both as a resource spec and as a price ceiling:
$15/mo (1 mo) · $13/mo (3 mo) · $10.83/mo (6 mo) · $10.00/mo (12 mo), *"Free trial period -
24 hours"*, and *"each trading platform receives enough resources on a virtual machine: **up to
3 GB of RAM, up to 16 GB of hard disk space and several CPUs** are allocated on demand."*
⚠️ It is **one platform per subscription** — not a packing option.
⚠️ https://www.mql5.com/en/vps/forex-plans still shows a stale 15/14/13/12.8 ladder;
the `/en/vps` figures are internally consistent with the advertised "up to 33% discount".

**Commercial forex-VPS "N terminals per plan" specs (DOCUMENTED — vendor marketing):**

| Vendor | Plan | Stated terminals | RAM | Price | Gross GB/terminal |
|---|---|---|---|---|---|
| ForexVPS.net | Core / Edge / Prime | 1–3 / 3–6 / 6+ | 4 / 6 / 8 GB | €35 / €52 / €70 | 1.33 / 1.00 / 1.33 |
| FXVM | Lite / Basic / Advanced | 1–2 / 3–4 / 4–6 | 1.5 / 2.5 / 4 GB | €22 / €31 / €44 | 0.75 / 0.63 / 0.67 |
| AccuWebHosting | Forex VPS 1–4 | ≤2 / ≤4 / ≤8 / 8+ | 1.5 / 3 / 4 / 8 GB | $7.99–$59.99 | 0.75 / 0.75 / 0.50 / 1.00 |
| VCCL | Mini→XL | 1–2 / 2–4 / 5–10 / 10–15 | 1 / 2 / 4 / 8 GB | — | 0.50 / 0.50 / 0.40 / 0.53 |

Median implied ≈ **0.67 GB gross per terminal**, range 0.40–1.33. Net of a 1.5–2 GB Windows
baseline, vendors are betting on **~250–700 MB per terminal**.
AccuWeb's *marginal* disk is the cleanest disk datum: (40−35)/2 = **2.5 GB/terminal**.
QuantVPS guidance (DOCUMENTED): *"Start with 2–4 GB of RAM for the first terminal, then add
1–2 GB for each additional terminal"* · *"Allocate 1 vCPU per active terminal"* (conservative).
DigiRDP (DOCUMENTED): *"2 GB Windows baseline + … 100-200 MB per MT5 chart"* ·
*"1 core per 2-3 active EAs (MT5)"*.

**Community measurements (ANECDOTAL):**
- **The best packing datum**, MQL5 forum #438447 (2022-12-21): a Ryzen 9 4900HS with **32 GB
  RAM** ran **25 MT5 terminals** with *"CPU utilised in 15% and RAM in 30%"*
  → ≈ **295 MB/terminal** after subtracting Windows.
- ⚠️ **The binding constraint on Windows is NOT RAM.** Same thread, MQL5 moderator: *"the
  technical limit set by the MetaTrader application is **32 terminals per computer session**…
  the practical maximum it is between **24-28**."* This was hit at 30% RAM / 15% CPU with
  ~22 GB unused. **Containerised Wine sidesteps this entirely — each container is its own
  session.**
- Per-terminal, 1 chart: *"both mt5 are using around 400-500 MB per terminal"* (MQL5 #386311);
  MT5 423.3 MB (MQL5 #353661).
- Tail risk (psyb0t/mt5-httpapi, DOCUMENTED): *"MT5 hoards loaded chart history… and does not
  give the memory back. **Deep history scraping can blow each terminal up to several
  gigabytes**."* ← directly relevant, since our workload *is* history scraping.

**Wine/Docker specifics** — our exact image, `gmag11/metatrader5_vnc:2.3`, measured via the
Docker Hub registry API and by decompressing all 15 layers (**DOCUMENTED, measured**):
compressed **1.688 GB (1.572 GiB)**, uncompressed **4.92 GB (4.58 GiB)**. Repo README:
*"container size is considerably bigger from about 600 MB to 4 GB"*.
⚠️ **The image does not contain MT5** — MT5 installs at runtime into the `/config` volume, so
the 4.58 GiB is Debian + Wine + Python + KasmVNC, living in a **shared overlayfs layer paid
once per host**. Marginal disk for container #2..N is the `/config` volume alone.
Multi-instance is officially just port+volume separation (repo owner, issue #3: *"You just need
to change exposed TCP port and volume to a different location so that they do not collide."*).
RAM per container: *"It's require at least 1gb ram per instance"* (issue #8) and *"Using just
one container, works fine for 2gb and 2 vCPUs"* (issue #10) — both **ANECDOTAL**.
`mt5linux` is alive (207★, last push 2026-08-04).
**Wine-vs-native RAM delta: UNVERIFIED** — no primary measurement found.

**Planning figures used below [CALC, from the above]:**

| Quantity | Low | **Planning** | High |
|---|---|---|---|
| RAM per containerised terminal | 1.0 GB | **1.5 GB** | 2.0 GB |
| vCPU per terminal | 0.15 | **0.20–0.25** | 0.30 (1.0 if you follow vendor guidance) |
| Disk (`/config`) per terminal | 1.5 GB | **3 GB** | 10–20 GB with deep history |
| Host reserve per box | — | **2 GB** | — |

I use **1.5 GB/terminal** rather than the measured ~350 MB because the unit here is a *container*
(Debian + Wine + KasmVNC + terminal), not a bare terminal, and because our workload is history
scraping — the documented memory-hoarding path.

### 2.2 Railway (our current provider)

https://railway.com/pricing, read 2026-08-08 — rates are quoted **per second**:

| Resource | Published rate | **Per month (730 h = 2,628,000 s) [CALC]** |
|---|---|---|
| Memory | $0.00000386 per GB / second | **$10.14 per GB-month** |
| CPU | $0.00000772 per vCPU / second | **$20.29 per vCPU-month** |
| Volumes | $0.00000006 per GB / second | **$0.158 per GB-month** |
| Egress | **$0.05 per GB** (services) | — |
| Object storage | $0.015 per GB-month, free egress | — |

Plans: Free $0 (+$1 credits) · Hobby $5/mo (incl. $5 credits) · **Pro $20/mo per workspace
(incl. $20 credits)** · Enterprise custom. **No per-service subscription charge** — billing is
consumption-based beyond the included credits. Pro service ceiling: *"Up to 1,000 vCPU / 1 TB
per service, 42 replicas."*

Railway bills **measured usage**, not allocation — so the terminal profile drives cost directly:

| Profile | RAM / vCPU / volume | **Cost per always-on terminal [CALC]** |
|---|---|---|
| Low | 1.0 GB / 0.15 / 3 GB | **$13.66 / month** |
| **Planning** | **1.5 GB / 0.20 / 5 GB** | **$20.06 / month** |
| High | 2.0 GB / 0.30 / 10 GB | **$27.95 / month** |

The existing Pro $20/mo workspace is already paid for the analytics worker, so the incremental
subscription cost of the fleet is $0; egress is negligible for a polling workload but is
$0.05/GB if it grows.

⚠️ **Railway is the worst option in this study: ~$20/terminal/month is 2.3× MetaApi's $8.64,
for strictly more operational work.** Its one virtue is that the RPyC channel never leaves
Railway's internal mesh (no Tailscale tunnel), which is exactly why `railway-gateway.md` names
it PRIMARY for the *single*-terminal case. That rationale does not survive contact with a fleet.

### 2.3 Packed VPS

**Hetzner raised prices twice in 2026** — official notice: *"The price adjustment applies to new
orders and cloud instance rescales starting from 15 June 2026, 8 AM CEST"*
(https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).
Any pre-mid-2026 Hetzner cost assumption is invalid. Included traffic collapsed from 20 TB to
**0.5 TB**, then €1.00 per extra TB in the EU.

Best-value-per-GB-RAM comparison (**the binding constraint is RAM**):

| Option | Config | Price/mo | **€/GB-RAM/mo** |
|---|---|---|---|
| **Contabo Cloud VPS 18** | 18 vCPU / **96 GB** / 600 GB SSD, 1 Gbit unlimited | **€49.00 net** (€39.20 on 24 mo) | **0.51 (0.41)** ← best |
| Contabo Cloud VPS 12 | 12 vCPU / 48 GB / 400 GB | €25.00 net (€20.00 on 24 mo) | 0.52 (0.42) |
| Contabo Cloud VPS 6 | 6 vCPU / 12 GB / 200 GB | €7.50 net (€6.00 on 24 mo) | 0.63 (0.50) |
| Hetzner AX41-1-LTD (dedicated) | Ryzen 5 3600 / 64 GB / 2×512 GB NVMe, **€0 setup** | €57.30 ex-VAT | 0.90 |
| Hetzner CX53 (cloud) | 16 vCPU / 32 GB / 320 GB | €29.49 ex-VAT | 0.92 |
| Hetzner CCX33 (dedicated vCPU) | 8 / 32 GB | €138.49 ex-VAT | 4.33 |
| Hetzner Server Auction, cheapest/GB read today | 64 GB, i7-6700 | €60.70 | 0.95 |

Sources: https://contabo.com/en/vps/ (configurator confirms *"No Setup Fee"* and that listed
prices are **net** — checkout shows *"€23.80 = €20.00 + 19% VAT"*); Hetzner official price table
at https://docs.hetzner.com/ (*"All prices are excluding VAT"*, excludes the €0.50/mo primary
IPv4); https://www.hetzner.com/sb/ (*"All without setup fees by the way"*). All read 2026-08-08.

**Contabo is ~2.2× better than Hetzner's best on €/GB.** Trade-off: shared/oversubscribed vCPU,
and the headline rate needs a 24-month term. Given MT5's measured 0.15–0.25 vCPU/terminal that
is an acceptable bet, but **validate CPU steal on a single box before committing to a term**.
I price **monthly billing (no lock-in)** in the tables below; the 24-month rate is 20% cheaper.

**Packing [CALC]** — at 1.5 GB/terminal, 0.25 vCPU/terminal, 3 GB disk/terminal, 2 GB host reserve:

| Box | Fits (RAM-bound) | vCPU allows | Disk allows | **Planning capacity** |
|---|---|---|---|---|
| Contabo VPS 6 (12 GB) | 6 | 24 | 66 | **6** |
| Contabo VPS 12 (48 GB) | 30 | 48 | 133 | **30** |
| Contabo VPS 18 (96 GB) | 62 | 72 | 200 | **50** (derated from 62 for headroom) |

The Windows 24–28-terminals-per-session ceiling **does not apply** — each Docker container is
its own session under Wine. This is a real and underrated advantage of the Wine path.

### 2.4 Windows licensing — the reason to stay on Wine

| Provider | Config | Windows surcharge/month |
|---|---|---|
| **Hetzner Cloud** | any | **NOT OFFERED — BYOL only** |
| Hetzner dedicated | Standard, 8 / 16 cores | €27.90 / €55.90 ex-VAT |
| Hetzner dedicated | **Datacenter**, 8 cores | €173.40 ex-VAT |
| **Contabo VPS** | 4 / 8 / 12 / 18 vCPU | **€8 / €28 / €53 / €77** net |
| OVHcloud VPS (DE) | 4 / 6 / 8 vCore | €8 / €17 / €28 ex-VAT |
| Vultr | 2 / 4 vCPU | $32 / $64 |
| AWS t3.medium / m5.large | 2 vCPU | $13.43 / $67.16 per month [CALC, ×730 h] |

Sources: https://docs.hetzner.com/robot/general/pricing/windows-2025-pricing ·
https://docs.hetzner.com/cloud/servers/windows-on-cloud/ · Contabo configurator ·
https://www.vultr.com/servers/windows. Read 2026-08-08.
Microsoft **SPLA per-core rate card: UNVERIFIED** — Microsoft directs to resellers and does not
publish it. RDS CAL pricing: **UNVERIFIED**; hoster Windows add-ons generally exclude RDS CALs.

⚠️ Two structural findings:
1. **Hetzner Cloud — the cheapest compute in this study — cannot legally run Windows at all**
   without your own Software-Assurance-covered licence. Microsoft Product Terms (Universal
   License Terms): customers may not *"use the Products to offer commercial hosting services to
   third parties"*; only the **Flexible Virtualization Benefit** permits *"licensed copies… on
   devices, including shared Servers, that are under the day-to-day management and control of
   Authorized Outsourcers"*, and that requires **subscription licences or active SA**. A plain
   licence with no SA **cannot** legally be BYOL'd onto a shared VPS.
2. Contabo and OVHcloud DE land on **identical** €8/€17/€28 for 4/6/8 vCPU — two unrelated EU
   hosters passing through the same SPLA rate card. Treat that as the effective European floor.

**Conclusion: Wine-on-Linux avoids €8–€77/month/box of Windows licensing and unlocks the
cheapest hosts entirely.** The trade-off is Wine flakiness — and note MetaQuotes explicitly
carved Wine out of its Windows-7/8 EOL (*"The only exception is platforms running under Wine"*,
build 5320, 25 Sep 2025), which is a meaningful signal that Wine is a supported-in-practice
target rather than a hack.

---

## 3. Scenario table

**Assumptions stated once:** MetaApi = Cloud G2, high reliability, **24/7 deployed**, at its own
published $8.64/account/month, plus an **UNVERIFIED $30/month subscription** (conservative — if
it is $0, subtract $30 from each row). The one-off $2.10/account onboarding fee is excluded
from the monthly run-rate and called out separately. Self-hosted rows use 1.5 GB RAM /
0.25 vCPU / 3 GB disk per terminal. VPS rows use **monthly-billed** Contabo (no 24-month lock)
converted at 1.1552 USD/EUR, **+15% for backups and a control node**. All USD/month.

| Accounts | (a) **MetaApi** (24/7) | (b) **Railway fleet** | (c) **Packed VPS (Contabo)** |
|---|---|---|---|
| **5** | **$73.20** — $14.64/acct | **$100.30** — $20.06/acct | 1× VPS 6 → **$9.96** — **$1.99/acct** |
| **25** | **$246.00** — $9.84/acct | **$501.50** — $20.06/acct | 1× VPS 12 → **$33.21** — **$1.33/acct** |
| **100** | **$894.00** — $8.94/acct | **$2,006.00** — $20.06/acct | 2× VPS 18 → **$130.19** — **$1.30/acct** |
| **500** | ⚠️ **NOT PUBLIC** — >250 requires a Business subscription (contact sales). *List-rate extrapolation only:* $4,350.00 — $8.70/acct | **$10,030.00** — $20.06/acct | 10× VPS 18 → **$650.95** — **$1.30/acct** |

**MetaApi duty-cycled variants [CALC from published rates, incl. the 6-hour minimum]:**

| Sync cadence | Deployed h/mo | **$/account/month** | vs 24/7 |
|---|---|---|---|
| 24/7 always-on | 730 | **$8.64** | — |
| Nightly (30.4 starts × 6 h min) | 182 | **$4.95** | −43% |
| Weekly (4.35 starts × 6 h min) | 26 | **$1.37** | −84% |

⚠️ The 6-hour minimum is what makes nightly only a 43% saving rather than the ~95% a
minutes-long sync would otherwise imply. Two consequences:
- **Weekly duty-cycling ($1.37/acct/mo) is cost-competitive with a packed VPS ($1.30/acct/mo)
  with zero ops burden.** This is the most interesting number in the study.
- **Every wizard-time account validation costs $0.072 + 6 h × $0.012 = $0.144.** A user who
  retries a bad password ten times costs $1.44. Budget for it, and rate-limit it.

### Break-even

- **Railway is dominated at every scale** — it never beats MetaApi and never beats a VPS.
  There is no crossover; it is strictly worse. **Eliminate it as a fleet option.**
- **Packed VPS beats MetaApi 24/7 on pure infrastructure at every scale, including n=5.**
  There is **no infrastructure crossover point.** The saving is $63/mo at 5 accounts, $213/mo at
  25, $764/mo at 100 and $3,699/mo at 500.
- Therefore **the break-even is entirely an engineering-cost break-even, not an infra one.**
  At $7.34/account/month saved, a self-hosted fleet must earn back its build:

  | Build cost valued at | Break-even in account-months | = 100 accts for | = 500 accts for |
  |---|---|---|---|
  | $0 (founder time, no cash out) | immediate | immediate | immediate |
  | ~3 weeks at contractor rates (~$8,000) | ~1,090 | ~11 months | ~2.2 months |
  | ~6 weeks (~$16,000) | ~2,180 | ~22 months | ~4.4 months |

  Plus ongoing ops, which never stops. **Below ~100 concurrent accounts the infra saving does
  not pay for the ops burden. Above ~250 it clearly does** — and that is conveniently the exact
  point where MetaApi's public pricing runs out.

---

## 4. The costs that are not infrastructure

### 4.1 Engineering effort

**Managed adapter (MetaApi or Tradesync): ≈ 1 file + tests.** Verified against the code —
`Mt5Client` (`analytics-service/services/mt5_client.py`) exposes only `login`, `account_info`,
`history_deals_get`, `order_check`, `close`, `restart`, `terminal_key`. A managed adapter needs
three of those. Realistic: **3–5 days** including deal-shape parity tests against the existing
golden fixtures (`tests/test_mt5_golden_fixtures.py`, `test_mt5_deal_reconstruction.py`) and a
flag-gated rollout in the established pattern. **Ongoing ops ≈ near zero** — no supervision, no
Wine, no terminal updates. You inherit MetaApi's 99.5%/99.96% instead of owning uptime.

**Self-hosted fleet: a genuine subsystem, not a config change.** New work that does not exist today:
- **Orchestration / placement** — N containers across M boxes, account→terminal assignment,
  rebalancing when a box fills. Today `mt5_concurrency.py` serialises *everything* through one
  gateway lock; a fleet needs per-terminal locks, a registry, and a scheduler.
- **Supervision and restart-on-wedge.** The repo already documents that a bare TCP-connect check
  on the RPyC bridge is **false-green** (`mt5linux-constraint.txt`, three distinct failure modes
  discovered 2026-07-25). Per-terminal *semantic* health probes are mandatory, ×N.
- **Terminal auto-updates.** From our own runbook: *"The MetaTrader terminal binary self-updates
  from the broker independently of this image and CANNOT be frozen — only the image tag+digest
  is pinnable."* With N terminals across M brokers, you get **N independent uncontrolled update
  events**, each a potential parity break, and the only detector is a soak window.
- **Wine flakiness + the memory-hoarding tail** (*"deep history scraping can blow each terminal
  up to several gigabytes"*) → you need per-container memory caps and recycling, or one greedy
  account OOMs its box-mates.
- **Networking.** Off-Railway means the Tailscale/WireGuard tunnel the repo already documents as
  the VPS-fallback requirement — plus the standing hard constraint that the **unauthenticated
  RPyC channel must never touch a public interface**, now enforced across M boxes instead of one.
- **Broker IP allowlisting.** Egress IP per box; some brokers allowlist. M boxes = M IPs to
  register. (We already carry this pain with the Railway 3-IP rotation.)
- **Capacity/billing plumbing**, backups of M `/config` volumes, and a 24-month Contabo term
  decision.

Honest range: **3–6 weeks to build**, then **~4–8 h/month steady-state ops**, spiking on every
broker-side terminal update. That ops load is *per-fleet*, not per-account — which is precisely
why it only pays off at scale.

### 4.2 Who holds the broker credential — likely decisive

| Option | Who holds the user's MT5 investor password |
|---|---|
| **Self-hosted (today, and any fleet)** | **Quantalyze only.** Credential goes user → our DB → our terminal. One custodian. |
| **MetaApi / Tradesync / mtapi.io cloud / MT Connect** | **Quantalyze *and* a third party.** We collect it and forward it to a vendor that stores it to drive its own headless terminals — MetaApi's on servers in the **UK and US** (HLC Cloud LLC, Wyoming / MetaApi DMCC). |
| **mtapi.io on-premise ($1,800/mo)** | Quantalyze only — vendor ships software, not hosting. |
| **cTrader Open API** | **Nobody.** OAuth view-only scope; **no password ever exists in our system.** |

Name it plainly: **choosing a managed MT5 provider means a third party custodies your customers'
broker credentials.** Concrete consequences:
- A **sub-processor** under GDPR — requires a DPA, disclosure in the privacy policy, and a
  transfer mechanism for the US leg. Our repo is public and our compliance posture is already
  documented; this is an addition to it, not a footnote.
- **Blast radius**: a MetaApi breach exposes every Quantalyze MT5 user at once, and we would
  learn about it from them. We have no visibility and no compensating control.
- **Investor passwords are read-only server-side**, which genuinely caps the damage to data
  disclosure rather than fund loss — that is the mitigating fact, and it is a real one. But
  MetaApi accepts master passwords through the same field, so the control is *our* discipline,
  not an enforced boundary.
- ⚠️ **Institutional/professional users may simply refuse.** Quantalyze's positioning is
  verified track records for allocators; "we forward your broker credentials to a third-party
  US/UK vendor" is a question that will be asked in diligence. **This can be decisive regardless
  of price** — and it points the other way from the $7.34/account/month infra saving, since
  self-hosting is the *better* answer on custody.

### 4.3 Vendor lock-in and exit cost

**Lock-in is genuinely low, and this is the strongest argument for starting managed.** The
`Mt5Session` seam means MetaApi is an implementation of an interface we already own; there is no
data model to migrate (dailies remain canonical in our own Postgres) and no proprietary format.
**Exit cost ≈ the cost of building the self-hosted fleet you deferred, minus nothing** — you do
not pay a penalty for having gone managed first, you simply pay later what you would have paid
now, and you keep the option open the whole time.

Two real exit frictions:
1. **Credential re-collection.** If MetaApi holds the passwords, migrating off means either
   exporting them (check whether their API even permits credential read-back — **UNVERIFIED**)
   or **asking every user to re-enter their investor password**. At 500 users that is a
   material churn event. **Mitigation: keep the credential of record in our own encrypted store
   and treat MetaApi as a write-only sink.** Do this from day one; it costs nothing now and
   removes the only sharp edge in the exit.
2. **The >250-account cliff.** Public pricing stops at 250. Above that we are in an unpriced
   negotiation with a vendor that knows we are already integrated. **This is asymmetric and it
   arrives exactly when we are least able to move.**

---

## 5. Bottom line

**Recommendation: build the MetaApi adapter now; do not build a self-hosted fleet yet; plan the
fleet as the deliberate exit at ~250 accounts.**

Reasoning:
1. **Railway is eliminated on the numbers.** $20.06/terminal/month is 2.3× MetaApi and 15× a
   packed VPS, for strictly more work. Whatever happens, the fleet does not live on Railway.
2. **The infra saving from self-hosting is real but small in absolute terms until ~100
   accounts** — $63/mo at 5, $213/mo at 25. That does not buy 3–6 weeks of build plus permanent
   ops. At 5–25 accounts, engineering time is the scarce resource and MetaApi converts it to
   cash at a rate we can afford.
3. **The seam makes this cheap to reverse.** ~1 file, no data migration, no proprietary format.
   Starting managed costs us almost nothing in optionality — provided we keep the credential of
   record in our own store and never let MetaApi become the only copy.
4. **Duty-cycling is the lever, not the provider.** Our workload is a periodic sync, not live
   streaming. Nightly = $4.95/acct/mo, weekly = $1.37 — the latter matching a packed VPS
   outright. Design the sync cadence deliberately and the managed option stays cheap far longer
   than the headline $8.64 suggests. Rate-limit wizard validation, which costs $0.144 per attempt.
5. **Plan the exit at 250, not at 500.** MetaApi's public pricing stops at 250 accounts; above
   it we negotiate from a weak position. Building the fleet should be *scheduled* work triggered
   at ~150–200 accounts, not emergency work triggered at 250.

**Secondary recommendation:** start the **cTrader Open API** approval in parallel. It is free,
it is the only option where we never custody a password, and Spotware's approval is a human
review with lead time. It does not replace MT5 — it covers a different (large) broker roster —
but it is the strictly-better model wherever it applies.

### The single factor most likely to change this

**Credential custody.** Every cost conclusion above says "go managed"; the custody analysis says
the opposite. If an early institutional prospect, an allocator's diligence questionnaire, or
counsel says that forwarding customer broker credentials to a third-party US/UK processor is
unacceptable, then **price stops being the deciding variable entirely** and the self-hosted
Contabo fleet becomes mandatory at any scale — at which point the $7.34/account/month saving is
a bonus rather than the reason. That question is answerable today, cheaply, by asking one
prospective client — and it should be answered **before** the adapter is written, because it
determines whether the adapter is the destination or a way-station.

Runner-up factor: **the unpriced Business tier**. If MetaApi's >250 pricing comes back with
meaningful volume discounts, the managed option extends comfortably past 500 and the fleet may
never need to be built. If it comes back flat or worse, the exit date moves earlier.

---

## Appendix — what I could not verify

| Item | Status |
|---|---|
| MetaApi paid-subscription monthly fee ($30?) | **UNVERIFIED** — not rendered in the pricing-card markup I scraped; corroborated by two secondary reads; estimator "Total" adds no base fee. Confirm at signup. |
| MetaApi free tier | **UNVERIFIED** — not stated on the pricing page or FAQ; asserted by third parties |
| MetaApi Business subscription (>250 accounts) | **NOT PUBLIC — requires sales contact** (their own words) |
| MetaApi credential read-back / export on exit | **UNVERIFIED** |
| MetaQuotes MT5 terminal RAM/CPU/disk minimums | **Do not exist** — MetaQuotes explicitly declines to state them (sourced) |
| Wine-vs-native MT5 RAM delta | **UNVERIFIED** — no primary measurement found |
| Populated `/config` volume size for gmag11 image | **UNVERIFIED** — container not run |
| Microsoft SPLA per-core rate card; RDS CAL pricing | **UNVERIFIED** — Microsoft does not publish; directs to resellers |
| MetaQuotes Web/Manager API pricing | **NOT PUBLIC — requires sales contact**; brokers/banks only |
| mtapi.io investor-password support | **NOT DOCUMENTED** — inference only |
| MT Connect API MT5 availability | **CONTRADICTORY** — homepage claims MT5, docs say "coming soon" |
| Tradesync ToS §13.2 resale restriction | **Reported, needs written clarification from vendor** |
| Reddit community RAM reports | **UNCOVERED** — search tooling blocks reddit.com |
| Contabo real-world CPU steal under 50 containers | **UNVERIFIED** — must be measured on one box before a 24-month term |
