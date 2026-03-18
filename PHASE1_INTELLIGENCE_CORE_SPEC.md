# Phase 1 Intelligence Core Spec

## Goal

Phase 1 proves one thing: the system can turn finance events into forecasts, review the outcome later, and learn from mistakes in a structured way.

## Scope

Initial scope is intentionally narrow:

- input: transcript snippet, speech excerpt, headline, or earnings commentary
- assets: selected US equities, ETFs, index proxies, FX proxies
- horizons: `1h`, `1d`, `5d`
- output: structured impact forecast plus explanation
- feedback: automatic post-mortem after horizon completes

## Phase 1 services

### `api`

Public and internal endpoints for events, predictions, outcomes, and lessons.

### `event_parser`

Turns raw text into structured finance events.

### `impact_engine`

Produces asset-impact predictions using retrieval, rules, and baseline models.

### `scoring_engine`

Fetches market outcomes and scores prediction quality.

### `critique_engine`

Generates failure tags and post-mortems.

### `memory_service`

Stores and retrieves events, predictions, outcomes, and lessons.

## End-to-end flow

1. Submit transcript or headline.
2. Parse text into entities, themes, sentiment, and event class.
3. Retrieve similar historical events.
4. Generate candidate asset impacts.
5. Score and rank predictions.
6. Save prediction journal entry.
7. When the horizon expires, compute market outcome.
8. Score accuracy and calibration.
9. Generate critique.
10. Save lesson for future retrieval.

## Database schema

### `sources`

```sql
create table sources (
  id uuid primary key,
  source_type text not null,
  title text,
  speaker text,
  publisher text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw_uri text,
  raw_text text,
  metadata jsonb not null default '{}'
);
```

### `events`

