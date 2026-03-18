import { applyReplayTuningResponseSchema } from "@finance-superbrain/schemas";
import type {
  ApplyReplayTuningRequest,
  ApplyReplayTuningResponse,
  CreateModelVersionRequest,
  HistoricalReplayDiagnosticsResponse,
} from "@finance-superbrain/schemas";

import { buildHistoricalReplayDiagnostics } from "./historicalReplayDiagnostics.js";
import { inferPredictionStrategyProfile } from "./modelStrategyProfiles.js";
import { buildReplayPatternPriorSet } from "./replayPatternPriors.js";
import type { Repository } from "./repository.types.js";

const truncate = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const inferModelFamily = (modelVersion: string) => {
  const normalized = modelVersion.replace(/-replay-tuned$/i, "");
  const strippedVersion = normalized.replace(/-?v\d[\w-]*$/i, "");
  return strippedVersion || normalized || modelVersion;
};

const buildTargetModelVersion = (
  sourceModelVersion: string,
  requestedTargetModelVersion?: string,
) =>
  truncate(
    requestedTargetModelVersion?.trim() || `${sourceModelVersion}-replay-tuned`,
    80,
  );

const buildLabel = (
  sourceLabel: string | undefined,
  sourceModelVersion: string,
  labelSuffix: string,
  targetModelVersion: string,
  sourceModelMatchesTarget: boolean,
) => {
  if (sourceModelMatchesTarget) {
    return truncate(sourceLabel || `${sourceModelVersion} ${labelSuffix}`, 120);
  }

  const base = sourceLabel || sourceModelVersion;
  return truncate(`${base} ${labelSuffix}`, 120);
};

const buildDescription = (
  existingDescription: string | undefined,
  sourceModelVersion: string,
  casePack: string,
  caseCount: number,
) => {
  const tuningNote = `Replay-tuned from ${sourceModelVersion} using ${casePack} (${caseCount} cases).`;
  return truncate(
    existingDescription ? `${existingDescription} ${tuningNote}` : tuningNote,
    1000,
  );
};

const resolveReplayProfile = (
  diagnostics: HistoricalReplayDiagnosticsResponse["models"][number],
  inferredProfile: string,
) => {
  const patchedProfile = diagnostics.recommended_tuning.feature_flags_patch.strategy_profile;

  return typeof patchedProfile === "string" && patchedProfile.trim()
    ? patchedProfile
    : diagnostics.profile ?? inferredProfile;
};

export const applyHistoricalReplayTuning = async (
  repository: Repository,
  sourceModelVersion: string,
  request: ApplyReplayTuningRequest,
): Promise<ApplyReplayTuningResponse> => {
  const appliedPatternPriors = request.use_pattern_priors
    ? await buildReplayPatternPriorSet(repository, sourceModelVersion)
    : null;
  const diagnosticsReport = await buildHistoricalReplayDiagnostics(repository, {
    model_versions: [sourceModelVersion],
    cases: request.cases,
  }, {
    patternPriors: appliedPatternPriors,
  });
  const diagnostics = diagnosticsReport.models[0];

  if (!diagnostics) {
    throw new Error(`No replay diagnostics were produced for ${sourceModelVersion}.`);
  }

  const sourceModel = await repository.getModelVersion(sourceModelVersion);
  const targetModelVersion = buildTargetModelVersion(
    sourceModelVersion,
    request.target_model_version,
  );
  const targetModel =
    targetModelVersion === sourceModelVersion
      ? sourceModel
      : await repository.getModelVersion(targetModelVersion);
  const baseModel = targetModel ?? sourceModel;
  const inferredProfile = inferPredictionStrategyProfile(sourceModelVersion, sourceModel);
  const replayProfile = resolveReplayProfile(diagnostics, inferredProfile);
  const replayPriorPatterns = appliedPatternPriors?.selected_patterns
    .map((pattern) => pattern.pattern_key)
    .join(",");
  const replayPriorAppliedAt = appliedPatternPriors ? new Date().toISOString() : null;
  const savedModelInput: CreateModelVersionRequest = {
    model_version: targetModelVersion,
    family: baseModel?.family ?? inferModelFamily(sourceModelVersion),
    label: buildLabel(
      sourceModel?.label,
      sourceModelVersion,
      request.label_suffix,
      targetModelVersion,
      targetModelVersion === sourceModelVersion,
    ),
    description: buildDescription(
      baseModel?.description,
      sourceModelVersion,
      diagnosticsReport.case_pack,
      diagnosticsReport.case_count,
    ),
    owner: baseModel?.owner,
    prompt_profile: replayProfile,
    status: request.status,
    feature_flags: {
      ...(baseModel?.feature_flags ?? {}),
      ...diagnostics.recommended_tuning.feature_flags_patch,
      replay_tuned_from: sourceModelVersion,
      replay_tuned_at: replayPriorAppliedAt ?? new Date().toISOString(),
      replay_case_pack: diagnosticsReport.case_pack,
      replay_case_count: diagnosticsReport.case_count,
      replay_profile: replayProfile,
      ...(appliedPatternPriors
        ? {
            replay_prior_family: appliedPatternPriors.family,
            replay_prior_scope: appliedPatternPriors.source_scope,
            replay_prior_pattern_count: appliedPatternPriors.selected_patterns.length,
            replay_prior_patterns: replayPriorPatterns ?? "",
            replay_prior_promotion_samples: appliedPatternPriors.promotion_sample_count,
            replay_prior_applied_at: replayPriorAppliedAt ?? new Date().toISOString(),
          }
        : {}),
    },
  };
  const savedModel = await repository.saveModelVersion(savedModelInput);

  return applyReplayTuningResponseSchema.parse({
    source_model_version: sourceModelVersion,
    saved_model: savedModel,
    diagnostics,
    applied_pattern_priors: appliedPatternPriors,
  });
};
