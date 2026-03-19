import type {
  CreateSourceRequest,
  ChinaHistoricalCaseInput,
  ChinaHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type ChinaPreset = {
  event_family: string;
  default_title: (item: ChinaHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: ChinaHistoricalCaseInput) => string;
  buildReviewHints: (item: ChinaHistoricalCaseInput) => string[];
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

const defaultInstitution = (item: ChinaHistoricalCaseInput) =>
  item.institution?.trim() || "PBOC";

const defaultRegion = (item: ChinaHistoricalCaseInput) =>
  item.region?.trim() || "china";

const mapSignalToSurprise = (signal: ChinaHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const CHINA_PRESETS: Record<ChinaHistoricalCaseInput["event_type"], ChinaPreset> = {
  pboc_rate_cut: {
    event_family: "pboc_rate_cut",
    default_title: () => "PBOC cuts lending rates",
    default_dominant_catalyst: "pboc-rate-cut",
    primary_themes: ["china_easing", "monetary_policy", "property_support"],
    primary_assets: ["FXI", "KWEB", "EEM", "MCHI"],
    tags: ["china_loader", "pboc", "rate_cut", "lpr"],
    regimes: ["china_easing_cycle"],
    sectors: ["financials", "real_estate", "technology"],
    buildLead: (item) =>
      `${defaultInstitution(item)} cut lending rates, injecting monetary stimulus into China's slowing economy and property-stressed financial system.`,
    buildReviewHints: () => [
      "Check whether the cut matched, exceeded, or fell short of consensus — surprise magnitude drives the equity reaction.",
      "Review whether AUD/USD moved on the PBOC cut as a China demand proxy currency.",
      "Confirm whether property developer equities outperformed or underperformed broad FXI on PBOC easing days.",
    ],
  },
  pboc_rrr_cut: {
    event_family: "pboc_rrr_cut",
    default_title: () => "PBOC cuts reserve requirement ratio — liquidity injection",
    default_dominant_catalyst: "pboc-rrr-cut",
    primary_themes: ["china_easing", "liquidity_injection", "monetary_policy"],
    primary_assets: ["FXI", "KWEB", "EEM"],
    tags: ["china_loader", "pboc", "rrr", "liquidity"],
    regimes: ["china_easing_cycle"],
    sectors: ["financials", "real_estate"],
    buildLead: (item) =>
      `${defaultInstitution(item)} reduced the reserve requirement ratio, releasing hundreds of billions of yuan in bank liquidity to support credit expansion.`,
    buildReviewHints: () => [
      "Check whether the RRR cut alone was viewed as sufficient stimulus or markets expected additional LPR cuts.",
      "Review whether Chinese bank stocks outperformed FXI on RRR cut days — direct cost-of-funds beneficiaries.",
      "Confirm whether the RRR cut translated into accelerated credit growth in the subsequent quarter.",
    ],
  },
  property_sector_stress: {
    event_family: "property_sector_stress",
    default_title: (item) => `${defaultInstitution(item)} property stress event`,
    default_dominant_catalyst: "china-property-stress",
    primary_themes: ["china_property_crisis", "credit_stress", "contagion"],
    primary_assets: ["FXI", "EEM", "MCHI", "BHP"],
    tags: ["china_loader", "property", "real_estate", "developer", "stress"],
    regimes: ["china_credit_stress", "property_downturn"],
    sectors: ["real_estate", "financials", "materials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} experienced a significant property sector stress event, raising contagion risks across China's banking system, wealth management products, and construction supply chain.`,
    buildReviewHints: () => [
      "Check whether iron ore and copper fell as leading indicators of China construction demand collapse.",
      "Review whether the PBOC injected emergency liquidity following the property stress event.",
      "Confirm whether the stress was isolated to one developer or spread sector-wide through creditor panic.",
    ],
  },
  regulatory_crackdown: {
    event_family: "regulatory_crackdown",
    default_title: (item) => `${defaultInstitution(item)} regulatory crackdown`,
    default_dominant_catalyst: "china-regulatory-crackdown",
    primary_themes: ["china_regulation", "tech_selloff", "xi_risk_premium"],
    primary_assets: ["KWEB", "BABA", "FXI", "JD"],
    tags: ["china_loader", "regulation", "crackdown", "ccp_policy"],
    regimes: ["china_regulatory_risk"],
    sectors: ["technology", "consumer_discretionary"],
    buildLead: (item) =>
      `${defaultInstitution(item)} launched a regulatory crackdown that repriced the risk premium for Chinese tech and platform companies, raising questions about the investability of Chinese private sector equities.`,
    buildReviewHints: () => [
      "Check whether the crackdown was sector-specific (education, fintech, gaming) or indicated a broad 'common prosperity' platform change.",
      "Review whether US-listed China ADRs sold off more than Hong Kong H-shares — delisting risk premium vs. pure regulatory risk.",
      "Confirm whether Alibaba, Tencent, and Meituan moved together or diverged based on specific regulatory exposure.",
    ],
  },
  zero_covid_exit: {
    event_family: "zero_covid_exit",
    default_title: () => "China abruptly ends zero-COVID policy",
    default_dominant_catalyst: "china-zero-covid-exit",
    primary_themes: ["china_reopening", "risk_on", "china_recovery"],
    primary_assets: ["FXI", "KWEB", "EEM", "MCHI"],
    tags: ["china_loader", "zero_covid", "reopening", "policy_pivot"],
    regimes: ["china_reopening"],
    sectors: ["consumer_discretionary", "technology", "travel", "materials"],
    buildLead: () =>
      "China ended its zero-COVID policy, removing three years of mobility restrictions and unlocking a massive domestic consumption, construction, and services recovery trade.",
    buildReviewHints: () => [
      "Check whether luxury goods stocks and Asian casino equities were among the first beneficiaries of the reopening trade.",
      "Review whether the initial COVID wave following reopening caused a short-term headwind before the recovery trade accelerated.",
      "Confirm whether copper and iron ore rallied as construction demand proxies for the reopening.",
    ],
  },
  lockdown_shock: {
    event_family: "lockdown_shock",
    default_title: (item) => `${defaultInstitution(item)} lockdown shock`,
    default_dominant_catalyst: "china-lockdown-supply-shock",
    primary_themes: ["supply_chain_disruption", "china_lockdown", "zero_covid_cost"],
    primary_assets: ["FXI", "EEM", "MCHI"],
    tags: ["china_loader", "lockdown", "supply_chain", "zero_covid"],
    regimes: ["zero_covid_stress", "supply_shock"],
    sectors: ["industrials", "technology", "materials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} entered a COVID lockdown, triggering supply chain disruption across global manufacturing, semiconductor, and automotive supply networks.`,
    buildReviewHints: () => [
      "Check whether the port congestion (Shanghai) created a global freight rate spike measurable in FBX or Baltic exchange indices.",
      "Review whether copper fell as a leading indicator of reduced China construction and manufacturing activity during the lockdown.",
      "Confirm whether the lockdown's duration vs. initial expectations drove additional market downside beyond the announcement shock.",
    ],
  },
  pmi_miss: {
    event_family: "pmi_miss",
    default_title: () => "China PMI falls into contraction territory",
    default_dominant_catalyst: "china-pmi-contraction",
    primary_themes: ["china_deflation", "pmi_miss", "demand_weakness"],
    primary_assets: ["FXI", "EEM", "MCHI"],
    tags: ["china_loader", "pmi", "caixin", "deflation", "contraction"],
    regimes: ["china_slowdown", "deflation_risk"],
    sectors: ["industrials", "materials", "technology"],
    buildLead: () =>
      "China's PMI fell below 50 into contraction territory, confirming deteriorating manufacturing and services demand alongside deflationary price pressures.",
    buildReviewHints: () => [
      "Check whether the PMI miss was driven by new orders (demand) or output (supply disruption) — different implications for duration.",
      "Review whether the AUDUSD fell on the China PMI miss as the primary China proxy currency pair.",
      "Confirm whether the PMI miss triggered PBOC easing expectations that partially offset the bearish data.",
    ],
  },
  stimulus_announcement: {
    event_family: "stimulus_announcement",
    default_title: () => "China announces major stimulus package",
    default_dominant_catalyst: "china-stimulus",
    primary_themes: ["china_stimulus", "policy_pivot", "risk_on"],
    primary_assets: ["FXI", "KWEB", "EEM", "MCHI"],
    tags: ["china_loader", "stimulus", "pboc", "fiscal", "policy"],
    regimes: ["china_policy_stimulus"],
    sectors: ["real_estate", "financials", "technology", "consumer"],
    buildLead: (item) =>
      `${defaultInstitution(item)} announced a major stimulus package targeting China's slowing economy, property sector, and equity markets — triggering a sharp reversal of China underweight positioning.`,
    buildReviewHints: () => [
      "Check whether the stimulus announcement drove a short squeeze in China underweight hedge fund positions or genuine fundamental re-rating.",
      "Review whether copper and iron ore rallied on the stimulus announcement as construction demand proxies.",
      "Confirm whether the stimulus detail (size, transmission mechanism) was sufficient to address the structural property downturn.",
    ],
  },
  reopening_trade: {
    event_family: "reopening_trade",
    default_title: () => "China reopening trade accelerates",
    default_dominant_catalyst: "china-reopening",
    primary_themes: ["china_reopening", "risk_on", "emerging_markets"],
    primary_assets: ["FXI", "KWEB", "EEM", "MCHI"],
    tags: ["china_loader", "reopening", "recovery", "china_trade"],
    regimes: ["china_reopening", "em_recovery"],
    sectors: ["consumer_discretionary", "technology", "materials", "travel"],
    buildLead: () =>
      "China's post-COVID reopening trade gained momentum as mobility data, high-frequency retail indicators, and border reopening confirmed a genuine economic recovery in the world's second-largest economy.",
    buildReviewHints: () => [
      "Check whether the reopening trade was already heavily priced by the time the economic data confirmed the recovery.",
      "Review whether global luxury goods, Asian casino stocks, and commodity equities outperformed broad EEM during the China reopening.",
      "Confirm whether the reopening recovery was eventually capped by the property sector downturn reasserting structural headwinds.",
    ],
  },
  us_china_tariff_escalation: {
    event_family: "us_china_tariff_escalation",
    default_title: () => "US-China tariff escalation — trade war shock",
    default_dominant_catalyst: "us-china-tariff-escalation",
    primary_themes: ["trade_war", "tariff_shock", "china_us_decoupling"],
    primary_assets: ["FXI", "EEM", "SPY"],
    tags: ["china_loader", "tariffs", "trade_war", "trump", "escalation"],
    regimes: ["trade_war", "risk_off"],
    sectors: ["technology", "consumer_discretionary", "industrials"],
    buildLead: () =>
      "The US-China trade war escalated with significant new tariff announcements, disrupting global supply chains, compressing corporate margins for China-exposed companies, and triggering a broad risk-off move in EM equities.",
    buildReviewHints: () => [
      "Check whether the tariff escalation was already partially priced by China equity underperformance in the weeks prior.",
      "Review whether supply chain beneficiaries (Vietnam, India, Mexico equities) outperformed China during tariff escalation.",
      "Confirm whether the USD strengthened or weakened on tariff announcements — the geopolitical dollar effect.",
    ],
  },
  tech_sector_selloff: {
    event_family: "tech_sector_selloff",
    default_title: () => "China tech selloff — regulatory overhang crystallizes",
    default_dominant_catalyst: "china-tech-selloff",
    primary_themes: ["china_regulation", "tech_selloff", "adr_delisting_risk"],
    primary_assets: ["KWEB", "BABA", "FXI", "BIDU"],
    tags: ["china_loader", "tech", "kweb", "regulatory", "selloff"],
    regimes: ["china_regulatory_risk"],
    sectors: ["technology"],
    buildLead: () =>
      "China's technology sector experienced a broad selloff driven by regulatory risk crystallization, ADR delisting fears, or specific enforcement actions that undermined the investability thesis for Chinese tech equities.",
    buildReviewHints: () => [
      "Check whether the selloff was driven by new regulatory announcements or simply the market processing existing overhang.",
      "Review whether Hong Kong H-share listings of Chinese tech companies outperformed US ADRs on delisting fears.",
      "Confirm whether KWEB's decline reflected a structural re-rating of China tech or a cyclical overshoot.",
    ],
  },
  deflation_data: {
    event_family: "deflation_data",
    default_title: () => "China CPI falls into deflation — deflationary spiral risk",
    default_dominant_catalyst: "china-deflation",
    primary_themes: ["china_deflation", "demand_collapse", "consumer_weakness"],
    primary_assets: ["FXI", "EEM", "MCHI"],
    tags: ["china_loader", "deflation", "cpi", "ppi", "consumer_weakness"],
    regimes: ["china_slowdown", "deflation_risk"],
    sectors: ["consumer_staples", "consumer_discretionary", "industrials"],
    buildLead: () =>
      "China reported deflation in consumer prices, confirming that domestic demand was insufficient to sustain positive pricing power — raising the spectre of a Japan-style deflationary trap that would be structurally bearish for corporate earnings.",
    buildReviewHints: () => [
      "Check whether Chinese government bonds rallied (yields fell) on deflation data — bond market pricing persistent rate cuts.",
      "Review whether the deflation reading prompted analyst comparisons to Japan's Lost Decade — a structural re-rating catalyst.",
      "Confirm whether yuan weakness accompanied the deflation reading as capital sought higher-yielding assets abroad.",
    ],
  },
  party_congress: {
    event_family: "party_congress",
    default_title: () => "CCP Party Congress — leadership and policy direction",
    default_dominant_catalyst: "china-political-event",
    primary_themes: ["china_political_risk", "xi_risk_premium", "policy_direction"],
    primary_assets: ["FXI", "KWEB", "BABA", "MCHI"],
    tags: ["china_loader", "ccp", "party_congress", "political_risk", "xi"],
    regimes: ["china_political_risk"],
    sectors: ["technology", "consumer_discretionary", "financials"],
    buildLead: () =>
      "A CCP Party Congress or key political event reshaped China's leadership structure and policy direction, with markets pricing the implications for private sector regulatory risk, economic policy, and the geopolitical risk premium on Chinese assets.",
    buildReviewHints: () => [
      "Check whether the politburo composition (technocrats vs. loyalists) was the key variable in the market's reaction.",
      "Review whether Xi's consolidation of power was incrementally priced or whether Party Congress outcomes caused discrete repricing.",
      "Confirm whether the 'Xi risk premium' concept — a discount on Chinese equities for operating at CCP sufferance — was cited in analyst reports post-Congress.",
    ],
  },
  ev_sector_surge: {
    event_family: "ev_sector_surge",
    default_title: (item) => `${defaultInstitution(item)} China EV sector milestone`,
    default_dominant_catalyst: "china-ev-sector-surge",
    primary_themes: ["china_ev", "industrial_policy", "supply_chain_dominance"],
    primary_assets: ["BYDDY", "NIO", "LI", "XPEV"],
    tags: ["china_loader", "ev", "byd", "china_industrial_policy", "battery"],
    regimes: ["china_industrial_champion", "ev_adoption"],
    sectors: ["consumer_discretionary", "technology", "materials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} achieved a milestone in China's EV sector dominance, reflecting China's strategic industrial policy investment in battery technology, supply chain control, and manufacturing scale.`,
    buildReviewHints: () => [
      "Check whether Western EV manufacturers (Tesla, legacy OEMs) sold off in sympathy with Chinese EV strength on competitive threat fears.",
      "Review whether CATL and lithium/battery material stocks moved on Chinese EV delivery milestones.",
      "Confirm whether the milestone triggered European EV tariff discussions — the trade policy response to China's industrial dominance.",
    ],
  },
};

const buildSource = (
  item: ChinaHistoricalCaseInput,
  preset: ChinaPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultInstitution(item)} / China Macro Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: ChinaHistoricalCaseInput,
  preset: ChinaPreset,
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
    `Loaded via China macro historical preset: ${item.event_type} for ${defaultInstitution(item)}.`,
});

const toHistoricalDraft = (item: ChinaHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = CHINA_PRESETS[item.event_type];

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

export const buildChinaHistoricalLibraryDrafts = (
  request: ChinaHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestChinaHistoricalCases = async (
  services: AppServices,
  request: ChinaHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildChinaHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
