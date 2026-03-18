import type {
  GeneratePredictionRequest,
  GeneratedPrediction,
  GeneratedPredictionAsset,
  ParsedEvent,
} from "@finance-superbrain/schemas";

import type {
  PredictionStrategyContext,
  PredictionStrategyProfile,
} from "./modelStrategyProfiles.js";

type Direction = GeneratedPredictionAsset["expected_direction"];

type AssetRule = {
  direction: Direction;
  magnitudeBp: number;
};

type ThemeAssetSignal = {
  theme: string;
  rule: AssetRule;
};

type AssetSignalContext = {
  conflict: boolean;
  corroboration_count: number;
  supporting_themes: string[];
  conflicting_themes: string[];
};

type BuildAssetsResult = {
  assets: GeneratedPredictionAsset[];
  signalContexts: AssetSignalContext[];
};

const THEME_ASSET_RULES: Record<string, Record<string, AssetRule>> = {
  trade_policy: {
    KWEB: { direction: "down", magnitudeBp: -180 },
    FXI: { direction: "down", magnitudeBp: -140 },
    BABA: { direction: "down", magnitudeBp: -190 },
    "USD/CNH": { direction: "up", magnitudeBp: 35 },
  },
  china_risk: {
    KWEB: { direction: "down", magnitudeBp: -150 },
    FXI: { direction: "down", magnitudeBp: -120 },
    BABA: { direction: "down", magnitudeBp: -160 },
    "USD/CNH": { direction: "up", magnitudeBp: 28 },
  },
  rates: {
    TLT: { direction: "up", magnitudeBp: 45 },
    SPY: { direction: "up", magnitudeBp: 55 },
    QQQ: { direction: "up", magnitudeBp: 70 },
    DXY: { direction: "down", magnitudeBp: -30 },
  },
  central_bank: {
    TLT: { direction: "up", magnitudeBp: 40 },
    QQQ: { direction: "up", magnitudeBp: 65 },
    SPY: { direction: "up", magnitudeBp: 50 },
    DXY: { direction: "down", magnitudeBp: -25 },
  },
  inflation: {
    TLT: { direction: "down", magnitudeBp: -60 },
    QQQ: { direction: "down", magnitudeBp: -90 },
    DXY: { direction: "up", magnitudeBp: 35 },
    GLD: { direction: "up", magnitudeBp: 40 },
  },
  stimulus: {
    SPY: { direction: "up", magnitudeBp: 80 },
    QQQ: { direction: "up", magnitudeBp: 95 },
    KWEB: { direction: "up", magnitudeBp: 110 },
    XLF: { direction: "up", magnitudeBp: 60 },
  },
  energy: {
    XLE: { direction: "up", magnitudeBp: 100 },
    USO: { direction: "up", magnitudeBp: 130 },
    CVX: { direction: "up", magnitudeBp: 70 },
    XOM: { direction: "up", magnitudeBp: 68 },
  },
  defense: {
    ITA: { direction: "up", magnitudeBp: 75 },
    LMT: { direction: "up", magnitudeBp: 62 },
    NOC: { direction: "up", magnitudeBp: 58 },
    RTX: { direction: "up", magnitudeBp: 54 },
  },
  ai_and_semis: {
    NVDA: { direction: "up", magnitudeBp: 120 },
    SOXX: { direction: "up", magnitudeBp: 95 },
    QQQ: { direction: "up", magnitudeBp: 70 },
    SMH: { direction: "up", magnitudeBp: 98 },
  },
};

const PROFILE_THEME_GROUPS: Record<
  PredictionStrategyProfile,
  {
    focusThemes: string[];
    preferredAssets: string[];
    label: string;
  }
> = {
  baseline: {
    focusThemes: [],
    preferredAssets: [],
    label: "baseline",
  },
  macro_dovish_sensitive: {
    focusThemes: ["rates", "central_bank", "inflation", "stimulus"],
    preferredAssets: ["TLT", "QQQ", "SPY", "DXY", "GLD"],
    label: "macro dovish sensitive",
  },
  policy_shock_sensitive: {
    focusThemes: ["trade_policy", "china_risk", "defense", "energy", "ai_and_semis"],
    preferredAssets: ["KWEB", "BABA", "USD/CNH", "XLE", "USO", "ITA", "NVDA", "SOXX", "SMH"],
    label: "policy shock sensitive",
  },
  contrarian_regime_aware: {
    focusThemes: ["trade_policy", "china_risk", "stimulus", "inflation", "rates", "energy"],
    preferredAssets: ["TLT", "DXY", "GLD", "SPY", "KWEB", "XLE"],
    label: "contrarian regime aware",
  },
};

