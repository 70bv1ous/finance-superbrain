import type {
  HistoricalCaseLabel,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  ParsedEvent,
} from "@finance-superbrain/schemas";

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const lowerIncludes = (haystack: string, needles: string[]) => {
  const normalized = haystack.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
};

const themeIncludes = (parsedEvent: ParsedEvent, themes: string[]) =>
  parsedEvent.themes.some((theme) => themes.includes(theme));

const normalizedText = (draft: HistoricalCaseLibraryDraft) =>
  [draft.source.title, draft.source.speaker, draft.source.publisher, draft.source.raw_text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const inferEventFamily = (parsedEvent: ParsedEvent) =>
  parsedEvent.themes[0] ?? parsedEvent.event_class.replace(/_/g, "-");

const inferRegions = (draft: HistoricalCaseLibraryDraft, parsedEvent: ParsedEvent) => {
  const text = normalizedText(draft);
  const entityValues = parsedEvent.entities.map((entity) => entity.value.toLowerCase());
  const values = new Set<string>();

  if (
    lowerIncludes(text, ["china", "chinese", "yuan", "beijing", "renminbi"]) ||
    entityValues.some((value) => value.includes("china"))
  ) {
    values.add("china");
    values.add("asia");
  }

  if (
    lowerIncludes(text, ["fed", "powell", "united states", "u.s.", "us ", "dollar"]) ||
    entityValues.some((value) => value.includes("united states") || value === "fed")
  ) {
    values.add("united_states");
  }

  if (lowerIncludes(text, ["europe", "ecb", "eurozone"])) {
    values.add("europe");
  }

  if (lowerIncludes(text, ["japan", "boj", "yen"])) {
    values.add("japan");
    values.add("asia");
  }

  if (!values.size) {
    values.add("global");
  }

  return [...values];
};

const inferSectors = (draft: HistoricalCaseLibraryDraft, parsedEvent: ParsedEvent) => {
  const text = normalizedText(draft);
  const values = new Set<string>();

  if (
    parsedEvent.themes.includes("energy") ||
    lowerIncludes(text, ["oil", "gas", "energy", "opec", "crude"])
  ) {
    values.add("energy");
  }

  if (
    parsedEvent.themes.includes("defense") ||
    lowerIncludes(text, ["defense", "military", "security", "contractor"])
  ) {
    values.add("defense");
  }

  if (
    parsedEvent.themes.includes("ai_and_semis") ||
    lowerIncludes(text, ["semiconductor", "chip", "chips", "ai compute", "guidance"])
  ) {
    values.add("semiconductors");
    values.add("technology");
  }

  if (draft.source.source_type === "earnings") {
    values.add("earnings");
  }

  if (!values.size && parsedEvent.candidate_assets.some((asset) => ["QQQ", "NVDA", "SOXX", "SMH"].includes(asset))) {
    values.add("technology");
  }

  return [...values];
};

const inferRegimes = (draft: HistoricalCaseLibraryDraft, parsedEvent: ParsedEvent) => {
  const text = normalizedText(draft);
  const values = new Set<string>();

  if (parsedEvent.sentiment === "risk_on") {
    values.add("risk_on");
  }

  if (parsedEvent.sentiment === "risk_off") {
    values.add("risk_off");
  }

  if (draft.source.source_type === "earnings") {
    values.add("earnings");
    values.add("earnings_season");
    values.add("single_stock_fundamental");
  }

  if (
    draft.source.source_type === "earnings" &&
    (themeIncludes(parsedEvent, [
      "earnings_guidance",
      "margin_pressure",
      "consumer_demand",
      "cloud_enterprise",
    ]) ||
      lowerIncludes(text, [
        "guidance cut",
        "margin pressure",
        "consumer weakness",
        "cloud slowdown",
        "reset expectations",
      ]))
  ) {
    values.add("earnings_reset");
  }

  if (
    themeIncludes(parsedEvent, ["ai_and_semis"]) ||
    lowerIncludes(text, ["ai demand", "ai capex", "accelerator demand", "gpu demand"])
  ) {
    values.add("ai_momentum");
  }

  if (
    parsedEvent.themes.some((theme) => ["rates", "central_bank", "inflation"].includes(theme)) ||
    lowerIncludes(text, ["cpi", "ppi", "fed", "powell", "yield", "rate cut", "rate hike"])
  ) {
    values.add("macro_rates");

    if (
      lowerIncludes(text, [
        "rate hike",
        "higher for longer",
        "hawkish",
        "hotter",
        "sticky inflation",
        "strong payrolls",
        "stronger than expected",
      ])
    ) {
      values.add("rate_hiking");
      values.add("higher_for_longer");
    }

    if (
      lowerIncludes(text, [
        "rate cut",
        "dovish",
        "cooler",
        "cooling inflation",
        "disinflation",
        "softer labor",
        "softer than expected",
      ])
    ) {
      values.add("rate_cutting");
    }

    if (
      themeIncludes(parsedEvent, ["inflation"]) &&
      lowerIncludes(text, ["cooler", "cooling inflation", "disinflation", "prices eased"])
    ) {
      values.add("disinflation");
    }
  }

  if (
    parsedEvent.themes.some((theme) =>
      ["trade_policy", "china_risk", "defense", "sanctions_policy", "fx_policy"].includes(theme),
    ) ||
    lowerIncludes(text, [
      "tariff",
      "export control",
      "security tensions",
      "war",
      "sanctions",
      "intervened in fx",
    ])
  ) {
    values.add("policy_shock");

    if (
      lowerIncludes(text, ["tariff", "export control", "trade restriction", "trade escalation"])
    ) {
      values.add("tariff_escalation");
    }

    if (
      lowerIncludes(text, ["war", "sanctions", "geopolitical", "security tensions", "military"])
    ) {
      values.add("geopolitical_risk");
    }

    if (
      themeIncludes(parsedEvent, ["fx_policy"]) ||
      lowerIncludes(text, ["fx intervention", "currency intervention", "yen intervention", "yuan support"])
    ) {
      values.add("fx_intervention");
    }
  }

  if (parsedEvent.themes.includes("stimulus")) {
    values.add("stimulus");

    if (
      lowerIncludes(text, ["china", "beijing", "pboc", "yuan", "renminbi", "chinese"])
    ) {
      values.add("china_stimulus");
    }
  }

  if (
    themeIncludes(parsedEvent, ["energy", "energy_supply"]) ||
    lowerIncludes(text, ["oil", "gas", "opec", "supply disruption", "inventory draw", "inventory build"])
  ) {
    values.add("commodities");

    if (
      lowerIncludes(text, [
        "opec cut",
        "supply disruption",
        "gas spike",
        "pipeline outage",
        "inventory draw",
      ])
    ) {
      values.add("energy_shock");
    }
  }

  if (
    themeIncludes(parsedEvent, ["banking_stress", "credit_stress", "default_risk", "liquidity"]) ||
    lowerIncludes(text, ["bank run", "deposit flight", "banking contagion", "credit spreads widen"])
  ) {
    values.add("banking_stress");
  }

  if (!values.size) {
    values.add("market_commentary");
  }

  return [...values];
};

const inferSurpriseType = (draft: HistoricalCaseLibraryDraft): HistoricalCaseLabel["surprise_type"] => {
  const text = normalizedText(draft);
  const positive = lowerIncludes(text, [
    "beat",
    "beats",
    "upside",
    "stronger",
    "relief",
    "rebound",
    "support",
    "cools",
  ]);
  const negative = lowerIncludes(text, [
    "miss",
    "disappoint",
    "weaker",
    "weakening",
    "hot inflation",
    "pressure",
    "pressured",
    "cuts guidance",
  ]);

  if (positive && negative) {
    return "mixed";
  }

  if (positive) {
    return "positive";
  }

  if (negative) {
    return "negative";
  }

  return "none";
};

const inferPrimaryAssets = (
  draft: HistoricalCaseLibraryDraft,
  parsedEvent: ParsedEvent,
) =>
  unique([
    ...draft.realized_moves
      .slice()
      .sort(
        (left, right) =>
          Math.abs(right.realized_magnitude_bp) - Math.abs(left.realized_magnitude_bp),
      )
      .slice(0, 4)
      .map((move) => move.ticker),
    ...parsedEvent.candidate_assets.slice(0, 4),
  ]).slice(0, 6);

const mergeArrayField = (
  manualValues: string[] | undefined,
  inferredValues: string[],
  mode: "merge" | "manual_only" | "inferred_only",
) => {
  if (mode === "manual_only") {
    return unique(manualValues ?? []);
  }

  if (mode === "inferred_only") {
    return unique(inferredValues);
  }

  return unique([...(manualValues ?? []), ...inferredValues]);
};

const fieldCount = (labels?: HistoricalCaseLabelInput) =>
  labels
    ? Object.values(labels).filter((value) =>
        Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "",
      ).length
    : 0;

export const buildHistoricalCaseLabels = (
  draft: HistoricalCaseLibraryDraft,
  parsedEvent: ParsedEvent,
  mode: "merge" | "manual_only" | "inferred_only" = "merge",
): HistoricalCaseLabel => {
  const manual = draft.labels;
  const inferred: HistoricalCaseLabel = {
    event_family: inferEventFamily(parsedEvent),
    tags: unique([
      draft.source.source_type,
      ...parsedEvent.themes,
      ...inferRegimes(draft, parsedEvent),
      ...inferRegions(draft, parsedEvent),
      ...inferSectors(draft, parsedEvent),
    ]),
    regimes: inferRegimes(draft, parsedEvent),
    regions: inferRegions(draft, parsedEvent),
    sectors: inferSectors(draft, parsedEvent),
    primary_themes: unique(parsedEvent.themes),
    primary_assets: inferPrimaryAssets(draft, parsedEvent),
    competing_catalysts:
      draft.dominant_catalyst && !["historical-library", "historical-backfill", "historical-replay"].includes(draft.dominant_catalyst)
        ? [draft.dominant_catalyst]
        : [],
    surprise_type: inferSurpriseType(draft),
    case_quality: "draft",
    label_source: "inferred",
    notes: null,
  };

  const manualFields = fieldCount(manual);
  const labelSource =
    mode === "manual_only" || (manualFields > 0 && inferred.tags.length === 0)
      ? ("manual" as const)
      : manualFields > 0
        ? ("hybrid" as const)
        : ("inferred" as const);

  return {
    event_family:
      mode === "inferred_only"
        ? inferred.event_family
        : manual?.event_family ?? inferred.event_family,
    tags: mergeArrayField(manual?.tags, inferred.tags, mode),
    regimes: mergeArrayField(manual?.regimes, inferred.regimes, mode),
    regions: mergeArrayField(manual?.regions, inferred.regions, mode),
    sectors: mergeArrayField(manual?.sectors, inferred.sectors, mode),
    primary_themes: mergeArrayField(manual?.primary_themes, inferred.primary_themes, mode),
    primary_assets: mergeArrayField(manual?.primary_assets, inferred.primary_assets, mode),
    competing_catalysts: mergeArrayField(
      manual?.competing_catalysts,
      inferred.competing_catalysts,
      mode,
    ),
    surprise_type:
      mode === "inferred_only" ? inferred.surprise_type : manual?.surprise_type ?? inferred.surprise_type,
    case_quality:
      mode === "inferred_only" ? inferred.case_quality : manual?.case_quality ?? inferred.case_quality,
    label_source: labelSource,
    notes:
      mode === "inferred_only"
        ? inferred.notes
        : manual?.notes === undefined
          ? inferred.notes
          : manual.notes,
  };
};

export const normalizeHistoricalCaseId = (
  draft: HistoricalCaseLibraryDraft,
  fallbackIndex = 0,
) => {
  if (draft.case_id?.trim()) {
    return draft.case_id.trim().toLowerCase();
  }

  const base = (draft.source.title || draft.source.raw_text.slice(0, 60))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  return `${base || "historical-case"}-${fallbackIndex + 1}`;
};
