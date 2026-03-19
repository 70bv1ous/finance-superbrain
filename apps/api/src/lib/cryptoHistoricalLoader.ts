import type {
  CreateSourceRequest,
  CryptoHistoricalCaseInput,
  CryptoHistoricalIngestionRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type CryptoPreset = {
  event_family: string;
  default_title: (item: CryptoHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: CryptoHistoricalCaseInput) => string;
  buildReviewHints: (item: CryptoHistoricalCaseInput) => string[];
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

const defaultInstitution = (item: CryptoHistoricalCaseInput) =>
  item.institution?.trim() || "Crypto market";

const defaultRegion = (item: CryptoHistoricalCaseInput) =>
  item.region?.trim() || "global";

const mapSignalToSurprise = (signal: CryptoHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const CRYPTO_PRESETS: Record<CryptoHistoricalCaseInput["event_type"], CryptoPreset> = {
  exchange_collapse: {
    event_family: "exchange_collapse",
    default_title: (item) => `${defaultInstitution(item)} exchange collapse`,
    default_dominant_catalyst: "exchange-collapse",
    primary_themes: ["crypto_stress", "contagion", "liquidity"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN"],
    tags: ["crypto_loader", "exchange", "collapse"],
    regimes: ["crypto_stress", "liquidity_shock"],
    sectors: ["crypto", "fintech"],
    buildLead: (item) =>
      `${defaultInstitution(item)} collapsed, triggering contagion across crypto markets and forcing leveraged positions to unwind.`,
    buildReviewHints: () => [
      "Check whether contagion spread beyond the specific exchange to solvent counterparties.",
      "Review whether BTC and ETH decoupled or moved together during the stress.",
      "Confirm whether the selloff was primarily driven by forced liquidations or fundamental repricing.",
    ],
  },
  stablecoin_depeg: {
    event_family: "stablecoin_depeg",
    default_title: (item) => `${defaultInstitution(item)} stablecoin depeg`,
    default_dominant_catalyst: "stablecoin-depeg",
    primary_themes: ["crypto_stress", "liquidity", "contagion"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN"],
    tags: ["crypto_loader", "stablecoin", "depeg"],
    regimes: ["crypto_stress", "liquidity_shock"],
    sectors: ["crypto", "defi"],
    buildLead: (item) =>
      `${defaultInstitution(item)} lost its dollar peg, triggering forced liquidations and contagion across DeFi protocols and centralized exchanges.`,
    buildReviewHints: () => [
      "Check whether the depeg was algorithmic (death spiral) or collateral-backed (recoverable).",
      "Review whether DeFi liquidation cascades amplified the move beyond the stablecoin itself.",
      "Confirm whether BTC/ETH moved on the depeg or on secondary contagion effects.",
    ],
  },
  regulatory_action: {
    event_family: "regulatory_action",
    default_title: (item) => `${defaultInstitution(item)} regulatory action`,
    default_dominant_catalyst: "regulatory-action",
    primary_themes: ["regulation", "institutional", "crypto_market"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN"],
    tags: ["crypto_loader", "regulatory", "sec"],
    regimes: ["regulatory_risk", "institutional_crypto"],
    sectors: ["crypto", "fintech"],
    buildLead: (item) =>
      `${defaultInstitution(item)} faced a significant regulatory action that repriced regulatory risk across the crypto market.`,
    buildReviewHints: () => [
      "Check whether the action was sector-wide or exchange-specific.",
      "Review whether the market treated the action as clearing an overhang (positive resolution) or escalating risk.",
      "Confirm whether Bitcoin moved with altcoins or decoupled as a 'safer' asset.",
    ],
  },
  btc_halving: {
    event_family: "btc_halving",
    default_title: () => "Bitcoin halving reduces block reward supply",
    default_dominant_catalyst: "btc-halving",
    primary_themes: ["supply_shock", "bitcoin", "institutional"],
    primary_assets: ["BTC-USD", "MSTR", "COIN"],
    tags: ["crypto_loader", "halving", "bitcoin", "supply"],
    regimes: ["crypto_bull", "supply_shock"],
    sectors: ["crypto"],
    buildLead: () =>
      "Bitcoin's block reward halving cut new supply issuance by 50%, a historically bullish supply shock that has preceded each major bull cycle.",
    buildReviewHints: () => [
      "Check whether the market had already front-run the halving in the weeks prior.",
      "Review whether miner sell pressure post-halving created a short-term headwind.",
      "Confirm how quickly the supply reduction effect manifested in price versus the broader macro backdrop.",
    ],
  },
  crypto_market_crash: {
    event_family: "crypto_market_crash",
    default_title: () => "Crypto market enters bear market crash",
    default_dominant_catalyst: "crypto-market-crash",
    primary_themes: ["crypto_stress", "risk_off", "deleveraging"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN", "MSTR"],
    tags: ["crypto_loader", "bear_market", "crash"],
    regimes: ["crypto_bear", "risk_off"],
    sectors: ["crypto"],
    buildLead: () =>
      "The crypto market entered a prolonged bear phase driven by macro headwinds, regulatory pressure, or ecosystem contagion — destroying leveraged positions and speculative excess.",
    buildReviewHints: () => [
      "Check whether the crash was macro-driven (Fed, liquidity) or crypto-specific (fraud, hack).",
      "Review whether BTC and ETH maintained correlation or diverged during the selloff.",
      "Confirm whether the low was a capitulation event or a slow grind lower.",
    ],
  },
  crypto_market_rally: {
    event_family: "crypto_market_rally",
    default_title: () => "Crypto market rally to new highs",
    default_dominant_catalyst: "crypto-market-rally",
    primary_themes: ["risk_on", "institutional", "bitcoin"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN", "MSTR"],
    tags: ["crypto_loader", "bull_market", "rally"],
    regimes: ["crypto_bull", "risk_on"],
    sectors: ["crypto"],
    buildLead: () =>
      "The crypto market rallied to new highs driven by institutional adoption, supply dynamics, or macro tailwinds — with BTC and ETH leading broad market appreciation.",
    buildReviewHints: () => [
      "Check whether the rally was driven by spot buying or leveraged futures funding rates.",
      "Review whether altcoins outperformed or underperformed BTC/ETH during the move.",
      "Confirm whether the rally reflected genuine demand or speculative excess that would mean-revert.",
    ],
  },
  defi_exploit: {
    event_family: "defi_exploit",
    default_title: (item) => `${defaultInstitution(item)} DeFi exploit`,
    default_dominant_catalyst: "defi-exploit",
    primary_themes: ["crypto_stress", "security", "defi"],
    primary_assets: ["ETH-USD", "BTC-USD"],
    tags: ["crypto_loader", "hack", "defi", "security"],
    regimes: ["crypto_stress"],
    sectors: ["crypto", "defi"],
    buildLead: (item) =>
      `${defaultInstitution(item)} suffered a major DeFi exploit, destroying protocol value and raising security concerns across the broader DeFi ecosystem.`,
    buildReviewHints: () => [
      "Check whether the exploit was contained to the protocol or triggered contagion across DeFi.",
      "Review whether ETH and BTC reacted to the news or whether it was altcoin-specific.",
      "Confirm whether the protocol was recoverable (whitehat/fork) or permanently destroyed.",
    ],
  },
  institutional_adoption: {
    event_family: "institutional_adoption",
    default_title: (item) => `${defaultInstitution(item)} institutional Bitcoin adoption`,
    default_dominant_catalyst: "institutional-adoption",
    primary_themes: ["institutional", "bitcoin", "demand"],
    primary_assets: ["BTC-USD", "MSTR", "COIN"],
    tags: ["crypto_loader", "institutional", "adoption"],
    regimes: ["institutional_crypto", "crypto_bull"],
    sectors: ["crypto", "fintech"],
    buildLead: (item) =>
      `${defaultInstitution(item)} made a significant institutional crypto move that shifted the demand/supply dynamic and validated Bitcoin as an institutional asset class.`,
    buildReviewHints: () => [
      "Check whether the adoption announcement triggered sustained demand or was a one-day event.",
      "Review whether the announcement changed the narrative for institutional crypto adoption broadly.",
      "Confirm whether MSTR, COIN, and crypto-adjacent equities moved with or led BTC.",
    ],
  },
  macro_correlation_shock: {
    event_family: "macro_correlation_shock",
    default_title: () => "Macro event triggers crypto correlation shock",
    default_dominant_catalyst: "macro-correlation-shock",
    primary_themes: ["macro_correlation", "risk_asset", "crypto_market"],
    primary_assets: ["BTC-USD", "ETH-USD", "COIN"],
    tags: ["crypto_loader", "macro", "correlation"],
    regimes: ["macro_driven", "risk_off"],
    sectors: ["crypto"],
    buildLead: () =>
      "A macro event triggered a sharp correlation move in crypto, confirming Bitcoin's role as a high-beta risk asset that amplifies macro deleveraging or risk-on flows.",
    buildReviewHints: () => [
      "Check whether Bitcoin moved more or less than equities — higher beta suggests liquidity-driven selling.",
      "Review whether crypto recovered before or after traditional risk assets.",
      "Confirm whether stablecoins held their peg during the macro shock.",
    ],
  },
  mining_event: {
    event_family: "mining_event",
    default_title: () => "Bitcoin mining network event",
    default_dominant_catalyst: "mining-event",
    primary_themes: ["bitcoin", "supply", "network"],
    primary_assets: ["BTC-USD", "MSTR"],
    tags: ["crypto_loader", "mining", "hashrate", "bitcoin"],
    regimes: ["crypto_market"],
    sectors: ["crypto"],
    buildLead: () =>
      "A significant Bitcoin mining network event changed the hash rate or miner economics, affecting network security perception and BTC supply dynamics.",
    buildReviewHints: () => [
      "Check whether the hash rate change was temporary or structural.",
      "Review whether miner sell pressure changed following the event.",
      "Confirm whether the market treated the development as bullish (decentralization) or bearish (instability).",
    ],
  },
  fork_upgrade: {
    event_family: "fork_upgrade",
    default_title: (item) => `${defaultInstitution(item)} protocol upgrade`,
    default_dominant_catalyst: "protocol-upgrade",
    primary_themes: ["ethereum", "protocol", "upgrade"],
    primary_assets: ["ETH-USD", "BTC-USD"],
    tags: ["crypto_loader", "upgrade", "ethereum", "protocol"],
    regimes: ["crypto_market"],
    sectors: ["crypto", "defi"],
    buildLead: (item) =>
      `${defaultInstitution(item)} executed a major protocol upgrade that changed tokenomics, security, or functionality — with markets reacting to the supply/demand and sentiment implications.`,
    buildReviewHints: () => [
      "Check whether the upgrade was 'buy the rumour, sell the news' or sustained post-event.",
      "Review whether the upgrade changed ETH staking economics or supply issuance materially.",
      "Confirm whether DeFi activity or gas usage changed post-upgrade in a way that affected demand.",
    ],
  },
};

const buildSource = (
  item: CryptoHistoricalCaseInput,
  preset: CryptoPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  speaker: item.speaker?.trim(),
  publisher: item.publisher?.trim() || `${defaultInstitution(item)} Crypto Desk`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: CryptoHistoricalCaseInput,
  preset: CryptoPreset,
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
    `Loaded via crypto historical preset: ${item.event_type} for ${defaultInstitution(item)}.`,
});

const toHistoricalDraft = (item: CryptoHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = CRYPTO_PRESETS[item.event_type];

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

export const buildCryptoHistoricalLibraryDrafts = (
  request: CryptoHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestCryptoHistoricalCases = async (
  services: AppServices,
  request: CryptoHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildCryptoHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
