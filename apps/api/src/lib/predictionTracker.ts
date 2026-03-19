/**
 * Prediction Tracker (#6 — Feedback Loop).
 *
 * Logs every brain response to Supabase so we can track directional accuracy
 * over time.  A separate route lets traders mark outcomes after the event.
 *
 * Table DDL (run once in Supabase SQL editor):
 *
 *   CREATE TABLE IF NOT EXISTS prediction_log (
 *     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     session_id       TEXT NOT NULL,
 *     query            TEXT NOT NULL,
 *     event_type       TEXT NOT NULL,
 *     confidence_level TEXT,
 *     answer_summary   TEXT,
 *     case_ids_cited   TEXT[],
 *     analogues_count  INTEGER,
 *     outcome          TEXT,          -- 'correct' | 'incorrect' | 'partial' | null
 *     outcome_notes    TEXT,
 *     created_at       TIMESTAMPTZ DEFAULT NOW(),
 *     resolved_at      TIMESTAMPTZ
 *   );
 */

import pg from "pg";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

export type PredictionLogEntry = {
  session_id:       string;
  query:            string;
  event_type:       string;
  confidence_level: string;
  answer_summary:   string;
  case_ids_cited:   string[];
  analogues_count:  number;
};

/**
 * Logs a brain response.  Fire-and-forget — never throws so it can't break chat.
 */
export async function logPrediction(entry: PredictionLogEntry): Promise<void> {
  try {
    const db = getPool();
    await db.query(
      `INSERT INTO prediction_log
         (session_id, query, event_type, confidence_level, answer_summary, case_ids_cited, analogues_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.session_id,
        entry.query.slice(0, 1000),
        entry.event_type,
        entry.confidence_level,
        entry.answer_summary.slice(0, 500),
        entry.case_ids_cited,
        entry.analogues_count,
      ]
    );
  } catch {
    // silent — never break the main chat flow
  }
}

/**
 * Marks a previous prediction with its outcome.
 */
export async function resolveOutcome(
  sessionId:    string,
  outcome:      "correct" | "incorrect" | "partial",
  outcomeNotes: string,
): Promise<boolean> {
  try {
    const db = getPool();
    const res = await db.query(
      `UPDATE prediction_log
          SET outcome = $1, outcome_notes = $2, resolved_at = NOW()
        WHERE session_id = $3 AND outcome IS NULL`,
      [outcome, outcomeNotes.slice(0, 500), sessionId]
    );
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Returns the N most recent prediction_log rows (for the dashboard).
 */
export async function getRecentPredictions(limit = 20): Promise<Array<{
  id: string;
  session_id: string;
  query: string;
  event_type: string;
  confidence_level: string;
  answer_summary: string;
  analogues_count: number;
  outcome: string | null;
  outcome_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}>> {
  try {
    const db = getPool();
    const res = await db.query(
      `SELECT id, session_id, query, event_type, confidence_level,
              answer_summary, analogues_count,
              outcome, outcome_notes, created_at, resolved_at
         FROM prediction_log
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.rows.map(r => ({
      ...r,
      created_at:  r.created_at instanceof Date  ? r.created_at.toISOString()  : r.created_at,
      resolved_at: r.resolved_at instanceof Date ? r.resolved_at.toISOString() : r.resolved_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Returns accuracy stats: overall %, by event type, by confidence level.
 * Also returns total_logged (all predictions, not just resolved ones).
 */
export async function getAccuracyStats(): Promise<{
  total_logged: number;
  total_resolved: number;
  overall_accuracy_pct: number;
  by_event_type: Record<string, { correct: number; total: number; pct: number }>;
  by_confidence: Record<string, { correct: number; total: number; pct: number }>;
}> {
  try {
    const db = getPool();

    const countRes = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM prediction_log`);
    const totalLogged = parseInt(countRes.rows[0]?.cnt ?? "0", 10);

    const res = await db.query<{
      event_type: string;
      confidence_level: string;
      outcome: string;
      cnt: string;
    }>(
      `SELECT event_type, confidence_level, outcome, COUNT(*) as cnt
         FROM prediction_log
        WHERE outcome IS NOT NULL
        GROUP BY event_type, confidence_level, outcome`
    );

    const byEvent: Record<string, { correct: number; total: number; pct: number }> = {};
    const byConf:  Record<string, { correct: number; total: number; pct: number }> = {};
    let totalCorrect = 0;
    let totalResolved = 0;

    for (const row of res.rows) {
      const cnt = parseInt(row.cnt, 10);
      const isCorrect = row.outcome === "correct";

      // by event type
      byEvent[row.event_type] ??= { correct: 0, total: 0, pct: 0 };
      byEvent[row.event_type].total   += cnt;
      if (isCorrect) byEvent[row.event_type].correct += cnt;

      // by confidence
      byConf[row.confidence_level] ??= { correct: 0, total: 0, pct: 0 };
      byConf[row.confidence_level].total   += cnt;
      if (isCorrect) byConf[row.confidence_level].correct += cnt;

      totalResolved += cnt;
      if (isCorrect) totalCorrect += cnt;
    }

    // compute pcts
    for (const v of Object.values(byEvent)) v.pct = v.total ? Math.round((v.correct / v.total) * 100) : 0;
    for (const v of Object.values(byConf))  v.pct = v.total ? Math.round((v.correct / v.total) * 100) : 0;

    return {
      total_logged:         totalLogged,
      total_resolved:       totalResolved,
      overall_accuracy_pct: totalResolved ? Math.round((totalCorrect / totalResolved) * 100) : 0,
      by_event_type:        byEvent,
      by_confidence:        byConf,
    };
  } catch {
    return { total_logged: 0, total_resolved: 0, overall_accuracy_pct: 0, by_event_type: {}, by_confidence: {} };
  }
}
