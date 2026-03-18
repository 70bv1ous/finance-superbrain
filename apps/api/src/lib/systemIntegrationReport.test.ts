import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { buildSystemIntegrationReport } from "./systemIntegrationReport.js";

describe("system integration report", () => {
  it("keeps per-integration latest job state accurate even when one provider dominates recent volume", async () => {
    const repository = new InMemoryRepository();
    const transcriptJob = await repository.enqueueOperationJob({
      operation_name: "transcript_pull",
      triggered_by: "script",
      payload: {},
      max_attempts: 2,
      available_at: "2026-03-15T00:00:00.000Z",
    });

    for (let index = 0; index < 30; index += 1) {
      await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {
          index,
        },
        max_attempts: 2,
        available_at: `2026-03-15T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
      });
    }

    const report = await buildSystemIntegrationReport(repository, {
      limit: 4,
    });

    const transcript = report.integrations.find(
      (integration) => integration.integration === "transcript",
    );

    expect(transcript).not.toBeNull();
    expect(transcript?.latest_status).toBe("pending");
    expect(transcript?.latest_attempt_count).toBe(0);
    expect(transcript?.latest_job_at).toBe(transcriptJob.updated_at);
  });
});
