import type {
  CreateSourceRequest,
  CommoditiesHistoricalCaseInput,
  CommoditiesHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type CommoditiesPreset = {
  event_family: string;
  default_title: (item: CommoditiesHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: CommoditiesHistoricalCaseInput) => string;
  buildReviewHints: (item: CommoditiesHistoricalCaseInput) => string[];
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

const defaultInstitution = (item: CommoditiesHistoricalCaseInput) =>
  item.institution?.trim() || "Commodity market";

const defaultRegion = (item: CommoditiesHistoricalCaseInput) =>
  item.region?.trim() || "global";

const mapSignalToSurprise = (signal: CommoditiesHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const COMMODITIES_PRESETS: Record<CommoditiesHistoricalCaseInput["event_type"], CommoditiesPreset> = {
  base_metal_squeeze: {
    event_family: "base_metal_squeeze",
    default_title: (item) => `${defaultInstitution(item)} base metal short squeeze`,
    default_dominant_catalyst: "base-metal-squeeze",
    primary_themes: ["short_squeeze", "commodity_stress", "supply_shock"],
    primary_assets: ["FCX", "VALE", "COPX"],
    tags: ["commodities_loader", "base_metal", "squeeze", "lme"],
    regimes: ["commodity_squeeze"],
    sectors: ["materials", "mining"],
    buildLead: (item) =>
      `A short squeeze in ${defaultInstitution(item)} drove violent commodity price spikes, forcing leveraged shorts to cover while exposing the fragility of concentrated derivative positions in physical commodity markets.`,
    buildReviewHints: () => [
      "Check whether the exchange's intervention (trade cancellation, position limits) created lasting counterparty risk concerns.",
      "Review whether the squeeze was driven by genuine physical supply constraints or purely financial positioning.",
      "Confirm whether the affected metal's downstream users (manufacturers) faced acute near-term cost pressures.",
    ],
  },
  base_metal_rally: {
    event_family: "base_metal_rally",
    default_title: () => "Base metal rally on demand recovery",
    default_dominant_catalyst: "base-metal-rally",
    primary_themes: ["commodity_supercycle", "demand_recovery", "china_demand"],
    primary_assets: ["FCX", "COPX", "SCCO"],
    tags: ["commodities_loader", "base_metal", "rally", "demand"],
    regimes: ["commodity_bull"],
    sectors: ["materials", "mining", "industrials"],
    buildLead: () =>
      "Base metal prices surged on a combination of strong demand recovery signals, supply constraints, and the green energy transition narrative driving structural re-rating of critical metal producers.",
    buildReviewHints: () => [
      "Check whether the commodity rally was driven by China demand (most important marginal buyer) or global recovery.",
      "Review whether mining equity (FCX, COPX) provided more or less than 1x leverage to the underlying commodity price move.",
      "Confirm whether the rally reflected speculative positioning or genuine physical demand from end-users.",
    ],
  },
  base_metal_selloff: {
    event_family: "base_metal_selloff",
    default_title: () => "Base metal selloff on demand fears",
    default_dominant_catalyst: "base-metal-selloff",
    primary_themes: ["recession_indicator", "commodity_selloff", "china_demand_collapse"],
    primary_assets: ["FCX", "COPX", "BHP"],
    tags: ["commodities_loader", "base_metal", "selloff", "dr_copper", "recession"],
    regimes: ["commodity_bear", "recession_fear"],
    sectors: ["materials", "mining"],
    buildLead: () =>
      "Base metal prices fell sharply as demand destruction fears — driven by China slowdown, Fed tightening, or recession concerns — overwhelmed supply constraints and supercycle narratives.",
    buildReviewHints: () => [
      "Check whether the selloff validated 'Dr. Copper' as a leading recession indicator.",
      "Review whether the selloff was driven by financial deleveraging (futures positioning) vs. actual physical demand decline.",
      "Confirm whether the AUDUSD tracked the base metal selloff as a high-beta China demand proxy.",
    ],
  },
  gold_safe_haven: {
    event_family: "gold_safe_haven",
    default_title: () => "Gold surges as safe haven demand spikes",
    default_dominant_catalyst: "gold-safe-haven",
    primary_themes: ["gold_safe_haven", "risk_off", "safe_haven"],
    primary_assets: ["GLD", "GDX", "SLV"],
    tags: ["commodities_loader", "gold", "safe_haven", "risk_off"],
    regimes: ["safe_haven", "risk_off"],
    sectors: ["precious_metals"],
    buildLead: () =>
      "Gold surged as a safe haven asset as investors fled risk assets, banking stress, or geopolitical shocks — simultaneously benefiting from flight-to-safety demand and the Fed rate cut repricing that compresses real yields.",
    buildReviewHints: () => [
      "Check whether gold outperformed or underperformed Treasuries during the risk-off episode — establishing gold's relative safe haven ranking.",
      "Review whether gold miners (GDX) amplified or dampened the spot gold move through operational leverage.",
      "Confirm whether silver moved with or disproportionately vs. gold — 'silver catches up' pattern in strong gold moves.",
    ],
  },
  gold_breakout: {
    event_family: "gold_breakout",
    default_title: () => "Gold breaks to all-time high",
    default_dominant_catalyst: "gold-all-time-high",
    primary_themes: ["gold_breakout", "real_yield_collapse", "monetary_debasement"],
    primary_assets: ["GLD", "GDX", "GDXJ"],
    tags: ["commodities_loader", "gold", "breakout", "all_time_high", "real_yields"],
    regimes: ["gold_bull"],
    sectors: ["precious_metals", "materials"],
    buildLead: () =>
      "Gold broke to a new all-time high, driven by real yield compression, central bank demand, and the monetary debasement narrative — triggering momentum-based buying and analyst upgrades.",
    buildReviewHints: () => [
      "Check whether the all-time high was front-run by gold ETF flows or driven primarily by futures positioning.",
      "Review whether gold miners (GDX) provided the expected >1x leverage to the spot gold breakout.",
      "Confirm whether the breakout sustained above the prior high or was immediately reversed — breakout quality matters for signal value.",
    ],
  },
  gold_central_bank_buying: {
    event_family: "gold_central_bank_buying",
    default_title: () => "Central banks purchase record gold — de-dollarization accelerates",
    default_dominant_catalyst: "central-bank-gold-buying",
    primary_themes: ["de_dollarization", "central_bank_demand", "reserve_diversification"],
    primary_assets: ["GLD", "GDX", "IAU"],
    tags: ["commodities_loader", "gold", "central_bank", "de_dollarization", "reserves"],
    regimes: ["gold_bull", "de_dollarization"],
    sectors: ["precious_metals"],
    buildLead: () =>
      "Central banks purchased record quantities of gold as a reserve diversification strategy, accelerating de-dollarization after the Russia sanctions demonstrated that USD reserves could be weaponized.",
    buildReviewHints: () => [
      "Check whether the central bank buying was price-insensitive — creating a structural floor under gold.",
      "Review whether the WGC report timing created a recurring announcement effect on gold prices.",
      "Confirm whether the buying was concentrated in specific EM central banks (China, Turkey, Poland) or broad-based.",
    ],
  },
  agricultural_supply_shock: {
    event_family: "agricultural_supply_shock",
    default_title: () => "Agricultural supply shock — food security threatened",
    default_dominant_catalyst: "agricultural-supply-shock",
    primary_themes: ["food_security", "supply_shock", "agricultural_inflation"],
    primary_assets: ["WEAT", "MOO", "NTR"],
    tags: ["commodities_loader", "agriculture", "wheat", "food_security", "supply_shock"],
    regimes: ["commodity_bull", "supply_shock"],
    sectors: ["agriculture", "food", "fertilizers"],
    buildLead: () =>
      "A major agricultural supply shock disrupted global food commodity supply chains, driving grain and oilseed prices to multi-year highs and threatening food security in import-dependent EM nations.",
    buildReviewHints: () => [
      "Check whether the supply shock transmitted through to retail food inflation in EM nations within 2-3 months.",
      "Review whether fertilizer stocks (NTR, MOS) outperformed grain ETFs (WEAT) on the agricultural supply shock.",
      "Confirm whether alternative supply sources (other exporters) could partially offset the supply disruption.",
    ],
  },
  grain_deal_disruption: {
    event_family: "grain_deal_disruption",
    default_title: () => "Grain deal collapse disrupts food trade",
    default_dominant_catalyst: "grain-deal-disruption",
    primary_themes: ["food_security", "russia_ukraine", "agricultural_inflation"],
    primary_assets: ["WEAT", "MOO", "CORN"],
    tags: ["commodities_loader", "wheat", "grain", "ukraine", "russia", "food_shock"],
    regimes: ["geopolitical_shock", "commodity_spike"],
    sectors: ["agriculture", "food"],
    buildLead: () =>
      "The collapse of a grain deal or disruption to Black Sea agricultural corridors threatened global food supply chains, driving immediate grain price spikes and food security fears in import-dependent nations.",
    buildReviewHints: () => [
      "Check whether alternative export routes (rail, Danube) could absorb the Black Sea disruption at comparable cost.",
      "Review whether EM food-importing nation CDS spreads (Egypt, Pakistan) widened on the grain deal disruption.",
      "Confirm whether the grain price spike reversed as the market assessed the actual supply impact vs. initial fear.",
    ],
  },
  battery_metal_surge: {
    event_family: "battery_metal_surge",
    default_title: () => "Battery metal prices surge — EV demand and supply constraints",
    default_dominant_catalyst: "battery-metal-surge",
    primary_themes: ["battery_metals_supercycle", "ev_demand", "energy_transition"],
    primary_assets: ["ALB", "SQM", "LTHM"],
    tags: ["commodities_loader", "lithium", "battery", "ev", "supercycle"],
    regimes: ["commodity_bull", "ev_boom"],
    sectors: ["materials", "mining", "battery_metals"],
    buildLead: () =>
      "Battery metal prices surged as accelerating EV adoption and energy storage buildout outpaced supply from existing mines, creating a structural deficit that repriced the entire battery materials supply chain.",
    buildReviewHints: () => [
      "Check whether the surge reflected genuine physical deficit or speculative positioning on the EV adoption narrative.",
      "Review whether the extreme price environment incentivized new mine development that would eventually destroy the thesis.",
      "Confirm whether IRA domestic content provisions changed the sourcing patterns for battery metal procurement.",
    ],
  },
  battery_metal_crash: {
    event_family: "battery_metal_crash",
    default_title: () => "Battery metal crash — EV demand miss and supply surge",
    default_dominant_catalyst: "battery-metal-crash",
    primary_themes: ["lithium_crash", "ev_demand_miss", "commodity_cycle"],
    primary_assets: ["ALB", "SQM", "LTHM"],
    tags: ["commodities_loader", "lithium", "battery", "ev", "oversupply", "crash"],
    regimes: ["commodity_bear", "ev_slowdown"],
    sectors: ["materials", "mining", "battery_metals"],
    buildLead: () =>
      "Battery metal prices collapsed as EV demand growth disappointed against euphoric expectations while new mine supply from Australia, Chile, and Argentina flooded the market, demonstrating that even 'structural demand' stories are subject to commodity cycle dynamics.",
    buildReviewHints: () => [
      "Check whether the crash was faster or slower than historical commodity cycle downturns — a sign of structural vs. cyclical demand.",
      "Review whether major automakers used the price collapse to renegotiate long-term supply contracts at dramatically lower prices.",
      "Confirm whether Western lithium producers (ALB) faced more severe margin compression than low-cost Chilean/Australian rivals.",
    ],
  },
  uranium_bull_run: {
    event_family: "uranium_bull_run",
    default_title: () => "Uranium price surges — nuclear renaissance and physical buying",
    default_dominant_catalyst: "uranium-nuclear-renaissance",
    primary_themes: ["nuclear_renaissance", "uranium_bull", "energy_security"],
    primary_assets: ["URA", "CCJ", "UUUU"],
    tags: ["commodities_loader", "uranium", "nuclear", "sprott", "energy_transition"],
    regimes: ["commodity_bull", "energy_security"],
    sectors: ["energy", "mining", "utilities"],
    buildLead: () =>
      "Uranium prices surged driven by renewed nuclear energy interest (energy security post-Ukraine invasion, AI power demand), Sprott Physical Uranium Trust physical buying, and constrained mine supply — creating the first nuclear bull market since 2007.",
    buildReviewHints: () => [
      "Check whether Sprott Physical Uranium Trust's buying program created a price-insensitive demand pool that structurally moved spot prices.",
      "Review whether reactor restart announcements (Japan, Europe) provided incremental demand visibility beyond Sprott's purchases.",
      "Confirm whether Kazatomprom output cuts or Cameco mine suspensions were the primary supply catalyst.",
    ],
  },
  platinum_group_shock: {
    event_family: "platinum_group_shock",
    default_title: (item) => `${defaultInstitution(item)} platinum group metal shock`,
    default_dominant_catalyst: "pgm-supply-shock",
    primary_themes: ["russia_supply_shock", "pgm_supply", "auto_supply_chain"],
    primary_assets: ["PALL", "PPLT", "SBSW"],
    tags: ["commodities_loader", "palladium", "platinum", "pgm", "russia", "auto"],
    regimes: ["geopolitical_shock", "commodity_bull"],
    sectors: ["materials", "mining", "auto"],
    buildLead: (item) =>
      `${defaultInstitution(item)} experienced a platinum group metal supply shock, disrupting the auto catalytic converter supply chain and repricing the risk of Russia-sourced PGM supply concentration.`,
    buildReviewHints: () => [
      "Check whether the PGM price spike was sustained or gave back gains as supply routes were rerouted.",
      "Review whether the EV transition narrative (eliminating catalytic converters) was used as a medium-term bearish offset.",
      "Confirm whether South African PGM producers gained pricing power and market share during the Russia supply shock.",
    ],
  },
  fertilizer_spike: {
    event_family: "fertilizer_spike",
    default_title: () => "Fertilizer prices spike — natural gas and sanctions destroy supply",
    default_dominant_catalyst: "fertilizer-supply-shock",
    primary_themes: ["fertilizer_crisis", "food_security", "natural_gas_crisis"],
    primary_assets: ["NTR", "MOS", "CF"],
    tags: ["commodities_loader", "fertilizer", "nitrogen", "potash", "yara", "food_security"],
    regimes: ["commodity_bull", "supply_shock"],
    sectors: ["agriculture", "chemicals", "fertilizers"],
    buildLead: () =>
      "Fertilizer prices spiked to multi-decade highs as European natural gas prices made nitrogen fertilizer production uneconomic and Russia/Belarus sanctions restricted potash supply — amplifying food commodity inflation globally.",
    buildReviewHints: () => [
      "Check whether European gas prices were the primary nitrogen fertilizer driver vs. Russia/Belarus sanctions on potash.",
      "Review whether fertilizer company margins peaked at spot price highs or whether input costs (gas) compressed margins simultaneously.",
      "Confirm whether the fertilizer spike contributed measurably to global food CPI and EM food security crises.",
    ],
  },
  precious_metal_squeeze: {
    event_family: "precious_metal_squeeze",
    default_title: (item) => `${defaultInstitution(item)} precious metal squeeze attempt`,
    default_dominant_catalyst: "precious-metal-squeeze",
    primary_themes: ["retail_squeeze", "precious_metals", "market_microstructure"],
    primary_assets: ["SLV", "GLD", "PSLV"],
    tags: ["commodities_loader", "silver", "gold", "squeeze", "retail", "microstructure"],
    regimes: ["retail_trading_frenzy"],
    sectors: ["precious_metals"],
    buildLead: (item) =>
      `${defaultInstitution(item)} attempted a precious metal market squeeze, revealing the structural differences between squeezing illiquid equities vs. deep commodity markets with multiple delivery mechanisms.`,
    buildReviewHints: () => [
      "Check whether the squeeze failed for fundamental reasons (market too large) vs. technical (ETF creation halts).",
      "Review whether physical-backed ETFs (PSLV) outperformed paper ETFs (SLV) during the squeeze as physical delivery was the ultimate test.",
      "Confirm whether the episode created lasting structural concerns about commodity ETF mechanisms under stress.",
    ],
  },
  mine_supply_disruption: {
    event_family: "mine_supply_disruption",
    default_title: (item) => `${defaultInstitution(item)} mine closure disrupts supply`,
    default_dominant_catalyst: "mine-supply-disruption",
    primary_themes: ["supply_disruption", "political_risk", "social_license"],
    primary_assets: ["FCX", "COPX", "SCCO"],
    tags: ["commodities_loader", "mine_closure", "political_risk", "social_license", "supply"],
    regimes: ["commodity_supply_shock"],
    sectors: ["materials", "mining"],
    buildLead: (item) =>
      `${defaultInstitution(item)} faced a forced mine closure due to political, legal, or community opposition, disrupting global supply of a critical commodity and raising the 'social license to operate' risk premium for mining projects globally.`,
    buildReviewHints: () => [
      "Check whether the commodity spot price response adequately reflected the scale of the supply disruption.",
      "Review whether the closure increased political risk premiums for other major mine permits in the same region.",
      "Confirm whether the affected mining company's debt covenants were stressed by the revenue loss from closure.",
    ],
  },
};

const buildSource = (
  item: CommoditiesHistoricalCaseInput,
  preset: CommoditiesPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultInstitution(item)} Commodities Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: CommoditiesHistoricalCaseInput,
  preset: CommoditiesPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    item.institution,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([
    ...(item.labels?.regimes ?? []),
    ...preset.regimes,
  ]),
  regions: unique([...(item.labels?.regions ?? []), defaultRegion(item)]),
  sectors: unique([...(item.labels?.sectors ?? []), ...preset.sectors]),
  primary_themes: unique([
    ...(item.labels?.primary_themes ?? []),
    ...preset.primary_themes,
  ]),
  primary_assets: unique([
    ...(item.focus_assets ?? []),
    ...preset.primary_assets,
    ...(item.labels?.primary_assets ?? []),
  ]).slice(0, 8),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type: item.labels?.surprise_type ?? mapSignalToSurprise(item.signal_bias),
  case_quality: item.labels?.case_quality,
  notes:
    item.labels?.notes ??
    `Loaded via commodities historical preset: ${item.event_type} for ${defaultInstitution(item)}.`,
});

const toHistoricalDraft = (item: CommoditiesHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = COMMODITIES_PRESETS[item.event_type];

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

export const buildCommoditiesHistoricalLibraryDrafts = (
  request: CommoditiesHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestCommoditiesHistoricalCases = async (
  services: AppServices,
  request: CommoditiesHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildCommoditiesHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
