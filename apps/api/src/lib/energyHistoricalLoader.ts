import type {
  CreateSourceRequest,
  EnergyHistoricalCaseInput,
  EnergyHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type EnergyPreset = {
  event_family: string;
  default_title: (item: EnergyHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: EnergyHistoricalCaseInput) => string;
  buildReviewHints: (item: EnergyHistoricalCaseInput) => string[];
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

const defaultRegion = (item: EnergyHistoricalCaseInput) =>
  item.region?.trim() || (item.market === "natural_gas" ? "north_america" : "global");

const defaultProducer = (item: EnergyHistoricalCaseInput) =>
  item.producer?.trim() || (item.event_type.startsWith("opec") ? "OPEC+" : "Energy market");

const mapSignalToSurprise = (signal: EnergyHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const energySpecificRegimes = (item: EnergyHistoricalCaseInput) => {
  const values = new Set<string>();

  if (["opec_cut", "supply_disruption", "gas_spike", "inventory_draw"].includes(item.event_type)) {
    values.add("energy_shock");
  }

  if (["opec_raise", "inventory_build"].includes(item.event_type)) {
    values.add("energy_relief");
  }

  if (item.event_type === "demand_shock") {
    values.add("global_growth_repricing");
  }

  return [...values];
};

const ENERGY_PRESETS: Record<EnergyHistoricalCaseInput["event_type"], EnergyPreset> = {
  opec_cut: {
    event_family: "opec_cut",
    default_title: (item) => `${defaultProducer(item)} signals an oil output cut`,
    default_dominant_catalyst: "opec-cut",
    primary_themes: ["energy", "energy_supply", "inflation"],
    primary_assets: ["CL=F", "USO", "XLE", "XOM", "CVX"],
    tags: ["energy_loader", "opec", "supply_cut"],
    regimes: ["commodity_volatility", "inflation_sensitive"],
    sectors: ["energy"],
    buildLead: (item) =>
      `${defaultProducer(item)} signaled an output cut that tightened crude balances and forced markets to reprice oil, energy equities, and inflation risk.`,
    buildReviewHints: () => [
      "Check whether front-month crude and the energy-equity move confirmed the same supply-tightening read.",
      "Review whether breakevens or bond yields echoed the inflation impulse from the oil move.",
      "Confirm whether the move held once details on compliance and duration were better understood.",
    ],
  },
  opec_raise: {
    event_family: "opec_raise",
    default_title: (item) => `${defaultProducer(item)} signals a supply increase`,
    default_dominant_catalyst: "opec-raise",
    primary_themes: ["energy", "energy_supply"],
    primary_assets: ["CL=F", "USO", "XLE", "XOM", "CVX"],
    tags: ["energy_loader", "opec", "supply_increase"],
    regimes: ["commodity_volatility", "global_growth"],
    sectors: ["energy"],
    buildLead: (item) =>
      `${defaultProducer(item)} opened the door to more supply, easing crude tightness and pressuring oil-linked risk assets.`,
    buildReviewHints: () => [
      "Check whether the added supply changed only the first move or the entire forward curve.",
      "Review whether refiners, integrated oils, and the broad energy ETF reacted differently.",
      "Confirm whether macro demand worries amplified the downside reaction in crude.",
    ],
  },
  supply_disruption: {
    event_family: "energy_supply_disruption",
    default_title: () => "Energy supply disruption reshapes the commodity path",
    default_dominant_catalyst: "energy-supply-disruption",
    primary_themes: ["energy", "energy_supply"],
    primary_assets: ["CL=F", "USO", "XLE", "XOP"],
    tags: ["energy_loader", "supply_disruption", "commodity_shock"],
    regimes: ["commodity_volatility", "geopolitical_risk"],
    sectors: ["energy"],
    buildLead: (item) =>
      `${defaultProducer(item)} faced a supply disruption that tightened the energy balance and pushed markets to reprice oil-sensitive assets.`,
    buildReviewHints: () => [
      "Check whether the disruption hit prompt supply only or changed the medium-term curve shape as well.",
      "Review whether energy producers, airlines, and inflation-sensitive assets all responded coherently.",
      "Confirm whether official repair or restart timelines reversed the move later in the session.",
    ],
  },
  inventory_draw: {
    event_family: "energy_inventory_draw",
    default_title: () => "Energy inventories draw faster than expected",
    default_dominant_catalyst: "inventory-draw",
    primary_themes: ["energy", "energy_supply"],
    primary_assets: ["CL=F", "USO", "XLE", "XOP"],
    tags: ["energy_loader", "inventory", "draw"],
    regimes: ["commodity_volatility", "inflation_sensitive"],
    sectors: ["energy"],
    buildLead: (item) =>
      `${defaultProducer(item)} showed a larger inventory draw than expected, tightening the prompt market and supporting energy-sensitive assets.`,
    buildReviewHints: () => [
      "Check whether the inventory draw mattered more than refinery utilization or product balances.",
      "Review whether crude and product markets confirmed the same tightening narrative.",
      "Confirm whether the draw held through the close or was faded by broader risk sentiment.",
    ],
  },
  inventory_build: {
    event_family: "energy_inventory_build",
    default_title: () => "Energy inventories build and pressure the complex",
    default_dominant_catalyst: "inventory-build",
    primary_themes: ["energy", "energy_supply"],
    primary_assets: ["CL=F", "USO", "XLE", "XOP"],
    tags: ["energy_loader", "inventory", "build"],
    regimes: ["commodity_volatility", "global_growth"],
    sectors: ["energy"],
    buildLead: (item) =>
      `${defaultProducer(item)} showed an inventory build that loosened the prompt balance and weighed on energy prices and producers.`,
    buildReviewHints: () => [
      "Check whether the build was crude-specific or driven by weaker end-product demand.",
      "Review whether the move reflected a supply loosening or a growth scare embedded in inventories.",
      "Confirm whether energy equities kept pace with the commodity move or diverged.",
    ],
  },
  gas_spike: {
    event_family: "natural_gas_spike",
    default_title: () => "Natural gas spike tightens the inflation backdrop",
    default_dominant_catalyst: "natural-gas-spike",
    primary_themes: ["energy", "inflation"],
    primary_assets: ["NG=F", "UNG", "XLE", "XLU"],
    tags: ["energy_loader", "natural_gas", "price_spike"],
    regimes: ["commodity_volatility", "inflation_sensitive"],
    sectors: ["energy", "utilities"],
    buildLead: (item) =>
      `${defaultProducer(item)} triggered a sharp natural-gas move, tightening the inflation backdrop and changing the path for gas-sensitive equities.`,
    buildReviewHints: () => [
      "Check whether utilities, producers, and inflation proxies agreed on the significance of the gas spike.",
      "Review whether the move was weather-driven, storage-driven, or policy-driven.",
      "Confirm whether the spike faded once updated supply or storage data arrived.",
    ],
  },
  demand_shock: {
    event_family: "energy_demand_shock",
    default_title: () => "Energy demand shock shifts global-growth pricing",
    default_dominant_catalyst: "energy-demand-shock",
    primary_themes: ["energy", "global_growth"],
    primary_assets: ["CL=F", "XLE", "XLI", "SPY"],
    tags: ["energy_loader", "demand_shock", "global_growth"],
    regimes: ["global_growth", "commodity_volatility"],
    sectors: ["energy", "industrials"],
    buildLead: (item) =>
      `${defaultProducer(item)} shifted the demand outlook for energy markets, forcing investors to reprice crude, cyclicals, and broader growth-sensitive assets.`,
    buildReviewHints: () => [
      "Check whether the move was really about energy demand or a broader global-growth repricing.",
      "Review whether industrials and transports confirmed the same macro signal as crude.",
      "Confirm whether the first move reversed once competing macro data hit the tape.",
    ],
  },
};

/** Fallback preset for extended energy event types (geopolitical_shock, opec_increase, spr_release, supply_expansion, etc.) */
const ENERGY_GENERIC_PRESET: EnergyPreset = {
  event_family: "energy_event",
  default_title: () => "Energy market event shifts crude and commodity pricing",
  default_dominant_catalyst: "energy-event",
  primary_themes: ["energy", "inflation", "geopolitics"],
  primary_assets: ["CL=F", "USO", "XLE", "SPY"],
  tags: ["energy_loader", "energy_event"],
  regimes: ["commodity_volatility", "inflation_sensitive"],
  sectors: ["energy"],
  buildLead: (item) =>
    `An energy market development shifted the supply-demand balance, repricing crude, energy equities, and inflation-sensitive assets.`,
  buildReviewHints: () => [
    "Check whether the energy event changed the medium-term supply-demand narrative or was quickly faded.",
    "Review whether crude, energy equities, and broader inflation assets all moved in the same direction.",
    "Confirm whether refinery, pipeline, or geopolitical follow-through sustained or reversed the initial move.",
  ],
};

const buildSource = (item: EnergyHistoricalCaseInput, preset: EnergyPreset): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultProducer(item)} Energy Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: EnergyHistoricalCaseInput,
  preset: EnergyPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    item.market,
    item.producer,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([
    ...(item.labels?.regimes ?? []),
    ...preset.regimes,
    ...energySpecificRegimes(item),
  ]),
  regions: unique([...(item.labels?.regions ?? []), defaultRegion(item)]),
  sectors: unique([...(item.labels?.sectors ?? []), ...preset.sectors]),
  primary_themes: unique([...(item.labels?.primary_themes ?? []), ...preset.primary_themes]),
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
    `Loaded via energy historical preset: ${item.event_type} for ${item.market}.`,
});

const toHistoricalDraft = (item: EnergyHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = (ENERGY_PRESETS as Record<string, EnergyPreset>)[item.event_type] ?? ENERGY_GENERIC_PRESET;

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

export const buildEnergyHistoricalLibraryDrafts = (
  request: EnergyHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestEnergyHistoricalCases = async (
  services: AppServices,
  request: EnergyHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildEnergyHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
