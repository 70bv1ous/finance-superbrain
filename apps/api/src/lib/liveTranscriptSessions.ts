import { randomUUID } from "node:crypto";

import { transcriptSessionAnalysisSchema } from "@finance-superbrain/schemas";
import type {
  CreateTranscriptChunkRequest,
  StoredTranscriptChunk,
  StoredTranscriptSession,
} from "@finance-superbrain/schemas";

import { generateCalibratedPredictionSet } from "./analogs.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import type { Repository } from "./repository.types.js";

const IMPORTANT_KEYWORDS = [
  "tariff",
  "china",
  "yuan",
  "rate",
  "rates",
  "yield",
  "inflation",
  "stimulus",
  "guidance",
  "earnings",
  "margin",
  "opec",
  "oil",
  "fed",
  "powell",
  "export control",
  "restriction",
  "cut",
  "hike",
];

const tailChars = (text: string, maxChars: number) => {
  if (text.length <= maxChars) {
    return text.trim();
  }

  const sliced = text.slice(text.length - maxChars).trim();
  const firstSpace = sliced.indexOf(" ");

  return firstSpace > 0 ? sliced.slice(firstSpace + 1).trim() : sliced;
};

const buildRollingTranscriptText = (
  chunks: StoredTranscriptChunk[],
  rollingWindowChars: number,
) => tailChars(chunks.map((chunk) => chunk.text.trim()).join("\n\n"), rollingWindowChars);

const splitSentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);

const highlightScore = (sentence: string, latestChunkText: string) => {
  const lower = sentence.toLowerCase();
  let score = 0.15;
  let rationale = "recent market-relevant transcript line";

  const keywordHits = IMPORTANT_KEYWORDS.filter((keyword) => lower.includes(keyword)).length;
  if (keywordHits) {
    score += keywordHits * 0.16;
    rationale = "contains market-sensitive finance language";
  }

  if (/\b\d+(\.\d+)?%?\b/.test(sentence)) {
    score += 0.1;
    rationale = "contains numeric guidance or measurable market cue";
  }

  if (latestChunkText.includes(sentence)) {
    score += 0.12;
    rationale = "most recent transcript update with likely market impact";
  }

  return {
    text: sentence,
    rationale,
    score: Math.min(Number(score.toFixed(2)), 0.99),
  };
};

const buildHighlights = (rollingText: string, latestChunkText: string) =>
  splitSentences(rollingText)
    .map((sentence) => highlightScore(sentence, latestChunkText))
    .filter((item) => item.score >= 0.22)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

export const buildTranscriptSessionAnalysis = async (
  repository: Repository,
  session: StoredTranscriptSession,
  chunks: StoredTranscriptChunk[],
) => {
  const rollingText = buildRollingTranscriptText(chunks, session.rolling_window_chars);
  const parsedEvent = parseFinanceEvent({
    source_type: session.source_type,
    title: session.title,
    speaker: session.speaker,
    publisher: session.publisher,
    raw_uri: session.raw_uri,
    raw_text: rollingText,
  });
  const calibrated = await generateCalibratedPredictionSet(repository, {
    event: parsedEvent,
    horizons: session.horizons,
    model_version: session.model_version,
  });
  const latestChunkText = chunks[chunks.length - 1]?.text ?? rollingText;

  return transcriptSessionAnalysisSchema.parse({
    id: randomUUID(),
    session_id: session.id,
    chunk_count: chunks.length,
    rolling_text_chars: rollingText.length,
    parsed_event: parsedEvent,
    analogs: calibrated.analogs,
    predictions: calibrated.predictions,
    highlights: buildHighlights(rollingText, latestChunkText),
    created_at: new Date().toISOString(),
  });
};

export const appendChunkAndAnalyze = async (
  repository: Repository,
  session: StoredTranscriptSession,
  input: CreateTranscriptChunkRequest,
) => {
  if (session.status === "closed") {
    throw new Error("Cannot append to a closed transcript session.");
  }

  await repository.appendTranscriptSessionChunk(session.id, input);
  const chunks = await repository.listTranscriptSessionChunks(session.id);
  const analysis = await buildTranscriptSessionAnalysis(repository, session, chunks);
  await repository.saveTranscriptSessionAnalysis(analysis);

  return analysis;
};
