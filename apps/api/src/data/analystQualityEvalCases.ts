import type { ParseEventRequest } from "@finance-superbrain/schemas";

export type AnalystQualityEvalCase = {
  id: string;
  label: string;
  request: ParseEventRequest;
  expectedThemes: string[];
  requiredAssets: string[];
  directionalChecks: Array<{
    ticker: string;
    expectedDirection: "up" | "down" | "mixed";
  }>;
  bannedThesisPhrases?: string[];
};

export const ANALYST_QUALITY_EVAL_CASES: AnalystQualityEvalCase[] = [
  {
    id: "macro_dovish_growth_scare",
    label: "Dovish policy shift with growth-slowdown cross-currents",
    request: {
      source_type: "headline",
      title: "Central bank softens inflation language",
      raw_text:
        "The central bank unexpectedly softened its inflation language, signaled a slower pace of quantitative tightening, and emphasized downside growth risks after a sharp decline in freight rates and industrial demand surveys.",
    },
    expectedThemes: ["central_bank", "rates", "growth_slowdown"],
    requiredAssets: ["TLT", "QQQ", "GLD"],
    directionalChecks: [
      { ticker: "TLT", expectedDirection: "up" },
      { ticker: "QQQ", expectedDirection: "down" },
      { ticker: "GLD", expectedDirection: "up" },
    ],
    bannedThesisPhrases: ["central bank and inflation are likely to drive a neutral reaction"],
  },
  {
    id: "energy_supply_shock",
    label: "Oil supply shock with inflation spillover",
    request: {
      source_type: "headline",
      title: "Middle East crude exports disrupted",
      raw_text:
        "A surprise disruption to major Middle East crude exports removed 1.5 million barrels per day from expected supply, pushed front-month oil futures sharply higher, and triggered immediate concern about inflation spillovers and airline cost pressure.",
    },
    expectedThemes: ["energy", "energy_supply", "inflation", "margin_pressure"],
    requiredAssets: ["USO", "XLE"],
    directionalChecks: [
      { ticker: "USO", expectedDirection: "up" },
      { ticker: "XLE", expectedDirection: "up" },
    ],
  },
  {
    id: "china_tariff_pressure",
    label: "Trade-policy escalation into China-linked risk",
    request: {
      source_type: "transcript",
      title: "Tariff escalation rhetoric",
      speaker: "Donald Trump",
      raw_text:
        "Donald Trump said tariffs on China could rise again, warned that Beijing would face further trade restrictions, and noted that the yuan has been weakening alongside pressure on Chinese technology shares.",
    },
    expectedThemes: ["trade_policy", "china_risk"],
    requiredAssets: ["KWEB", "USD/CNH"],
    directionalChecks: [
      { ticker: "KWEB", expectedDirection: "down" },
      { ticker: "USD/CNH", expectedDirection: "up" },
    ],
  },
  {
    id: "banking_stress_backstop",
    label: "Regional-bank funding stress with policy backstop",
    request: {
      source_type: "headline",
      title: "Regional-bank funding pressure intensifies",
      raw_text:
        "Regional banks faced renewed deposit outflows and funding pressure overnight, while officials discussed liquidity backstops to prevent broader contagion across the banking system.",
    },
    expectedThemes: ["banking_stress"],
    requiredAssets: ["KRE", "TLT"],
    directionalChecks: [
      { ticker: "KRE", expectedDirection: "down" },
      { ticker: "TLT", expectedDirection: "up" },
    ],
  },
];
