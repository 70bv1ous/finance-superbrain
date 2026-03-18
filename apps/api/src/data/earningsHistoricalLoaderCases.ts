import type { EarningsHistoricalCaseInput } from "@finance-superbrain/schemas";

export const EARNINGS_HISTORICAL_LOADER_CASES: EarningsHistoricalCaseInput[] = [
  {
    case_id: "earnings-nvda-ai-capex-upside",
    case_pack: "earnings_v1",
    event_type: "ai_capex_upside",
    signal_bias: "positive",
    company: "NVIDIA",
    ticker: "NVDA",
    sector: "semiconductors",
    peers: ["SOXX", "SMH", "AMD"],
    summary:
      "Management highlighted stronger AI compute demand, hyperscaler capex upside, and better supply visibility through the next several quarters.",
    occurred_at: "2024-05-22T20:15:00.000Z",
    realized_moves: [
      { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 129 },
      { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 91 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 44 },
    ],
    timing_alignment: 0.82,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "earnings-salesforce-cloud-slowdown",
    case_pack: "earnings_v1",
    event_type: "cloud_slowdown",
    signal_bias: "negative",
    company: "Salesforce",
    ticker: "CRM",
    sector: "software",
    peers: ["IGV", "NOW", "MSFT"],
    summary:
      "The call described slower enterprise seat expansion, longer sales cycles, and a softer software demand backdrop than investors had priced in.",
    occurred_at: "2024-05-29T20:05:00.000Z",
    realized_moves: [
      { ticker: "CRM", realized_direction: "down", realized_magnitude_bp: -164 },
      { ticker: "IGV", realized_direction: "down", realized_magnitude_bp: -53 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -27 },
    ],
    timing_alignment: 0.79,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "earnings-nike-guidance-cut",
    case_pack: "earnings_v1",
    event_type: "guidance_cut",
    signal_bias: "negative",
    company: "Nike",
    ticker: "NKE",
    sector: "consumer_discretionary",
    peers: ["XLY", "LULU", "XRT"],
    summary:
      "Management cut the forward outlook and pointed to weaker traffic, more promotions, and a softer consumer setup than expected.",
    occurred_at: "2023-12-21T21:15:00.000Z",
    realized_moves: [
      { ticker: "NKE", realized_direction: "down", realized_magnitude_bp: -118 },
      { ticker: "XLY", realized_direction: "down", realized_magnitude_bp: -31 },
      { ticker: "XRT", realized_direction: "down", realized_magnitude_bp: -46 },
    ],
    timing_alignment: 0.76,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "earnings-tesla-margin-pressure",
    case_pack: "earnings_v1",
    event_type: "margin_pressure",
    signal_bias: "negative",
    company: "Tesla",
    ticker: "TSLA",
    sector: "automotive",
    peers: ["XLY", "GM", "F"],
    summary:
      "Automotive gross margins came in below expectations, and management signaled pricing pressure and heavier cost absorption ahead.",
    occurred_at: "2024-04-23T20:10:00.000Z",
    realized_moves: [
      { ticker: "TSLA", realized_direction: "down", realized_magnitude_bp: -141 },
      { ticker: "XLY", realized_direction: "down", realized_magnitude_bp: -22 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -18 },
    ],
    timing_alignment: 0.78,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "earnings-costco-management-tone-shift",
    case_pack: "earnings_v1",
    event_type: "management_tone_shift",
    signal_bias: "mixed",
    company: "Costco",
    ticker: "COST",
    sector: "consumer_staples",
    peers: ["WMT", "TGT", "XLP"],
    summary:
      "The headline numbers were solid, but management commentary turned more cautious on traffic quality and promotional intensity later in the call.",
    occurred_at: "2024-09-26T20:15:00.000Z",
    realized_moves: [
      { ticker: "COST", realized_direction: "down", realized_magnitude_bp: -57 },
      { ticker: "WMT", realized_direction: "down", realized_magnitude_bp: -19 },
      { ticker: "XLP", realized_direction: "down", realized_magnitude_bp: -11 },
    ],
    timing_alignment: 0.63,
    labels: {
      case_quality: "reviewed",
    },
  },
];
