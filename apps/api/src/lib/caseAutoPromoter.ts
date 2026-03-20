/**
 * Case Auto-Promoter
 *
 * When a prediction is scored as "correct" or "partial" with HIGH confidence,
 * this module auto-generates a historical case from it and seeds it immediately
 * into the vector store.
 *
 * This closes the learning loop in the other direction from feedbackCorrectionHandler:
 *   - feedbackCorrectionHandler: brain was WRONG → teach the correct answer
 *   - caseAutoPromoter:          brain was RIGHT  → reinforce the winning pattern
 *
 * The brain literally grows its case library from every event it correctly calls.
 *
 * Trigger conditions (both must be true):
 *   1. outcome === "correct" OR outcome === "partial"
 *   2. confidence_level === "high"
 *
 * A "partial" correct with high confidence is still worth promoting — the
 * directional reasoning was sound even if magnitude or timing was off.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { HistoricalCaseLibraryDraft } from "@finance-superbrain/schemas";
import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutoPromotionInput = {
  session_id:       string;
  query:            string;
  answer_summary:   string;
  event_type:       string;
  confidence_level: string;
  outcome:          "correct" | "partial";
  notes:            string;
};

export type AutoPromotionResult = {
  case_id:   string;
  case_pack: string;
  status:    "promoted";
  message:   string;
};

type StructuredCase = {
  domain:            string;
  case_pack:         string;
  event_type:        string;
  signal_bias:       "bullish" | "bearish" | "mixed" | "neutral";
  summary:           string;
  review_hints:      string[];
  dominant_catalyst: string;
  primary_themes:    string[];
  predicted_moves:   Array<{ ticker: string; direction: "up" | "down" | "flat"; magnitude_bp: number }>;
};

// ─── Domain → Case Pack mapping ───────────────────────────────────────────────
// Must stay in sync with feedbackCorrectionHandler.ts

const DOMAIN_PACK_MAP: Record<string, string> = {
  macro:               "macro_calendar_v1",
  earnings:            "earnings_v1",
  energy:              "energy_v1",
  credit:              "credit_banking_v1",
  crypto:              "crypto_v1",
  china:               "china_macro_v1",
  commodities:         "commodities_v1",
  geopolitical:        "geopolitical_v1",
  policy_fx:           "policy_fx_v1",
  volatility:          "volatility_v1",
  real_estate_housing: "real_estate_housing_v1",
  sovereign_debt:      "sovereign_debt_v1",
};

// ─── Should we promote? ───────────────────────────────────────────────────────

/**
 * Returns true only when it is worth promoting:
 *   - outcome is "correct" or "partial"
 *   - confidence was "high"
 *
 * We skip "low" and "medium" confidence calls even if correct, because those
 * are probabilistic guesses and reinforcing them risks over-fitting.
 */
export function shouldAutoPromote(
  outcome:          string,
  confidence_level: string,
): boolean {
  return (
    (outcome === "correct" || outcome === "partial") &&
    confidence_level === "high"
  );
}

// ─── Haiku structuring ────────────────────────────────────────────────────────

