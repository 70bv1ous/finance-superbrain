import type {
  CreateSourceRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  SovereignDebtHistoricalCaseInput,
  SovereignDebtHistoricalIngestionRequest,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type SovereignDebtPreset = {
  event_family: string;
  default_title: (item: SovereignDebtHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: SovereignDebtHistoricalCaseInput) => string;
  buildReviewHints: (item: SovereignDebtHistoricalCaseInput) => string[];
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

const defaultSovereign = (item: SovereignDebtHistoricalCaseInput) =>
  item.sovereign?.trim() || "sovereign";

const mapSignalToSurprise = (signal: SovereignDebtHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const SOVEREIGN_DEBT_PRESETS: Record<
  SovereignDebtHistoricalCaseInput["event_type"],
  SovereignDebtPreset
> = {
  treasury_auction_tail: {
    event_family: "treasury_auction_tail",
    default_title: () => "US Treasury auction tail — weak demand clears at higher yield than expected",
    default_dominant_catalyst: "treasury-auction-tail",
    primary_themes: ["treasury_auction_tail", "treasury_supply_shock", "bond_vigilantes"],
    primary_assets: ["TLT", "SPY", "DXY", "IEF"],
    tags: ["sovereign_loader", "treasury_auction", "tail", "supply_shock"],
    regimes: ["bond_vigilantes", "treasury_supply_stress"],
    sectors: ["bonds", "financials"],
    buildLead: (item) =>
      `A US Treasury auction tail${item.yield_at_event_bp ? ` (clearing yield ${(item.yield_at_event_bp / 100).toFixed(2)}%)` : ""} signaled weak demand absorption, with the clearing yield materially above the pre-auction when-issued price — intensifying bond vigilante concerns about the US government's ability to finance its deficit at sustainable rates.`,
    buildReviewHints: () => [
      "A Treasury auction tail is NOT a default signal — it is a supply/demand imbalance for a specific maturity. The next auction of the same tenor typically normalizes within 4-6 weeks as dealers clear inventory and the higher clearing yield attracts fresh buyers.",
      "The bid-to-cover ratio is a lagging signal; the tail (clearing yield minus when-issued yield) is the real-time signal. A tail greater than 3bp on a 30-year auction signals meaningful demand weakness; a tail above 5bp signals genuine absorption stress.",
      "Treasury auction supply shocks are seasonal: the August-November period typically has peak auction supply — demand weakness in this window is more predictive of sustained weakness than weakness in January-March when supply is lighter and demand is seasonally stronger.",
    ],
  },
  debt_ceiling_standoff: {
    event_family: "debt_ceiling_standoff",
    default_title: () => "US debt ceiling standoff — T-bill X-date yield inversion, default risk premium",
    default_dominant_catalyst: "us-debt-ceiling-x-date",
    primary_themes: ["debt_ceiling", "t_bill_inversion", "safe_haven_paradox", "fiscal_risk"],
    primary_assets: ["TLT", "GLD", "SPY", "VIX"],
    tags: ["sovereign_loader", "us", "debt_ceiling", "x_date", "t_bill_inversion"],
    regimes: ["fiscal_risk", "political_risk"],
    sectors: ["financials", "bonds", "precious_metals"],
    buildLead: () =>
      "A US debt ceiling standoff created a T-bill yield inversion around the X-date as markets priced a default risk premium — with the paradoxical safe-haven dynamic where gold outperformed US Treasuries as the ultimate hedge against US sovereign credit risk.",
    buildReviewHints: () => [
      "The cleanest signal of US debt ceiling default risk is the T-bill yield inversion around the X-date: when near-X-date bills yield 150bp+ over post-resolution bills, markets are pricing genuine default probability — more precise than VIX or equity selloffs.",
      "During US debt ceiling standoffs, GLD is a superior safe haven to TLT because TLT is itself exposed to the default risk — the paradox is that Treasuries become the risky asset, so gold becomes the 'ultimate' safe haven from US sovereign credit risk.",
      "US debt ceiling relief rallies are historically reliable: the political incentive structure (catastrophic consequences for Congress from actual default) ensures resolution before the X-date — buying SPY and GLD into the final week before X-date has been a high-conviction trade in every historical episode.",
    ],
  },
  sovereign_downgrade: {
    event_family: "sovereign_downgrade",
    default_title: (item) => `${defaultSovereign(item).toUpperCase()} sovereign credit downgrade — rating action and market repricing`,
    default_dominant_catalyst: "sovereign-credit-downgrade",
    primary_themes: ["sovereign_downgrade", "fiscal_credibility", "rating_action"],
    primary_assets: ["TLT", "SPY", "DXY", "GLD"],
    tags: ["sovereign_loader", "downgrade", "rating_action", "fiscal_credibility"],
    regimes: ["fiscal_risk", "safe_haven_paradox"],
    sectors: ["bonds", "financials"],
    buildLead: (item) =>
      `A sovereign credit downgrade for ${defaultSovereign(item)} by a major rating agency triggered a market repricing of the fiscal credibility premium — with potentially paradoxical reactions where the affected sovereign's currency or bonds moved contrary to the direction implied by the rating action.`,
    buildReviewHints: () => [
      "US sovereign downgrades produce paradoxical dollar reactions: both the 2011 S&P and 2023 Fitch downgrades caused the dollar to weaken because the 'safe haven from US risk' trade benefits gold and other reserve currencies — the downgrade is a US-specific risk that reduces dollar demand at the margin.",
      "Treasury yields can fall on a US downgrade (as in 2011) because 'flight to safety' demand overrides the credit rating action — when global investors need safety, they buy Treasuries regardless of the rating since no realistic substitute exists at scale.",
      "A sovereign downgrade is NOT a default signal — it is a signal of deteriorating fiscal trajectory and governance quality. The market impact is primarily on sentiment (2-4 week effect) rather than on fundamental investor flows, which are governed by mandate constraints that adjust slowly to rating changes.",
    ],
  },
  gilt_crisis: {
    event_family: "gilt_crisis",
    default_title: (item) => `${defaultSovereign(item).toUpperCase()} gilt/bond crisis — fiscal credibility collapse, emergency central bank intervention`,
    default_dominant_catalyst: "gilt-crisis-fiscal-credibility",
    primary_themes: ["gilt_crisis", "fiscal_credibility", "bond_vigilantes", "emergency_intervention"],
    primary_assets: ["TLT", "GLD", "EWU", "DXY"],
    tags: ["sovereign_loader", "gilt", "bond_vigilantes", "ldi", "fiscal_crisis"],
    regimes: ["bond_vigilantes", "fiscal_crisis"],
    sectors: ["bonds", "financials", "pension_funds"],
    buildLead: (item) =>
      `A ${defaultSovereign(item)} gilt/sovereign bond crisis erupted as an unfunded fiscal shock destroyed market confidence, forcing emergency central bank intervention — a definitive 'bond vigilante' moment where markets compelled policy reversal through yield spike and currency collapse.`,
    buildReviewHints: () => [
      "LDI (liability-driven investment) pension fund margin calls create a self-reinforcing gilt selloff feedback loop: levered duration hedging in pension funds amplifies bond selloffs into systemic crises when the initial fiscal shock is large enough to trigger margin calls.",
      "Combined gilt-and-currency selloffs (bond yields up AND currency down simultaneously) are the most severe fiscal credibility crisis signal — normally bonds and currency diverge, but when both sell off together, markets are pricing a loss of confidence in the entire fiscal framework.",
      "Emergency central bank gilt purchases (BoE in 2022) resolve the acute LDI margin call crisis but do not resolve the underlying fiscal credibility problem — the emergency QE stabilizes the mechanics while the political reversal (policy U-turn) resolves the fundamental cause.",
    ],
  },
  btp_bund_blowout: {
    event_family: "btp_bund_blowout",
    default_title: () => "Italy BTP-Bund spread blowout — eurozone redenomination risk pricing",
    default_dominant_catalyst: "btp-bund-spread-blowout",
    primary_themes: ["btp_bund_blowout", "eurozone_risk", "redenomination_risk", "political_risk"],
    primary_assets: ["EWI", "EURUSD", "TLT", "EWP"],
    tags: ["sovereign_loader", "italy", "btp", "bund", "spread", "eurozone", "redenomination"],
    regimes: ["eurozone_stress", "political_risk"],
    sectors: ["bonds", "financials"],
    buildLead: () =>
      "An Italian BTP-Bund spread blowout was amplified by 'redenomination risk' — the market's assessment that Italian bonds could be converted to a devalued new lira if Italy exited the eurozone — driving spreads far beyond pure credit risk levels and creating EUR/USD and contagion to Spanish bonds.",
    buildReviewHints: () => [
      "BTP-Bund spread blowouts combine credit risk AND redenomination risk (eurozone exit probability) — when the political narrative includes eurozone exit, spreads widen far beyond fundamental credit risk, making mean-reversion trades excellent when the exit narrative reverses.",
      "Spanish bond spread widening (40-80bp) is a reliable contagion signal from Italian political crises: BTP-Bund widening above 200bp historically triggers automatic Bono-Bund widening, creating a paired trade opportunity in Italian vs. Spanish ETFs.",
      "The ECB's 'whatever it takes' backstop (OMT/TPI) creates a ceiling on BTP-Bund spread widening — sustained widening above 400bp is self-limiting because it approaches the ECB intervention threshold, making short BTP positions above those levels high-risk.",
    ],
  },
  em_sovereign_default: {
    event_family: "em_sovereign_default",
    default_title: (item) => `${defaultSovereign(item).toUpperCase()} sovereign default — EM contagion, currency devaluation, banking stress`,
    default_dominant_catalyst: "em-sovereign-default",
    primary_themes: ["em_sovereign_default", "em_contagion", "currency_crisis", "banking_stress"],
    primary_assets: ["EEM", "GLD", "SPY", "EMBI"],
    tags: ["sovereign_loader", "em_default", "em_contagion", "currency_crisis"],
    regimes: ["sovereign_default", "em_contagion"],
    sectors: ["sovereign_debt", "financials", "em"],
    buildLead: (item) =>
      `${defaultSovereign(item).toUpperCase()} announced or completed a sovereign debt default, triggering the canonical EM contagion sequence: sovereign bond spreads blow out in neighboring economies, EM equities sell off, then EM currencies weaken as capital flight accelerates.`,
    buildReviewHints: () => [
      "EM sovereign default contagion follows a sequence: EM sovereign bonds first (immediate spread widening in neighboring countries), then EM equities (2-5 days), then EM currencies (as capital flight accelerates) — understanding this sequence enables staged risk reduction or entry.",
      "Currency pegs that require foreign debt (the 'original sin' of EM financing in dollars) create binary risk profiles: the peg holds until it breaks catastrophically (30-70% devaluation), making orderly exit nearly impossible and the devaluation magnitude far larger than in freely floating EM currencies.",
      "The domestic banking transmission of EM sovereign defaults (banks hold sovereign bonds → default → bank insolvency → credit contraction) is the most economically devastating secondary effect — the depth and duration of the economic contraction depends heavily on the banking sector's sovereign debt exposure.",
    ],
  },
  fiscal_shock: {
    event_family: "fiscal_shock",
    default_title: (item) => `${defaultSovereign(item).toUpperCase()} fiscal shock — unfunded policy triggers bond market stress`,
    default_dominant_catalyst: "fiscal-shock-bond-stress",
    primary_themes: ["fiscal_shock", "fiscal_credibility", "bond_market_stress"],
    primary_assets: ["TLT", "GLD", "SPY", "DXY"],
    tags: ["sovereign_loader", "fiscal_shock", "bond_stress", "credibility"],
    regimes: ["fiscal_crisis", "bond_market_stress"],
    sectors: ["bonds", "financials"],
    buildLead: (item) =>
      `A major fiscal shock from ${defaultSovereign(item)} — whether unfunded tax cuts, spending expansion, or central bank interference with orthodox monetary policy — triggered bond market stress as investors questioned the sustainability of the fiscal and monetary framework.`,
    buildReviewHints: () => [
      "Fiscal shocks that combine expansionary policy with non-orthodox monetary policy (e.g., Erdogan's anti-rate-hike stance) are the most dangerous because they eliminate the standard policy response mechanism — markets price a confidence crisis premium rather than just a fiscal risk premium.",
      "The currency is typically the first and most sensitive indicator of fiscal credibility stress: a currency selling off simultaneously with government bonds (not just bonds rallying or currency falling alone) is the signal that 'bond vigilantes' are fully engaged.",
      "Central bank independence signals are a binary risk factor for sovereign debt: when a government publicly overrides monetary policy, it triggers a self-fulfilling confidence collapse that creates the very crisis the government sought to avoid — policy U-turns (restoring independence) are the only reliable resolution.",
    ],
  },
  safe_haven_demand: {
    event_family: "safe_haven_demand",
    default_title: () => "Sovereign safe haven demand — flight to quality drives bond yields lower",
    default_dominant_catalyst: "safe-haven-sovereign-demand",
    primary_themes: ["safe_haven_demand", "flight_to_quality", "risk_off"],
    primary_assets: ["TLT", "GLD", "DXY", "SPY"],
    tags: ["sovereign_loader", "safe_haven", "flight_to_quality", "risk_off"],
    regimes: ["safe_haven", "risk_off"],
    sectors: ["bonds", "precious_metals"],
    buildLead: () =>
      "A flight-to-quality event drove safe-haven demand into high-grade sovereign bonds, compressing yields and generating mark-to-market gains for long-duration government bond positions — with gold and Treasuries competing as the 'ultimate' safe havens depending on the nature of the risk being hedged.",
    buildReviewHints: () => [
      "US Treasuries and gold compete as safe havens depending on the risk type: flight FROM global risk (geopolitical, EM crisis) benefits Treasuries most; flight FROM US-specific risk (debt ceiling, fiscal crisis) benefits gold most — identifying the risk source determines the safe haven hierarchy.",
      "Safe haven demand rallies in Treasuries are self-correcting if they overshoot fundamental value: when the flight-to-quality event resolves, the accumulated safe-haven premium unwinds rapidly — long-duration Treasury positions should have tight stop-losses after the resolving catalyst.",
      "The safe haven demand signal is clearest when Treasuries AND gold rally simultaneously (both benefit from different aspects of risk aversion), versus when only one rallies — the latter may reflect technical positioning or sector rotation rather than genuine flight-to-quality.",
    ],
  },
  treasury_supply_shock: {
    event_family: "treasury_supply_shock",
    default_title: () => "US Treasury supply shock — expanded auction sizes stress market absorption capacity",
    default_dominant_catalyst: "treasury-supply-shock",
    primary_themes: ["treasury_supply_shock", "bond_vigilantes", "fiscal_deficit", "auction_absorption"],
    primary_assets: ["TLT", "SPY", "DXY", "IEF"],
    tags: ["sovereign_loader", "treasury_supply", "shock", "auction_size", "fiscal"],
    regimes: ["bond_vigilantes", "treasury_supply_stress"],
    sectors: ["bonds", "financials"],
    buildLead: () =>
      "A US Treasury supply shock — driven by expanded auction sizes resulting from the widening fiscal deficit — stressed the market's absorption capacity, pushing yields higher as dealers struggled to distribute increased issuance and the bond vigilante narrative intensified.",
    buildReviewHints: () => [
      "Treasury supply shocks are measured by the gap between required issuance (deficit + maturing debt) and natural demand (foreign central bank purchases + domestic institutional demand): when this gap expands, yields must rise to attract marginal buyers, creating a 'term premium' expansion.",
      "The August 2023 Treasury supply shock announcement (expanded auction sizes across tenors) demonstrated that changes in Treasury supply calendars are tradeable events: the TLT fell 8% in the month following the announcement as markets repriced the term premium for higher supply.",
      "Treasury supply shocks are partially self-correcting: higher yields attract new buyers (pension funds, insurance companies) at better valuations — but the adjustment can take 3-6 months and require yields to reach levels that attract sufficient marginal demand to clear the expanded supply.",
    ],
  },
};

const buildSource = (
  item: SovereignDebtHistoricalCaseInput,
  preset: SovereignDebtPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  publisher:
    item.publisher?.trim() ||
    `Sovereign Debt Markets / ${defaultSovereign(item).toUpperCase()} Fiscal Events`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: SovereignDebtHistoricalCaseInput,
  preset: SovereignDebtPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    item.sovereign,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([...(item.labels?.regimes ?? []), ...preset.regimes]),
  regions: unique([...(item.labels?.regions ?? []), defaultSovereign(item)]),
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
    `Loaded via sovereign debt historical preset: ${item.event_type} for ${defaultSovereign(item)}${item.yield_at_event_bp ? ` (yield: ${item.yield_at_event_bp}bp)` : ""}.`,
});

const toHistoricalDraft = (
  item: SovereignDebtHistoricalCaseInput,
): HistoricalCaseLibraryDraft => {
  const preset = SOVEREIGN_DEBT_PRESETS[item.event_type];

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

export const buildSovereignDebtHistoricalLibraryDrafts = (
  request: SovereignDebtHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestSovereignDebtHistoricalCases = async (
  services: AppServices,
  request: SovereignDebtHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildSovereignDebtHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
