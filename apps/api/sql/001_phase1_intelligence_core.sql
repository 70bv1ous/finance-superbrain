create table if not exists sources (
  id uuid primary key,
  source_type text not null,
  title text,
  speaker text,
  publisher text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw_uri text,
  raw_text text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists model_registry (
  model_version text primary key,
  family text not null,
  label text,
  description text,
  owner text,
  prompt_profile text,
  status text not null default 'experimental',
  feature_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists transcript_sessions (
  id uuid primary key,
  source_type text not null,
  title text,
  speaker text,
  publisher text,
  raw_uri text,
  model_version text not null,
  horizons jsonb not null default '["1d"]'::jsonb,
  rolling_window_chars integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transcript_stream_bindings (
  id uuid primary key,
  provider text not null,
  external_stream_key text not null,
  session_id uuid not null references transcript_sessions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_stream_key)
);

create table if not exists transcript_stream_buffers (
  id uuid primary key,
  provider text not null,
  external_stream_key text not null,
  session_id uuid not null references transcript_sessions(id),
  pending_text text not null default '',
  fragment_count integer not null default 0,
  first_occurred_at timestamptz,
  last_occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_stream_key)
);

create table if not exists transcript_chunks (
  id uuid primary key,
  session_id uuid not null references transcript_sessions(id),
  sequence integer not null,
  occurred_at timestamptz,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists transcript_session_analyses (
  id uuid primary key,
  session_id uuid not null references transcript_sessions(id),
  chunk_count integer not null,
  rolling_text_chars integer not null,
  parsed_event jsonb not null,
  analogs jsonb not null default '[]'::jsonb,
  predictions jsonb not null default '[]'::jsonb,
  highlights jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key,
  source_id uuid not null references sources(id),
  event_class text not null,
  summary text not null,
  sentiment text,
  urgency_score numeric(5,4),
  novelty_score numeric(5,4),
  regime_snapshot jsonb not null default '{}'::jsonb,
  extracted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists event_assets (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticker text not null,
  asset_class text not null,
  relation_type text not null,
  relevance_score numeric(5,4) not null
);

create table if not exists predictions (
  id uuid primary key,
  event_id uuid not null references events(id),
  model_version text not null,
  horizon text not null,
  status text not null default 'pending',
  thesis text not null,
  confidence numeric(5,4) not null,
  evidence jsonb not null default '[]'::jsonb,
  invalidations jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists prediction_assets (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  ticker text not null,
  expected_direction text not null,
  expected_magnitude_bp integer,
  expected_volatility_change numeric(8,4),
  rank_order integer not null,
  conviction numeric(5,4) not null
);

create table if not exists prediction_outcomes (
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

create table if not exists postmortems (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  verdict text not null,
  failure_tags jsonb not null default '[]'::jsonb,
  critique text not null,
  lesson_summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id uuid primary key,
  prediction_id uuid not null references predictions(id),
  lesson_type text not null,
  lesson_summary text not null,
  embedding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists historical_case_library (
  case_id text primary key,
  case_pack text not null,
  source jsonb not null,
  horizon text not null,
  realized_moves jsonb not null default '[]'::jsonb,
  timing_alignment numeric(6,4) not null,
  dominant_catalyst text not null,
  parsed_event jsonb not null,
  labels jsonb not null default '{}'::jsonb,
  review jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table historical_case_library
  add column if not exists review jsonb not null default '{}'::jsonb;

create table if not exists calibration_snapshots (
  id uuid primary key,
  as_of timestamptz not null,
  sample_count integer not null,
  average_total_score numeric(6,4) not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists lineage_snapshots (
  id uuid primary key,
  as_of timestamptz not null,
  family_count integer not null,
  total_shells integer not null,
  hardened_shells integer not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists benchmark_replay_snapshots (
  id uuid primary key,
  as_of timestamptz not null,
  benchmark_pack_id text not null,
  selected_case_count integer not null,
  family_count integer not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists walk_forward_replay_snapshots (
  id uuid primary key,
  as_of timestamptz not null,
  benchmark_pack_id text not null,
  eligible_case_count integer not null,
  window_count integer not null,
  family_count integer not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists benchmark_trust_refreshes (
  id uuid primary key,
  generated_at timestamptz not null,
  benchmark_pack_id text not null,
  seed jsonb not null,
  before_summary jsonb not null,
  after_summary jsonb not null,
  delta jsonb not null,
  benchmark_snapshot_id uuid references benchmark_replay_snapshots(id) on delete set null,
  benchmark_snapshot_case_count integer,
  benchmark_snapshot_family_count integer,
  created_at timestamptz not null default now()
);

create table if not exists operation_runs (
  id uuid primary key,
  operation_name text not null,
  status text not null,
  triggered_by text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  metadata jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists operation_leases (
  operation_name text not null,
  scope_key text not null,
  owner text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (operation_name, scope_key)
);

create table if not exists operation_jobs (
  id uuid primary key,
  operation_name text not null,
  status text not null,
  triggered_by text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  max_attempts integer not null default 1,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operation_workers (
  worker_id text primary key,
  lifecycle_state text not null,
  supported_operations jsonb not null default '[]'::jsonb,
  poll_interval_ms integer,
  idle_backoff_ms integer,
  started_at timestamptz not null,
  last_heartbeat_at timestamptz not null,
  last_cycle_started_at timestamptz,
  last_cycle_finished_at timestamptz,
  last_cycle_processed integer,
  last_cycle_completed integer,
  last_cycle_failed integer,
  last_cycle_retried integer,
  last_cycle_abandoned integer,
  total_cycles integer not null default 0,
  total_processed integer not null default 0,
  total_completed integer not null default 0,
  total_failed integer not null default 0,
  total_retried integer not null default 0,
  total_abandoned integer not null default 0,
  last_error_message text,
  stopped_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists operation_worker_services (
  service_id text primary key,
  worker_id text not null,
  lifecycle_state text not null,
  supported_operations jsonb not null default '[]'::jsonb,
  supervisor_pid integer,
  supervisor_host text,
  supervisor_instance_id text,
  invocation_mode text,
  supervisor_backoff_ms integer not null,
  success_window_ms integer not null,
  heartbeat_interval_ms integer not null,
  max_restarts integer not null,
  restart_count integer not null default 0,
  restart_streak integer not null default 0,
  current_restart_backoff_ms integer,
  started_at timestamptz not null,
  last_heartbeat_at timestamptz not null,
  last_loop_started_at timestamptz,
  last_loop_finished_at timestamptz,
  last_loop_runtime_ms integer,
  last_exit_code integer,
  last_exit_signal text,
  last_error_message text,
  stopped_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists operation_worker_events (
  id uuid primary key,
  worker_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  lifecycle_state text,
  cycle_processed integer,
  cycle_completed integer,
  cycle_failed integer,
  cycle_retried integer,
  cycle_abandoned integer,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists operation_worker_service_events (
  id uuid primary key,
  service_id text not null,
  worker_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  lifecycle_state text,
  scheduled_restart boolean,
  restart_count integer,
  restart_streak integer,
  loop_runtime_ms integer,
  exit_code integer,
  exit_signal text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists system_integration_governance_states (
  integration text primary key,
  operation_name text not null,
  action text not null,
  highest_probe_status text not null,
  configured_targets integer not null default 0,
  ready_targets integer not null default 0,
  degraded_targets integer not null default 0,
  unknown_targets integer not null default 0,
  recent_retry_scheduled integer not null default 0,
  recent_non_retryable_failures integer not null default 0,
  recent_stale_recovered integer not null default 0,
  recent_trend_signal text not null,
  degraded_since timestamptz,
  outage_since timestamptz,
  hold_until timestamptz,
  retry_delay_seconds integer,
  reason text not null,
  detail text not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists system_integration_probe_states (
  integration text primary key,
  timeout_ms integer not null,
  configured_targets integer not null default 0,
  ready_targets integer not null default 0,
  degraded_targets integer not null default 0,
  unknown_targets integer not null default 0,
  highest_status text not null,
  targets jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_operation_jobs_idempotency_key
  on operation_jobs(idempotency_key);

  create table if not exists evolution_schedule_configs (
    id text primary key,
    enabled boolean not null default true,
    create_postmortems boolean not null default true,
    capture_calibration_snapshot boolean not null default true,
    capture_benchmark_snapshot boolean not null default true,
    capture_walk_forward_snapshot boolean not null default true,
    benchmark_pack_id text not null default 'core_benchmark_v1',
    run_benchmark_trust_refresh boolean not null default true,
    run_molt_cycle boolean not null default true,
    capture_lineage_snapshot boolean not null default true,
    self_audit_interval_hours integer not null,
    benchmark_snapshot_interval_hours integer not null default 24,
    walk_forward_snapshot_interval_hours integer not null default 168,
    benchmark_trust_refresh_interval_hours integer not null default 168,
    molt_interval_hours integer not null,
    lineage_snapshot_interval_hours integer not null,
    walk_forward_defaults jsonb not null default '{}'::jsonb,
    trust_refresh_defaults jsonb not null default '{}'::jsonb,
    molt_cycle_defaults jsonb not null default '{}'::jsonb,
    next_self_audit_at timestamptz,
    next_benchmark_snapshot_at timestamptz,
    next_walk_forward_snapshot_at timestamptz,
    next_benchmark_trust_refresh_at timestamptz,
    next_molt_at timestamptz,
    next_lineage_snapshot_at timestamptz,
    last_run_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists evolution_schedule_configs
  add column if not exists capture_benchmark_snapshot boolean not null default true;
alter table if exists evolution_schedule_configs
  add column if not exists capture_walk_forward_snapshot boolean not null default true;
alter table if exists evolution_schedule_configs
  add column if not exists benchmark_pack_id text not null default 'core_benchmark_v1';
  alter table if exists evolution_schedule_configs
    add column if not exists benchmark_snapshot_interval_hours integer not null default 24;
  alter table if exists evolution_schedule_configs
    add column if not exists walk_forward_snapshot_interval_hours integer not null default 168;
  alter table if exists evolution_schedule_configs
    add column if not exists next_benchmark_snapshot_at timestamptz;
  alter table if exists evolution_schedule_configs
    add column if not exists walk_forward_defaults jsonb not null default '{}'::jsonb;
  alter table if exists evolution_schedule_configs
    add column if not exists next_walk_forward_snapshot_at timestamptz;
  alter table if exists evolution_schedule_configs
    add column if not exists run_benchmark_trust_refresh boolean not null default true;
  alter table if exists evolution_schedule_configs
    add column if not exists benchmark_trust_refresh_interval_hours integer not null default 168;
alter table if exists evolution_schedule_configs
  add column if not exists trust_refresh_defaults jsonb not null default '{}'::jsonb;
  alter table if exists evolution_schedule_configs
    add column if not exists next_benchmark_trust_refresh_at timestamptz;

create table if not exists growth_pressure_policies (
  family text primary key,
  enabled boolean not null default true,
  thresholds jsonb not null default '{}'::jsonb,
  persistence jsonb not null default '{}'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists growth_pressure_alerts (
  id uuid primary key,
  family text not null,
  policy_family text not null,
  active_model_version text,
  severity text not null,
  status text not null,
  generation_depth integer not null,
  pass_rate numeric(6,4),
  average_total_score numeric(6,4),
  calibration_gap numeric(6,4),
  trend_signal text not null,
  signals jsonb not null default '[]'::jsonb,
  recommended_action text not null,
  persistence_count integer not null default 1,
  first_triggered_at timestamptz not null,
  last_triggered_at timestamptz not null,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  handled_at timestamptz,
  resolved_at timestamptz,
  last_planned_action text,
  last_plan_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists growth_pressure_action_plans (
  id uuid primary key,
  alert_id uuid not null references growth_pressure_alerts(id),
  family text not null,
  active_model_version text,
  action_type text not null,
  status text not null,
  requires_operator_approval boolean not null default false,
  rationale text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  candidate_model_version text,
  operator_note text,
  approved_at timestamptz,
  blocked_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists promotion_evaluations (
  id uuid primary key,
  candidate_model_version text not null,
  baseline_model_version text not null,
  case_pack text not null,
  case_count integer not null,
  passed boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  deltas jsonb not null default '{}'::jsonb,
  thresholds jsonb not null default '{}'::jsonb,
  baseline jsonb not null,
  candidate jsonb not null,
  walk_forward jsonb,
  saved_model jsonb,
  created_at timestamptz not null default now()
);

alter table promotion_evaluations add column if not exists walk_forward jsonb;
alter table if exists operation_worker_services
  add column if not exists supervisor_pid integer;
alter table if exists operation_worker_services
  add column if not exists supervisor_host text;
alter table if exists operation_worker_services
  add column if not exists supervisor_instance_id text;
alter table if exists operation_worker_services
  add column if not exists invocation_mode text;
alter table if exists operation_worker_services
  add column if not exists current_restart_backoff_ms integer;

create index if not exists idx_events_source_id on events(source_id);
create index if not exists idx_sources_raw_uri on sources(raw_uri);
create index if not exists idx_event_assets_event_id on event_assets(event_id);
create index if not exists idx_transcript_sessions_updated_at on transcript_sessions(updated_at desc);
create index if not exists idx_transcript_stream_bindings_session_id on transcript_stream_bindings(session_id);
create index if not exists idx_transcript_stream_bindings_updated_at on transcript_stream_bindings(updated_at desc);
create index if not exists idx_transcript_stream_buffers_session_id on transcript_stream_buffers(session_id);
create index if not exists idx_transcript_stream_buffers_updated_at on transcript_stream_buffers(updated_at desc);
create index if not exists idx_transcript_chunks_session_id on transcript_chunks(session_id);
create index if not exists idx_transcript_session_analyses_session_id on transcript_session_analyses(session_id);
create index if not exists idx_predictions_event_id on predictions(event_id);
create index if not exists idx_prediction_assets_prediction_id on prediction_assets(prediction_id);
create index if not exists idx_prediction_outcomes_prediction_id on prediction_outcomes(prediction_id);
create index if not exists idx_postmortems_prediction_id on postmortems(prediction_id);
create index if not exists idx_lessons_prediction_id on lessons(prediction_id);
create index if not exists idx_historical_case_library_case_pack on historical_case_library(case_pack);
create index if not exists idx_historical_case_library_updated_at on historical_case_library(updated_at desc);
create index if not exists idx_calibration_snapshots_as_of on calibration_snapshots(as_of desc);
create index if not exists idx_lineage_snapshots_as_of on lineage_snapshots(as_of desc);
create index if not exists idx_benchmark_replay_snapshots_as_of on benchmark_replay_snapshots(as_of desc);
create index if not exists idx_benchmark_replay_snapshots_pack on benchmark_replay_snapshots(benchmark_pack_id);
create index if not exists idx_walk_forward_replay_snapshots_as_of on walk_forward_replay_snapshots(as_of desc);
create index if not exists idx_walk_forward_replay_snapshots_pack on walk_forward_replay_snapshots(benchmark_pack_id);
create index if not exists idx_benchmark_trust_refreshes_generated_at on benchmark_trust_refreshes(generated_at desc);
create index if not exists idx_benchmark_trust_refreshes_pack on benchmark_trust_refreshes(benchmark_pack_id);
create index if not exists idx_operation_runs_started_at on operation_runs(started_at desc);
create index if not exists idx_operation_runs_name on operation_runs(operation_name);
create index if not exists idx_operation_runs_status on operation_runs(status);
create index if not exists idx_operation_leases_expires_at on operation_leases(expires_at);
create index if not exists idx_operation_jobs_status_available on operation_jobs(status, available_at asc);
create index if not exists idx_operation_jobs_operation_name on operation_jobs(operation_name);
create index if not exists idx_operation_jobs_updated_at on operation_jobs(updated_at desc);
create index if not exists idx_operation_workers_updated_at on operation_workers(updated_at desc);
create index if not exists idx_operation_workers_heartbeat on operation_workers(last_heartbeat_at desc);
create index if not exists idx_operation_worker_services_updated_at on operation_worker_services(updated_at desc);
create index if not exists idx_operation_worker_services_heartbeat on operation_worker_services(last_heartbeat_at desc);
create index if not exists idx_operation_worker_events_occurred_at on operation_worker_events(occurred_at desc);
create index if not exists idx_operation_worker_events_worker on operation_worker_events(worker_id, occurred_at desc);
create index if not exists idx_operation_worker_events_type on operation_worker_events(event_type, occurred_at desc);
create index if not exists idx_operation_worker_service_events_occurred_at on operation_worker_service_events(occurred_at desc);
create index if not exists idx_operation_worker_service_events_service on operation_worker_service_events(service_id, occurred_at desc);
create index if not exists idx_operation_worker_service_events_worker on operation_worker_service_events(worker_id, occurred_at desc);
create index if not exists idx_operation_worker_service_events_type on operation_worker_service_events(event_type, occurred_at desc);
create index if not exists idx_system_integration_governance_checked_at on system_integration_governance_states(checked_at desc);
create index if not exists idx_system_integration_probe_checked_at on system_integration_probe_states(checked_at desc);
create index if not exists idx_evolution_schedule_configs_updated_at on evolution_schedule_configs(updated_at desc);
create index if not exists idx_growth_pressure_alerts_family on growth_pressure_alerts(family);
create index if not exists idx_growth_pressure_alerts_status on growth_pressure_alerts(status);
create index if not exists idx_growth_pressure_alerts_updated_at on growth_pressure_alerts(updated_at desc);
create index if not exists idx_growth_pressure_action_plans_family on growth_pressure_action_plans(family);
create index if not exists idx_growth_pressure_action_plans_status on growth_pressure_action_plans(status);
create index if not exists idx_growth_pressure_action_plans_updated_at on growth_pressure_action_plans(updated_at desc);
create index if not exists idx_model_registry_family on model_registry(family);
create index if not exists idx_promotion_evaluations_created_at on promotion_evaluations(created_at desc);
create index if not exists idx_promotion_evaluations_candidate_model on promotion_evaluations(candidate_model_version);
