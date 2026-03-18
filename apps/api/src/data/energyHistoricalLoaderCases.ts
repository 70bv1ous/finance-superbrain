import type { EnergyHistoricalCaseInput } from "@finance-superbrain/schemas";

export const ENERGY_HISTORICAL_LOADER_CASES: EnergyHistoricalCaseInput[] = [
  {
    case_id: "energy-opec-cut-crude-rally",
    case_pack: "energy_v1",
    event_type: "opec_cut",
    signal_bias: "bullish",
    market: "crude_oil",
    region: "middle_east",
    producer: "OPEC+",
    focus_assets: ["XLE", "XOM"],
    summary:
      "Producers announced a surprise output cut that tightened prompt crude balances, lifted oil sharply, and reignited the inflation conversation.",
    occurred_at: "2023-04-02T20:00:00.000Z",
    realized_moves: [
      { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 144 },
      { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 67 },
      { ticker: "XOM", realized_direction: "up", realized_magnitude_bp: 54 },
    ],
    timing_alignment: 0.86,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "energy-inventory-build-growth-fear",
    case_pack: "energy_v1",
    event_type: "inventory_build",
    signal_bias: "bearish",
    market: "crude_oil",
    region: "north_america",
    producer: "EIA",
    focus_assets: ["USO", "XLE"],
    summary:
      "A larger-than-expected inventory build combined with softer implied demand pushed crude lower and weighed on energy equities.",
    occurred_at: "2024-02-14T15:30:00.000Z",
    realized_moves: [
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: -91 },
      { ticker: "USO", realized_direction: "down", realized_magnitude_bp: -88 },
      { ticker: "XLE", realized_direction: "down", realized_magnitude_bp: -39 },
    ],
    timing_alignment: 0.79,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "energy-refinery-outage-supply-shock",
    case_pack: "energy_v1",
    event_type: "supply_disruption",
    signal_bias: "bullish",
    market: "refined_products",
    region: "north_america",
    producer: "US Gulf Coast",
    focus_assets: ["XLE", "VLO"],
    summary:
      "A refinery outage disrupted product supply and tightened the near-term energy balance, lifting crude-linked and downstream-sensitive names.",
    occurred_at: "2024-06-10T14:00:00.000Z",
    realized_moves: [
      { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 72 },
      { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 31 },
      { ticker: "VLO", realized_direction: "up", realized_magnitude_bp: 58 },
    ],
    timing_alignment: 0.74,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "energy-gas-spike-weather",
    case_pack: "energy_v1",
    event_type: "gas_spike",
    signal_bias: "bullish",
    market: "natural_gas",
    region: "north_america",
    producer: "US gas market",
    focus_assets: ["UNG", "XLU"],
    summary:
      "Weather stress and storage concerns triggered a natural gas spike, lifting gas-sensitive assets while reviving inflation concerns.",
    occurred_at: "2022-08-22T13:00:00.000Z",
    realized_moves: [
      { ticker: "NG=F", realized_direction: "up", realized_magnitude_bp: 188 },
      { ticker: "UNG", realized_direction: "up", realized_magnitude_bp: 176 },
      { ticker: "XLU", realized_direction: "down", realized_magnitude_bp: -24 },
    ],
    timing_alignment: 0.82,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "energy-demand-scare-global-growth",
    case_pack: "energy_v1",
    event_type: "demand_shock",
    signal_bias: "bearish",
    market: "broad_energy",
    region: "global",
    producer: "Global demand outlook",
    focus_assets: ["XLI", "SPY"],
    summary:
      "A weaker demand outlook hit the energy complex, pressured cyclicals, and reinforced a softer global growth narrative.",
    occurred_at: "2025-01-10T14:00:00.000Z",
    realized_moves: [
      { ticker: "CL=F", realized_direction: "down", realized_magnitude_bp: -104 },
      { ticker: "XLE", realized_direction: "down", realized_magnitude_bp: -51 },
      { ticker: "XLI", realized_direction: "down", realized_magnitude_bp: -34 },
    ],
    timing_alignment: 0.77,
    labels: {
      case_quality: "reviewed",
    },
  },
];