async function structurePromotedCase(
  apiKey:  string,
  input:   AutoPromotionInput,
): Promise<StructuredCase> {
  const client = new Anthropic({ apiKey });

  const outcomeLabel = input.outcome === "correct"
    ? "FULLY CORRECT — direction and thesis matched"
    : "PARTIALLY CORRECT — directional reasoning was sound but magnitude or timing was off";

  const prompt = `You are a financial AI trainer. The brain made a HIGH-CONFIDENCE prediction and it was verified as: ${outcomeLabel}.

Your job is to convert this verified correct prediction into a high-quality historical training case so the brain can reference this pattern in future queries.

ORIGINAL QUESTION:
"${input.query}"

BRAIN'S ANSWER SUMMARY (first 500 chars):
"${input.answer_summary.slice(0, 500)}"

OUTCOME VERDICT: ${outcomeLabel}
OUTCOME NOTES: ${input.notes || "none"}
EVENT TYPE DETECTED: ${input.event_type}

Produce a structured training case that captures WHY this pattern worked. Return ONLY valid JSON:
{
  "domain": "<EXACTLY one of: macro, earnings, energy, credit, crypto, china, commodities, geopolitical, policy_fx, volatility, real_estate_housing, sovereign_debt>",
  "event_type": "<specific event subtype, e.g. cpi_print, fomc_decision, earnings_beat, oil_supply_shock>",
  "signal_bias": "<bullish | bearish | mixed | neutral — the ACTUAL directional outcome>",
  "summary": "<200-350 word summary: (1) What was the event/setup. (2) What happened in markets (extract key directional calls from the brain answer). (3) WHY this pattern held — the fundamental mechanism. (4) What conditions made this a high-confidence read. Be instructional for future retrieval.>",
  "review_hints": [
    "PATTERN: <the winning analytical pattern that worked here>",
    "CONDITION: <what conditions or setup made this a reliable high-confidence call>",
    "SIGNAL: <the key signal or catalyst that drove the move>",
    "RULE: <a concrete rule: 'When X happens under Y conditions, expect Z'>"
  ],
  "dominant_catalyst": "<short kebab-case, e.g. hot-cpi-risk-off, fomc-hawkish-surprise, earnings-beat-multiple-expansion>",
  "primary_themes": ["<3-5 relevant market themes, e.g. inflation, risk_off, rates, sector_rotation>"],
  "predicted_moves": [
    { "ticker": "<e.g. SPY>", "direction": "<up|down|flat>", "magnitude_bp": <integer basis points, 0 if unknown> }
  ]
}

For predicted_moves: extract any specific tickers and directional calls mentioned in the brain's answer. Use 0 for magnitude_bp if no specific number was given. Include at most 6 tickers.`;

  const response = await client.messages.create({
    model:      "claude-haiku-4-5",
    max_tokens: 1200,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();

  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Haiku auto-promoter returned unparseable response.");
  }

  const parsed = JSON.parse(stripped.slice(start, end + 1)) as StructuredCase;
  parsed.case_pack = DOMAIN_PACK_MAP[parsed.domain] ?? "macro_calendar_v1";
  return parsed;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function autoPromoteCase(
  services: AppServices,
  input:    AutoPromotionInput,
): Promise<AutoPromotionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured.");

  // 1. Use Haiku to structure the verified case
  const structured = await structurePromotedCase(apiKey, input);

  // 2. Build a deterministic, traceable case_id
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const caseId    = `autopromoted-${structured.domain}-${dateStamp}-${Date.now().toString(36)}`;

  // 3. Build the raw_text for vector embedding
  const movesText = structured.predicted_moves
    .filter(m => m.ticker)
    .map(m => `${m.ticker} ${m.direction.toUpperCase()} ${m.magnitude_bp}bp`)
    .join("; ");

  const rawText = [
    `AUTO-PROMOTED CASE — Brain's high-confidence prediction was verified ${input.outcome.toUpperCase()}.`,
    `Original question: ${input.query}`,
    `Brain's answer: ${input.answer_summary.slice(0, 300)}`,
    `Outcome: ${input.outcome}. Notes: ${input.notes || "none"}`,
    movesText ? `Predicted moves (verified correct): ${movesText}.` : "",
    structured.summary,
  ]
    .filter(Boolean)
    .join(" ");

  // 4. Build the HistoricalCaseLibraryDraft
  const draft: HistoricalCaseLibraryDraft = {
    case_id:   caseId,
    case_pack: structured.case_pack,
    source: {
      source_type: "user_note",
      raw_text:    rawText,
      publisher:   "case_auto_promoter",
      occurred_at: new Date().toISOString().slice(0, 10),
    },
    horizon:  "1d",
    realized_moves: structured.predicted_moves
      .filter(m => m.ticker)
      .map(m => ({
        ticker:                m.ticker,
        realized_direction:    m.direction,
        realized_magnitude_bp: m.magnitude_bp,
      })),
    timing_alignment:  input.outcome === "correct" ? 0.90 : 0.70,
    dominant_catalyst: structured.dominant_catalyst,
    labels: {
      tags:           ["auto_promoted", "brain_verified", structured.domain, structured.event_type, input.outcome],
      regimes:        [],
      regions:        ["global"],
      sectors:        [],
      primary_themes: structured.primary_themes,
      primary_assets: structured.predicted_moves.map(m => m.ticker).filter(Boolean),
      surprise_type:  "none",
      case_quality:   "reviewed",
      notes:          `Auto-promoted: brain HIGH confidence prediction verified ${input.outcome.toUpperCase()}. Session: ${input.session_id}.`,
    },
    review_hints: structured.review_hints.slice(0, 4),
  };

  // 5. Seed into vector store — brain reinforces this winning pattern NOW
  await ingestHistoricalCaseLibrary(services, {
    items:                  [draft],
    store_library:          true,
    ingest_reviewed_memory: true,
    fallback_model_version: "case-auto-promoter-v1",
    labeling_mode:          "merge",
  });

  return {
    case_id:   caseId,
    case_pack: structured.case_pack,
    status:    "promoted",
    message:   `Brain has reinforced this pattern. Case ${caseId} is now in the vector store.`,
  };
}
