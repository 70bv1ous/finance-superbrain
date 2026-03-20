-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: Renaissance-style Evaluation Framework
-- Applied: 2026-03-20
--
-- Purpose:
--   Implements rigorous 60/20/20 temporal train/validation/test split tracking
--   and a full evaluation framework to measure Finance Superbrain accuracy with
--   proper statistical hygiene (Bonferroni correction, calibration scoring).
--
-- Key principles enforced by this schema:
--   1. Temporal splitting — data_split is assigned by occurred_at date, never random
--   2. Researcher lockout — test set predictions are flagged; re-evaluation is logged
--   3. Multiple testing correction — 13 hypotheses → Bonferroni α = 0.0038
--   4. Contamination tracking — cross-split event clusters are documented
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tag all historical cases with their data split ───────────────────────

-- data_split values:
--   'train'      — occurred_at < 2023-10-01  (approx 60%)
--   'validation' — 2023-10-01 <= occurred_at < 2024-04-01  (approx 20%)
--   'test'       — occurred_at >= 2024-04-01  (approx 20%, LOCKED)
--   'live'       — cases added after v1 freeze (excluded from split evaluation)
ALTER TABLE historical_case_library
  ADD COLUMN IF NOT EXISTS data_split       TEXT NOT NULL DEFAULT 'untagged',
  ADD COLUMN IF NOT EXISTS split_version    TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS contamination_flag    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contamination_notes   TEXT;

CREATE INDEX IF NOT EXISTS idx_historical_case_library_data_split
  ON historical_case_library(data_split);

CREATE INDEX IF NOT EXISTS idx_historical_case_library_split_version
  ON historical_case_library(split_version);

-- ─── 2. Evaluation predictions table ─────────────────────────────────────────
-- Records each time the brain is asked to predict on a held-out case query.
-- The oracle outcome is stored separately (after the fact) to prevent peeking.

CREATE TABLE IF NOT EXISTS evaluation_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Query context
  query_text            TEXT NOT NULL,
  event_type            TEXT,
  domain                TEXT,

  -- Evaluation metadata
  eval_split            TEXT NOT NULL DEFAULT 'validation',  -- 'validation' | 'test'
  split_version         TEXT NOT NULL DEFAULT 'v1',
  oracle_case_id        TEXT,          -- the case whose outcome we are predicting

  -- Brain output
  predicted_direction   TEXT,          -- 'up' | 'down' | 'mixed' | 'flat' | 'unknown'
  confidence_level      TEXT,          -- 'high' | 'medium' | 'low'
  predicted_tickers     JSONB,         -- [{ticker, direction, magnitude_bp_est}]
  retrieved_case_ids    TEXT[],        -- which training cases the brain cited
  retrieved_case_count  INTEGER,
  reasoning_summary     TEXT,          -- first 500 chars of brain answer

  -- Oracle outcome (filled in after scoring, never before)
  oracle_realized_moves JSONB,         -- [{ticker, realized_direction, realized_magnitude_bp}]
  oracle_occurred_at    TIMESTAMPTZ,

  -- Scoring (filled in by POST /v1/evaluation/score)
  direction_accuracy    FLOAT,         -- fraction of tickers where direction was correct (0.0–1.0)
  tickers_scored        INTEGER,
  is_correct            BOOLEAN,       -- TRUE if direction_accuracy >= 0.5
  is_scored             BOOLEAN NOT NULL DEFAULT FALSE,
  scored_at             TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_predictions_eval_split
  ON evaluation_predictions(eval_split);
CREATE INDEX IF NOT EXISTS idx_eval_predictions_domain
  ON evaluation_predictions(domain);
CREATE INDEX IF NOT EXISTS idx_eval_predictions_confidence
  ON evaluation_predictions(confidence_level);
CREATE INDEX IF NOT EXISTS idx_eval_predictions_scored
  ON evaluation_predictions(is_scored);
CREATE INDEX IF NOT EXISTS idx_eval_predictions_created_at
  ON evaluation_predictions(created_at DESC);

-- ─── 3. Evaluation sessions table ────────────────────────────────────────────
-- Aggregates a batch of scored predictions into a statistical report.
-- Each session represents one full run of the evaluation protocol.

CREATE TABLE IF NOT EXISTS evaluation_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  split_version             TEXT NOT NULL DEFAULT 'v1',
  eval_split                TEXT NOT NULL DEFAULT 'test',    -- 'validation' | 'test'

  -- Counts
  n_predictions             INTEGER NOT NULL DEFAULT 0,
  n_scored                  INTEGER NOT NULL DEFAULT 0,

  -- Primary metric: direction accuracy
  overall_accuracy          FLOAT,     -- fraction correct across all scored tickers
  high_conf_accuracy        FLOAT,     -- accuracy for 'high' confidence only
  low_conf_accuracy         FLOAT,     -- accuracy for 'low' confidence (calibration check)

  -- Calibration: Brier score (lower = better; 0.25 = random, 0.0 = perfect)
  brier_score               FLOAT,

  -- Statistical significance (Bonferroni-corrected)
  -- H0: accuracy <= 0.5 (random chance)
  -- Bonferroni threshold: α = 0.05 / 13 = 0.00385 (1 aggregate + 12 domain tests)
  aggregate_p_value         FLOAT,
  bonferroni_threshold      FLOAT NOT NULL DEFAULT 0.00385,
  is_statistically_significant  BOOLEAN,

  -- Domain breakdown (JSON: {domain: {n, accuracy, p_value}})
  domain_breakdown          JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Confidence calibration curve data
  -- JSON: [{bin: '0.8-1.0', n: 12, accuracy: 0.75}, ...]
  calibration_curve         JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- Contamination flags present in this session
  contaminated_predictions  INTEGER NOT NULL DEFAULT 0,

  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_sessions_created_at
  ON evaluation_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_sessions_eval_split
  ON evaluation_sessions(eval_split);

-- ─── 4. Contamination log table ──────────────────────────────────────────────
-- Documents all known cross-split contamination risks for transparency.
-- This is the "contamination audit trail" — no contamination should be hidden.

CREATE TABLE IF NOT EXISTS contamination_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The type of contamination risk
  -- 'event_cluster'    — same real-world event in multiple cases across splits
  -- 'forward_ref'      — a training case's summary references future events
  -- 'researcher'       — researcher observed test-set case during development
  -- 'semantic_near_dup' — two cases in different splits are semantically very similar
  contamination_type TEXT NOT NULL,

  severity          TEXT NOT NULL,  -- 'critical' | 'warning' | 'info'

  -- The case(s) involved
  case_ids          TEXT[] NOT NULL,
  splits_involved   TEXT[] NOT NULL,  -- e.g. ['train', 'test']

  description       TEXT NOT NULL,
  mitigation        TEXT,             -- what we did to address it

  -- Whether this contamination invalidates results
  invalidates_results  BOOLEAN NOT NULL DEFAULT FALSE,

  split_version     TEXT NOT NULL DEFAULT 'v1',
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contamination_log_type
  ON contamination_audit_log(contamination_type);
CREATE INDEX IF NOT EXISTS idx_contamination_log_severity
  ON contamination_audit_log(severity);
