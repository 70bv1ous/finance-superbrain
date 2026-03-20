import type {
  CreateSourceRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  RealEstateHousingHistoricalCaseInput,
  RealEstateHousingHistoricalIngestionRequest,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type RealEstateHousingPreset = {
  event_family: string;
  default_title: (item: RealEstateHousingHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: RealEstateHousingHistoricalCaseInput) => string;
  buildReviewHints: (item: RealEstateHousingHistoricalCaseInput) => string[];
};

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const defaultReviewHints = (hints: string[], manualHints?: string[]) =>
  unique([...(manualHints ?? []), ...hints]).slice(0, 12);

const defaultRegion = (item: RealEstateHousingHistoricalCaseInput) =>
  item.region?.trim() || "us";

const mapSignalToSurprise = (signal: RealEstateHousingHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const REAL_ESTATE_HOUSING_PRESETS: Record<
  RealEstateHousingHistoricalCaseInput["event_type"],
  RealEstateHousingPreset
> = {
  housing_starts_miss: {
    event_family: "housing_starts_miss",
    default_title: () => "Housing starts miss — construction activity below expectations",
    default_dominant_catalyst: "housing-starts-miss",
    primary_themes: ["housing_starts_miss", "construction_weakness", "housing_leading_indicator"],
    primary_assets: ["XHB", "DHI", "LEN", "VNQ"],
    tags: ["realestate_loader", "housing_starts", "miss", "construction"],
    regimes: ["housing_downturn"],
    sectors: ["homebuilders", "real_estate"],
    buildLead: (item) =>
      `Housing starts in ${defaultRegion(item)} missed expectations, signaling weakness in residential construction activity that typically leads homebuilder revenue and earnings by 6-12 months, with negative implications for the XHB homebuilder ETF and related building materials companies.`,
    buildReviewHints: () => [
      "Housing starts misses are leading indicators of homebuilder revenue: permits precede starts by 1-3 months, starts precede completions by 6-12 months — a persistent starts miss chain (3+ consecutive months) reliably leads to homebuilder earnings cuts.",
      "Duration risk drives REITs first and then housing activity data drives homebuilders — a housing starts miss has a delayed impact on homebuilder fundamentals versus the immediate cap rate effect on REITs from rising interest rates.",
      "The single-family vs. multi-family breakdown within housing starts is critical: single-family weakness signals affordability constraints and buyer demand deterioration, while multi-family weakness signals developer/financing concerns — different investment implications for XHB vs. VNQ.",
    ],
  },
  housing_starts_beat: {
    event_family: "housing_starts_beat",
    default_title: () => "Housing starts beat — construction activity above expectations",
    default_dominant_catalyst: "housing-starts-beat",
    primary_themes: ["housing_starts_beat", "construction_strength", "homebuilder_demand"],
    primary_assets: ["XHB", "DHI", "LEN", "TOL"],
    tags: ["realestate_loader", "housing_starts", "beat", "construction"],
    regimes: ["housing_recovery"],
    sectors: ["homebuilders", "real_estate"],
    buildLead: (item) =>
      `Housing starts in ${defaultRegion(item)} beat expectations, confirming residential construction momentum that supports homebuilder order books and is consistent with eventual earnings upside for XHB constituents.`,
    buildReviewHints: () => [
      "Housing starts beats during periods of constrained existing inventory (lock-in effect) are particularly bullish for homebuilders because new construction is absorbing demand that cannot be met by the existing home market.",
      "Building permits — released alongside housing starts — are a better leading indicator than starts for homebuilder order pipelines: a permits beat signals 1-3 months of forward starts strength.",
      "Single-family starts beats are the high-conviction homebuilder signal; multi-family starts beats benefit apartment REITs (EQR, AVB) but not the XHB homebuilder complex — separating these components is essential for precise sector positioning.",
    ],
  },
  case_shiller_decline: {
    event_family: "case_shiller_decline",
    default_title: () => "Case-Shiller home price decline — national or metro price correction",
    default_dominant_catalyst: "case-shiller-home-price-decline",
    primary_themes: ["case_shiller_decline", "home_price_correction", "housing_wealth_effect"],
    primary_assets: ["VNQ", "XHB", "IYR"],
    tags: ["realestate_loader", "case_shiller", "home_prices", "decline"],
    regimes: ["real_estate_correction"],
    sectors: ["real_estate", "homebuilders"],
    buildLead: (item) =>
      `The Case-Shiller home price index reported a decline for ${defaultRegion(item)}, signaling a reversal in residential property values with distinct implications for REIT valuations (cap rate impact) versus homebuilder business models (volume and margin impacts).`,
    buildReviewHints: () => [
      "Case-Shiller declines do not automatically harm homebuilders when existing inventory is constrained: low inventory redirects buyer demand toward new construction, creating a counterintuitive positive for XHB even as reported home prices fall.",
      "Duration risk drives REITs first on price data: VNQ reprices immediately on Case-Shiller data because cap rate expectations adjust to property value changes, while homebuilder reactions are driven more by order volume trends than reported price indices.",
      "Regional bifurcation within Case-Shiller is more informative than the national index: pandemic boomtown declines (Austin, Phoenix, Boise) do not predict coastal decline (New York, LA, Boston), and homebuilder geographic exposure determines which companies are most affected.",
    ],
  },
  mortgage_rate_shock: {
    event_family: "mortgage_rate_shock",
    default_title: () => "Mortgage rate shock — rapid rate rise impairs housing affordability",
    default_dominant_catalyst: "mortgage-rate-shock",
    primary_themes: ["mortgage_rate_shock", "affordability_collapse", "housing_demand_destruction"],
    primary_assets: ["XHB", "VNQ", "IYR", "AGNC", "NLY"],
    tags: ["realestate_loader", "mortgage_rate", "rate_shock", "affordability"],
    regimes: ["rate_hike_cycle", "real_estate_stress"],
    sectors: ["homebuilders", "mortgage_reits", "real_estate"],
    buildLead: (item) =>
      `A mortgage rate shock${item.mortgage_rate_pct ? ` (30yr fixed at ${item.mortgage_rate_pct}%)` : ""} in ${defaultRegion(item)} created an affordability crisis that simultaneously compressed REIT valuations (cap rate expansion), impaired homebuilder demand (transaction volume collapse), and generated severe losses in mortgage REITs (duration risk and spread widening).`,
    buildReviewHints: () => [
      "Mortgage rate shocks create the 'lock-in effect': homeowners with low-rate mortgages refuse to sell, collapsing transaction volume (-35%+) while partially supporting prices — the market adjusts through volume, not price, unlike 2008 when both collapsed simultaneously.",
      "Duration risk drives REITs first in a mortgage rate shock: VNQ/IYR reprice immediately as cap rates adjust to higher risk-free rates, while XHB falls on a slower timeline driven by actual order cancellations, buyer walkouts, and affordability data.",
      "Mortgage REITs (AGNC, NLY) face dual headwinds in rate shock environments: rising interest rates create both mark-to-market losses on their bond holdings AND funding cost increases (short-term repos reprice faster than long-term MBS yields), compressing net interest margins from both sides.",
    ],
  },
  reit_rate_compression: {
    event_family: "reit_rate_compression",
    default_title: () => "REIT rate compression — rising yields force cap rate expansion and REIT selloff",
    default_dominant_catalyst: "reit-cap-rate-compression",
    primary_themes: ["reit_rate_compression", "cap_rate_expansion", "duration_risk"],
    primary_assets: ["VNQ", "IYR", "AGNC", "PLD"],
    tags: ["realestate_loader", "reit", "cap_rate", "rate_compression", "duration"],
    regimes: ["rate_hike_cycle", "real_estate_stress"],
    sectors: ["equity_reits", "mortgage_reits", "office_reits", "industrial_reits"],
    buildLead: () =>
      "Rising interest rates forced a REIT sector repricing through cap rate expansion — as the risk-free rate rose, REIT valuations declined mathematically as investors required higher yields to compensate for the additional risk versus risk-free alternatives, with the most severe impact on office and mortgage REITs.",
    buildReviewHints: () => [
      "REIT sector dispersion in rate hike cycles is extreme: office REITs face dual headwinds (rising cap rates AND secular work-from-home demand decline), while industrial REITs have demand buffers (e-commerce) that offset some cap rate expansion — treating REITs as a single sector is an analytical error.",
      "Mortgage REITs are the most rate-sensitive REIT sub-sector because they are levered bond portfolios: rising rates create simultaneous mark-to-market losses on assets AND funding cost increases on liabilities, compressing book value and NII from both sides.",
      "Duration risk drives REITs immediately and mechanically on rate expectations; fundamental property income (NOI growth) drives valuations on a 12-24 month lag — REIT investors must distinguish between the initial rate-shock repricing and the subsequent fundamental adjustment.",
    ],
  },
  reit_relief_rally: {
    event_family: "reit_relief_rally",
    default_title: () => "REIT relief rally — rate expectations decline drives cap rate compression and REIT rebound",
    default_dominant_catalyst: "reit-relief-rally-rate-decline",
    primary_themes: ["reit_relief_rally", "cap_rate_compression", "duration_rally"],
    primary_assets: ["VNQ", "IYR", "AGNC", "NLY"],
    tags: ["realestate_loader", "reit_rally", "rate_decline", "duration", "relief"],
    regimes: ["fed_pause", "rate_relief"],
    sectors: ["mortgage_reits", "equity_reits", "real_estate"],
    buildLead: () =>
      "A decline in rate expectations triggered a REIT relief rally through cap rate compression — as required yields fell, REIT valuations increased mathematically, with mortgage REITs providing the highest-beta expression of the rate decline thesis due to their levered duration exposure.",
    buildReviewHints: () => [
      "Mortgage REITs (AGNC, NLY) have the most leveraged reaction to rate declines: their book value improves on both the asset side (MBS mark-to-market gains) and the income side (improved NII spreads) — making them the highest-beta expression of a rate decline thesis in the real estate complex.",
      "REIT relief rallies driven by rate expectations reprice faster than fundamental improvement: VNQ can rally 10-15% on rate expectations alone, while actual transaction volume and property income improvements take 6-18 months to materialize.",
      "The bifurcation between REIT and homebuilder reactions to rate relief is persistent: REITs reprice immediately on rate expectations, while homebuilder demand requires actual mortgage rates below 6-6.5% to stimulate meaningful buyer activity — homebuilders lag REIT recoveries by 6-12 months in rate decline cycles.",
    ],
  },
  nhb_sentiment_collapse: {
    event_family: "nhb_sentiment_collapse",
    default_title: () => "NAHB housing market index collapse — builder sentiment signals deep housing recession",
    default_dominant_catalyst: "nahb-sentiment-collapse",
    primary_themes: ["nhb_sentiment_collapse", "homebuilder_stress", "housing_leading_indicator"],
    primary_assets: ["XHB", "DHI", "LEN", "PHM"],
    tags: ["realestate_loader", "nahb", "sentiment", "homebuilder", "leading_indicator"],
    regimes: ["housing_downturn"],
    sectors: ["homebuilders", "real_estate"],
    buildLead: () =>
      "The NAHB Housing Market Index collapsed below 50 (the contraction threshold), signaling that a majority of homebuilders view current and expected market conditions as poor — a reliable leading indicator of housing starts weakness by 3-6 months and homebuilder earnings cuts.",
    buildReviewHints: () => [
      "The NAHB traffic sub-component (prospective buyer traffic) is the most leading indicator within the release — when traffic falls below 30, it signals an effective buyer pool collapse from affordability, typically preceding starts weakness by 4-6 months.",
      "NAHB readings below 40 overstate housing recession risk when existing inventory is simultaneously constrained: the 2022 episode showed that the lock-in effect creates a demand floor for new construction that limits actual starts declines versus the 2008 cycle when both inventory and demand collapsed.",
      "Homebuilder cancellation rates above 20% (released with NAHB) reliably precede earnings estimate cuts of 30-50% in the sector — the cancellation rate is the most direct signal of near-term revenue impairment for individual homebuilder names.",
    ],
  },
  existing_home_sales_miss: {
    event_family: "existing_home_sales_miss",
    default_title: () => "Existing home sales miss — transaction volume collapses on affordability constraints",
    default_dominant_catalyst: "existing-home-sales-miss",
    primary_themes: ["existing_home_sales_miss", "transaction_volume_collapse", "lock_in_effect"],
    primary_assets: ["VNQ", "XHB", "IYR"],
    tags: ["realestate_loader", "existing_home_sales", "miss", "transaction_volume"],
    regimes: ["housing_downturn", "rate_hike_cycle"],
    sectors: ["real_estate", "homebuilders"],
    buildLead: (item) =>
      `Existing home sales in ${defaultRegion(item)} missed expectations, confirming a housing transaction volume collapse driven by affordability constraints and the lock-in effect — homeowners with low-rate mortgages unwilling to trade up or down at prevailing mortgage rates.`,
    buildReviewHints: () => [
      "Existing home sales misses during rate shock environments are driven primarily by the lock-in effect (low-rate homeowners unwilling to sell) rather than buyer demand weakness — the data signals inventory constraint, not demand destruction, which is a critical distinction for homebuilder investment thesis.",
      "Persistent existing home sales weakness (6+ months below 4.5M annualized) redirects buyer demand toward new construction, creating a counterintuitive tailwind for homebuilders (XHB) even as the broader housing market appears distressed.",
      "Existing home sales are a 2-3 week lagging indicator of contract signings (measured by Pending Home Sales index) — when existing sales miss, check the more timely pending sales data to determine if the miss reflects current market conditions or dated pipeline.",
    ],
  },
  existing_home_sales_beat: {
    event_family: "existing_home_sales_beat",
    default_title: () => "Existing home sales beat — transaction volume recovery signals housing normalization",
    default_dominant_catalyst: "existing-home-sales-beat",
    primary_themes: ["existing_home_sales_beat", "housing_normalization", "affordability_recovery"],
    primary_assets: ["VNQ", "XHB", "IYR", "DHI"],
    tags: ["realestate_loader", "existing_home_sales", "beat", "normalization"],
    regimes: ["housing_recovery"],
    sectors: ["real_estate", "homebuilders"],
    buildLead: (item) =>
      `Existing home sales in ${defaultRegion(item)} beat expectations, signaling a housing transaction volume recovery consistent with improving affordability conditions — typically driven by rate stabilization or decline — with positive implications for broad real estate equities.`,
    buildReviewHints: () => [
      "Existing home sales beats are most significant when driven by inventory increases (lock-in effect unwinding) rather than demand surges — rising inventory alongside rising sales signals a normalization toward a healthier housing market that benefits both buyers and sellers.",
      "A sustained existing home sales recovery (3+ consecutive months above 4.5M annualized) reduces the supply constraint argument for new construction, creating headwinds for homebuilder pricing power and margins even as overall housing activity improves.",
      "Duration risk drives REITs immediately on rate expectations, but existing home sales beats confirm that actual affordability has improved enough to stimulate buyer activity — this fundamental confirmation supports REIT and homebuilder valuations beyond the initial rate-expectation repricing.",
    ],
  },
  housing_bubble_deflation: {
    event_family: "housing_bubble_deflation",
    default_title: () => "Housing bubble deflation — structural correction in overextended residential property markets",
    default_dominant_catalyst: "housing-bubble-deflation",
    primary_themes: ["housing_bubble_deflation", "property_price_collapse", "mortgage_stress"],
    primary_assets: ["VNQ", "XHB", "IYR", "AGNC"],
    tags: ["realestate_loader", "housing_bubble", "deflation", "property_correction"],
    regimes: ["housing_correction", "financial_stress"],
    sectors: ["real_estate", "homebuilders", "mortgage_reits", "financials"],
    buildLead: (item) =>
      `A housing bubble deflation in ${defaultRegion(item)} triggered a structural correction in residential property values, with cascading effects across homebuilder equities (order collapse), mortgage REITs (credit losses), and broad REITs (cap rate expansion from forced selling and price discovery).`,
    buildReviewHints: () => [
      "Housing bubble deflations differ from rate-shock corrections in one critical way: when prices fall AND volume falls simultaneously (2008 pattern), both homebuilders and REITs face permanent impairment — versus rate shocks where volume collapses but prices partially hold (2022 lock-in effect pattern).",
      "Mortgage REITs face existential risk in housing bubble deflations when they hold non-agency (credit) MBS: price declines below 80% LTV create credit losses that are permanent, not mark-to-market — distinguishing agency MBS exposure (government guaranteed) from non-agency is essential.",
      "Housing bubble deflations have a 3-7 year recovery timeline for home prices in severely affected markets — homebuilder stocks typically bottom 12-18 months before home prices bottom as equity markets price the eventual recovery, creating a leading indicator relationship between homebuilder equities and fundamental home prices.",
    ],
  },
};

const buildSource = (
  item: RealEstateHousingHistoricalCaseInput,
  preset: RealEstateHousingPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  publisher:
    item.publisher?.trim() ||
    `Real Estate / Housing Data — ${defaultRegion(item).toUpperCase()}`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: RealEstateHousingHistoricalCaseInput,
  preset: RealEstateHousingPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    item.region,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([...(item.labels?.regimes ?? []), ...preset.regimes]),
  regions: unique([...(item.labels?.regions ?? []), defaultRegion(item)]),
  sectors: unique([...(item.labels?.sectors ?? []), ...preset.sectors]),
  primary_themes: unique([
    ...(item.labels?.primary_themes ?? []),
    ...preset.primary_themes,
  ]),
  primary_assets: unique([
    ...preset.primary_assets,
    ...(item.labels?.primary_assets ?? []),
  ]).slice(0, 8),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type: item.labels?.surprise_type ?? mapSignalToSurprise(item.signal_bias),
  case_quality: item.labels?.case_quality,
  notes:
    item.labels?.notes ??
    `Loaded via real estate housing historical preset: ${item.event_type} for ${defaultRegion(item)}${item.mortgage_rate_pct ? ` (mortgage rate: ${item.mortgage_rate_pct}%)` : ""}.`,
});

const toHistoricalDraft = (
  item: RealEstateHousingHistoricalCaseInput,
): HistoricalCaseLibraryDraft => {
  const preset = REAL_ESTATE_HOUSING_PRESETS[item.event_type];

  return {
    case_id: item.case_id,
    case_pack: item.case_pack,
    source: buildSource(item, preset),
    horizon: "1d",
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: item.dominant_catalyst?.trim() || preset.default_dominant_catalyst,
    labels: buildLabels(item, preset),
    review_hints: defaultReviewHints(preset.buildReviewHints(item), item.review_hints),
    model_version: item.model_version,
  };
};

export const buildRealEstateHousingHistoricalLibraryDrafts = (
  request: RealEstateHousingHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestRealEstateHousingHistoricalCases = async (
  services: AppServices,
  request: RealEstateHousingHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildRealEstateHousingHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
