/**
 * One-time setup script: creates the prediction_log table in Supabase.
 * Run: npx tsx src/scripts/setupPredictionLog.ts
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

await pool.query(`
  CREATE TABLE IF NOT EXISTS prediction_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       TEXT NOT NULL,
    query            TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    confidence_level TEXT,
    answer_summary   TEXT,
    case_ids_cited   TEXT[],
    analogues_count  INTEGER,
    outcome          TEXT CHECK (outcome IN ('correct','incorrect','partial')),
    outcome_notes    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_prediction_log_session
    ON prediction_log (session_id);

  CREATE INDEX IF NOT EXISTS idx_prediction_log_event_type
    ON prediction_log (event_type);

  CREATE INDEX IF NOT EXISTS idx_prediction_log_outcome
    ON prediction_log (outcome) WHERE outcome IS NOT NULL;
`);

console.log("✓ prediction_log table ready");
await pool.end();
