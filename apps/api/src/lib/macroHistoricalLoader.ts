import type {
  CreateSourceRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  MacroHistoricalCaseInput,
  MacroHistoricalIngestionRequest,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type MacroPreset = {
  event_family: string;
  source_type: CreateSourceRequest["source_type"];
  default_title: (bias: MacroHistoricalCaseInput["signal_bias"]) => string;
  default_speaker?: string;
  default_publisher: string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  regions: string[];
  buildLead: (bias: MacroHistoricalCaseInput["signal_bias"]) => string;
  buildReviewHints: (item: MacroHistoricalCaseInput) => string[];
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

const macroBiasRegimes = (
  eventType: MacroHistoricalCaseInput["event_type"],
  bias: MacroHistoricalCaseInput["signal_bias"],
) => {
  const values = new Set<string>();

  if (["cpi", "nfp", "fomc", "fed_speech"].includes(eventType)) {
    values.add("macro_rates");
  }

  if (["hotter", "stronger", "hawkish"].includes(bias)) {
    values.add("rate_hiking");
    values.add("higher_for_longer");
  }

  if (["cooler", "softer", "dovish"].includes(bias)) {
    values.add("rate_cutting");
  }

  if (
    eventType === "cpi" &&
    ["cooler", "softer", "dovish"].includes(bias)
  ) {
    values.add("disinflation");
  }

  if (
    eventType === "fomc" ||
    eventType === "fed_speech"
  ) {
    values.add("policy_transition");
  }

  if (eventType === "nfp" && ["softer", "cooler", "dovish"].includes(bias)) {
    values.add("labor_softening");
  }

  return [...values];
};

const MACRO_PRESETS: Record<MacroHistoricalCaseInput["event_type"], MacroPreset> = {
  cpi: {
    event_family: "cpi_release",
    source_type: "headline",
    default_title: (bias) =>
      ({
        hotter: "US CPI runs hotter than expected",
        cooler: "US CPI cools more than expected",
        mixed: "US CPI prints a mixed inflation signal",
        neutral: "US CPI lands near expectations",
        stronger: "US CPI surprises to the upside",
        softer: "US CPI softens modestly",
        dovish: "US CPI cools and supports a dovish read",
        hawkish: "US CPI stays sticky and keeps a hawkish tone alive",
      })[bias] ?? "US CPI update",
    default_publisher: "Bureau of Labor Statistics",
    default_dominant_catalyst: "cpi-release",
    primary_themes: ["inflation", "rates", "central_bank"],
    primary_assets: ["TLT", "QQQ", "DXY", "GLD"],
    tags: ["macro_calendar", "cpi", "inflation", "rates"],
    regimes: ["macro_rates", "united_states_macro"],
    regions: ["united_states"],
    buildLead: (bias) =>
      ({
        hotter:
          "US CPI inflation came in hotter than expected, keeping inflation pressure elevated and pushing rate-cut hopes back.",
        cooler:
          "US CPI inflation cooled more than expected, easing price pressure and supporting rate-cut expectations.",
        mixed:
          "US CPI delivered a mixed inflation signal, leaving the rates path less clear for markets.",
        neutral:
          "US CPI landed close to expectations, leaving markets to focus on the reaction in yields and policy pricing.",
        stronger:
          "US CPI surprised to the upside, reinforcing inflation pressure and tighter financial conditions.",
        softer:
          "US CPI softened modestly, helping bonds and long-duration equities stabilize.",
        dovish:
          "US CPI cooled enough to support a more dovish rates interpretation across bonds and growth equities.",
        hawkish:
          "US CPI stayed sticky enough to preserve a hawkish rates interpretation across yields and the dollar.",
      })[bias],
    buildReviewHints: () => [
      "Confirm whether the initial yield move held through the close or fully faded.",
      "Check if equities reacted to the inflation impulse or a same-day competing catalyst.",
      "Review whether the dollar response matched the bond-market reaction.",
    ],
  },
  nfp: {
    event_family: "nfp_release",
    source_type: "headline",
    default_title: (bias) =>
      ({
        stronger: "US payrolls surprise to the upside",
        softer: "US payrolls miss and soften the labor view",
        mixed: "US payrolls send a mixed labor signal",
        neutral: "US payrolls land near expectations",
        hotter: "US payrolls fuel a hotter macro read",
        cooler: "US payrolls cool the labor and rates outlook",
        dovish: "US payrolls support a dovish labor read",
        hawkish: "US payrolls preserve a hawkish rates read",
      })[bias] ?? "US payrolls update",
    default_publisher: "Bureau of Labor Statistics",
    default_dominant_catalyst: "nfp-release",
    primary_themes: ["rates", "central_bank"],
    primary_assets: ["TLT", "QQQ", "DXY", "SPY"],
    tags: ["macro_calendar", "nfp", "labor", "rates"],
    regimes: ["macro_rates", "united_states_macro"],
    regions: ["united_states"],
    buildLead: (bias) =>
      ({
        stronger:
          "US nonfarm payrolls came in stronger than expected, keeping labor conditions firm and repricing the rates path higher.",
        softer:
          "US nonfarm payrolls came in softer than expected, easing labor tightness and supporting rate-cut expectations.",
        mixed:
          "US nonfarm payrolls delivered a mixed labor signal, leaving markets to parse wages, revisions, and participation.",
        neutral:
          "US nonfarm payrolls landed close to expectations, shifting focus to wages, revisions, and broader macro context.",
        hotter:
          "US payrolls and wages ran hot enough to preserve pressure on yields and a tighter policy interpretation.",
        cooler:
          "US payrolls cooled enough to reduce rate pressure and help duration-sensitive assets recover.",
        dovish:
          "US payrolls helped reinforce a dovish labor interpretation for bonds and growth equities.",
        hawkish:
          "US payrolls reinforced a hawkish labor interpretation and kept the bond market defensive.",
      })[bias],
    buildReviewHints: () => [
      "Check whether wages, revisions, or participation drove the move more than the headline payroll number.",
      "Confirm whether yields and the dollar led the reaction or whether equities diverged.",
      "Review any same-day Fed communication that may have competed with the payroll release.",
    ],
  },
  fomc: {
    event_family: "fomc_decision",
    source_type: "headline",
    default_title: (bias) =>
      ({
        dovish: "FOMC strikes a dovish policy tone",
        hawkish: "FOMC leans hawkish on rates",
        mixed: "FOMC sends a mixed policy signal",
        neutral: "FOMC largely matches expectations",
        hotter: "FOMC reacts to hotter inflation risks",
        cooler: "FOMC opens room for easing as inflation cools",
        stronger: "FOMC responds to stronger growth conditions",
        softer: "FOMC acknowledges softer growth conditions",
      })[bias] ?? "FOMC policy decision",
    default_publisher: "Federal Reserve",
    default_dominant_catalyst: "fomc-decision",
    primary_themes: ["central_bank", "rates"],
    primary_assets: ["TLT", "QQQ", "DXY", "SPY"],
    tags: ["macro_calendar", "fomc", "fed", "central_bank", "rates"],
    regimes: ["macro_rates", "policy_transition"],
    regions: ["united_states"],
    buildLead: (bias) =>
      ({
        dovish:
          "The FOMC struck a dovish tone and opened more room for rate cuts if inflation and labor continue to soften.",
        hawkish:
          "The FOMC leaned hawkish, signaling that inflation risks still matter and easing is not imminent.",
        mixed:
          "The FOMC delivered a mixed policy signal, leaving markets to weigh the statement, dot plot, and press conference together.",
        neutral:
          "The FOMC largely matched expectations, pushing markets to focus on nuance in the statement and updated projections.",
        hotter:
          "The FOMC emphasized hotter inflation risks and maintained a restrictive policy tone.",
        cooler:
          "The FOMC acknowledged cooling inflation and signaled more flexibility around future easing.",
        stronger:
          "The FOMC highlighted stronger growth and labor resilience, keeping policy restrictive for longer.",
        softer:
          "The FOMC acknowledged softer growth and labor conditions, which helped support a more dovish read.",
      })[bias],
    buildReviewHints: () => [
      "Check whether the statement, dot plot, or press conference drove the final market move.",
      "Confirm whether the first move reversed once Powell Q&A began.",
      "Review whether equities and bonds agreed on the policy interpretation.",
    ],
  },
  fed_speech: {
    event_family: "fed_speech",
    source_type: "speech",
    default_title: (bias) =>
      ({
        dovish: "Fed speaker leans dovish on rates",
        hawkish: "Fed speaker leans hawkish on inflation",
        mixed: "Fed speaker offers a mixed policy read",
        neutral: "Fed speaker stays balanced on policy",
        hotter: "Fed speaker warns inflation may stay hot",
        cooler: "Fed speaker points to cooling inflation",
        stronger: "Fed speaker highlights stronger growth",
        softer: "Fed speaker highlights softer labor and growth",
      })[bias] ?? "Fed speech",
    default_speaker: "Jerome Powell",
    default_publisher: "Federal Reserve",
    default_dominant_catalyst: "fed-speech",
    primary_themes: ["central_bank", "rates"],
    primary_assets: ["TLT", "QQQ", "DXY", "SPY"],
    tags: ["macro_calendar", "fed_speech", "fed", "central_bank", "rates"],
    regimes: ["macro_rates", "policy_transition"],
    regions: ["united_states"],
    buildLead: (bias) =>
      ({
        dovish:
          "A Federal Reserve speaker struck a dovish tone and suggested room for cuts if inflation continues to cool.",
        hawkish:
          "A Federal Reserve speaker struck a hawkish tone and warned that inflation risks still require policy restraint.",
        mixed:
          "A Federal Reserve speaker delivered a mixed policy message, balancing inflation progress against growth and labor uncertainty.",
        neutral:
          "A Federal Reserve speaker stayed balanced, leaving markets to interpret nuance around timing and policy sensitivity.",
        hotter:
          "A Federal Reserve speaker warned that inflation may stay hot enough to delay easing.",
        cooler:
          "A Federal Reserve speaker emphasized cooling inflation and more flexibility around future easing.",
        stronger:
          "A Federal Reserve speaker pointed to stronger growth and labor conditions as reasons to stay patient on cuts.",
        softer:
          "A Federal Reserve speaker highlighted softer labor and growth conditions, supporting a more dovish market read.",
      })[bias],
    buildReviewHints: () => [
      "Confirm whether prepared remarks or Q&A drove the lasting market interpretation.",
      "Check if the speech changed the path implied by the latest FOMC pricing or simply echoed it.",
      "Review whether another same-day macro release overpowered the speech signal.",
    ],
  },
};

/** Fallback preset for extended macro event types (pce, gdp, sentiment, jolts, etc.) */
const MACRO_GENERIC_PRESET: MacroPreset = {
  event_family: "macro_data_release",
  source_type: "headline",
  default_title: (bias) =>
    ({
      hotter:   "Macro data release surprises to the upside",
      cooler:   "Macro data release surprises to the downside",
      stronger: "Macro data release comes in stronger than expected",
      softer:   "Macro data release comes in softer than expected",
      dovish:   "Macro data release supports a dovish rates interpretation",
      hawkish:  "Macro data release reinforces a hawkish rates view",
      mixed:    "Macro data release delivers a mixed signal",
      neutral:  "Macro data release lands close to expectations",
      weaker:   "Macro data release disappoints and signals weakness",
      positive: "Macro policy development is market-positive",
      negative: "Macro policy development is market-negative",
    })[bias] ?? "Macro data release",
  default_publisher: "Government Statistical Agency",
  default_dominant_catalyst: "macro-data-release",
  primary_themes: ["macro", "rates", "growth"],
  primary_assets: ["SPY", "TLT", "DXY"],
  tags: ["macro_calendar", "macro_data"],
  regimes: ["macro_rates", "united_states_macro"],
  regions: ["united_states"],
  buildLead: (bias) =>
    ({
      hotter:   "The macro data release came in stronger than expected, reinforcing inflation or growth pressure.",
      cooler:   "The macro data release came in softer than expected, easing pressure on rates and growth.",
      stronger: "The macro data release beat expectations and reinforced a positive growth or labor read.",
      softer:   "The macro data release missed expectations and supported a softer macro interpretation.",
      dovish:   "The macro data release supported a dovish rates interpretation, helping bonds and growth equities.",
      hawkish:  "The macro data release reinforced a hawkish rates view and kept policy tightening concerns alive.",
      mixed:    "The macro data release delivered a mixed signal, leaving markets to weigh competing reads.",
      neutral:  "The macro data release landed close to expectations, leaving the macro backdrop unchanged.",
      weaker:   "The macro data release disappointed expectations and signalled emerging weakness in the economy.",
      positive: "The macro policy development was market-positive, reducing uncertainty and supporting risk assets.",
      negative: "The macro policy development was market-negative, adding uncertainty and pressuring risk assets.",
    })[bias] ?? "",
  buildReviewHints: () => [
    "Check whether the data release drove a lasting yield move or was quickly faded.",
    "Review whether competing macro catalysts on the same day diluted the primary signal.",
    "Confirm the dollar response was consistent with the rates interpretation.",
  ],
};

const buildMacroSource = (item: MacroHistoricalCaseInput, preset: MacroPreset): CreateSourceRequest => ({
  source_type: preset.source_type,
  title: item.title?.trim() || preset.default_title(item.signal_bias),
  speaker: item.speaker?.trim() || preset.default_speaker,
  publisher: item.publisher?.trim() || preset.default_publisher,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item.signal_bias)} ${item.summary.trim()}`,
});

const buildMacroLabels = (
  item: MacroHistoricalCaseInput,
  preset: MacroPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([
    ...(item.labels?.regimes ?? []),
    ...preset.regimes,
    ...macroBiasRegimes(item.event_type, item.signal_bias),
  ]),
  regions: unique([...(item.labels?.regions ?? []), ...preset.regions]),
  sectors: item.labels?.sectors,
  primary_themes: unique([...(item.labels?.primary_themes ?? []), ...preset.primary_themes]),
  primary_assets: unique([...(item.labels?.primary_assets ?? []), ...preset.primary_assets]),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type:
    item.labels?.surprise_type ??
    (item.signal_bias === "mixed" ? "mixed" : item.signal_bias === "neutral" ? "none" : undefined),
  case_quality: item.labels?.case_quality,
  notes: item.labels?.notes ?? `Loaded via macro historical preset: ${item.event_type}.`,
});

const toHistoricalDraft = (item: MacroHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = (MACRO_PRESETS as Record<string, MacroPreset>)[item.event_type] ?? MACRO_GENERIC_PRESET;

  return {
    case_id: item.case_id,
    case_pack: item.case_pack,
    source: buildMacroSource(item, preset),
    horizon: "1d",
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: item.dominant_catalyst?.trim() || preset.default_dominant_catalyst,
    labels: buildMacroLabels(item, preset),
    review_hints: defaultReviewHints(preset.buildReviewHints(item), item.review_hints),
    model_version: item.model_version,
  };
};

export const buildMacroHistoricalLibraryDrafts = (
  request: MacroHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestMacroHistoricalCases = async (
  services: AppServices,
  request: MacroHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildMacroHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
