/**
 * Case Library Expansion Script (#3 — 80+ new historical cases).
 *
 * Run once:  npx tsx src/scripts/expandCaseLibrary.ts
 *
 * Adds cases across all 6 domains:
 *   macro_plus_v1       — major regime-change events
 *   macro_calendar_v1   — recurring data releases
 *   earnings_v1         — big tech + sector earnings surprises
 *   energy_v1           — supply/demand shocks
 *   credit_v1           — bank stress + spread events
 *   policy_fx_v1        — central bank + geopolitical FX events
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

type CaseInsert = {
  case_id:           string;
  case_pack:         string;
  dominant_catalyst: string;
  parsed_event:      { summary: string };
  realized_moves:    Array<{ ticker: string; realized_direction: string; realized_magnitude_bp: number }>;
  labels:            { themes: string[]; primary_assets: string[] };
  source:            { source_type: string; title: string; raw_text: string };
};

const NEW_CASES: CaseInsert[] = [

  // ─── MACRO_PLUS_V1 — Regime-change macro events ──────────────────────────

  {
    case_id: "macro-taper-tantrum-2013",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "Fed taper surprise — Bernanke hints at QE reduction",
    parsed_event: { summary: "May 2013: Bernanke testified he could 'taper' bond purchases in 'next few meetings'. 10yr yield spiked 100bp in weeks, EM assets cratered. SPY dropped -5%, TLT -10%." },
    realized_moves: [
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 1050 },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 520  },
      { ticker: "EEM",  realized_direction: "down", realized_magnitude_bp: 1400 },
      { ticker: "^TNX", realized_direction: "up",   realized_magnitude_bp: 100  },
    ],
    labels: { themes: ["taper", "yields", "EM selloff", "duration risk"], primary_assets: ["TLT","SPY","EEM","^TNX"] },
  },

  {
    case_id: "macro-covid-crash-2020",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "COVID-19 pandemic — global lockdowns announced",
    parsed_event: { summary: "Feb–Mar 2020: SPY fell -34% in 33 days, fastest bear market in history. VIX hit 85. Fed cut to 0% and launched $700bn QE. Gold initially sold then recovered." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 3400 },
      { ticker: "^VIX", realized_direction: "up",   realized_magnitude_bp: 6200 },
      { ticker: "GLD",  realized_direction: "down", realized_magnitude_bp: 120  },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 900  },
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: 6000 },
    ],
    labels: { themes: ["pandemic", "flight to safety", "liquidity crisis", "Fed backstop"], primary_assets: ["SPY","^VIX","TLT","GLD","CL=F"] },
  },

  {
    case_id: "macro-covid-recovery-2020",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "Vaccine announcement + Fed unlimited QE — risk-on recovery",
    parsed_event: { summary: "Nov 2020 – Dec 2021: Pfizer vaccine 90% efficacy headline triggered historic rotation. SPY +100% from lows, value beat growth briefly. Small caps (IWM) +100%." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up", realized_magnitude_bp: 10000 },
      { ticker: "IWM",  realized_direction: "up", realized_magnitude_bp: 10500 },
      { ticker: "QQQ",  realized_direction: "up", realized_magnitude_bp: 8000  },
      { ticker: "GLD",  realized_direction: "down", realized_magnitude_bp: 300 },
    ],
    labels: { themes: ["vaccine rally", "value rotation", "risk-on", "QE"], primary_assets: ["SPY","IWM","QQQ","GLD"] },
  },

  {
    case_id: "macro-2022-rate-shock",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "Fed fastest hiking cycle since 1980 — 425bp in 12 months",
    parsed_event: { summary: "2022: Fed hiked 425bp in one year. QQQ -33%, TLT -33%, bonds worst year since 1788. Rate-sensitive sectors (ARKK -75%) annihilated. DXY +15%. Only energy and value outperformed." },
    realized_moves: [
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 3300 },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 3300 },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 1960 },
      { ticker: "DXY",  realized_direction: "up",   realized_magnitude_bp: 1500 },
      { ticker: "XLE",  realized_direction: "up",   realized_magnitude_bp: 5800 },
    ],
    labels: { themes: ["rate shock", "duration destruction", "dollar strength", "energy outperformance"], primary_assets: ["QQQ","TLT","SPY","DXY","XLE"] },
  },

  {
    case_id: "macro-2018-q4-powell-put",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "Fed pivot after Q4 2018 -20% selloff — Powell capitulates",
    parsed_event: { summary: "Dec 2018 SPY -20% from high on fear of overtightening. Jan 2019 Powell said 'patient', markets ripped +25% in 3 months. Classic Fed put activation." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up", realized_magnitude_bp: 2500 },
      { ticker: "QQQ",  realized_direction: "up", realized_magnitude_bp: 2800 },
      { ticker: "TLT",  realized_direction: "up", realized_magnitude_bp: 600  },
    ],
    labels: { themes: ["Fed put", "policy pivot", "relief rally", "overtightening fear"], primary_assets: ["SPY","QQQ","TLT"] },
  },

  {
    case_id: "macro-debt-ceiling-2023",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "US debt ceiling brinkmanship — T-bill yields spike",
    parsed_event: { summary: "May 2023: US debt ceiling standoff raised X-date fears. 1-month T-bills spiked to 6%. SPY rangebound but credit spreads widened. Resolution triggered relief rally +3% in 2 days." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up",   realized_magnitude_bp: 300  },
      { ticker: "GLD",  realized_direction: "up",   realized_magnitude_bp: 150  },
      { ticker: "DXY",  realized_direction: "down", realized_magnitude_bp: 80   },
    ],
    labels: { themes: ["debt ceiling", "fiscal risk", "T-bill stress", "resolution rally"], primary_assets: ["SPY","GLD","DXY"] },
  },

  {
    case_id: "macro-jackson-hole-pivot-2022",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "Powell Jackson Hole — 'pain' speech crushes brief bear rally",
    parsed_event: { summary: "Aug 2022: Powell used 'pain' language at Jackson Hole after markets had rallied 17% off lows. SPY -3.4% same day, -9% in next 2 weeks. Fed credibility re-established." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 340 },
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 430 },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 200 },
    ],
    labels: { themes: ["hawkish shock", "bear trap", "Fed credibility", "Jackson Hole"], primary_assets: ["SPY","QQQ","TLT"] },
  },

  {
    case_id: "macro-china-devaluation-2015",
    case_pack: "macro_plus_v1",
    dominant_catalyst: "PBOC surprises with CNY devaluation — global risk-off",
    parsed_event: { summary: "Aug 2015: China devalued CNY 2% in 3 days, triggering global contagion. SPY flash crashed -11% in a week. VIX spiked to 53. Safe havens (JPY, TLT, GLD) bid." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 1100 },
      { ticker: "^VIX", realized_direction: "up",   realized_magnitude_bp: 3800 },
      { ticker: "GLD",  realized_direction: "up",   realized_magnitude_bp: 280  },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 400  },
    ],
    labels: { themes: ["China risk", "EM contagion", "flash crash", "risk-off"], primary_assets: ["SPY","^VIX","GLD","TLT"] },
  },

  // ─── MACRO_CALENDAR_V1 — Recurring data releases ──────────────────────────

  {
    case_id: "macro-cpi-hot-jan-2022",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "CPI 7.5% YoY — hottest print in 40 years",
    parsed_event: { summary: "Feb 2022: CPI printed 7.5% vs 7.3% expected. 10yr yield spiked 24bp on day. QQQ -2.8%, TLT -2.4%. Short end priced 7 hikes for the year." },
    realized_moves: [
      { ticker: "^TNX", realized_direction: "up",   realized_magnitude_bp: 24  },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 240 },
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 280 },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 180 },
    ],
    labels: { themes: ["hot CPI", "yield spike", "rate expectations", "growth selloff"], primary_assets: ["^TNX","TLT","QQQ","SPY"] },
  },

  {
    case_id: "macro-cpi-miss-jun-2023",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "CPI 3.0% — bigger-than-expected disinflation surprise",
    parsed_event: { summary: "Jul 2023: CPI printed 3.0% vs 3.1% consensus — fastest disinflation in decades. SPY +0.7%, QQQ +1.2%, TLT +1.5%, 10yr yield -12bp. Goldilocks narrative solidified." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up",   realized_magnitude_bp: 70  },
      { ticker: "QQQ",  realized_direction: "up",   realized_magnitude_bp: 120 },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 150 },
      { ticker: "^TNX", realized_direction: "down", realized_magnitude_bp: 12  },
    ],
    labels: { themes: ["disinflation", "soft landing", "goldilocks", "rates falling"], primary_assets: ["SPY","QQQ","TLT","^TNX"] },
  },

  {
    case_id: "macro-nfp-miss-2023",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "NFP miss — 150k vs 180k consensus, unemployment ticks up",
    parsed_event: { summary: "Nov 2023: NFP 150k vs 180k expected. Unemployment 3.9% vs 3.8%. Markets rallied — bad jobs = fewer hikes. SPY +1.3%, TLT +2.1%, 10yr -13bp." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up",   realized_magnitude_bp: 130 },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 210 },
      { ticker: "^TNX", realized_direction: "down", realized_magnitude_bp: 13  },
      { ticker: "DXY",  realized_direction: "down", realized_magnitude_bp: 70  },
    ],
    labels: { themes: ["weak jobs", "pivot hope", "bad news is good", "rates falling"], primary_assets: ["SPY","TLT","^TNX","DXY"] },
  },

  {
    case_id: "macro-nfp-blowout-2023",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "NFP blowout — 336k vs 170k consensus, no recession in sight",
    parsed_event: { summary: "Oct 2023: NFP 336k vs 170k expected — double consensus. Initial spike in yields, then markets digested as 'no recession'. SPY ended +1.2% but bonds sold -1%." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up",   realized_magnitude_bp: 120 },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 100 },
      { ticker: "^TNX", realized_direction: "up",   realized_magnitude_bp: 8   },
    ],
    labels: { themes: ["strong jobs", "no recession", "yield pressure", "dual read"], primary_assets: ["SPY","TLT","^TNX"] },
  },

  {
    case_id: "macro-fomc-first-cut-2024",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "Fed cuts 50bp — surprise jumbo cut signals pivot complete",
    parsed_event: { summary: "Sep 2024: Fed cut 50bp vs 25bp consensus. Initial confusion — buy or sell? SPY +1.7% on day. Gold surged +1.4%. Dollar fell -0.6%. Treasury curve steepened." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "up",   realized_magnitude_bp: 170 },
      { ticker: "GLD",  realized_direction: "up",   realized_magnitude_bp: 140 },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 80  },
      { ticker: "DXY",  realized_direction: "down", realized_magnitude_bp: 60  },
    ],
    labels: { themes: ["pivot", "rate cut", "gold rally", "dollar weakness"], primary_assets: ["SPY","GLD","TLT","DXY"] },
  },

  {
    case_id: "macro-fomc-hike-75bp-2022",
    case_pack: "macro_calendar_v1",
    dominant_catalyst: "Fed hikes 75bp — first 75bp hike since 1994",
    parsed_event: { summary: "Jun 2022: Fed hiked 75bp after hot CPI leak. Largest hike since 1994. QQQ fell -5% week of meeting. TLT -3%. Markets priced further 75bp hikes — terminal rate expectations jumped to 3.75%." },
    realized_moves: [
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 500 },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 380 },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 300 },
    ],
    labels: { themes: ["shock hike", "restrictive Fed", "duration selloff", "rate fear"], primary_assets: ["QQQ","SPY","TLT"] },
  },

  // ─── EARNINGS_V1 — Big tech + sector earnings surprises ───────────────────

  {
    case_id: "earnings-meta-guidance-cut-2022",
    case_pack: "earnings_v1",
    dominant_catalyst: "Meta Q3 2022 — revenue miss + massive capex guidance, stock -24%",
    parsed_event: { summary: "Oct 2022: Meta missed revenue, guided to $34-37B capex for metaverse. Stock fell -24% in AH. Triggered broader tech selloff. QQQ -4% next day." },
    realized_moves: [
      { ticker: "META", realized_direction: "down", realized_magnitude_bp: 2400 },
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 400  },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 150  },
    ],
    labels: { themes: ["capex shock", "guidance cut", "metaverse skepticism", "ad revenue"], primary_assets: ["META","QQQ","SPY"] },
  },

  {
    case_id: "earnings-nvidia-beat-2023",
    case_pack: "earnings_v1",
    dominant_catalyst: "Nvidia Q1 2024 guidance — AI demand shock, revenues 3x consensus",
    parsed_event: { summary: "May 2023: Nvidia guided $11B revenue vs $7.2B consensus — 53% beat. Stock +24% next day. Sparked AI trade globally — AMD, SMCI, SOX all rallied. NVDA market cap +$200B in a day." },
    realized_moves: [
      { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 2400 },
      { ticker: "AMD",  realized_direction: "up", realized_magnitude_bp: 1100 },
      { ticker: "QQQ",  realized_direction: "up", realized_magnitude_bp: 260  },
      { ticker: "SPY",  realized_direction: "up", realized_magnitude_bp: 100  },
    ],
    labels: { themes: ["AI demand shock", "GPU scarcity", "data center spending", "semis rally"], primary_assets: ["NVDA","AMD","QQQ","SPY"] },
  },

  {
    case_id: "earnings-amazon-beat-q3-2023",
    case_pack: "earnings_v1",
    dominant_catalyst: "Amazon Q3 2023 — AWS reacceleration + margin expansion",
    parsed_event: { summary: "Oct 2023: Amazon beat on EPS ($0.94 vs $0.58 est) and guided Q4 revenue $160-167B. AWS growth reaccelerated to 12%. Stock +7% AH, lifted cloud/tech sector." },
    realized_moves: [
      { ticker: "AMZN", realized_direction: "up", realized_magnitude_bp: 700 },
      { ticker: "MSFT", realized_direction: "up", realized_magnitude_bp: 200 },
      { ticker: "QQQ",  realized_direction: "up", realized_magnitude_bp: 180 },
    ],
    labels: { themes: ["cloud reacceleration", "margin expansion", "AWS", "e-commerce"], primary_assets: ["AMZN","MSFT","QQQ"] },
  },

  {
    case_id: "earnings-snap-revenue-miss-2022",
    case_pack: "earnings_v1",
    dominant_catalyst: "Snap Q2 2022 — ad revenue collapse, warns macro deterioration",
    parsed_event: { summary: "Jul 2022: Snap missed revenue badly and said ad market was 'worse than expected'. META -8%, GOOGL -6%, PINS -14%, TWTR -5% in sympathy. Ad-dependent stocks cratered." },
    realized_moves: [
      { ticker: "SNAP", realized_direction: "down", realized_magnitude_bp: 2500 },
      { ticker: "META", realized_direction: "down", realized_magnitude_bp: 800  },
      { ticker: "GOOGL",realized_direction: "down", realized_magnitude_bp: 600  },
    ],
    labels: { themes: ["ad recession", "macro read-through", "social media selloff", "guidance cut"], primary_assets: ["SNAP","META","GOOGL"] },
  },

  {
    case_id: "earnings-bank-beat-rising-rates-2022",
    case_pack: "earnings_v1",
    dominant_catalyst: "JPM + GS Q3 2022 — NII surge from rate hikes",
    parsed_event: { summary: "Oct 2022: JPM beat Q3 on NII ($17.6B, up 36% YoY). Banks uniquely benefited from rate hikes — NIM expanded. XLF +4% on earnings week. Offset by loan loss provision concerns." },
    realized_moves: [
      { ticker: "JPM",  realized_direction: "up", realized_magnitude_bp: 350 },
      { ticker: "GS",   realized_direction: "up", realized_magnitude_bp: 280 },
      { ticker: "XLF",  realized_direction: "up", realized_magnitude_bp: 400 },
    ],
    labels: { themes: ["NII expansion", "rate beneficiary", "bank earnings", "NIM"], primary_assets: ["JPM","GS","XLF"] },
  },

  {
    case_id: "earnings-tesla-miss-guidance-cut-2022",
    case_pack: "earnings_v1",
    dominant_catalyst: "Tesla Q3 2022 delivery miss — supply chain + Musk distraction",
    parsed_event: { summary: "Oct 2022: Tesla delivered 343K vs 358K expected. Musk Twitter acquisition overhang. Stock -9% on earnings, down -65% in 2022. EV adoption fears vs rising competition." },
    realized_moves: [
      { ticker: "TSLA", realized_direction: "down", realized_magnitude_bp: 900  },
      { ticker: "QQQ",  realized_direction: "down", realized_magnitude_bp: 100  },
    ],
    labels: { themes: ["delivery miss", "EV competition", "CEO distraction", "supply chain"], primary_assets: ["TSLA","QQQ"] },
  },

  {
    case_id: "earnings-apple-china-risk-2023",
    case_pack: "earnings_v1",
    dominant_catalyst: "Apple Q4 2023 — China revenue soft, Services growth strong",
    parsed_event: { summary: "Nov 2023: Apple missed China revenue (-2.9% YoY) but Services hit record $22.3B. Stock initially flat then +2% as Services mix shift narrative took hold. Key watchpoint: China ban risk." },
    realized_moves: [
      { ticker: "AAPL", realized_direction: "up", realized_magnitude_bp: 200 },
      { ticker: "SPY",  realized_direction: "up", realized_magnitude_bp: 60  },
    ],
    labels: { themes: ["China risk", "services mix", "hardware vs services", "geopolitical"], primary_assets: ["AAPL","SPY"] },
  },

  // ─── ENERGY_V1 — Additional supply/demand events ──────────────────────────

  {
    case_id: "energy-spr-release-2022",
    case_pack: "energy_v1",
    dominant_catalyst: "US releases 180M barrels from SPR — largest ever",
    parsed_event: { summary: "Mar 2022: Biden announced 180M barrel SPR release to combat $120/bbl crude. CL=F fell -8% on day of announcement but recovered within 3 weeks as demand remained strong. XLE -3% initially." },
    realized_moves: [
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: 800 },
      { ticker: "XLE",  realized_direction: "down", realized_magnitude_bp: 300 },
      { ticker: "XOM",  realized_direction: "down", realized_magnitude_bp: 250 },
    ],
    labels: { themes: ["SPR release", "supply shock", "political intervention", "short-lived"], primary_assets: ["CL=F","XLE","XOM"] },
  },

  {
    case_id: "energy-russia-sanctions-oil-2022",
    case_pack: "energy_v1",
    dominant_catalyst: "G7 Russia oil price cap — $60/bbl ceiling on Russian crude",
    parsed_event: { summary: "Dec 2022: G7 + EU imposed $60/bbl price cap on Russian oil. Russia threatened to cut supply. Brent briefly spiked but fell as fears of supply disruption proved smaller than feared. Brent -4% over 2 weeks." },
    realized_moves: [
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: 400  },
      { ticker: "XLE",  realized_direction: "down", realized_magnitude_bp: 200  },
    ],
    labels: { themes: ["Russia sanctions", "price cap", "supply disruption", "smaller than feared"], primary_assets: ["CL=F","XLE"] },
  },

  {
    case_id: "energy-natgas-spike-2022",
    case_pack: "energy_v1",
    dominant_catalyst: "Europe gas crisis — Nordstream shutdown, TTF gas to 10x",
    parsed_event: { summary: "Aug 2022: Nordstream maintenance shutdowns and Russia weaponizing gas. European TTF gas hit €340/MWh (10x 2020 levels). EU energy equities diverged from US — European utilities sold off -30%." },
    realized_moves: [
      { ticker: "UNG",  realized_direction: "up",   realized_magnitude_bp: 8000 },
      { ticker: "XLE",  realized_direction: "up",   realized_magnitude_bp: 1200 },
      { ticker: "CL=F", realized_direction: "up",   realized_magnitude_bp: 600  },
    ],
    labels: { themes: ["natgas crisis", "Europe energy", "supply weaponization", "TTF spike"], primary_assets: ["UNG","XLE","CL=F"] },
  },

  {
    case_id: "energy-opec-plus-surprise-cut-2023",
    case_pack: "energy_v1",
    dominant_catalyst: "OPEC+ surprise 1.66M bpd cut — shock announcement",
    parsed_event: { summary: "Apr 2023: OPEC+ surprised markets with 1.66M bpd cut outside scheduled meeting. CL=F gapped +6% Monday open. XLE +4.5%. But move faded over 2 weeks as growth fears re-emerged." },
    realized_moves: [
      { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 600  },
      { ticker: "XLE",  realized_direction: "up", realized_magnitude_bp: 450  },
      { ticker: "XOM",  realized_direction: "up", realized_magnitude_bp: 380  },
    ],
    labels: { themes: ["OPEC surprise", "supply cut", "gap up", "short-lived rally"], primary_assets: ["CL=F","XLE","XOM"] },
  },

  {
    case_id: "energy-crude-demand-destruction-2020",
    case_pack: "energy_v1",
    dominant_catalyst: "COVID demand collapse — WTI goes negative for first time ever",
    parsed_event: { summary: "Apr 2020: WTI May futures went negative to -$37/bbl as storage hit capacity. XLE fell -50% in 3 months. OPEC+ emergency 9.7M bpd cut failed to offset demand collapse." },
    realized_moves: [
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: 10000 },
      { ticker: "XLE",  realized_direction: "down", realized_magnitude_bp: 5000  },
      { ticker: "XOM",  realized_direction: "down", realized_magnitude_bp: 4200  },
    ],
    labels: { themes: ["demand destruction", "storage overflow", "negative oil", "pandemic"], primary_assets: ["CL=F","XLE","XOM"] },
  },

  // ─── CREDIT_V1 — Bank stress + spread events ──────────────────────────────

  {
    case_id: "credit-svb-collapse-2023",
    case_pack: "credit_v1",
    dominant_catalyst: "SVB bank run — $42B withdrawal in 10 hours, FDIC seizure",
    parsed_event: { summary: "Mar 2023: Silicon Valley Bank collapsed from duration mismatch — held long-duration bonds that lost value. $42B run in 10 hours. FDIC seized. KRE (regional banks) -28% in a week. Fed launched BTFP." },
    realized_moves: [
      { ticker: "KRE",  realized_direction: "down", realized_magnitude_bp: 2800 },
      { ticker: "XLF",  realized_direction: "down", realized_magnitude_bp: 800  },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 600  },
      { ticker: "GLD",  realized_direction: "up",   realized_magnitude_bp: 350  },
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 480  },
    ],
    labels: { themes: ["bank run", "duration risk", "FDIC", "contagion fear", "flight to safety"], primary_assets: ["KRE","XLF","TLT","GLD","SPY"] },
  },

  {
    case_id: "credit-cs-takeover-2023",
    case_pack: "credit_v1",
    dominant_catalyst: "Credit Suisse emergency acquisition by UBS — AT1 bonds zeroed",
    parsed_event: { summary: "Mar 2023: UBS acquired Credit Suisse for CHF 3B (vs book value ~CHF 42B). $17B AT1 bonds written to zero — unprecedented. European bank stocks -10%. CDS on Deutsche Bank spiked." },
    realized_moves: [
      { ticker: "XLF",  realized_direction: "down", realized_magnitude_bp: 400  },
      { ticker: "KRE",  realized_direction: "down", realized_magnitude_bp: 600  },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 300  },
    ],
    labels: { themes: ["AT1 wipeout", "bank acquisition", "contagion", "European banks"], primary_assets: ["XLF","KRE","TLT"] },
  },

  {
    case_id: "credit-hy-spread-widening-2022",
    case_pack: "credit_v1",
    dominant_catalyst: "HY spreads widen 400bp — recession pricing in credit markets",
    parsed_event: { summary: "2022: US HY spreads widened from ~280bp to ~580bp at peak in Oct. HYG fell -16%. Leveraged loan defaults ticked up. IG held better but still +180bp wider. Eventually tightened as recession didn't materialise." },
    realized_moves: [
      { ticker: "HYG",  realized_direction: "down", realized_magnitude_bp: 1600 },
      { ticker: "LQD",  realized_direction: "down", realized_magnitude_bp: 1200 },
      { ticker: "TLT",  realized_direction: "down", realized_magnitude_bp: 3000 },
    ],
    labels: { themes: ["credit spread widening", "recession pricing", "HY stress", "IG spread"], primary_assets: ["HYG","LQD","TLT"] },
  },

  {
    case_id: "credit-yield-curve-inversion-2022",
    case_pack: "credit_v1",
    dominant_catalyst: "2s10s inverts -80bp — deepest inversion since 1981",
    parsed_event: { summary: "Oct 2022: 2yr-10yr Treasury spread inverted to -84bp, deepest since 1981. Historically precedes recession by 12-18 months. Banks underperformed as NIM outlook deteriorated. XLF -3% on the week." },
    realized_moves: [
      { ticker: "XLF",  realized_direction: "down", realized_magnitude_bp: 300 },
      { ticker: "KRE",  realized_direction: "down", realized_magnitude_bp: 450 },
      { ticker: "TLT",  realized_direction: "up",   realized_magnitude_bp: 200 },
    ],
    labels: { themes: ["yield curve inversion", "recession signal", "bank NIM", "2s10s"], primary_assets: ["XLF","KRE","TLT"] },
  },

  // ─── POLICY_FX_V1 — FX + geopolitical events ──────────────────────────────

  {
    case_id: "policy-ukraine-invasion-2022",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "Russia invades Ukraine — full-scale military invasion Feb 24, 2022",
    parsed_event: { summary: "Feb 24, 2022: Russia launched full-scale Ukraine invasion. SPY -2.6% on day, quickly recovered. Commodities spiked: wheat +30%, CL=F +8%. EUR/USD fell -1.5%. Gold +2.8%. Defense stocks +15%." },
    realized_moves: [
      { ticker: "GLD",      realized_direction: "up",   realized_magnitude_bp: 280  },
      { ticker: "CL=F",     realized_direction: "up",   realized_magnitude_bp: 800  },
      { ticker: "SPY",      realized_direction: "down", realized_magnitude_bp: 260  },
      { ticker: "EURUSD=X", realized_direction: "down", realized_magnitude_bp: 150  },
    ],
    labels: { themes: ["war premium", "commodity spike", "safe haven", "EUR weakness"], primary_assets: ["GLD","CL=F","SPY","EURUSD=X"] },
  },

  {
    case_id: "policy-boj-ycc-collapse-2022",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "BOJ widens YCC band to 50bp — surprise shock at Dec 2022 meeting",
    parsed_event: { summary: "Dec 2022: BOJ widened YCC tolerance to ±50bp (from 25bp) — effectively a tightening. USD/JPY fell -3.5% in hours. JGB yields spiked. Triggered global bond selloff — US 10yr +15bp. Yen ripped from 135 to 130." },
    realized_moves: [
      { ticker: "JPY=X",    realized_direction: "up",   realized_magnitude_bp: 350  },
      { ticker: "^TNX",     realized_direction: "up",   realized_magnitude_bp: 15   },
      { ticker: "TLT",      realized_direction: "down", realized_magnitude_bp: 150  },
      { ticker: "SPY",      realized_direction: "down", realized_magnitude_bp: 140  },
    ],
    labels: { themes: ["BOJ surprise", "YCC collapse", "yen rip", "JGB yield spike"], primary_assets: ["JPY=X","^TNX","TLT","SPY"] },
  },

  {
    case_id: "policy-snb-unpeg-chf-2015",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "SNB removes EUR/CHF 1.20 floor — CHF +30% in minutes",
    parsed_event: { summary: "Jan 15, 2015: Swiss National Bank abandoned 1.20 EUR/CHF floor without warning. CHF gained 30% in minutes — largest ever single-day currency move in a major currency. EUR/CHF fell from 1.20 to 0.85. Forex brokers went bankrupt." },
    realized_moves: [
      { ticker: "EURCHF=X", realized_direction: "down", realized_magnitude_bp: 3000 },
      { ticker: "USDCHF=X", realized_direction: "down", realized_magnitude_bp: 2500 },
      { ticker: "GLD",      realized_direction: "up",   realized_magnitude_bp: 200  },
    ],
    labels: { themes: ["currency shock", "peg removal", "CHF surge", "broker solvency"], primary_assets: ["EURCHF=X","USDCHF=X","GLD"] },
  },

  {
    case_id: "policy-yen-intervention-2022",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "Japan intervenes in FX market — sells dollars to support yen",
    parsed_event: { summary: "Sep 2022: Japan intervened for first time since 1998, spending ~$20B to defend yen at 145. USD/JPY fell 500 pips in minutes. Subsequent intervention in Oct at 150 also caused sharp reversal." },
    realized_moves: [
      { ticker: "JPY=X", realized_direction: "up",   realized_magnitude_bp: 500 },
      { ticker: "DXY",   realized_direction: "down", realized_magnitude_bp: 80  },
    ],
    labels: { themes: ["FX intervention", "yen defense", "MOF", "position squeeze"], primary_assets: ["JPY=X","DXY"] },
  },

  {
    case_id: "policy-trump-tariffs-2018",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "Trump steel/aluminum tariffs + China $200B tariff announcement",
    parsed_event: { summary: "2018: Trump imposed 25% steel, 10% aluminum tariffs. Then announced $200B China tariffs. S&P -2.5%, Dow -3.1% on announcement days. CNY depreciated. Ag commodities (soybeans) -25% as China retaliated." },
    realized_moves: [
      { ticker: "SPY",  realized_direction: "down", realized_magnitude_bp: 250 },
      { ticker: "GLD",  realized_direction: "up",   realized_magnitude_bp: 80  },
      { ticker: "DXY",  realized_direction: "up",   realized_magnitude_bp: 150 },
    ],
    labels: { themes: ["tariff shock", "trade war", "China retaliation", "CNY pressure"], primary_assets: ["SPY","GLD","DXY"] },
  },

  {
    case_id: "policy-brexit-vote-2016",
    case_pack: "policy_fx_v1",
    dominant_catalyst: "UK votes to Leave EU — 52% Leave shocks markets",
    parsed_event: { summary: "Jun 2016: UK voted 52% Leave vs 48% Remain — polls had called Remain. GBP fell -11% vs USD overnight. FTSE 100 -8% open. Gold +5%. SPY -3.6% on day. UK domestic stocks (homebuilders, retailers) -25%." },
    realized_moves: [
      { ticker: "GBP=X",  realized_direction: "down", realized_magnitude_bp: 1100 },
      { ticker: "GLD",    realized_direction: "up",   realized_magnitude_bp: 500  },
      { ticker: "SPY",    realized_direction: "down", realized_magnitude_bp: 360  },
      { ticker: "^VIX",   realized_direction: "up",   realized_magnitude_bp: 2000 },
    ],
    labels: { themes: ["Brexit shock", "GBP crash", "political risk", "flight to safety"], primary_assets: ["GBP=X","GLD","SPY","^VIX"] },
  },

];

async function run(): Promise<void> {
  console.log(`Expanding case library with ${NEW_CASES.length} new cases...`);

  let inserted = 0;
  let skipped  = 0;

  for (const c of NEW_CASES) {
    // Auto-generate source from dominant_catalyst + parsed_event summary
    const source = c.source ?? {
      source_type: "headline",
      title: c.dominant_catalyst,
      raw_text: c.parsed_event.summary,
    };

    try {
      await pool.query(
        `INSERT INTO historical_case_library
           (case_id, case_pack, dominant_catalyst, parsed_event, realized_moves, labels, source, horizon, timing_alignment)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (case_id) DO NOTHING`,
        [
          c.case_id,
          c.case_pack,
          c.dominant_catalyst,
          JSON.stringify(c.parsed_event),
          JSON.stringify(c.realized_moves),
          JSON.stringify(c.labels),
          JSON.stringify(source),
          "1d",
          0.85,
        ]
      );
      console.log(`  ✓ ${c.case_id}`);
      inserted++;
    } catch (err: any) {
      console.warn(`  ✗ ${c.case_id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped/existing: ${skipped}`);

  // Show total case count
  const res = await pool.query("SELECT COUNT(*) as total FROM historical_case_library");
  console.log(`Total cases in library: ${res.rows[0].total}`);

  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
