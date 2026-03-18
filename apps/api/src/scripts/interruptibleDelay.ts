import { setTimeout as sleep } from "node:timers/promises";

export const waitForDelay = async (delayMs: number, signal?: AbortSignal) => {
  try {
    await sleep(delayMs, undefined, signal ? { signal } : undefined);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      throw error;
    }
  }
};
