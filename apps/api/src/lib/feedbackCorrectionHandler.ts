/**
 * Feedback Correction Handler
 *
 * When the brain makes a wrong prediction, this handler:
 * 1. Uses Claude Haiku to classify the event domain and generate a corrective case
 * 2. Builds a HistoricalCaseLibraryDraft with explicit "CORRECTION CASE" review_hints
 * 3. Seeds it immediately into the vector store so the brain learns right away
 *
 * The brain gets smarter from every mistake it makes.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { HistoricalCaseLibraryDraft } from "@finance-superbrain/schemas";
import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackCorrectionMove = {
  ticker: string;
  direction: "up" | "down" | "flat";
  magnitude_bp: number;
};

export type FeedbackCorrectionInput = {
  session_id?: string;
  question: string;
  brain_answer: string;
  actual_moves: FeedbackCorrectionMove[];
  occurred_at: string;
  notes: string;
};

export type FeedbackCorrectionResult = {
  case_id: string;
  case_pack: string;
  status: "seeded";
  message: string;
};

type ClassifiedCase = {
  domain: string;
  case_pack: string;
  event_type: string;
  signal_bias: "bullish" | "bearish" | "mixed" | "neutral";
  summary: string;
  review_hints: string[];
  dominant_catalyst: string;
  primary_themes: string[];
};

// ─── Domain → Case Pack mapping ───────────────────────────────────────────────

const DOMAIN_PACK_MAP: Record<string, string> = {
  macro:       "macro_calendar_v1",
  earnings:    "earnings_v1",
  energy:      "energy_v1",
  credit:      "credit_banking_v1",
  crypto:      "crypto_v1",
  china:       "china_macro_v1",
  commodities: "commodities_v1",
  geopolitical:"geopolitical_v1",
  policy_fx:   "policy_fx_v1",
};

// ─── Claude Haiku classification ─────────────────────────────────────────────

async function classifyCorrection(
  apiKey: string,
  input: FeedbackCorrectionInput,
): Promise<ClassifiedCase> {
  const client = new Anthropic({ apiKey });

  const movesText = input.actual_moves
    .map(m => `${m.ticker}: ${m.direction.toUpperCase()} ${m.magnitude_bp}bp`)
    .join(", ");

  const prompt = `You are a financial AI trainer. The brain made a wrong market prediction. Your job is to build a high-quality corrective training case so the brain learns from this mistake.

ORIGINAL QUESTION ASKED:
"${input.question}"

WHAT THE BRAIN PREDICTED (first 400 chars):
"${input.brain_answer.slice(0, 400)}"

WHAT ACTUALLY HAPPENED (user correction):
Notes: ${input.notes}
Actual realized moves: ${movesText}
Event date: ${input.occurred_at}

Produce a corrective training case. Return ONLY valid JSON in this exact structure:
{
  "domain": "<EXACTLY one of: macro, earnings, energy, credit, crypto, china, commodities, geopolitical, policy_fx>",
  "event_type": "<specific event type, e.g. cpi_print, fomc_decision, earnings_beat, oil_supply_shock, exchange_collapse, rate_hike>",
  "signal_bias": "<bullish | bearish | mixed | neutral — reflects the ACTUAL outcome>",
  "summary": "<300-450 word corrective summary. Structure: (1) What the event was. (2) What actually happened in markets with specific moves. (3) Why the brain's prediction was wrong — the specific framework error. (4) The correct analytical framework to apply next time. (5) Key rule to remember. Be precise and instructional.>",
  "review_hints": [
    "CORRECTION: <explain exactly what the brain got wrong — direction, magnitude, or framework>",
    "PATTERN: <describe the correct pattern to apply for this type of event>",
    "WARNING: <describe a common mistake or trap to avoid in similar situations>",
    "RULE: <state a concrete, actionable rule the brain should apply next time>"
  ],
  "dominant_catalyst": "<short kebab-case label, e.g. fed-pivot-surprise, supply-shock-oil, exchange-collapse-contagion>",
  "primary_themes": ["<3-5 relevant market themes, e.g. rates, inflation, risk_off, crypto_stress, china_risk>"]
}`;

  const response = await client.messages.create({
    model:      "claude-haiku-4-5",
    max_tokens: 1200,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Haiku classification returned unparseable response.");

  const parsed = JSON.parse(jsonMatch[0]) as ClassifiedCase;
  parsed.case_pack = DOMAIN_PACK_MAP[parsed.domain] ?? "macro_calendar_v1";
  return parsed;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleFeedbackCorrection(
  services: AppServices,
  input: FeedbackCorrectionInput,
): Promise<FeedbackCorrectionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured.");

  // 1. Classify domain and generate corrective case structure via Haiku
  const classified = await classifyCorrection(apiKey, input);

  // 2. Build case_id — deterministic, traceable
  const safeDate = input.occurred_at.slice(0, 10).replace(/-/g, "");
  const caseId   = `feedback-${classified.domain}-${safeDate}-${Date.now().toString(36)}`;

  // 3. Build the raw_text that will be embedded into the vector store
  const movesText = input.actual_moves
    .map(m => `${m.ticker} ${m.direction.toUpperCase()} ${m.magnitude_bp}bp`)
    .join("; ");

  const rawText = [
    `CORRECTION CASE — Brain prediction error. Logged for learning.`,
    `Event date: ${input.occurred_at}.`,
    `Original question: ${input.question}`,
    `Brain predicted: ${input.brain_answer.slice(0, 250)}`,
    `What actually happened: ${input.notes}`,
    `Actual realized moves: ${movesText}.`,
    classified.summary,
  ]
    .filter(Boolean)
    .join(" ");

  // 4. Build the HistoricalCaseLibraryDraft
  const draft: HistoricalCaseLibraryDraft = {
    case_id:   caseId,
    case_pack: classified.case_pack,
    source: {
      raw_text:    rawText,
      publisher:   "feedback_correction_system",
      occurred_at: input.occurred_at,
    },
    horizon:           "1d",
    realized_moves:    input.actual_moves.map(m => ({
      ticker:                  m.ticker,
      realized_direction:      m.direction,
      realized_magnitude_bp:   m.magnitude_bp,
    })),
    timing_alignment:  0.95,
    dominant_catalyst: classified.dominant_catalyst,
    labels: {
      tags:            ["feedback_correction", "brain_error", classified.domain, classified.event_type],
      regimes:         [],
      regions:         ["global"],
      sectors:         [],
      primary_themes:  classified.primary_themes,
      primary_assets:  input.actual_moves.map(m => m.ticker),
      surprise_type:   "none",
      case_quality:    "reviewed",
      notes:           `Auto-generated correction case. Session: ${input.session_id ?? "unknown"}. Brain was wrong — corrective case seeded.`,
    },
    review_hints: classified.review_hints.slice(0, 4),
  };

  // 5. Seed immediately into vector store — brain learns NOW
  await ingestHistoricalCaseLibrary(services, {
    items:                  [draft],
    store_library:          true,
    ingest_reviewed_memory: true,
    fallback_model_version: "feedback-correction-v1",
    labeling_mode:          "merge",
  });

  return {
    case_id:   caseId,
    case_pack: classified.case_pack,
    status:    "seeded",
    message:   `Brain has learned from this mistake. Case ${caseId} is now in the vector store.`,
  };
}
