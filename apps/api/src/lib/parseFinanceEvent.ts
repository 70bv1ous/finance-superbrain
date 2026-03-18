import type {
  ParseEventRequest,
  ParsedEvent,
  ParsedEventEntity,
} from "@finance-superbrain/schemas";

type ThemeConfig = {
  id: string;
  keywords: string[];
  assets: string[];
  explanations: string[];
  sentimentBias?: "risk_on" | "risk_off";
};

const THEME_CONFIGS: ThemeConfig[] = [
  {
    id: "trade_policy",
    keywords: ["tariff", "tariffs", "trade war", "export control", "import duty", "trade restriction"],
    assets: ["KWEB", "FXI", "BABA", "USD/CNH"],
    explanations: [
      "Trade-policy escalation tends to raise risk premiums for China-linked equities and FX.",
      "Markets often reprice supply-chain sensitivity quickly when tariff language hardens.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "china_risk",
    keywords: ["china", "chinese", "yuan", "renminbi", "beijing", "pboc"],
    assets: ["KWEB", "FXI", "BABA", "USD/CNH"],
    explanations: [
      "China-linked equities and the offshore yuan usually react first when China risk rises.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "rates",
    keywords: ["rate cut", "rate cuts", "rate hike", "rate hikes", "yield", "treasury", "bond market"],
    assets: ["TLT", "SPY", "QQQ", "DXY"],
    explanations: [
      "Rate language changes discount rates, equity multiples, and the dollar.",
    ],
  },
  {
    id: "central_bank",
    keywords: ["fed", "fomc", "powell", "ecb", "boj", "central bank"],
    assets: ["SPY", "QQQ", "TLT", "DXY"],
    explanations: [
      "Central-bank language can change rate expectations across equities, bonds, and FX.",
    ],
  },
  {
    id: "inflation",
    keywords: ["inflation", "cpi", "ppi", "price pressure", "sticky prices"],
    assets: ["TLT", "QQQ", "DXY", "GLD"],
    explanations: [
      "Inflation signals can reprice yields, growth equities, and defensive inflation hedges.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "labor",
    keywords: [
      "labor",
      "labour",
      "nonfarm payroll",
      "nonfarm payrolls",
      "jobs report",
      "employment",
      "wage growth",
      "unemployment rate",
    ],
    assets: ["TLT", "QQQ", "DXY", "SPY"],
    explanations: [
      "Labor data can reprice growth, rate-cut expectations, yields, and the dollar very quickly.",
    ],
  },
  {
    id: "earnings_guidance",
    keywords: ["guidance", "outlook", "forecast", "bookings", "pipeline", "raised guidance", "cut guidance"],
    assets: ["SPY", "QQQ", "IWM"],
    explanations: [
      "Forward guidance often matters more than the headline beat or miss for single-stock and sector reactions.",
    ],
  },
  {
    id: "consumer_demand",
    keywords: ["consumer", "traffic", "demand slowdown", "soft demand", "discretionary", "retail"],
    assets: ["XLY", "XRT", "SPY"],
    explanations: [
      "Consumer-demand commentary can reset expectations for discretionary spending, retail, and cyclicals.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "margin_pressure",
    keywords: ["margin pressure", "gross margin", "operating margin", "cost pressure", "pricing pressure"],
    assets: ["SPY", "QQQ", "XLY"],
    explanations: [
      "Margin commentary often changes how investors value earnings quality and forward profitability.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "cloud_enterprise",
    keywords: ["cloud", "enterprise", "seat growth", "software demand", "enterprise spending", "it budgets"],
    assets: ["QQQ", "IGV", "MSFT", "CRM"],
    explanations: [
      "Cloud and enterprise commentary can ripple through software, infrastructure, and broader growth multiples.",
    ],
  },
  {
    id: "fx_policy",
    keywords: [
      "fx intervention",
      "currency support",
      "support the yuan",
      "support the yen",
      "weaker yuan",
      "stronger yen",
      "devaluation",
      "foreign exchange market",
      "currency defense",
    ],
    assets: ["USD/CNH", "USD/JPY", "DXY", "FXI"],
    explanations: [
      "FX policy signals can quickly spill into local equities, cross-border risk appetite, and the dollar complex.",
    ],
  },
  {
    id: "sovereign_risk",
    keywords: [
      "sovereign",
      "rating downgrade",
      "debt crisis",
      "capital controls",
      "fiscal shock",
      "bond vigilantes",
      "default risk",
      "credit watch",
    ],
    assets: ["TLT", "DXY", "FXI", "EWU"],
    explanations: [
      "Sovereign and fiscal shocks can reprice local currencies, rates, and regional equity risk premia.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "banking_stress",
    keywords: [
      "bank run",
      "deposit flight",
      "deposit outflow",
      "banking stress",
      "liquidity backstop",
      "regional bank",
      "funding pressure",
    ],
    assets: ["KRE", "XLF", "TLT", "DXY"],
    explanations: [
      "Banking stress can reprice financial conditions, regional banks, and safe-haven assets very quickly.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "credit_stress",
    keywords: [
      "credit spread",
      "spread widening",
      "default",
      "downgrade",
      "credit shock",
      "high yield",
      "junk bond",
      "contagion",
    ],
    assets: ["HYG", "LQD", "XLF", "TLT"],
    explanations: [
      "Credit stress often spills into financials, lower-quality debt, and broader risk appetite.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "default_risk",
    keywords: ["default shock", "missed payment", "restructuring risk", "downgrade wave"],
    assets: ["HYG", "LQD", "SPY", "TLT"],
    explanations: [
      "Default risk can widen spreads, pressure cyclicals, and push flows toward quality and duration.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "sanctions_policy",
    keywords: ["sanction", "sanctions", "blacklist", "entity list", "restriction package"],
    assets: ["XLE", "ITA", "KWEB", "USD/CNH"],
    explanations: [
      "Sanctions and restriction packages can change supply chains, commodity flows, and geopolitical risk premiums.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "stimulus",
    keywords: ["stimulus", "support package", "liquidity injection", "easing", "relief"],
    assets: ["SPY", "QQQ", "KWEB", "XLF"],
    explanations: [
      "Stimulus language often boosts cyclicals and broad risk appetite when credible.",
    ],
    sentimentBias: "risk_on",
  },
  {
    id: "energy",
    keywords: ["oil", "gas", "energy", "opec", "crude"],
    assets: ["XLE", "USO", "CVX", "XOM"],
    explanations: [
      "Energy commentary can move oil-linked equities, ETFs, and inflation expectations.",
    ],
  },
  {
    id: "energy_supply",
    keywords: [
      "output cut",
      "production cut",
      "supply disruption",
      "inventory draw",
      "inventory build",
      "refinery outage",
      "pipeline outage",
      "output hike",
    ],
    assets: ["CL=F", "USO", "XLE", "XOM"],
    explanations: [
      "Energy supply shocks can reprice crude, downstream margins, and inflation-sensitive assets very quickly.",
    ],
  },
  {
    id: "defense",
    keywords: ["defense", "military", "security", "missile", "war"],
    assets: ["ITA", "LMT", "NOC", "RTX"],
    explanations: [
      "Defense and geopolitical commentary can reprice defense contractors and safe-haven flows.",
    ],
    sentimentBias: "risk_off",
  },
  {
    id: "ai_and_semis",
    keywords: ["chip", "chips", "semiconductor", "ai", "nvidia", "compute"],
    assets: ["NVDA", "SOXX", "QQQ", "SMH"],
    explanations: [
      "Semiconductor and AI commentary can move growth leadership and sector concentration risk.",
    ],
  },
];

const COUNTRY_KEYWORDS = [
  "china",
  "united states",
  "america",
  "japan",
  "europe",
  "uk",
  "taiwan",
  "russia",
  "saudi arabia",
];

const ORGANIZATION_KEYWORDS = [
  "fed",
  "fomc",
  "ecb",
  "boj",
  "pboc",
  "bbc",
  "opec",
];

const PERSON_KEYWORDS = [
  "donald trump",
  "jerome powell",
  "xi jinping",
  "elon musk",
];

const NEGATIVE_WORDS = [
  "guidance cut",
  "cut guidance",
  "demand slowdown",
  "soft demand",
  "margin pressure",
  "cost pressure",
  "pricing pressure",
  "deposit flight",
  "deposit outflow",
  "bank run",
  "funding pressure",
  "spread widening",
  "default",
  "downgrade",
  "devaluation",
  "weaken",
  "weakening",
  "slump",
  "dip",
  "fall",
  "lower",
  "risk",
  "pressure",
  "tariff",
  "sanction",
  "restrict",
  "uncertainty",
];

const POSITIVE_WORDS = [
  "rate cut",
  "rate cuts",
  "raised guidance",
  "raise guidance",
  "guidance raised",
  "guidance raise",
  "beat expectations",
  "support package",
  "liquidity injection",
  "support",
  "boost",
  "upside",
  "improve",
  "strong",
  "resilient",
  "relief",
  "stimulus",
  "growth",
];

const NOVELTY_WORDS = [
  "surprise",
  "unexpected",
  "new",
  "first time",
  "breaking",
  "sudden",
];

const URGENCY_WORDS = [
  "immediately",
  "urgent",
  "now",
  "today",
  "tonight",
  "breaking",
  "live",
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keywordPatternCache = new Map<string, RegExp>();

const matchesKeyword = (source: string, keyword: string) => {
  const normalized = keyword.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized.includes(" ")) {
    return source.includes(normalized);
  }

  let pattern = keywordPatternCache.get(normalized);

  if (!pattern) {
    pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`);
    keywordPatternCache.set(normalized, pattern);
  }

  return pattern.test(source);
};

const unique = <T>(values: T[]) => Array.from(new Set(values));

const detectThemes = (rawText: string) => {
  const matched = THEME_CONFIGS.filter((config) =>
    config.keywords.some((keyword) => matchesKeyword(rawText, keyword)),
  );

  return matched;
};

const detectEntities = (
  rawText: string,
  speaker?: string,
  title?: string,
): ParsedEventEntity[] => {
  const entities: ParsedEventEntity[] = [];
  const lowerTitle = (title ?? "").toLowerCase();
  const lowerSpeaker = (speaker ?? "").toLowerCase();

  if (speaker) {
    entities.push({ type: "person", value: speaker });
  }

  for (const person of PERSON_KEYWORDS) {
    if (matchesKeyword(rawText, person) || matchesKeyword(lowerTitle, person) || matchesKeyword(lowerSpeaker, person)) {
      entities.push({ type: "person", value: toTitleCase(person) });
    }
  }

  for (const country of COUNTRY_KEYWORDS) {
    if (matchesKeyword(rawText, country) || matchesKeyword(lowerTitle, country)) {
      entities.push({ type: "country", value: toTitleCase(country) });
    }
  }

  for (const organization of ORGANIZATION_KEYWORDS) {
    if (matchesKeyword(rawText, organization) || matchesKeyword(lowerTitle, organization)) {
      entities.push({ type: "organization", value: organization.toUpperCase() });
    }
  }

  for (const theme of detectThemes(rawText)) {
    entities.push({ type: "theme", value: theme.id });
  }

  return uniqueEntities(entities);
};

const uniqueEntities = (entities: ParsedEventEntity[]) => {
  const seen = new Set<string>();
  const output: ParsedEventEntity[] = [];

  for (const entity of entities) {
    const key = `${entity.type}:${entity.value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(entity);
  }

  return output;
};

const detectSentiment = (rawText: string, matchedThemes: ThemeConfig[]): ParsedEvent["sentiment"] => {
  let score = 0;

  for (const word of NEGATIVE_WORDS) {
    if (matchesKeyword(rawText, word)) {
      score -= 1;
    }
  }

  for (const word of POSITIVE_WORDS) {
    if (matchesKeyword(rawText, word)) {
      score += 1;
    }
  }

  for (const theme of matchedThemes) {
    if (theme.sentimentBias === "risk_off") {
      score -= 1;
    }
    if (theme.sentimentBias === "risk_on") {
      score += 1;
    }
  }

  if (score <= -2) {
    return "risk_off";
  }
  if (score >= 2) {
    return "risk_on";
  }
  return "neutral";
};

const detectEventClass = (
  sourceType: ParseEventRequest["source_type"],
  rawText: string,
  matchedThemes: ThemeConfig[],
): ParsedEvent["event_class"] => {
  const themeIds = new Set(matchedThemes.map((theme) => theme.id));

  if (sourceType === "transcript" || sourceType === "speech") {
    if (themeIds.has("central_bank") || themeIds.has("trade_policy")) {
      return "policy_speech";
    }
    return "live_commentary";
  }

  if (sourceType === "earnings") {
    return "earnings_commentary";
  }

  if (matchesKeyword(rawText, "guidance") || matchesKeyword(rawText, "earnings")) {
    return "earnings_commentary";
  }

  if (
    themeIds.has("inflation") ||
    themeIds.has("rates") ||
    themeIds.has("labor") ||
    themeIds.has("central_bank") ||
    themeIds.has("fx_policy") ||
    themeIds.has("sovereign_risk") ||
    themeIds.has("banking_stress") ||
    themeIds.has("credit_stress") ||
    themeIds.has("default_risk")
  ) {
    return "macro_commentary";
  }

  return "market_commentary";
};

const computeUrgencyScore = (
  rawText: string,
  matchedThemes: ThemeConfig[],
  sourceType: ParseEventRequest["source_type"],
) => {
  const urgencyHits = URGENCY_WORDS.filter((word) => matchesKeyword(rawText, word)).length;
  const base = 0.35 + matchedThemes.length * 0.08 + urgencyHits * 0.06;
  const sourceBonus = sourceType === "transcript" || sourceType === "speech" ? 0.08 : 0.03;
  return roundScore(clamp(base + sourceBonus, 0.1, 0.99));
};

const computeNoveltyScore = (rawText: string, matchedThemes: ThemeConfig[]) => {
  const noveltyHits = NOVELTY_WORDS.filter((word) => matchesKeyword(rawText, word)).length;
  const concentrationBonus = matchedThemes.length > 2 ? 0.07 : 0;
  const base = 0.28 + noveltyHits * 0.1 + concentrationBonus;
  return roundScore(clamp(base, 0.08, 0.95));
};

const buildCandidateAssets = (matchedThemes: ThemeConfig[], rawText: string) => {
  const assets = matchedThemes.flatMap((theme) => theme.assets);

  if (matchesKeyword(rawText, "gold")) {
    assets.push("GLD");
  }

  if (matchesKeyword(rawText, "bank") || matchesKeyword(rawText, "financial")) {
    assets.push("XLF");
  }

  return unique(assets).slice(0, 8);
};

const buildWhyItMatters = (matchedThemes: ThemeConfig[], sentiment: ParsedEvent["sentiment"]) => {
  const explanations = unique(matchedThemes.flatMap((theme) => theme.explanations));

  if (!explanations.length) {
    explanations.push(
      "The event introduces new information that could change investor expectations and near-term positioning.",
    );
  }

  if (sentiment === "risk_off") {
    explanations.push("The current signal leans defensive, so downside-sensitive assets may react first.");
  } else if (sentiment === "risk_on") {
    explanations.push("The signal leans supportive for risk appetite if follow-through data confirms it.");
  }

  return explanations.slice(0, 4);
};

const buildSummary = (
  speaker: string | undefined,
  matchedThemes: ThemeConfig[],
  sentiment: ParsedEvent["sentiment"],
) => {
  const themeLabels = matchedThemes.slice(0, 2).map((theme) => theme.id.replaceAll("_", " "));
  const subject = speaker ?? "The source";

  if (!themeLabels.length) {
    return `${subject} discussed market-relevant topics with a ${sentiment} tilt.`;
  }

  return `${subject} focused on ${themeLabels.join(" and ")} with a ${sentiment} market tilt.`;
};

const toTitleCase = (value: string) =>
  value.replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());

const roundScore = (value: number) => Number(value.toFixed(2));

export const parseFinanceEvent = (input: ParseEventRequest): ParsedEvent => {
  const rawText = input.raw_text.toLowerCase();
  const matchedThemes = detectThemes(rawText);
  const sentiment = detectSentiment(rawText, matchedThemes);
  const eventClass = detectEventClass(input.source_type, rawText, matchedThemes);
  const entities = detectEntities(rawText, input.speaker, input.title);
  const candidateAssets = buildCandidateAssets(matchedThemes, rawText);
  const whyItMatters = buildWhyItMatters(matchedThemes, sentiment);

  return {
    event_class: eventClass,
    summary: buildSummary(input.speaker, matchedThemes, sentiment),
    sentiment,
    urgency_score: computeUrgencyScore(rawText, matchedThemes, input.source_type),
    novelty_score: computeNoveltyScore(rawText, matchedThemes),
    entities,
    themes: matchedThemes.map((theme) => theme.id),
    candidate_assets: candidateAssets,
    why_it_matters: whyItMatters,
  };
};