const HORIZON_MULTIPLIER: Record<GeneratedPrediction["horizon"], number> = {
  "1h": 0.55,
  "1d": 1,
  "5d": 1.35,
};

const roundScore = (value: number) => Number(value.toFixed(2));

const roundMagnitude = (value: number) => Math.trunc(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const riskOnThemes = new Set(["stimulus", "ai_and_semis"]);
const riskOffThemes = new Set(["trade_policy", "china_risk", "inflation", "defense", "energy"]);

const hasThemeOverlap = (event: ParsedEvent, themes: string[]) =>
  event.themes.some((theme) => themes.includes(theme));

const hasCrossCurrents = (event: ParsedEvent) => {
  const positiveThemes = event.themes.filter((theme) => riskOnThemes.has(theme)).length;
  const negativeThemes = event.themes.filter((theme) => riskOffThemes.has(theme)).length;

  return event.sentiment === "neutral" || (positiveThemes > 0 && negativeThemes > 0);
};

const directionToSign = (direction: Direction) => {
  if (direction === "up") {
    return 1;
  }

  if (direction === "down") {
    return -1;
  }

  return 0;
};

const toStrategyContext = (
  strategy: PredictionStrategyProfile | PredictionStrategyContext,
): PredictionStrategyContext =>
  typeof strategy === "string"
    ? {
        model_version: null,
        profile: strategy,
        registry: null,
        tuning: {
          confidence_bias: 0,
          confidence_cap: null,
          magnitude_multiplier: 1,
          conviction_bias: 0,
          focus_themes: [],
          preferred_assets: [],
          caution_themes: [],
        },
      }
    : strategy;

const mergedFocusThemes = (strategy: PredictionStrategyContext) =>
  Array.from(
    new Set([
      ...PROFILE_THEME_GROUPS[strategy.profile].focusThemes,
      ...strategy.tuning.focus_themes,
    ]),
  );

const mergedPreferredAssets = (strategy: PredictionStrategyContext) =>
  Array.from(
    new Set([
      ...PROFILE_THEME_GROUPS[strategy.profile].preferredAssets,
      ...strategy.tuning.preferred_assets,
    ]),
  );

const expandCandidateAssets = (
  event: ParsedEvent,
  strategy: PredictionStrategyContext,
) => {
  const expanded = [...event.candidate_assets];
  const focusThemes = mergedFocusThemes(strategy);
  const preferredAssets = mergedPreferredAssets(strategy);

  if (strategy.profile === "baseline" && !strategy.tuning.preferred_assets.length) {
    return expanded.slice(0, 8);
  }

  if (hasThemeOverlap(event, focusThemes)) {
    for (const ticker of preferredAssets) {
      if (!expanded.includes(ticker)) {
        expanded.push(ticker);
      }
    }
  }

  return expanded.slice(0, 8);
};

const scaleMagnitudeByProfile = (
  event: ParsedEvent,
  ticker: string,
  magnitudeBp: number,
  strategy: PredictionStrategyContext,
) => {
  const absolute = Math.abs(magnitudeBp);
  const sign = magnitudeBp >= 0 ? 1 : -1;
  const isMacroAsset = ["TLT", "QQQ", "SPY", "DXY", "GLD", "XLF"].includes(ticker);
  const isPolicyAsset = [
    "KWEB",
    "FXI",
    "BABA",
    "USD/CNH",
    "ITA",
    "LMT",
    "NOC",
    "RTX",
    "XLE",
    "USO",
    "XOM",
    "CVX",
    "NVDA",
    "SOXX",
    "SMH",
  ].includes(ticker);

  let multiplier = 1;

  if (strategy.profile === "macro_dovish_sensitive") {
    multiplier = hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? isMacroAsset
        ? 1.28
        : 0.82
      : isPolicyAsset
        ? 0.74
        : 0.9;
  } else if (strategy.profile === "policy_shock_sensitive") {
    multiplier = hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? isPolicyAsset
        ? 1.3
        : 0.84
      : isMacroAsset
        ? 0.8
        : 0.92;
  } else if (strategy.profile === "contrarian_regime_aware") {
    multiplier = hasCrossCurrents(event) ? 0.62 : 0.88;
  }

  return roundMagnitude(absolute * multiplier * strategy.tuning.magnitude_multiplier * sign);
};

const convictionAdjustmentForProfile = (
  event: ParsedEvent,
  ticker: string,
  strategy: PredictionStrategyContext,
) => {
  const isMacroAsset = ["TLT", "QQQ", "SPY", "DXY", "GLD", "XLF"].includes(ticker);
  const isPolicyAsset = [
    "KWEB",
    "FXI",
    "BABA",
    "USD/CNH",
    "ITA",
    "LMT",
    "NOC",
    "RTX",
    "XLE",
    "USO",
    "XOM",
    "CVX",
    "NVDA",
    "SOXX",
    "SMH",
  ].includes(ticker);

  if (strategy.profile === "macro_dovish_sensitive") {
    return hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? isMacroAsset
        ? 0.07
        : -0.06
      : -0.08;
  }

  if (strategy.profile === "policy_shock_sensitive") {
    return hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? isPolicyAsset
        ? 0.08
        : -0.05
      : -0.08;
  }

  if (strategy.profile === "contrarian_regime_aware") {
    return hasCrossCurrents(event) ? -0.07 : -0.02;
  }

  return 0;
};

const applySentimentOverride = (
  event: ParsedEvent,
  ticker: string,
  rule: AssetRule | undefined,
): AssetRule => {
  if (rule) {
    if (event.sentiment === "risk_off" && ["NVDA", "SOXX", "QQQ", "SMH"].includes(ticker)) {
      return {
        direction: "down",
        magnitudeBp: Math.abs(rule.magnitudeBp) * -1,
      };
    }

    if (event.sentiment === "risk_off" && ["TLT", "GLD"].includes(ticker)) {
      return {
        direction: "up",
        magnitudeBp: Math.abs(rule.magnitudeBp),
      };
    }

    return rule;
  }

  if (event.sentiment === "risk_off") {
    return {
      direction: ["TLT", "GLD", "DXY", "USD/CNH"].includes(ticker) ? "up" : "down",
      magnitudeBp: ["TLT", "GLD", "DXY", "USD/CNH"].includes(ticker) ? 30 : -45,
    };
  }

  if (event.sentiment === "risk_on") {
    return {
      direction: ["DXY", "USD/CNH"].includes(ticker) ? "down" : "up",
      magnitudeBp: ["DXY", "USD/CNH"].includes(ticker) ? -25 : 55,
    };
  }

  return {
    direction: "mixed",
    magnitudeBp: 18,
  };
};

const aggregateThemeRule = (
  event: ParsedEvent,
  ticker: string,
): { rule: AssetRule | undefined; signalContext: AssetSignalContext } => {
  const themeSignals: ThemeAssetSignal[] = event.themes
    .map((theme) => {
      const rule = THEME_ASSET_RULES[theme]?.[ticker];

      return rule
        ? {
            theme,
            rule,
          }
        : null;
    })
    .filter((signal): signal is ThemeAssetSignal => Boolean(signal));

  if (!themeSignals.length) {
    return {
      rule: undefined,
      signalContext: {
        conflict: false,
        corroboration_count: 0,
        supporting_themes: [],
        conflicting_themes: [],
      },
    };
  }

  const positiveSignals = themeSignals.filter(
    (signal) => directionToSign(signal.rule.direction) > 0,
  );
  const negativeSignals = themeSignals.filter(
    (signal) => directionToSign(signal.rule.direction) < 0,
  );
  const conflict = positiveSignals.length > 0 && negativeSignals.length > 0;
  const signedMagnitudes = themeSignals.map((signal) => signal.rule.magnitudeBp);
  const totalSignedMagnitude = signedMagnitudes.reduce((sum, value) => sum + value, 0);
  const averageMagnitude = average(signedMagnitudes.map((value) => Math.abs(value)));

  if (conflict) {
    const dominantDirection = totalSignedMagnitude >= 0 ? "up" : "down";
    const dominantSignals =
      dominantDirection === "up" ? positiveSignals : negativeSignals;
    const dominantMagnitudeRatio =
      Math.abs(totalSignedMagnitude) /
      Math.max(signedMagnitudes.reduce((sum, value) => sum + Math.abs(value), 0), 1);

    if (dominantMagnitudeRatio < 0.28) {
      return {
        rule: {
          direction: "mixed",
          magnitudeBp: roundMagnitude(Math.max(18, averageMagnitude * 0.4)),
        },
        signalContext: {
          conflict: true,
          corroboration_count: 0,
          supporting_themes: dominantSignals.map((signal) => signal.theme),
          conflicting_themes: themeSignals
            .filter((signal) => !dominantSignals.includes(signal))
            .map((signal) => signal.theme),
        },
      };
    }

    return {
      rule: {
        direction: dominantDirection,
        magnitudeBp:
          dominantDirection === "up"
            ? roundMagnitude(averageMagnitude * (0.55 + dominantMagnitudeRatio * 0.5))
            : roundMagnitude(averageMagnitude * (0.55 + dominantMagnitudeRatio * 0.5) * -1),
      },
      signalContext: {
        conflict: true,
        corroboration_count: dominantSignals.length,
        supporting_themes: dominantSignals.map((signal) => signal.theme),
        conflicting_themes: themeSignals
          .filter((signal) => !dominantSignals.includes(signal))
          .map((signal) => signal.theme),
      },
    };
  }

  const dominantDirection = totalSignedMagnitude >= 0 ? "up" : "down";
  const corroborationMultiplier = 1 + Math.min(themeSignals.length - 1, 2) * 0.18;

  return {
    rule: {
      direction: dominantDirection,
      magnitudeBp:
        dominantDirection === "up"
          ? roundMagnitude(averageMagnitude * corroborationMultiplier)
          : roundMagnitude(averageMagnitude * corroborationMultiplier * -1),
    },
    signalContext: {
      conflict: false,
      corroboration_count: themeSignals.length,
      supporting_themes: themeSignals.map((signal) => signal.theme),
      conflicting_themes: [],
    },
  };
};

const buildAssets = (
  event: ParsedEvent,
  horizon: GeneratedPrediction["horizon"],
  strategy: PredictionStrategyContext,
) : BuildAssetsResult => {
  const signalContexts: AssetSignalContext[] = [];
  const assets = expandCandidateAssets(event, strategy).map((ticker) => {
    const aggregatedSignal = aggregateThemeRule(event, ticker);
    const rule = applySentimentOverride(event, ticker, aggregatedSignal.rule);
    const multiplier = HORIZON_MULTIPLIER[horizon];
    const magnitude = scaleMagnitudeByProfile(
      event,
      ticker,
      rule.magnitudeBp * multiplier,
      strategy,
    );
    const conflictPenalty = aggregatedSignal.signalContext.conflict ? 0.12 : 0;
    const corroborationBonus = Math.min(
      Math.max(aggregatedSignal.signalContext.corroboration_count - 1, 0) * 0.02,
      0.06,
    );
    const convictionBase = 0.56 + event.urgency_score * 0.14 + event.novelty_score * 0.08;
    const conviction = roundScore(
      clamp(
        convictionBase +
          (event.sentiment === "neutral" ? -0.08 : 0.04) +
          corroborationBonus -
          conflictPenalty +
          convictionAdjustmentForProfile(event, ticker, strategy) +
          strategy.tuning.conviction_bias,
        0.35,
        0.92,
      ),
    );
    const cautionThemeOverlap = event.themes.some((theme) =>
      strategy.tuning.caution_themes.includes(theme),
    );
    const contrarianMixedSignal =
      strategy.profile === "contrarian_regime_aware" &&
      !["TLT", "GLD"].includes(ticker) &&
      (hasCrossCurrents(event) ||
        (cautionThemeOverlap &&
          (aggregatedSignal.signalContext.conflict || event.sentiment === "neutral")));

    const direction =
      contrarianMixedSignal ? "mixed" : rule.direction;

    signalContexts.push(aggregatedSignal.signalContext);

    return {
      ticker,
      expected_direction: direction,
      expected_magnitude_bp: magnitude,
      conviction,
    };
  });

  return {
    assets: assets.slice(0, 5),
    signalContexts: signalContexts.slice(0, 5),
  };
};

const themeLabel = (theme: string) => theme.replaceAll("_", " ");

const buildThesis = (
  event: ParsedEvent,
  horizon: GeneratedPrediction["horizon"],
  strategy: PredictionStrategyContext,
) => {
  const topThemes = event.themes.slice(0, 2).map(themeLabel);
  const label = topThemes.length ? topThemes.join(" and ") : "market-relevant developments";
  const profileLabel = PROFILE_THEME_GROUPS[strategy.profile].label;

  if (strategy.profile === "contrarian_regime_aware" && hasCrossCurrents(event)) {
    return `${label} show cross-currents, so a ${profileLabel} strategy expects a less one-way ${event.sentiment} reaction over the next ${horizon}.`;
  }

  return `${label} are likely to drive a ${event.sentiment} reaction over the next ${horizon} under the ${profileLabel} strategy.`;
};

const buildEvidence = (
  event: ParsedEvent,
  strategy: PredictionStrategyContext,
  signalContexts: AssetSignalContext[],
) => {
  const evidence: string[] = [];
  const corroboratedSignals = signalContexts.filter(
    (signalContext) => signalContext.corroboration_count >= 2 && !signalContext.conflict,
  );
  const conflictedSignals = signalContexts.filter((signalContext) => signalContext.conflict);

  if (strategy.profile !== "baseline") {
    evidence.push(`Strategy profile: ${PROFILE_THEME_GROUPS[strategy.profile].label}.`);
  }

  if (event.urgency_score >= 0.7) {
    evidence.push("The event carries above-average urgency, which raises the chance of a near-term reaction.");
  }

  if (event.novelty_score >= 0.5) {
    evidence.push("The signal appears relatively novel, so investors may need to reprice expectations quickly.");
  }

  if (strategy.profile === "macro_dovish_sensitive" && hasThemeOverlap(event, mergedFocusThemes(strategy))) {
    evidence.splice(
      1,
      0,
      "Macro-sensitive assets are being weighted more heavily because the event centers on rates, inflation, or central-bank language.",
    );
  }

  if (strategy.profile === "policy_shock_sensitive" && hasThemeOverlap(event, mergedFocusThemes(strategy))) {
    evidence.splice(
      1,
      0,
      "Policy and geopolitical transmission channels are being weighted more aggressively for this setup.",
    );
  }

  if (strategy.profile === "contrarian_regime_aware" && hasCrossCurrents(event)) {
    evidence.splice(
      1,
      0,
      "Conflicting theme signals suggest the first market reaction may be less reliable than the headline implies.",
    );
  }

  if (corroboratedSignals.length) {
    evidence.push(
      `Cross-theme agreement supports ${corroboratedSignals.length} asset setup(s), which raises confidence in the transmission path.`,
    );
  }

  if (conflictedSignals.length) {
    evidence.push(
      `Some asset mappings contain mixed theme signals, so the engine is leaning more cautiously on one-way follow-through.`,
    );
  }

  evidence.push(...event.why_it_matters);

  if (strategy.tuning.caution_themes.some((theme) => event.themes.includes(theme))) {
    evidence.push("Tuning caution: similar themes have underperformed in replay diagnostics, so conviction is being moderated.");
  }

  return evidence.slice(0, 5);
};

const buildInvalidations = (
  event: ParsedEvent,
  strategy: PredictionStrategyContext,
  signalContexts: AssetSignalContext[],
) => {
  const invalidations: string[] = [];
  const conflictedThemes = Array.from(
    new Set(
      signalContexts.flatMap((signalContext) => signalContext.conflicting_themes),
    ),
  );

  if (strategy.profile === "contrarian_regime_aware") {
    invalidations.push("Regime cross-currents may cause a fade or reversal even if the headline initially looks directional.");
  }

  if (conflictedThemes.length) {
    invalidations.push(
      `Theme disagreement remains unresolved across ${conflictedThemes.slice(0, 3).join(", ")}, which can blunt or reverse the initial move.`,
    );
  }

  if (strategy.profile === "macro_dovish_sensitive") {
    invalidations.push("Macro assets may stay muted if yields fail to confirm the dovish interpretation.");
  }

  invalidations.push(
    "A stronger overlapping catalyst could dominate the tape and absorb this signal.",
    "Follow-up comments or fresh data could reverse the market's first interpretation.",
  );

  if (event.sentiment === "risk_off") {
    invalidations.push("Policy language could soften, reducing the defensive reaction.");
  } else if (event.sentiment === "risk_on") {
    invalidations.push("Supportive rhetoric may fail if macro data or liquidity conditions remain weak.");
  }

  if (strategy.tuning.caution_themes.some((theme) => event.themes.includes(theme))) {
    invalidations.push("Replay diagnostics show this theme has been fragile for this model version.");
  }

  return invalidations.slice(0, 3);
};

const buildAssumptions = (event: ParsedEvent, strategy: PredictionStrategyContext) => {
  const assumptions = [
    "Primary market attention remains on this event during the forecast horizon.",
    "Cross-asset price discovery behaves in line with recent historical analogs.",
  ];

  if (event.themes.includes("china_risk")) {
    assumptions.push("China-linked assets remain sensitive to policy and currency headlines.");
  }

  if (strategy.profile === "policy_shock_sensitive") {
    assumptions.push("Policy transmission into sector and country baskets remains faster than broader macro repricing.");
  }

  return assumptions.slice(0, 3);
};

const computeConfidence = (
  event: ParsedEvent,
  assetCount: number,
  signalContexts: AssetSignalContext[],
  strategy: PredictionStrategyContext,
) => {
  const corroboratedAssetCount = signalContexts.filter(
    (signalContext) => signalContext.corroboration_count >= 2 && !signalContext.conflict,
  ).length;
  const conflictedAssetCount = signalContexts.filter(
    (signalContext) => signalContext.conflict,
  ).length;
  const base =
    0.5 +
    event.urgency_score * 0.18 +
    event.novelty_score * 0.08 +
    Math.min(assetCount, 4) * 0.015 +
    corroboratedAssetCount * 0.015;

  let modifier = event.sentiment === "neutral" ? -0.08 : 0.02;

  if (strategy.profile === "macro_dovish_sensitive") {
    modifier += hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? 0.08
      : -0.07;
  } else if (strategy.profile === "policy_shock_sensitive") {
    modifier += hasThemeOverlap(event, mergedFocusThemes(strategy))
      ? 0.08
      : -0.07;
  } else if (strategy.profile === "contrarian_regime_aware") {
    modifier += hasCrossCurrents(event) ? -0.07 : -0.02;
  }

  modifier += strategy.tuning.confidence_bias;

  if (strategy.tuning.caution_themes.some((theme) => event.themes.includes(theme))) {
    modifier -= strategy.profile === "contrarian_regime_aware" ? 0.03 : 0.06;
  }

  modifier -= conflictedAssetCount * 0.05;

  const maxConfidence = strategy.tuning.confidence_cap ?? (strategy.profile === "contrarian_regime_aware" ? 0.82 : 0.92);

  return roundScore(clamp(base + modifier, 0.35, maxConfidence));
};

export const generatePredictionSet = (
  request: GeneratePredictionRequest,
  strategy: PredictionStrategyProfile | PredictionStrategyContext = "baseline",
): GeneratedPrediction[] => {
  const strategyContext = toStrategyContext(strategy);

  return request.horizons.map((horizon) => {
    const { assets, signalContexts } = buildAssets(request.event, horizon, strategyContext);

    return {
      horizon,
      thesis: buildThesis(request.event, horizon, strategyContext),
      confidence: computeConfidence(request.event, assets.length, signalContexts, strategyContext),
      assets,
      evidence: buildEvidence(request.event, strategyContext, signalContexts),
      invalidations: buildInvalidations(request.event, strategyContext, signalContexts),
      assumptions: buildAssumptions(request.event, strategyContext),
    };
  });
};
