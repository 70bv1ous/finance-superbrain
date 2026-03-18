import type { CreditHistoricalCaseInput } from "@finance-superbrain/schemas";

export const CREDIT_HISTORICAL_LOADER_CASES: CreditHistoricalCaseInput[] = [
  {
    case_id: "credit-svb-bank-run",
    case_pack: "credit_v1",
    event_type: "bank_run",
    signal_bias: "negative",
    institution: "Silicon Valley Bank",
    region: "united_states",
    focus_assets: ["KRE", "XLF"],
    summary:
      "Rapid deposit outflows and forced asset sales triggered bank-run stress, sending regional banks sharply lower while safe havens rallied.",
    occurred_at: "2023-03-10T15:00:00.000Z",
    realized_moves: [
      { ticker: "KRE", realized_direction: "down", realized_magnitude_bp: -167 },
      { ticker: "XLF", realized_direction: "down", realized_magnitude_bp: -74 },
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 92 },
    ],
    timing_alignment: 0.87,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "credit-fed-liquidity-backstop",
    case_pack: "credit_v1",
    event_type: "liquidity_backstop",
    signal_bias: "supportive",
    institution: "Federal Reserve",
    region: "united_states",
    focus_assets: ["KRE", "SPY"],
    summary:
      "Authorities launched a liquidity backstop to stabilize bank funding and reduce immediate stress in regional financials.",
    occurred_at: "2023-03-12T22:00:00.000Z",
    realized_moves: [
      { ticker: "KRE", realized_direction: "up", realized_magnitude_bp: 96 },
      { ticker: "XLF", realized_direction: "up", realized_magnitude_bp: 48 },
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -26 },
    ],
    timing_alignment: 0.78,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "credit-hy-spread-widening",
    case_pack: "credit_v1",
    event_type: "credit_spread_widening",
    signal_bias: "negative",
    institution: "US high-yield market",
    region: "united_states",
    focus_assets: ["HYG", "LQD"],
    summary:
      "High-yield spreads widened materially on growth and funding concerns, weighing on lower-quality credit and financial risk appetite.",
    occurred_at: "2022-06-13T14:00:00.000Z",
    realized_moves: [
      { ticker: "HYG", realized_direction: "down", realized_magnitude_bp: -82 },
      { ticker: "LQD", realized_direction: "down", realized_magnitude_bp: -37 },
      { ticker: "XLF", realized_direction: "down", realized_magnitude_bp: -28 },
    ],
    timing_alignment: 0.81,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "credit-global-bank-contagion",
    case_pack: "credit_v1",
    event_type: "banking_contagion",
    signal_bias: "negative",
    institution: "European banking system",
    region: "europe",
    focus_assets: ["EUFN", "XLF"],
    summary:
      "Contagion fears spread through major European banks, pressuring global financials and pushing investors into sovereign duration.",
    occurred_at: "2023-03-15T08:00:00.000Z",
    realized_moves: [
      { ticker: "EUFN", realized_direction: "down", realized_magnitude_bp: -124 },
      { ticker: "XLF", realized_direction: "down", realized_magnitude_bp: -53 },
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 61 },
    ],
    timing_alignment: 0.84,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "credit-downgrade-wave-cre",
    case_pack: "credit_v1",
    event_type: "downgrade_wave",
    signal_bias: "negative",
    institution: "US commercial real estate credit",
    region: "united_states",
    focus_assets: ["HYG", "KRE"],
    summary:
      "A cluster of downgrades across commercial real estate credit deepened banking and funding concerns for exposed lenders.",
    occurred_at: "2024-02-06T13:00:00.000Z",
    realized_moves: [
      { ticker: "HYG", realized_direction: "down", realized_magnitude_bp: -49 },
      { ticker: "KRE", realized_direction: "down", realized_magnitude_bp: -63 },
      { ticker: "SPY", realized_direction: "down", realized_magnitude_bp: -21 },
    ],
    timing_alignment: 0.75,
    labels: {
      case_quality: "reviewed",
    },
  },
];
