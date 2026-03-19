import type {
  CreateSourceRequest,
  GeopoliticalHistoricalCaseInput,
  GeopoliticalHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type GeopoliticalPreset = {
  event_family: string;
  default_title: (item: GeopoliticalHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: GeopoliticalHistoricalCaseInput) => string;
  buildReviewHints: (item: GeopoliticalHistoricalCaseInput) => string[];
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

const defaultInstitution = (item: GeopoliticalHistoricalCaseInput) =>
  item.institution?.trim() || "Geopolitical event";

const defaultRegion = (item: GeopoliticalHistoricalCaseInput) =>
  item.region?.trim() || "global";

const mapSignalToSurprise = (signal: GeopoliticalHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const GEOPOLITICAL_PRESETS: Record<GeopoliticalHistoricalCaseInput["event_type"], GeopoliticalPreset> = {
  us_election: {
    event_family: "us_election",
    default_title: () => "US presidential election — market reprices macro regime",
    default_dominant_catalyst: "us-election",
    primary_themes: ["us_election", "policy_regime_change", "macro_repricing"],
    primary_assets: ["SPY", "DXY", "TLT", "GLD"],
    tags: ["geopolitical_loader", "us_election", "policy_regime"],
    regimes: ["election_risk", "policy_transition"],
    sectors: ["financials", "defense", "clean_energy", "technology"],
    buildLead: (item) =>
      `${defaultInstitution(item)} won the US presidential election, triggering a significant macro regime repricing across USD, bonds, equities, and commodities as markets adjusted to the new administration's policy priorities.`,
    buildReviewHints: () => [
      "Check whether the 'Trump trade' or 'Biden trade' sector rotations delivered durable alpha or reversed in subsequent months.",
      "Review whether the USD moved in the expected direction and whether the move was sustained beyond election week.",
      "Confirm whether bond markets (TLT) correctly anticipated the fiscal implications of the incoming administration.",
    ],
  },
  em_election: {
    event_family: "em_election",
    default_title: (item) => `${defaultRegion(item)} election — political transition`,
    default_dominant_catalyst: "em-election",
    primary_themes: ["em_political_transition", "reform_risk", "currency_risk"],
    primary_assets: ["EEM", "GLD"],
    tags: ["geopolitical_loader", "em_election", "political_transition", "reform"],
    regimes: ["em_political_transition"],
    sectors: ["financials", "materials", "consumer"],
    buildLead: (item) =>
      `A significant election in ${defaultRegion(item)} triggered market repricing of the political risk premium, fiscal trajectory, and currency sustainability for the affected emerging market economy.`,
    buildReviewHints: () => [
      "Check whether the election outcome was priced in advance or genuinely surprised markets.",
      "Review whether currency moves (stronger or weaker) preceded equity moves — FX as the primary political risk transmission.",
      "Confirm whether the new government's first 100 days policies validated or contradicted the market's initial election reaction.",
    ],
  },
  geopolitical_conflict: {
    event_family: "geopolitical_conflict",
    default_title: (item) => `${defaultRegion(item)} geopolitical conflict — market shock`,
    default_dominant_catalyst: "geopolitical-conflict",
    primary_themes: ["geopolitical_conflict", "safe_haven", "commodity_shock"],
    primary_assets: ["GLD", "USO", "SPY"],
    tags: ["geopolitical_loader", "conflict", "war", "safe_haven", "geopolitical"],
    regimes: ["geopolitical_risk", "safe_haven"],
    sectors: ["energy", "defense", "precious_metals"],
    buildLead: (item) =>
      `A major geopolitical conflict erupted in ${defaultRegion(item)}, triggering a flight-to-safety bid in gold and sovereign bonds while commodity prices spiked on supply disruption fears.`,
    buildReviewHints: () => [
      "Check whether gold's safe haven rally was sustained or gave back gains as markets assessed the conflict's economic scope.",
      "Review whether energy prices reflected genuine supply disruption or were driven by risk premium that subsequently normalized.",
      "Confirm whether defense stocks provided durable alpha vs. simply spiking on the day of the conflict announcement.",
    ],
  },
  military_escalation: {
    event_family: "military_escalation",
    default_title: (item) => `${defaultRegion(item)} military escalation`,
    default_dominant_catalyst: "military-escalation",
    primary_themes: ["military_escalation", "middle_east_risk", "oil_risk_premium"],
    primary_assets: ["GLD", "USO", "LMT"],
    tags: ["geopolitical_loader", "military", "escalation", "risk_off"],
    regimes: ["geopolitical_risk"],
    sectors: ["energy", "defense", "precious_metals"],
    buildLead: (item) =>
      `A military escalation in ${defaultRegion(item)} triggered an immediate geopolitical risk premium in oil, gold, and defense stocks while equities sold off on uncertainty.`,
    buildReviewHints: () => [
      "Check whether the 'buy the rumor, sell the fact' pattern applied — pre-escalation positioning vs. post-event normalization.",
      "Review whether the escalation was contained or risked broadening into a wider regional conflict.",
      "Confirm whether defense stocks provided outsized alpha vs. energy stocks — markets pricing military vs. supply risk.",
    ],
  },
  sanctions_shock: {
    event_family: "sanctions_shock",
    default_title: (item) => `${defaultRegion(item)} sanctions shock`,
    default_dominant_catalyst: "sanctions-shock",
    primary_themes: ["sanctions_shock", "de_dollarization", "commodity_supply"],
    primary_assets: ["GLD", "USO", "EEM"],
    tags: ["geopolitical_loader", "sanctions", "reserve_weaponization", "geopolitical"],
    regimes: ["sanctions_regime", "geopolitical_risk"],
    sectors: ["energy", "financials", "precious_metals"],
    buildLead: (item) =>
      `Major sanctions on ${defaultRegion(item)} disrupted commodity supply chains, foreign reserve holdings, and payment systems — with structural implications for de-dollarization and the safety of USD-denominated reserve assets.`,
    buildReviewHints: () => [
      "Check whether the sanctions created durable supply disruption or were circumvented through third-party intermediaries.",
      "Review whether central bank gold buying accelerated following the sanctions as EM reserve managers diversified from USD.",
      "Confirm whether the sanctioned country's currency recovered or experienced sustained debasement.",
    ],
  },
  shipping_disruption: {
    event_family: "shipping_disruption",
    default_title: () => "Global shipping disruption — freight rates surge",
    default_dominant_catalyst: "shipping-disruption",
    primary_themes: ["shipping_disruption", "supply_chain", "freight_inflation"],
    primary_assets: ["ZIM", "SBLK", "USO"],
    tags: ["geopolitical_loader", "shipping", "freight", "supply_chain", "suez"],
    regimes: ["supply_chain_stress", "geopolitical_risk"],
    sectors: ["shipping", "industrials", "energy"],
    buildLead: () =>
      "A geopolitical shipping disruption forced vessels to reroute, causing freight rate spikes, supply chain delays, and renewed goods inflation concerns as alternative routes added significant cost and time.",
    buildReviewHints: () => [
      "Check whether the freight rate spike translated into measurable goods inflation in CPI data 2-3 months later.",
      "Review whether dry bulk and container shipping companies diverged — different route exposure to the disruption.",
      "Confirm whether the disruption was temporary (markets normalized quickly) or sustained (structural rerouting).",
    ],
  },
  strait_tension: {
    event_family: "strait_tension",
    default_title: () => "Taiwan Strait / strategic waterway tension",
    default_dominant_catalyst: "strait-tension",
    primary_themes: ["taiwan_risk", "semiconductor_supply", "china_us_tension"],
    primary_assets: ["TSM", "EWT", "FXI"],
    tags: ["geopolitical_loader", "taiwan", "strait", "semiconductor", "china"],
    regimes: ["geopolitical_risk", "china_us_tension"],
    sectors: ["technology", "semiconductors"],
    buildLead: () =>
      "Tensions in the Taiwan Strait or other strategic waterways escalated, triggering an immediate risk-off repricing of semiconductor supply chain vulnerabilities and China-US geopolitical risk premiums.",
    buildReviewHints: () => [
      "Check whether the TSMC geopolitical discount vs. South Korean peers widened on Taiwan Strait escalations.",
      "Review whether semiconductor supply chain diversification (TSMC Arizona, Samsung Texas) was cited as the mitigating factor.",
      "Confirm whether China's military exercises caused lasting market positioning changes or were quickly faded.",
    ],
  },
  em_currency_crisis: {
    event_family: "em_currency_crisis",
    default_title: (item) => `${defaultRegion(item)} currency crisis`,
    default_dominant_catalyst: "em-currency-crisis",
    primary_themes: ["currency_crisis", "em_stress", "capital_flight"],
    primary_assets: ["EEM", "GLD"],
    tags: ["geopolitical_loader", "currency_crisis", "em", "capital_flight"],
    regimes: ["em_currency_crisis", "political_risk"],
    sectors: ["financials", "consumer"],
    buildLead: (item) =>
      `${defaultRegion(item)} experienced a sharp currency crisis driven by unorthodox monetary policy, political interference in central bank independence, or a sudden stop in capital flows — creating acute EM contagion risk.`,
    buildReviewHints: () => [
      "Check whether the EM currency crisis was idiosyncratic (specific policy failure) or transmitted to other EM currencies.",
      "Review whether dollarization of domestic savings accelerated following the currency crisis — a permanent structural change.",
      "Confirm whether orthodox policy reversal (rate hikes, independent central bank) stabilized the currency.",
    ],
  },
  debt_ceiling_standoff: {
    event_family: "debt_ceiling_standoff",
    default_title: () => "US debt ceiling standoff — default risk premium spikes",
    default_dominant_catalyst: "us-debt-ceiling-default-risk",
    primary_themes: ["us_fiscal_risk", "debt_ceiling", "safe_haven_paradox"],
    primary_assets: ["TLT", "GLD", "SPY"],
    tags: ["geopolitical_loader", "debt_ceiling", "default", "treasury", "x_date"],
    regimes: ["political_risk", "fiscal_risk"],
    sectors: ["financials", "precious_metals"],
    buildLead: () =>
      "The US debt ceiling standoff escalated, with T-bill yields spiking around the 'X-date' as markets priced a default risk premium — creating the paradoxical safe haven scenario where gold outperformed US Treasuries.",
    buildReviewHints: () => [
      "Check whether the T-bill yield inversion (X-date bills vs. post-resolution bills) was the cleanest signal of default risk.",
      "Review whether GLD outperformed TLT during the debt ceiling — validating gold as the 'ultimate' safe haven from US credit risk.",
      "Confirm whether the bipartisan resolution created a clear relief rally in T-bills and equity markets.",
    ],
  },
  trade_war_escalation: {
    event_family: "trade_war_escalation",
    default_title: () => "Trade war tariff escalation — global growth shock",
    default_dominant_catalyst: "trade-war-escalation",
    primary_themes: ["trade_war", "tariff_shock", "global_growth_risk"],
    primary_assets: ["SPY", "EEM", "DXY", "GLD"],
    tags: ["geopolitical_loader", "tariffs", "trade_war", "escalation"],
    regimes: ["trade_war", "risk_off"],
    sectors: ["technology", "consumer_discretionary", "industrials"],
    buildLead: () =>
      "A major trade war tariff escalation disrupted global supply chains, compressed corporate margins for internationally exposed companies, and triggered a risk-off repricing of global growth expectations.",
    buildReviewHints: () => [
      "Check whether the tariff escalation was already partially priced in or genuinely surprised markets.",
      "Review whether supply chain beneficiary countries (Vietnam, India, Mexico) outperformed China during tariff escalation.",
      "Confirm whether the USD strengthened or weakened — tariff shock on the reserve currency creates conflicting directional signals.",
    ],
  },
  nuclear_diplomacy: {
    event_family: "nuclear_diplomacy",
    default_title: (item) => `${defaultRegion(item)} nuclear diplomacy event`,
    default_dominant_catalyst: "nuclear-diplomacy",
    primary_themes: ["geopolitical_risk", "nuclear_risk", "oil_supply"],
    primary_assets: ["USO", "GLD", "SPY"],
    tags: ["geopolitical_loader", "nuclear", "iran", "diplomacy", "nonproliferation"],
    regimes: ["geopolitical_risk"],
    sectors: ["energy", "defense", "precious_metals"],
    buildLead: (item) =>
      `A nuclear diplomacy development involving ${defaultRegion(item)} repriced Middle East geopolitical risk, oil supply chain security, and the broader non-proliferation risk premium.`,
    buildReviewHints: () => [
      "Check whether oil's nuclear deal reaction was driven by actual supply implications vs. geopolitical positioning.",
      "Review whether Israel's reaction to Iran nuclear developments was the primary market transmission mechanism.",
      "Confirm whether US-Iran nuclear deal progress caused OPEC supply strategy adjustments.",
    ],
  },
  assassination_event: {
    event_family: "assassination_event",
    default_title: (item) => `${defaultRegion(item)} high-profile assassination — geopolitical shock`,
    default_dominant_catalyst: "assassination-geopolitical",
    primary_themes: ["geopolitical_conflict", "safe_haven", "oil_risk_premium"],
    primary_assets: ["GLD", "USO", "LMT"],
    tags: ["geopolitical_loader", "assassination", "geopolitical", "risk_off"],
    regimes: ["geopolitical_risk"],
    sectors: ["energy", "defense", "precious_metals"],
    buildLead: (item) =>
      `A high-profile assassination in ${defaultRegion(item)} triggered an immediate geopolitical risk premium — with oil, gold, and defense stocks spiking as markets priced potential military retaliation and regional escalation.`,
    buildReviewHints: () => [
      "Check whether the 'spike and recover' pattern held — geopolitical events often cause brief dislocations that reverse within days.",
      "Review whether the assassination created a durable escalation cycle or was absorbed without lasting market impact.",
      "Confirm whether defense stocks (LMT, RTX) outperformed energy stocks (XLE) — military vs. supply chain risk pricing.",
    ],
  },
  constitutional_crisis: {
    event_family: "constitutional_crisis",
    default_title: (item) => `${defaultRegion(item)} constitutional or political crisis`,
    default_dominant_catalyst: "constitutional-political-crisis",
    primary_themes: ["political_crisis", "institutional_risk", "currency_stress"],
    primary_assets: ["GLD", "EEM"],
    tags: ["geopolitical_loader", "constitutional", "political_crisis", "risk_off"],
    regimes: ["political_risk"],
    sectors: ["financials", "currency"],
    buildLead: (item) =>
      `${defaultRegion(item)} experienced a major constitutional or political crisis that threatened institutional stability, disrupted currency markets, and raised the political risk premium on domestic assets.`,
    buildReviewHints: () => [
      "Check whether the crisis resolution (parliamentary vote, election, impeachment) created a clear market re-entry signal.",
      "Review whether currency weakness preceded equity weakness — FX as the first market to price political instability.",
      "Confirm whether the political crisis created lasting institutional damage or was absorbed without structural change.",
    ],
  },
  fiscal_policy_shock: {
    event_family: "fiscal_policy_shock",
    default_title: (item) => `${defaultRegion(item)} fiscal policy shock — market credibility crisis`,
    default_dominant_catalyst: "fiscal-credibility-crisis",
    primary_themes: ["fiscal_credibility", "bond_market", "currency_crisis"],
    primary_assets: ["TLT", "GLD"],
    tags: ["geopolitical_loader", "fiscal", "bond_market", "credibility", "currency"],
    regimes: ["fiscal_crisis", "bond_market_stress"],
    sectors: ["financials", "real_estate", "utilities"],
    buildLead: (item) =>
      `${defaultRegion(item)} announced a major fiscal policy shock that shattered bond market confidence, triggering a currency and gilt crisis as investors questioned the sustainability of public finances — forcing emergency central bank intervention.`,
    buildReviewHints: () => [
      "Check whether the fiscal shock created a 'bond vigilante' moment — markets forcing policy reversal.",
      "Review whether the LDI (liability-driven investment) or pension fund margin call dynamic amplified the bond selloff.",
      "Confirm whether the policy reversal (retreating from the fiscal shock) created a clear recovery signal in bonds and currency.",
    ],
  },
};

const buildSource = (
  item: GeopoliticalHistoricalCaseInput,
  preset: GeopoliticalPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultInstitution(item)} / Geopolitical Risk Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: GeopoliticalHistoricalCaseInput,
  preset: GeopoliticalPreset,
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
    `Loaded via geopolitical historical preset: ${item.event_type} for ${defaultInstitution(item)}.`,
});

const toHistoricalDraft = (item: GeopoliticalHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = GEOPOLITICAL_PRESETS[item.event_type];

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

export const buildGeopoliticalHistoricalLibraryDrafts = (
  request: GeopoliticalHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestGeopoliticalHistoricalCases = async (
  services: AppServices,
  request: GeopoliticalHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildGeopoliticalHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
