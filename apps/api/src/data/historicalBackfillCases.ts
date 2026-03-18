import type {
  CreateSourceRequest,
  HistoricalCaseLibraryDraft,
  HistoricalReplayRequest,
  RealizedMove,
} from "@finance-superbrain/schemas";

export type HistoricalBackfillCase = {
  case_id: string;
  case_pack: string;
  source: CreateSourceRequest;
  horizon: "1d";
  realized_moves: RealizedMove[];
  timing_alignment: number;
  tags: string[];
};

const selectHistoricalBackfillCases = (casePack = "macro_v1") =>
  HISTORICAL_BACKFILL_CASES.filter((item) =>
    casePack === "macro_plus_v1"
      ? item.case_pack === "macro_v1" || item.case_pack === "macro_plus_v1"
      : item.case_pack === casePack,
  );

export const HISTORICAL_BACKFILL_CASES: HistoricalBackfillCase[] = [
  {
    case_id: "china-tariff-warning",
    case_pack: "macro_v1",
    source: {
      source_type: "transcript",
      title: "China tariff warning",
      speaker: "Donald Trump",
      raw_text:
        "Donald Trump said tariffs on China could rise and that the yuan has been weakening, which may pressure Chinese tech stocks.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -174 },
      { ticker: "BABA", realized_direction: "down", realized_magnitude_bp: -188 },
      { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 33 },
    ],
    timing_alignment: 0.82,
    tags: ["china", "tariffs", "fx", "politics"],
  },
  {
    case_id: "china-stimulus-support",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Renewed China stimulus support",
      raw_text:
        "Officials signaled more stimulus support for China, boosting growth expectations and broader risk appetite across equities.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 118 },
      { ticker: "SPY", realized_direction: "up", realized_magnitude_bp: 72 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 96 },
    ],
    timing_alignment: 0.79,
    tags: ["china", "stimulus", "risk_on"],
  },
  {
    case_id: "fed-dovish-turn",
    case_pack: "macro_v1",
    source: {
      source_type: "speech",
      title: "Fed turns dovish",
      speaker: "Jerome Powell",
      raw_text:
        "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool and labor conditions weaken.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 42 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 69 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -28 },
    ],
    timing_alignment: 0.8,
    tags: ["fed", "rates", "macro", "policy"],
  },
  {
    case_id: "hot-inflation-surprise",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Hot inflation surprise",
      raw_text:
        "A hotter-than-expected inflation print renewed rate pressure, pushing yields higher and rattling growth stocks.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -64 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -92 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 37 },
    ],
    timing_alignment: 0.84,
    tags: ["inflation", "macro", "rates"],
  },
  {
    case_id: "opec-output-cut",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "OPEC output cut",
      raw_text:
        "OPEC signaled deeper oil production cuts, lifting crude expectations and reinforcing energy-sector strength.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 102 },
      { ticker: "USO", realized_direction: "up", realized_magnitude_bp: 136 },
      { ticker: "XOM", realized_direction: "up", realized_magnitude_bp: 72 },
    ],
    timing_alignment: 0.81,
    tags: ["oil", "energy", "commodities"],
  },
  {
    case_id: "defense-spending-surge",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Defense spending surge",
      raw_text:
        "Lawmakers backed a larger defense package after escalating security tensions, increasing attention on military contractors.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "ITA", realized_direction: "up", realized_magnitude_bp: 74 },
      { ticker: "LMT", realized_direction: "up", realized_magnitude_bp: 61 },
      { ticker: "RTX", realized_direction: "up", realized_magnitude_bp: 52 },
    ],
    timing_alignment: 0.76,
    tags: ["defense", "geopolitics", "fiscal"],
  },
  {
    case_id: "chip-export-restrictions",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Chip export restrictions tighten",
      raw_text:
        "New export control language on advanced AI chips raised concern for semiconductor demand and supply-chain access.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "NVDA", realized_direction: "down", realized_magnitude_bp: -128 },
      { ticker: "SOXX", realized_direction: "down", realized_magnitude_bp: -88 },
      { ticker: "SMH", realized_direction: "down", realized_magnitude_bp: -94 },
    ],
    timing_alignment: 0.78,
    tags: ["semiconductors", "china", "trade"],
  },
  {
    case_id: "chip-relief-exemption",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Semiconductor relief exemption",
      raw_text:
        "Officials signaled exemptions to earlier chip restrictions, easing pressure on AI and semiconductor names.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 104 },
      { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 82 },
      { ticker: "SMH", realized_direction: "up", realized_magnitude_bp: 88 },
    ],
    timing_alignment: 0.74,
    tags: ["semiconductors", "policy", "risk_on"],
  },
  {
    case_id: "soft-labor-print",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Soft labor print boosts cut hopes",
      raw_text:
        "A softer labor print increased expectations for rate cuts, supporting bonds and growth equities while easing dollar pressure.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 47 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 66 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -24 },
    ],
    timing_alignment: 0.8,
    tags: ["labor", "macro", "rates"],
  },
  {
    case_id: "oil-rally-fades",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Oil rally fades despite OPEC language",
      raw_text:
        "OPEC jawboning failed to hold crude higher as recession fears intensified and broader demand expectations weakened.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "XLE", realized_direction: "down", realized_magnitude_bp: -58 },
      { ticker: "USO", realized_direction: "down", realized_magnitude_bp: -84 },
      { ticker: "XOM", realized_direction: "down", realized_magnitude_bp: -46 },
    ],
    timing_alignment: 0.67,
    tags: ["oil", "energy", "growth"],
  },
  {
    case_id: "inflation-cools",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "Inflation cools more than expected",
      raw_text:
        "Cooling inflation relieved price pressure, improving the outlook for bonds and long-duration growth stocks.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 59 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 86 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -32 },
    ],
    timing_alignment: 0.82,
    tags: ["inflation", "macro", "risk_on"],
  },
  {
    case_id: "china-tech-rebound",
    case_pack: "macro_v1",
    source: {
      source_type: "headline",
      title: "China tech rebound despite tariff rhetoric",
      raw_text:
        "Tariff rhetoric toward China intensified, but investors focused on a larger domestic support package and China tech stocks rebounded instead.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 96 },
      { ticker: "BABA", realized_direction: "up", realized_magnitude_bp: 108 },
      { ticker: "USD/CNH", realized_direction: "down", realized_magnitude_bp: -26 },
    ],
    timing_alignment: 0.61,
    tags: ["china", "tariffs", "stimulus", "regime-shift"],
  },
  {
    case_id: "strong-jobs-repricing",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "Strong jobs print reprices cuts",
      raw_text:
        "A stronger-than-expected jobs report pushed Treasury yields higher, reduced confidence in near-term rate cuts, and pressured growth stocks.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -52 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -73 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 29 },
    ],
    timing_alignment: 0.83,
    tags: ["labor", "macro", "rates", "repricing"],
  },
  {
    case_id: "yield-drop-risk-on",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "Yields drop as bond market rallies",
      raw_text:
        "Treasury yields fell sharply as the bond market rallied, easing rate pressure and supporting long-duration equities and broad risk appetite.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 54 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 78 },
      { ticker: "SPY", realized_direction: "up", realized_magnitude_bp: 46 },
    ],
    timing_alignment: 0.8,
    tags: ["rates", "bonds", "risk_on"],
  },
  {
    case_id: "ceasefire-defense-fade",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "Ceasefire hopes cool defense trade",
      raw_text:
        "Security tensions eased after ceasefire talks, reducing demand for military names and weakening the defense trade.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "ITA", realized_direction: "down", realized_magnitude_bp: -44 },
      { ticker: "LMT", realized_direction: "down", realized_magnitude_bp: -31 },
      { ticker: "RTX", realized_direction: "down", realized_magnitude_bp: -28 },
    ],
    timing_alignment: 0.74,
    tags: ["defense", "geopolitics", "de-escalation"],
  },
  {
    case_id: "middle-east-oil-spike",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "Middle East tensions lift oil",
      raw_text:
        "War concerns in the Middle East lifted crude prices, tightened energy supply expectations, and boosted energy equities.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "USO", realized_direction: "up", realized_magnitude_bp: 118 },
      { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 88 },
      { ticker: "XOM", realized_direction: "up", realized_magnitude_bp: 61 },
    ],
    timing_alignment: 0.78,
    tags: ["energy", "war", "supply-shock"],
  },
  {
    case_id: "pboc-supports-yuan",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "PBOC supports the yuan",
      raw_text:
        "The PBOC signaled support for the yuan and broader liquidity easing, helping China tech sentiment and improving risk appetite.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "USD/CNH", realized_direction: "down", realized_magnitude_bp: -24 },
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 84 },
      { ticker: "BABA", realized_direction: "up", realized_magnitude_bp: 93 },
    ],
    timing_alignment: 0.77,
    tags: ["china", "fx", "stimulus", "pboc"],
  },
  {
    case_id: "ai-capex-upside",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "earnings",
      title: "AI capex upside surprise",
      raw_text:
        "Earnings commentary highlighted stronger AI compute demand, higher capital spending, and improved guidance for semiconductor suppliers.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 126 },
      { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 89 },
      { ticker: "SMH", realized_direction: "up", realized_magnitude_bp: 94 },
    ],
    timing_alignment: 0.8,
    tags: ["earnings", "ai", "semiconductors", "guidance"],
  },
  {
    case_id: "ai-guidance-disappoints",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "earnings",
      title: "AI guidance disappoints",
      raw_text:
        "Earnings guidance disappointed on AI compute demand and chip orders, pressuring semiconductor leaders and broader growth sentiment.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "NVDA", realized_direction: "down", realized_magnitude_bp: -111 },
      { ticker: "SOXX", realized_direction: "down", realized_magnitude_bp: -76 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -48 },
    ],
    timing_alignment: 0.79,
    tags: ["earnings", "ai", "semiconductors", "guidance"],
  },
  {
    case_id: "hot-cpi-stocks-hold-up",
    case_pack: "macro_plus_v1",
    source: {
      source_type: "headline",
      title: "Hot CPI but equities recover",
      raw_text:
        "A hot CPI print pushed yields higher at first, but equities recovered as investors focused on resilient growth and stronger earnings support.",
    },
    horizon: "1d",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -38 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 31 },
      { ticker: "SPY", realized_direction: "up", realized_magnitude_bp: 24 },
    ],
    timing_alignment: 0.56,
    tags: ["inflation", "regime-shift", "risk_on"],
  },
];

export const buildHistoricalReplayPack = (
  modelVersions: string[],
  casePack = "macro_v1",
): HistoricalReplayRequest => ({
  model_versions: modelVersions,
  cases: selectHistoricalBackfillCases(casePack).map((item) => ({
    case_id: item.case_id,
    case_pack: casePack,
    source: item.source,
    horizon: item.horizon,
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: "historical-replay",
    model_version: "historical-replay-baseline",
    tags: item.tags,
  })),
});

export const buildHistoricalLibraryDrafts = (
  casePack = "macro_plus_v1",
): HistoricalCaseLibraryDraft[] =>
  selectHistoricalBackfillCases(casePack).map((item) => ({
    case_id: item.case_id,
    case_pack: item.case_pack,
    source: item.source,
    horizon: item.horizon,
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: "historical-backfill",
    labels: {
      tags: item.tags,
      case_quality: "reviewed",
    },
  }));
