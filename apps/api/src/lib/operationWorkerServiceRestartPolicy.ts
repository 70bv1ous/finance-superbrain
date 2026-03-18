export const resolveOperationWorkerServiceRestartStreak = (input: {
  scheduled_restart: boolean;
  runtime_ms: number;
  success_window_ms: number;
  current_restart_streak: number;
}) => {
  if (!input.scheduled_restart) {
    return 0;
  }

  if (input.runtime_ms >= input.success_window_ms) {
    return 1;
  }

  return Math.max(0, input.current_restart_streak) + 1;
};

export const resolveOperationWorkerServiceRestartDelayMs = (input: {
  base_backoff_ms: number;
  max_backoff_ms: number;
  restart_streak: number;
}) => {
  const baseBackoffMs = Math.max(1_000, Math.floor(input.base_backoff_ms));
  const maxBackoffMs = Math.max(baseBackoffMs, Math.floor(input.max_backoff_ms));
  const normalizedRestartStreak = Math.max(1, Math.floor(input.restart_streak));
  const exponent = Math.min(30, normalizedRestartStreak - 1);
  const multiplier = 2 ** exponent;

  return Math.min(maxBackoffMs, baseBackoffMs * multiplier);
};
