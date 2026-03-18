import type { StoredModelVersion } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

export type PredictionStrategyProfile =
  | "baseline"
  | "macro_dovish_sensitive"
  | "policy_shock_sensitive"
  | "contrarian_regime_aware";

export type PredictionStrategyTuning = {
  confidence_bias: number;
  confidence_cap: number | null;
  magnitude_multiplier: number;
  conviction_bias: number;
  focus_themes: string[];
  preferred_assets: string[];
  caution_themes: string[];
};

export type PredictionStrategyContext = {
  model_version: string | null;
  profile: PredictionStrategyProfile;
  registry: StoredModelVersion | null;
  tuning: PredictionStrategyTuning;
};

const VALID_PROFILES = new Set<PredictionStrategyProfile>([
  "baseline",
  "macro_dovish_sensitive",
  "policy_shock_sensitive",
  "contrarian_regime_aware",
]);

const normalizeProfile = (value: unknown): PredictionStrategyProfile | null =>
  typeof value === "string" && VALID_PROFILES.has(value as PredictionStrategyProfile)
    ? (value as PredictionStrategyProfile)
    : null;

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseCsv = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const buildTuning = (registry?: StoredModelVersion | null): PredictionStrategyTuning => {
  const flags = registry?.feature_flags ?? {};

  return {
    confidence_bias: clamp(parseNumber(flags.confidence_bias) ?? 0, -0.2, 0.2),
    confidence_cap: (() => {
      const parsed = parseNumber(flags.confidence_cap);
      return parsed === null ? null : clamp(parsed, 0.35, 0.95);
    })(),
    magnitude_multiplier: clamp(parseNumber(flags.magnitude_multiplier) ?? 1, 0.5, 1.5),
    conviction_bias: clamp(parseNumber(flags.conviction_bias) ?? 0, -0.2, 0.2),
    focus_themes: parseCsv(flags.focus_themes),
    preferred_assets: parseCsv(flags.preferred_assets),
    caution_themes: parseCsv(flags.caution_themes),
  };
};

export const inferPredictionStrategyProfile = (
  modelVersion?: string | null,
  registry?: StoredModelVersion | null,
): PredictionStrategyProfile => {
  const flaggedProfile = normalizeProfile(registry?.feature_flags.strategy_profile);

  if (flaggedProfile) {
    return flaggedProfile;
  }

  const promptProfile = normalizeProfile(registry?.prompt_profile);

  if (promptProfile) {
    return promptProfile;
  }

  const haystack = [
    modelVersion,
    registry?.model_version,
    registry?.family,
    registry?.label,
    registry?.description,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/(contrarian|regime|cross-current|cross current)/.test(haystack)) {
    return "contrarian_regime_aware";
  }

  if (/(policy|shock|tariff|geopolitic|china|defense|energy|semi)/.test(haystack)) {
    return "policy_shock_sensitive";
  }

  if (/(macro|dovish|fed|rates|inflation|labor)/.test(haystack)) {
    return "macro_dovish_sensitive";
  }

  return "baseline";
};

export const resolvePredictionStrategyProfile = async (
  repository: Repository,
  modelVersion?: string,
): Promise<PredictionStrategyContext> => {
  if (!modelVersion) {
    return {
      model_version: null,
      profile: "baseline",
      registry: null,
      tuning: buildTuning(null),
    };
  }

  const registry = await repository.getModelVersion(modelVersion);

  return {
    model_version: modelVersion,
    profile: inferPredictionStrategyProfile(modelVersion, registry),
    registry,
    tuning: buildTuning(registry),
  };
};

export const strategyProfileLabel = (profile: PredictionStrategyProfile) =>
  profile.replaceAll("_", " ");