```sql
create table events (
  id uuid primary key,
  source_id uuid not null references sources(id),
  event_class text not null,
  summary text not null,
  sentiment text,
  urgency_score numeric(5,4),
  novelty_score numeric(5,4),
  regime_snapshot jsonb not null default '{}',
  extracted jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

### `event_assets`

```sql
create table event_assets (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticker text not null,
  asset_class text not null,
  relation_type text not null,
  relevance_score numeric(5,4) not null
);
```

### `predictions`

```sql
create table predictions (
  id uuid primary key,
  event_id uuid not null references events(id),
  model_version text not null,
  horizon text not null,
  status text not null default 'pending',
  thesis text not null,
  confidence numeric(5,4) not null,
  evidence jsonb not null default '[]',
  invalidations jsonb not null default '[]',
  assumptions jsonb not null default '[]',
  created_at timestamptz not null default now()
);
```

### `prediction_assets`

```sql
create table prediction_assets (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  ticker text not null,
  expected_direction text not null,
  expected_magnitude_bp integer,
  expected_volatility_change numeric(8,4),
  rank_order integer not null,
  conviction numeric(5,4) not null
);
```

### `prediction_outcomes`

```sql
create table prediction_outcomes (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  horizon text not null,
  measured_at timestamptz not null,
  outcome_payload jsonb not null,
  direction_score numeric(6,4),
  magnitude_score numeric(6,4),
  timing_score numeric(6,4),
  calibration_score numeric(6,4),
  total_score numeric(6,4),
  created_at timestamptz not null default now()
);
```

### `postmortems`

```sql
create table postmortems (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  verdict text not null,
  failure_tags jsonb not null default '[]',
  critique text not null,
  lesson_summary text not null,
  created_at timestamptz not null default now()
);
```

### `lessons`

```sql
create table lessons (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  lesson_type text not null,
  lesson_summary text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

## JSON contracts

### Event parser output

```json
{
  "event_class": "policy_speech",
  "summary": "Speaker signaled a harder trade stance toward China.",
  "sentiment": "risk_off",
  "urgency_score": 0.82,
  "novelty_score": 0.61,
  "entities": [
    { "type": "person", "value": "Donald Trump" },
    { "type": "country", "value": "China" },
    { "type": "theme", "value": "tariffs" }
  ],
  "themes": ["trade_policy", "china_risk", "macro"],
  "candidate_assets": ["KWEB", "BABA", "USD/CNH", "SPY"],
  "why_it_matters": [
    "higher tariff rhetoric can increase China risk premium",
    "FX and China tech are historically sensitive to trade-escalation language"
  ]
}
```

### Prediction output

```json
{
  "horizon": "1d",
  "thesis": "Trade-escalation language is likely negative for China-linked risk assets over the next session.",
  "confidence": 0.68,
  "assets": [
    {
      "ticker": "KWEB",
      "expected_direction": "down",
      "expected_magnitude_bp": -180,
      "conviction": 0.74
    },
    {
      "ticker": "USD/CNH",
      "expected_direction": "up",
      "expected_magnitude_bp": 35,
      "conviction": 0.63
    }
  ],
  "evidence": [
    "historical analogs show China tech weakness after trade-escalation rhetoric",
    "current regime has elevated sensitivity to policy headlines"
  ],
  "invalidations": [
    "follow-up comments soften the initial tone",
    "broader risk-on macro tape overwhelms event-specific reaction"
  ]
}
```

## API endpoints

### `POST /v1/sources`

Create a raw source record.

Request:

```json
{
  "source_type": "transcript",
  "title": "BBC live interview",
  "speaker": "Donald Trump",
  "occurred_at": "2026-03-12T08:00:00Z",
  "raw_text": "..."
}
```

### `POST /v1/events/parse`

Parse a source into a structured event.

### `POST /v1/predictions/generate`

Generate predictions for an event and one or more horizons.

### `GET /v1/predictions/:id`

Return prediction journal entry, assets, and current scoring status.

### `POST /v1/predictions/:id/score`

Manually trigger scoring for a completed horizon.

### `GET /v1/lessons/search?q=...`

Retrieve similar lessons and prior failure cases.

### `GET /v1/events/:id/analogs`

Return nearest historical analog events.

## Scoring logic

The score should not only ask "was direction correct?"

### Direction score

- `1.0` if correct direction
- `0.5` if neutral or mixed and model used low confidence
- `0.0` if wrong direction

### Magnitude score

Scale based on absolute error between expected and realized move.

### Timing score

Higher score if the predicted move happened inside the forecast horizon, lower if it happened too early or too late.

### Calibration score

Compare confidence to empirical hit rate.

Example:

- model says `0.80`
- bucketed historical accuracy for similar `0.75-0.85` predictions is `0.58`
- calibration penalty applies

### Total score

Suggested first formula:

```text
total = 0.40 * direction
      + 0.25 * magnitude
      + 0.20 * timing
      + 0.15 * calibration
```

## Critique engine prompts

The critique engine should answer:

- What was the original thesis?
- What actually happened?
- Which part of the thesis held up?
- Which assumption failed?
- Was another catalyst dominant?
- Was confidence too high or too low?
- Which lesson should be stored?

Structured output:

```json
{
  "verdict": "partially_wrong",
  "failure_tags": ["wrong_timing", "overconfidence"],
  "critique": "The directional call was broadly right, but the reaction arrived after the 1-day horizon because the market focused first on an unrelated CPI release.",
  "lesson_summary": "When a major macro release is within 24 hours, political headline impact should be time-discounted."
}
```

## Baseline models

Do not start with a giant custom-trained model.

Start with:

1. rule-based entity and theme extraction
2. retrieval over tagged historical events
3. gradient-boosted baseline or classifier for directional impact
4. confidence calibration layer
5. LLM only for explanation and critique formatting

This gives faster iteration and cleaner debugging.

## Training data plan

The system needs structured examples.

Phase 1 dataset should contain:

- event text
- extracted themes
- linked assets
- market regime features
- forecast labels
- realized returns by horizon
- human or programmatic critique tags

Useful first sources:

- major earnings call excerpts
- FOMC statements and speeches
- CPI and payroll release summaries
- trade-policy headlines
- company-specific guidance changes

## Evaluation set

Create a fixed holdout set before tuning heavily.

Evaluation slices:

- macro vs company-specific events
- high-vol vs low-vol regimes
- US session vs overnight
- crowded vs uncrowded trades

## Safety controls

Phase 1 should include:

- no live brokerage execution
- full logging of prompts, outputs, and scores
- confidence cap for weak evidence
- fail-closed behavior if market data is missing
- explicit "analysis, not advice" product language until compliance review

## Build order

### Week 1

- set up API service
- create database schema
- create source and event endpoints

### Week 2

- build parser output contract
- add analog retrieval
- implement prediction journal writes

### Week 3

- connect market data scoring
- calculate direction, magnitude, timing, calibration

### Week 4

- implement critique engine
- store lessons
- build a basic dashboard for event -> prediction -> outcome -> lesson

## Definition of success

Phase 1 succeeds if:

- forecasts are fully auditable
- scoring is automatic and reliable
- critiques are structured, not vague
- lessons can be retrieved and reused
- performance is measurable by event type and regime

## Recommended next artifact

After this spec, the next implementation artifact should be:

- a monorepo scaffold with `api`, `web`, and `services`
- SQL migrations for the tables above
- an initial `POST /v1/events/parse` endpoint
