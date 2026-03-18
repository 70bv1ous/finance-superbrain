import type {
  CreateSourceRequest,
  EarningsHistoricalCaseInput,
  EarningsHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type EarningsPreset = {
  event_family: string;
  default_title: (item: EarningsHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  tags: string[];
  sectors: string[];
  peer_assets: string[];
  buildLead: (item: EarningsHistoricalCaseInput) => string;
  buildReviewHints: (item: EarningsHistoricalCaseInput) => string[];
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

const COMPANY_SOURCE_TYPE: CreateSourceRequest["source_type"] = "earnings";

const mapSignalToSurprise = (signal: EarningsHistoricalCaseInput["signal_bias"]) =>
  signal === "positive"
    ? "positive"
    : signal === "negative"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const earningsSpecificRegimes = (item: EarningsHistoricalCaseInput) => {
  const values = new Set<string>(["single_stock_fundamental", "earnings_season"]);

  if (item.event_type === "ai_capex_upside") {
    values.add("ai_momentum");
  }

  if (
    [
      "earnings_miss",
      "guidance_cut",
      "margin_pressure",
      "consumer_weakness",
      "cloud_slowdown",
      "management_tone_shift",
    ].includes(item.event_type)
  ) {
    values.add("earnings_reset");
  }

  if (["earnings_beat", "guidance_raise"].includes(item.event_type)) {
    values.add("earnings_momentum");
  }

  return [...values];
};

const EARNINGS_PRESETS: Record<EarningsHistoricalCaseInput["event_type"], EarningsPreset> = {
  earnings_beat: {
    event_family: "earnings_beat",
    default_title: (item) => `${item.company} beats and reinforces the quarter`,
    default_dominant_catalyst: "earnings-beat",
    primary_themes: ["earnings_guidance"],
    tags: ["earnings_loader", "earnings", "beat"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) delivered an earnings beat and gave investors a stronger read on the quarter.`,
    buildReviewHints: () => [
      "Check whether the stock traded on the headline beat or on forward guidance once the call began.",
      "Review whether peers moved in sympathy or if the reaction stayed company-specific.",
      "Confirm whether the move held after management commentary and Q&A.",
    ],
  },
  earnings_miss: {
    event_family: "earnings_miss",
    default_title: (item) => `${item.company} misses and disappoints the quarter`,
    default_dominant_catalyst: "earnings-miss",
    primary_themes: ["earnings_guidance"],
    tags: ["earnings_loader", "earnings", "miss"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) missed expectations and investors had to reprice the quality of the quarter.`,
    buildReviewHints: () => [
      "Check whether the damage came from the quarter itself or from weaker guidance layered on top.",
      "Review whether peer stocks followed the disappointment or diverged.",
      "Confirm whether the after-hours move expanded or reversed after the call.",
    ],
  },
  guidance_raise: {
    event_family: "guidance_raise",
    default_title: (item) => `${item.company} raises guidance`,
    default_dominant_catalyst: "guidance-raise",
    primary_themes: ["earnings_guidance"],
    tags: ["earnings_loader", "guidance", "raise"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) raised guidance and improved the forward earnings path for investors.`,
    buildReviewHints: () => [
      "Check whether the market cared more about the raise itself or about the implied quality of future demand.",
      "Review if peers rerated higher or if the move stayed idiosyncratic.",
      "Confirm whether management tone supported the raised outlook through Q&A.",
    ],
  },
  guidance_cut: {
    event_family: "guidance_cut",
    default_title: (item) => `${item.company} cuts guidance`,
    default_dominant_catalyst: "guidance-cut",
    primary_themes: ["earnings_guidance"],
    tags: ["earnings_loader", "guidance", "cut"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) cut guidance, forcing investors to reset the forward earnings outlook.`,
    buildReviewHints: () => [
      "Check whether the guidance cut mattered more than the quarter’s headline numbers.",
      "Review whether peers and suppliers moved with the reset.",
      "Confirm whether the stock stabilized after management explained the cut or kept trending lower.",
    ],
  },
  ai_capex_upside: {
    event_family: "ai_capex_upside",
    default_title: (item) => `${item.company} highlights AI demand and capex upside`,
    default_dominant_catalyst: "ai-capex-upside",
    primary_themes: ["ai_and_semis", "earnings_guidance"],
    tags: ["earnings_loader", "ai", "capex", "semiconductors"],
    sectors: ["technology", "semiconductors"],
    peer_assets: ["SOXX", "SMH", "QQQ"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) highlighted stronger AI demand and capex upside, improving the setup for semiconductor and infrastructure exposure.`,
    buildReviewHints: () => [
      "Check whether the move was driven by AI demand commentary or by formal guidance changes.",
      "Review if semiconductor peers and AI infrastructure names moved in line.",
      "Confirm whether the market treated the signal as durable demand or short-term enthusiasm.",
    ],
  },
  margin_pressure: {
    event_family: "margin_pressure",
    default_title: (item) => `${item.company} flags margin pressure`,
    default_dominant_catalyst: "margin-pressure",
    primary_themes: ["margin_pressure", "earnings_guidance"],
    tags: ["earnings_loader", "margin", "profitability"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) warned about margin pressure, forcing investors to reassess earnings quality and profitability durability.`,
    buildReviewHints: () => [
      "Check whether the move was driven by gross-margin pressure, opex growth, or pricing weakness.",
      "Review whether the margin issue spilled into peers or stayed company-specific.",
      "Confirm whether the stock recovered once management explained the cost path.",
    ],
  },
  consumer_weakness: {
    event_family: "consumer_weakness",
    default_title: (item) => `${item.company} signals consumer weakness`,
    default_dominant_catalyst: "consumer-weakness",
    primary_themes: ["consumer_demand", "earnings_guidance"],
    tags: ["earnings_loader", "consumer", "demand"],
    sectors: ["consumer_discretionary"],
    peer_assets: ["XLY", "XRT", "SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) signaled softer consumer demand, raising concern about discretionary spending and traffic trends.`,
    buildReviewHints: () => [
      "Check whether the weakness came from traffic, ticket size, promotions, or inventory.",
      "Review whether consumer peers confirmed the weakness or diverged.",
      "Confirm whether the stock reacted to demand softness or a broader guidance reset.",
    ],
  },
  cloud_slowdown: {
    event_family: "cloud_slowdown",
    default_title: (item) => `${item.company} flags cloud and enterprise slowdown`,
    default_dominant_catalyst: "cloud-slowdown",
    primary_themes: ["cloud_enterprise", "earnings_guidance"],
    tags: ["earnings_loader", "cloud", "enterprise", "software"],
    sectors: ["technology", "software"],
    peer_assets: ["IGV", "QQQ", "MSFT"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) described slower cloud and enterprise demand, weighing on software and growth expectations.`,
    buildReviewHints: () => [
      "Check whether the slowdown came from seats, bookings, pipeline, or larger-enterprise budgets.",
      "Review whether software peers repriced with the same message.",
      "Confirm whether management framed the slowdown as cyclical, competitive, or execution-driven.",
    ],
  },
  management_tone_shift: {
    event_family: "management_tone_shift",
    default_title: (item) => `${item.company} shifts management tone on the call`,
    default_dominant_catalyst: "management-tone-shift",
    primary_themes: ["earnings_guidance"],
    tags: ["earnings_loader", "management_tone", "call_takeaways"],
    sectors: [],
    peer_assets: ["SPY"],
    buildLead: (item) =>
      `${item.company} (${item.ticker}) shifted management tone on the call, changing how investors interpreted the quarter and the road ahead.`,
    buildReviewHints: () => [
      "Check whether the tone shift changed the stock’s direction after the initial print reaction.",
      "Review which exact call comments the market anchored on.",
      "Confirm whether the tone change altered peer sentiment or stayed company-specific.",
    ],
  },
};

const defaultSector = (item: EarningsHistoricalCaseInput, preset: EarningsPreset) =>
  item.sector?.trim() ? [item.sector.trim()] : preset.sectors;

const buildSource = (item: EarningsHistoricalCaseInput, preset: EarningsPreset): CreateSourceRequest => ({
  source_type: COMPANY_SOURCE_TYPE,
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${item.company} Investor Relations`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: EarningsHistoricalCaseInput,
  preset: EarningsPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.company,
    item.ticker,
    item.event_type,
    item.signal_bias,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([...(item.labels?.regimes ?? []), ...earningsSpecificRegimes(item)]),
  regions: unique([...(item.labels?.regions ?? []), "united_states"]),
  sectors: unique([...(item.labels?.sectors ?? []), ...defaultSector(item, preset)]),
  primary_themes: unique([...(item.labels?.primary_themes ?? []), ...preset.primary_themes]),
  primary_assets: unique([
    item.ticker,
    ...(item.peers ?? []),
    ...preset.peer_assets,
    ...(item.labels?.primary_assets ?? []),
  ]).slice(0, 8),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type: item.labels?.surprise_type ?? mapSignalToSurprise(item.signal_bias),
  case_quality: item.labels?.case_quality,
  notes:
    item.labels?.notes ??
    `Loaded via earnings historical preset: ${item.event_type} for ${item.company} (${item.ticker}).`,
});

const toHistoricalDraft = (item: EarningsHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = EARNINGS_PRESETS[item.event_type];

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

export const buildEarningsHistoricalLibraryDrafts = (
  request: EarningsHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestEarningsHistoricalCases = async (
  services: AppServices,
  request: EarningsHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildEarningsHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
