import type {
  CreateSourceRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  PolicyHistoricalCaseInput,
  PolicyHistoricalIngestionRequest,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type PolicyPreset = {
  event_family: string;
  source_type: CreateSourceRequest["source_type"];
  default_title: (item: PolicyHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  buildLead: (item: PolicyHistoricalCaseInput) => string;
  buildReviewHints: (item: PolicyHistoricalCaseInput) => string[];
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

const mapSignalToSurprise = (signal: PolicyHistoricalCaseInput["signal_bias"]) =>
  signal === "positive" || signal === "supportive"
    ? "positive"
    : signal === "negative" || signal === "restrictive"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const normalizedRegion = (item: PolicyHistoricalCaseInput) =>
  item.region?.trim() ? item.region.trim() : item.country.trim().toLowerCase().replace(/\s+/g, "_");

const isChinaRelated = (item: PolicyHistoricalCaseInput) => {
  const normalizedCountry = item.country.trim().toLowerCase();
  const normalizedPair = item.currency_pair?.trim().toLowerCase() ?? "";

  return (
    normalizedCountry.includes("china") ||
    normalizedCountry.includes("hong kong") ||
    normalizedPair.includes("cnh") ||
    normalizedPair.includes("cny")
  );
};

const policySpecificRegimes = (item: PolicyHistoricalCaseInput) => {
  const values = new Set<string>();

  if (item.event_type === "trade_escalation") {
    values.add("tariff_escalation");
    values.add("geopolitical_risk");
  }

  if (item.event_type === "trade_relief") {
    values.add("tariff_relief");
  }

  if (item.event_type === "stimulus_support") {
    values.add("policy_support");
    if (isChinaRelated(item)) {
      values.add("china_stimulus");
    }
  }

  if (item.event_type === "fx_intervention") {
    values.add("fx_intervention");
  }

  if (item.event_type === "capital_controls") {
    values.add("capital_controls");
  }

  if (item.event_type === "sovereign_credit" || item.event_type === "fiscal_shock") {
    values.add("sovereign_stress");
  }

  if (item.event_type === "regulatory_crackdown") {
    values.add("regulatory_crackdown");
    if (isChinaRelated(item)) {
      values.add("china_policy_risk");
    }
  }

  if (item.event_type === "sanctions") {
    values.add("geopolitical_risk");
  }

  if (item.event_type === "geopolitical_deescalation") {
    values.add("geopolitical_relief");
  }

  return [...values];
};

const POLICY_PRESETS: Record<PolicyHistoricalCaseInput["event_type"], PolicyPreset> = {
  trade_escalation: {
    event_family: "trade_escalation",
    source_type: "headline",
    default_title: (item) => `${item.country} trade restrictions escalate`,
    default_dominant_catalyst: "trade-escalation",
    primary_themes: ["trade_policy"],
    primary_assets: ["FXI", "KWEB", "USD/CNH", "DXY"],
    tags: ["policy_loader", "trade_policy", "escalation"],
    regimes: ["policy_shock", "cross_border_risk"],
    buildLead: (item) =>
      `${item.country} signaled harder trade restrictions and markets had to reprice cross-border risk, supply chains, and FX sensitivity.`,
    buildReviewHints: () => [
      "Check whether the move was driven by the policy headline itself or by follow-up retaliation expectations.",
      "Review whether FX, local equities, and US-listed proxies all moved in the same direction.",
      "Confirm whether the first reaction faded once investors focused on carve-outs or exemptions.",
    ],
  },
  trade_relief: {
    event_family: "trade_relief",
    source_type: "headline",
    default_title: (item) => `${item.country} trade relief supports risk appetite`,
    default_dominant_catalyst: "trade-relief",
    primary_themes: ["trade_policy", "stimulus"],
    primary_assets: ["FXI", "KWEB", "USD/CNH", "SPY"],
    tags: ["policy_loader", "trade_policy", "relief"],
    regimes: ["policy_relief", "cross_border_risk"],
    buildLead: (item) =>
      `${item.country} signaled trade relief or exemptions, easing supply-chain pressure and supporting broader risk appetite.`,
    buildReviewHints: () => [
      "Check whether the relief changed medium-term expectations or only helped a short squeeze.",
      "Review whether local and global equities both participated in the relief move.",
      "Confirm whether the FX move supported the same interpretation as equities.",
    ],
  },
  stimulus_support: {
    event_family: "stimulus_support",
    source_type: "headline",
    default_title: (item) => `${item.country} stimulus support lifts markets`,
    default_dominant_catalyst: "stimulus-support",
    primary_themes: ["stimulus", "fx_policy"],
    primary_assets: ["FXI", "KWEB", "USD/CNH", "SPY"],
    tags: ["policy_loader", "stimulus", "support"],
    regimes: ["policy_support", "cross_border_risk"],
    buildLead: (item) =>
      `${item.country} signaled policy support and liquidity relief, improving local growth expectations and cross-asset risk sentiment.`,
    buildReviewHints: () => [
      "Check whether the market believed the stimulus package was credible or only headline support.",
      "Review whether the currency stabilized with equities or diverged.",
      "Confirm whether the move was sustained after investors sized the package details.",
    ],
  },
  fx_intervention: {
    event_family: "fx_intervention",
    source_type: "headline",
    default_title: (item) => `${item.country} intervenes in FX markets`,
    default_dominant_catalyst: "fx-intervention",
    primary_themes: ["fx_policy"],
    primary_assets: ["USD/JPY", "USD/CNH", "DXY", "TLT"],
    tags: ["policy_loader", "fx", "intervention"],
    regimes: ["fx_regime", "policy_shock"],
    buildLead: (item) =>
      `${item.country} intervened or signaled intervention in FX markets, changing the path for the local currency and cross-asset risk pricing.`,
    buildReviewHints: () => [
      "Check whether the intervention changed the trend or only caused a short-lived squeeze.",
      "Review whether local equities reacted in the same direction as the currency move.",
      "Confirm whether bond markets treated the intervention as credible policy support.",
    ],
  },
  capital_controls: {
    event_family: "capital_controls",
    source_type: "headline",
    default_title: (item) => `${item.country} tightens capital controls`,
    default_dominant_catalyst: "capital-controls",
    primary_themes: ["sovereign_risk", "fx_policy"],
    primary_assets: ["USD/CNH", "FXI", "EEM", "DXY"],
    tags: ["policy_loader", "capital_controls", "sovereign"],
    regimes: ["sovereign_risk", "policy_shock"],
    buildLead: (item) =>
      `${item.country} tightened capital controls, forcing investors to reprice sovereign policy risk, FX access, and local equity exposure.`,
    buildReviewHints: () => [
      "Check whether the market treated the measure as temporary management or a deeper regime signal.",
      "Review whether offshore vehicles and local proxies moved differently.",
      "Confirm whether broader EM risk assets reacted beyond the home market.",
    ],
  },
  sovereign_credit: {
    event_family: "sovereign_credit",
    source_type: "headline",
    default_title: (item) => `${item.country} sovereign credit pressure hits markets`,
    default_dominant_catalyst: "sovereign-credit",
    primary_themes: ["sovereign_risk"],
    primary_assets: ["TLT", "DXY", "EWU", "FXI"],
    tags: ["policy_loader", "sovereign", "credit"],
    regimes: ["sovereign_risk", "rates_volatility"],
    buildLead: (item) =>
      `${item.country} faced a sovereign credit or ratings shock, changing local rates, currency risk, and regional equity sentiment.`,
    buildReviewHints: () => [
      "Check whether rates, FX, and equities all confirmed the sovereign-stress read.",
      "Review whether the move stayed local or spilled into global duration and risk assets.",
      "Confirm whether fiscal response messaging softened or worsened the market reaction.",
    ],
  },
  fiscal_shock: {
    event_family: "fiscal_shock",
    source_type: "headline",
    default_title: (item) => `${item.country} fiscal policy shock reprices markets`,
    default_dominant_catalyst: "fiscal-shock",
    primary_themes: ["sovereign_risk", "rates"],
    primary_assets: ["TLT", "DXY", "EWU", "SPY"],
    tags: ["policy_loader", "fiscal", "sovereign"],
    regimes: ["sovereign_risk", "rates_volatility"],
    buildLead: (item) =>
      `${item.country} introduced a fiscal shock that forced investors to reassess sovereign credibility, duration risk, and local asset premia.`,
    buildReviewHints: () => [
      "Check whether the reaction was driven by the policy size, funding concerns, or credibility damage.",
      "Review whether FX and rates moved together in a coherent sovereign-stress pattern.",
      "Confirm whether policy reversals or central-bank intervention changed the closing move.",
    ],
  },
  regulatory_crackdown: {
    event_family: "regulatory_crackdown",
    source_type: "headline",
    default_title: (item) => `${item.country} regulatory crackdown pressures markets`,
    default_dominant_catalyst: "regulatory-crackdown",
    primary_themes: ["trade_policy", "china_risk"],
    primary_assets: ["KWEB", "FXI", "BABA", "USD/CNH"],
    tags: ["policy_loader", "regulation", "crackdown"],
    regimes: ["policy_shock", "sector_regulation"],
    buildLead: (item) =>
      `${item.country} intensified regulatory pressure, forcing investors to reprice policy risk across exposed sectors and FX-linked assets.`,
    buildReviewHints: () => [
      "Check whether the crackdown affected one sector or changed the country risk premium more broadly.",
      "Review whether offshore listings, local proxies, and the currency all confirmed the move.",
      "Confirm whether later policy clarification softened the reaction.",
    ],
  },
  sanctions: {
    event_family: "sanctions",
    source_type: "headline",
    default_title: (item) => `${item.country} sanctions shock hits risk assets`,
    default_dominant_catalyst: "sanctions",
    primary_themes: ["sanctions_policy", "defense"],
    primary_assets: ["XLE", "ITA", "DXY", "USD/CNH"],
    tags: ["policy_loader", "sanctions", "geopolitics"],
    regimes: ["policy_shock", "geopolitical_risk"],
    buildLead: (item) =>
      `${item.country} faced or imposed sanctions that changed commodity flows, defense risk, and broader geopolitical pricing.`,
    buildReviewHints: () => [
      "Check whether the sanctions impacted commodities, defense names, or the sanctioned market most directly.",
      "Review whether the move was first-order policy pricing or second-order supply-chain repricing.",
      "Confirm whether safe-haven FX and rates moved with the same geopolitical read.",
    ],
  },
  geopolitical_deescalation: {
    event_family: "geopolitical_deescalation",
    source_type: "headline",
    default_title: (item) => `${item.country} policy de-escalation supports relief`,
    default_dominant_catalyst: "policy-deescalation",
    primary_themes: ["stimulus", "fx_policy"],
    primary_assets: ["SPY", "FXI", "USD/CNH", "XLE"],
    tags: ["policy_loader", "deescalation", "relief"],
    regimes: ["policy_relief", "geopolitical_relief"],
    buildLead: (item) =>
      `${item.country} signaled policy or geopolitical de-escalation, easing risk premiums across local FX and related equities.`,
    buildReviewHints: () => [
      "Check whether the de-escalation changed the medium-term narrative or only reversed the most recent panic move.",
      "Review whether commodities, FX, and equities all confirmed the relief read.",
      "Confirm whether later official statements reinforced or diluted the relief signal.",
    ],
  },
};

/** Fallback preset for extended policy event types (policy_shift, fx_regime_shift, geopolitical_shock, etc.) */
const POLICY_GENERIC_PRESET: PolicyPreset = {
  event_family: "policy_event",
  source_type: "headline",
  default_title: (item) => `${item.country} policy development moves markets`,
  default_dominant_catalyst: "policy-event",
  primary_themes: ["central_bank", "trade_policy", "geopolitics"],
  primary_assets: ["SPY", "TLT", "DXY"],
  tags: ["policy_loader", "policy_event"],
  regimes: ["policy_transition", "macro_rates"],
  buildLead: (item) =>
    `${item.country} generated a significant policy development that shifted market expectations and repriced risk assets, currencies, and rates.`,
  buildReviewHints: () => [
    "Check whether the policy event changed the medium-term rates or growth narrative.",
    "Review whether FX, equities, and bonds all confirmed the same policy interpretation.",
    "Confirm whether subsequent official commentary reinforced or reversed the initial move.",
  ],
};

const buildSource = (item: PolicyHistoricalCaseInput, preset: PolicyPreset): CreateSourceRequest => ({
  source_type: preset.source_type,
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${item.country} Policy Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: PolicyHistoricalCaseInput,
  preset: PolicyPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.country,
    item.event_type,
    item.signal_bias,
    item.currency_pair,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([
    ...(item.labels?.regimes ?? []),
    ...preset.regimes,
    ...policySpecificRegimes(item),
  ]),
  regions: unique([...(item.labels?.regions ?? []), normalizedRegion(item)]),
  sectors: item.labels?.sectors,
  primary_themes: unique([...(item.labels?.primary_themes ?? []), ...preset.primary_themes]),
  primary_assets: unique([
    ...(item.focus_assets ?? []),
    ...(item.currency_pair ? [item.currency_pair] : []),
    ...preset.primary_assets,
    ...(item.labels?.primary_assets ?? []),
  ]).slice(0, 8),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type: item.labels?.surprise_type ?? mapSignalToSurprise(item.signal_bias),
  case_quality: item.labels?.case_quality,
  notes:
    item.labels?.notes ??
    `Loaded via policy historical preset: ${item.event_type} for ${item.country}.`,
});

const toHistoricalDraft = (item: PolicyHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = (POLICY_PRESETS as Record<string, PolicyPreset>)[item.event_type] ?? POLICY_GENERIC_PRESET;

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

export const buildPolicyHistoricalLibraryDrafts = (
  request: PolicyHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestPolicyHistoricalCases = async (
  services: AppServices,
  request: PolicyHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildPolicyHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
