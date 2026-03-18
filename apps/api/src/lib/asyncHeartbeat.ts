export type AsyncHeartbeatHandle = {
  stop: () => Promise<void>;
};

const minimumHeartbeatIntervalMs = 1_000;

export const resolveHeartbeatIntervalMs = (
  ttlMs: number,
  requestedIntervalMs?: number,
) => {
  if (requestedIntervalMs !== undefined) {
    return Math.max(10, Math.floor(requestedIntervalMs));
  }

  return Math.max(minimumHeartbeatIntervalMs, Math.floor(ttlMs / 3));
};

export const startAsyncHeartbeat = (options: {
  interval_ms: number;
  label: string;
  on_heartbeat: () => Promise<void>;
}): AsyncHeartbeatHandle => {
  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }

    timeout = setTimeout(runHeartbeat, options.interval_ms);
  };

  const runHeartbeat = () => {
    inFlight = (async () => {
      try {
        await options.on_heartbeat();
      } catch (error) {
        console.error(`Failed heartbeat for ${options.label}`, error);
      } finally {
        inFlight = null;
        scheduleNext();
      }
    })();
  };

  scheduleNext();

  return {
    stop: async () => {
      stopped = true;

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      await inFlight;
    },
  };
};
