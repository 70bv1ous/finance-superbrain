type LoginAttemptState = {
  count: number;
  window_started_at_ms: number;
  blocked_until_ms: number;
};

const attemptsByKey = new Map<string, LoginAttemptState>();

const WINDOW_MS = Number(process.env.AUTH_LOGIN_WINDOW_MINUTES ?? 15) * 60 * 1000;
const BLOCK_MS = Number(process.env.AUTH_LOGIN_BLOCK_MINUTES ?? 15) * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5);

const getFreshState = (state: LoginAttemptState | undefined, now: number): LoginAttemptState => {
  if (!state) {
    return {
      count: 0,
      window_started_at_ms: now,
      blocked_until_ms: 0,
    };
  }

  if (state.blocked_until_ms > 0 && now >= state.blocked_until_ms) {
    return {
      count: 0,
      window_started_at_ms: now,
      blocked_until_ms: 0,
    };
  }

  if (now - state.window_started_at_ms >= WINDOW_MS) {
    return {
      count: 0,
      window_started_at_ms: now,
      blocked_until_ms: 0,
    };
  }

  return state;
};

export const getLoginRateLimitState = (key: string, now = Date.now()) => {
  const state = getFreshState(attemptsByKey.get(key), now);
  attemptsByKey.set(key, state);

  if (state.blocked_until_ms > now) {
    return {
      allowed: false,
      retry_after_seconds: Math.max(1, Math.ceil((state.blocked_until_ms - now) / 1000)),
    };
  }

  return {
    allowed: true,
    retry_after_seconds: 0,
  };
};

export const recordFailedLoginAttempt = (key: string, now = Date.now()) => {
  const state = getFreshState(attemptsByKey.get(key), now);
  const nextCount = state.count + 1;
  const nextState: LoginAttemptState = {
    count: nextCount,
    window_started_at_ms: state.window_started_at_ms,
    blocked_until_ms: nextCount >= MAX_ATTEMPTS ? now + BLOCK_MS : 0,
  };

  attemptsByKey.set(key, nextState);

  return {
    allowed: nextState.blocked_until_ms <= now,
    retry_after_seconds:
      nextState.blocked_until_ms > now
        ? Math.max(1, Math.ceil((nextState.blocked_until_ms - now) / 1000))
        : 0,
  };
};

export const clearLoginRateLimit = (key: string) => {
  attemptsByKey.delete(key);
};

export const resetLoginRateLimitState = () => {
  attemptsByKey.clear();
};
