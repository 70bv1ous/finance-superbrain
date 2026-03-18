import type { MacroHistoricalCaseInput } from "@finance-superbrain/schemas";

export const MACRO_HISTORICAL_LOADER_CASES: MacroHistoricalCaseInput[] = [
  {
    case_id: "macro-cpi-hotter-repricing",
    case_pack: "macro_calendar_v1",
    event_type: "cpi",
    signal_bias: "hotter",
    summary:
      "Core inflation stayed sticky enough to push yields higher, weigh on duration, and pressure growth equities into the close.",
    occurred_at: "2023-02-14T13:30:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -61 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -87 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 34 },
    ],
    timing_alignment: 0.84,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "macro-cpi-cooler-relief",
    case_pack: "macro_calendar_v1",
    event_type: "cpi",
    signal_bias: "cooler",
    summary:
      "Inflation cooled more than expected, helping bonds rally, easing dollar pressure, and supporting long-duration growth stocks.",
    occurred_at: "2023-11-14T13:30:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 57 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 82 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -29 },
    ],
    timing_alignment: 0.81,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "macro-nfp-stronger-yields-up",
    case_pack: "macro_calendar_v1",
    event_type: "nfp",
    signal_bias: "stronger",
    summary:
      "Payroll growth and wage strength pushed markets to reduce rate-cut expectations, lifting yields and pressuring growth assets.",
    occurred_at: "2024-02-02T13:30:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -55 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -71 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 28 },
    ],
    timing_alignment: 0.82,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "macro-nfp-softer-duration-relief",
    case_pack: "macro_calendar_v1",
    event_type: "nfp",
    signal_bias: "softer",
    summary:
      "A softer labor print improved the duration outlook, helped bonds rally, and supported long-duration technology names.",
    occurred_at: "2024-07-05T12:30:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 46 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 68 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -21 },
    ],
    timing_alignment: 0.8,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "macro-fomc-dovish-pivot",
    case_pack: "macro_calendar_v1",
    event_type: "fomc",
    signal_bias: "dovish",
    summary:
      "The statement and press conference both opened more room for easing, lifting bonds and growth equities while weakening the dollar.",
    occurred_at: "2024-12-18T19:00:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 51 },
      { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 74 },
      { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -27 },
    ],
    timing_alignment: 0.79,
    labels: {
      case_quality: "reviewed",
    },
  },
  {
    case_id: "macro-fed-speech-hawkish",
    case_pack: "macro_calendar_v1",
    event_type: "fed_speech",
    signal_bias: "hawkish",
    title: "Fed speech keeps inflation guard up",
    speaker: "Jerome Powell",
    summary:
      "The speech reinforced that inflation risks still matter, which kept yields firm and capped appetite for duration-sensitive growth.",
    occurred_at: "2025-01-29T18:00:00.000Z",
    realized_moves: [
      { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -39 },
      { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -41 },
      { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 18 },
    ],
    timing_alignment: 0.74,
    labels: {
      case_quality: "reviewed",
    },
  },
];
