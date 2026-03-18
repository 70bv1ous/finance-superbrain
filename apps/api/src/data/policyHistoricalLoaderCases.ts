import type { PolicyHistoricalCaseInput } from "@finance-superbrain/schemas";

export const POLICY_HISTORICAL_LOADER_CASES: PolicyHistoricalCaseInput[] = [
  {
    case_id: "policy-china-stimulus-yuan-support",
    case_pack: "policy_fx_v1",
    event_type: "stimulus_support",
    signal_bias: "supportive",
    country: "China",
    region: "asia",
    currency_pair: "USD/CNH",
    focus_assets: ["KWEB", "BABA"],
    summary:
      "Authorities signaled broader liquidity support and more active yuan stabilization, improving China tech sentiment and easing growth fears.",
    occurred_at: "2023-08-28T02:00:00.000Z",
    realized_moves: [
      { ticker: "USD/CNH", realized_direction: "down", realized_magnitude_bp: -27 },
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 92 },
      { ticker: "BABA", realized_direction: "up", realized_magnitude_bp: 101 },
    ],
    timing_alignment: 0.8,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-japan-yen-intervention-2022",
    case_pack: "policy_fx_v1",
    event_type: "fx_intervention",
    signal_bias: "supportive",
    country: "Japan",
    region: "asia",
    currency_pair: "USD/JPY",
    focus_assets: ["EWJ"],
    summary:
      "Japanese officials stepped into the FX market to defend the yen after disorderly weakness, forcing a sharp USD/JPY reversal and tightening risk conditions.",
    occurred_at: "2022-09-22T14:00:00.000Z",
    realized_moves: [
      { ticker: "USD/JPY", realized_direction: "down", realized_magnitude_bp: -168 },
      { ticker: "EWJ", realized_direction: "down", realized_magnitude_bp: -29 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -14 },
    ],
    timing_alignment: 0.82,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-japan-yen-intervention",
    case_pack: "policy_fx_v1",
    event_type: "fx_intervention",
    signal_bias: "supportive",
    country: "Japan",
    region: "asia",
    currency_pair: "USD/JPY",
    focus_assets: ["EWJ"],
    summary:
      "Officials intervened to support the yen after disorderly depreciation, pulling USD/JPY lower and shifting risk sentiment across Japan-sensitive assets.",
    occurred_at: "2024-04-29T01:00:00.000Z",
    realized_moves: [
      { ticker: "USD/JPY", realized_direction: "down", realized_magnitude_bp: -143 },
      { ticker: "EWJ", realized_direction: "down", realized_magnitude_bp: -34 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -18 },
    ],
    timing_alignment: 0.77,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-china-yuan-defense-fix",
    case_pack: "policy_fx_v1",
    event_type: "fx_intervention",
    signal_bias: "supportive",
    country: "China",
    region: "asia",
    currency_pair: "USD/CNH",
    focus_assets: ["FXI", "KWEB"],
    summary:
      "State-bank dollar selling and a stronger-than-expected yuan fix signaled official defense of the currency, helping USD/CNH pull back and improving China risk sentiment.",
    occurred_at: "2023-09-11T01:00:00.000Z",
    realized_moves: [
      { ticker: "USD/CNH", realized_direction: "down", realized_magnitude_bp: -36 },
      { ticker: "FXI", realized_direction: "up", realized_magnitude_bp: 33 },
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 47 },
    ],
    timing_alignment: 0.76,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-uk-fiscal-shock",
    case_pack: "policy_fx_v1",
    event_type: "fiscal_shock",
    signal_bias: "negative",
    country: "United Kingdom",
    region: "europe",
    currency_pair: "GBP/USD",
    focus_assets: ["EWU"],
    summary:
      "A large unfunded fiscal package triggered a sharp repricing in gilts, sterling, and UK risk assets as policy credibility came under stress.",
    occurred_at: "2022-09-23T11:00:00.000Z",
    realized_moves: [
      { ticker: "GBP/USD", realized_direction: "down", realized_magnitude_bp: -118 },
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -29 },
      { ticker: "EWU", realized_direction: "down", realized_magnitude_bp: -67 },
    ],
    timing_alignment: 0.83,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-european-bank-capital-controls",
    case_pack: "policy_fx_v1",
    event_type: "capital_controls",
    signal_bias: "restrictive",
    country: "European Union",
    region: "europe",
    currency_pair: "EUR/USD",
    focus_assets: ["EZU"],
    summary:
      "Emergency capital-transfer restrictions and tighter market controls drove sovereign stress concerns and pressured regional assets.",
    occurred_at: "2023-03-20T08:00:00.000Z",
    realized_moves: [
      { ticker: "EUR/USD", realized_direction: "down", realized_magnitude_bp: -49 },
      { ticker: "EZU", realized_direction: "down", realized_magnitude_bp: -58 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 22 },
    ],
    timing_alignment: 0.71,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-russia-sanctions-energy-shock",
    case_pack: "policy_fx_v1",
    event_type: "sanctions",
    signal_bias: "negative",
    country: "Russia",
    region: "europe",
    focus_assets: ["XLE", "USO", "ITA"],
    summary:
      "New sanctions reshaped commodity and defense expectations, pushing energy risk higher and broadening geopolitical risk premiums.",
    occurred_at: "2022-02-28T08:00:00.000Z",
    realized_moves: [
      { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 83 },
      { ticker: "USO", realized_direction: "up", realized_magnitude_bp: 109 },
      { ticker: "ITA", realized_direction: "up", realized_magnitude_bp: 41 },
    ],
    timing_alignment: 0.79,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "policy-china-tech-regulatory-relief",
    case_pack: "policy_fx_v1",
    event_type: "trade_relief",
    signal_bias: "positive",
    country: "China",
    region: "asia",
    currency_pair: "USD/CNH",
    focus_assets: ["KWEB", "FXI"],
    summary:
      "Officials signaled a lighter regulatory stance and partial relief on market restrictions, sparking a relief move in China tech and the yuan.",
    occurred_at: "2024-09-24T02:00:00.000Z",
    realized_moves: [
      { ticker: "KWEB", realized_direction: "up", realized_magnitude_bp: 105 },
      { ticker: "FXI", realized_direction: "up", realized_magnitude_bp: 72 },
      { ticker: "USD/CNH", realized_direction: "down", realized_magnitude_bp: -23 },
    ],
    timing_alignment: 0.75,
    labels: {
      case_quality: "reviewed",
    },
  },
];
