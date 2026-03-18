import type {
  CreateSourceRequest,
  CreditHistoricalCaseInput,
  CreditHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type CreditPreset = {
  event_family: string;
  default_title: (item: CreditHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: CreditHistoricalCaseInput) => string;
  buildReviewHints: (item: CreditHistoricalCaseInput) => string[];
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

const defaultInstitution = (item: CreditHistoricalCaseInput) =>
  item.institution?.trim() ||
  ({
    bank_run: "Regional banking system",
    deposit_flight: "Regional banking system",
    liquidity_backstop: "Central bank and banking system",
    credit_spread_widening: "Credit market",
    default_shock: "Corporate credit market",
    banking_contagion: "Global banking system",
    downgrade_wave: "Ratings and credit market",
  })[item.event_type];

const defaultRegion = (item: CreditHistoricalCaseInput) =>
  item.region?.trim() ||
  ({
    banking_contagion: "global",
    credit_spread_widening: "united_states",
    default_shock: "united_states",
    downgrade_wave: "united_states",
  } as Partial<Record<CreditHistoricalCaseInput["event_type"], string>>)[item.event_type] ||
  "united_states";

const mapSignalToSurprise = (signal: CreditHistoricalCaseInput["signal_bias"]) =>
  signal === "supportive"
    ? "positive"
    : signal === "negative"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const creditSpecificRegimes = (item: CreditHistoricalCaseInput) => {
  const values = new Set<string>();

  if (["bank_run", "deposit_flight", "banking_contagion"].includes(item.event_type)) {
    values.add("banking_stress");
  }

  if (["credit_spread_widening", "default_shock", "downgrade_wave"].includes(item.event_type)) {
    values.add("credit_stress");
  }

  if (item.event_type === "liquidity_backstop") {
    values.add("liquidity_backstop");
  }

  return [...values];
};

const CREDIT_PRESETS: Record<CreditHistoricalCaseInput["event_type"], CreditPreset> = {
  bank_run: {
    event_family: "bank_run",
    default_title: (item) => `${defaultInstitution(item)} shows bank-run stress`,
    default_dominant_catalyst: "bank-run-stress",
    primary_themes: ["banking_stress", "liquidity"],
    primary_assets: ["KRE", "XLF", "TLT", "DXY"],
    tags: ["credit_loader", "banking", "bank_run"],
    regimes: ["financial_stress", "liquidity_shock"],
    sectors: ["financials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} showed acute run-risk and liquidity stress, forcing investors to reprice regional banks, safe havens, and funding conditions.`,
    buildReviewHints: () => [
      "Check whether deposit-flight headlines or formal capital/liquidity data drove the lasting market move.",
      "Review whether regional banks, money-center banks, and rates all confirmed the same stress narrative.",
      "Confirm whether policy response headlines reversed part of the move before the close.",
    ],
  },
  deposit_flight: {
    event_family: "deposit_flight",
    default_title: (item) => `${defaultInstitution(item)} faces deposit flight`,
    default_dominant_catalyst: "deposit-flight",
    primary_themes: ["banking_stress", "liquidity"],
    primary_assets: ["KRE", "XLF", "TLT", "DXY"],
    tags: ["credit_loader", "banking", "deposit_flight"],
    regimes: ["financial_stress", "liquidity_shock"],
    sectors: ["financials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} faced deposit flight pressure, forcing markets to reassess bank funding stability and the path of financial conditions.`,
    buildReviewHints: () => [
      "Check whether deposit flight stayed idiosyncratic or became a sector-wide funding concern.",
      "Review whether rates and credit ETFs moved with the same stress signal as banks.",
      "Confirm whether the market focused on deposits, asset-liability mismatch, or regulatory response.",
    ],
  },
  liquidity_backstop: {
    event_family: "liquidity_backstop",
    default_title: () => "Authorities launch a banking liquidity backstop",
    default_dominant_catalyst: "liquidity-backstop",
    primary_themes: ["banking_stress", "liquidity", "central_bank"],
    primary_assets: ["KRE", "XLF", "TLT", "SPY"],
    tags: ["credit_loader", "policy_backstop", "liquidity"],
    regimes: ["policy_backstop", "financial_stress"],
    sectors: ["financials"],
    buildLead: () =>
      "Authorities launched a liquidity backstop that eased near-term funding fears and changed the path for banks, rates, and broader risk sentiment.",
    buildReviewHints: () => [
      "Check whether the backstop genuinely compressed stress or only produced a short-covering rally.",
      "Review whether regional banks improved more than broader financials after the announcement.",
      "Confirm whether bond-market pricing reinforced the stabilization message.",
    ],
  },
  credit_spread_widening: {
    event_family: "credit_spread_widening",
    default_title: () => "Credit spreads widen and pressure risk assets",
    default_dominant_catalyst: "credit-spreads-widen",
    primary_themes: ["credit_stress", "liquidity"],
    primary_assets: ["HYG", "LQD", "XLF", "TLT"],
    tags: ["credit_loader", "spreads", "widening"],
    regimes: ["credit_cycle", "financial_stress"],
    sectors: ["financials"],
    buildLead: () =>
      "Credit spreads widened materially, raising funding stress concerns and pressuring cyclicals, financials, and lower-quality credit.",
    buildReviewHints: () => [
      "Check whether high-yield and investment-grade credit both confirmed the widening move.",
      "Review whether equities reacted to spreads directly or to a same-day growth scare.",
      "Confirm whether policy commentary or issuance flow changed the close.",
    ],
  },
  default_shock: {
    event_family: "default_shock",
    default_title: (item) => `${defaultInstitution(item)} triggers a default shock`,
    default_dominant_catalyst: "default-shock",
    primary_themes: ["credit_stress", "default_risk"],
    primary_assets: ["HYG", "LQD", "SPY", "TLT"],
    tags: ["credit_loader", "default", "credit"],
    regimes: ["credit_cycle", "financial_stress"],
    sectors: ["financials"],
    buildLead: (item) =>
      `${defaultInstitution(item)} triggered a default or near-default shock, forcing investors to reprice broader credit risk and contagion probability.`,
    buildReviewHints: () => [
      "Check whether the default stayed issuer-specific or widened into a broader credit repricing.",
      "Review whether bond ETFs, cyclicals, and safe havens agreed on the severity of the shock.",
      "Confirm whether restructuring headlines softened the market reaction later.",
    ],
  },
  banking_contagion: {
    event_family: "banking_contagion",
    default_title: () => "Banking contagion fears spread across markets",
    default_dominant_catalyst: "banking-contagion",
    primary_themes: ["banking_stress", "credit_stress"],
    primary_assets: ["KRE", "XLF", "EUFN", "TLT"],
    tags: ["credit_loader", "banking", "contagion"],
    regimes: ["financial_stress", "global_risk_off"],
    sectors: ["financials"],
    buildLead: () =>
      "Contagion fears spread through the banking system, raising cross-market stress and forcing investors into defensives and liquidity-sensitive assets.",
    buildReviewHints: () => [
      "Check whether the stress stayed regional or spilled across geographies and bank tiers.",
      "Review whether CDS, bank equities, and government bonds all confirmed the contagion read.",
      "Confirm whether official support or rescue headlines changed the closing move.",
    ],
  },
  downgrade_wave: {
    event_family: "downgrade_wave",
    default_title: () => "Ratings downgrades deepen credit pressure",
    default_dominant_catalyst: "downgrade-wave",
    primary_themes: ["credit_stress", "default_risk"],
    primary_assets: ["HYG", "LQD", "KRE", "SPY"],
    tags: ["credit_loader", "downgrade", "ratings"],
    regimes: ["credit_cycle", "financial_stress"],
    sectors: ["financials"],
    buildLead: () =>
      "A wave of downgrades deepened credit stress and forced investors to reprice lower-quality borrowers, banks, and cyclical risk assets.",
    buildReviewHints: () => [
      "Check whether the downgrade wave changed spreads broadly or stayed concentrated in one pocket of credit.",
      "Review whether banks, high yield, and cyclicals all reflected the same deterioration signal.",
      "Confirm whether the market focused more on ratings mechanics or underlying fundamentals.",
    ],
  },
};

const buildSource = (item: CreditHistoricalCaseInput, preset: CreditPreset): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultInstitution(item)} Credit Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: CreditHistoricalCaseInput,
  preset: CreditPreset,
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
    ...creditSpecificRegimes(item),
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
    `Loaded via credit historical preset: ${item.event_type} for ${defaultInstitution(item)}.`,
});

const toHistoricalDraft = (item: CreditHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = CREDIT_PRESETS[item.event_type];

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

export const buildCreditHistoricalLibraryDrafts = (
  request: CreditHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestCreditHistoricalCases = async (
  services: AppServices,
  request: CreditHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildCreditHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
