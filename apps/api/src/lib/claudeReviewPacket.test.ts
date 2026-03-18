import { afterEach, describe, expect, it } from "vitest";

import { buildClaudeReviewPacket } from "./claudeReviewPacket.js";
import { InMemoryRepository } from "./InMemoryRepository.js";

let repository: InMemoryRepository | null = null;

afterEach(async () => {
  await repository?.reset();
  repository = null;
});

describe("buildClaudeReviewPacket", () => {
  it("renders a reusable review handoff packet", async () => {
    repository = new InMemoryRepository();
    await repository.saveModelVersion({
      model_version: "impact-engine-v0",
      family: "impact-engine",
      label: "Impact Engine v0",
      status: "active",
      feature_flags: {},
    });

    const packet = await buildClaudeReviewPacket(repository, {
      git_context: {
        branch: "codex/test-packet",
        status_lines: ["M apps/api/src/lib/runMoltCycle.ts"],
        changed_files: ["apps/api/src/lib/runMoltCycle.ts"],
      },
    });

    expect(packet).toContain("# Claude Review Packet");
    expect(packet).toContain("Benchmark pack: core_benchmark_v1");
    expect(packet).toContain("## Current System State");
    expect(packet).toContain("## Current Intelligence Loop");
    expect(packet).toContain("## Current Evolution Loop");
    expect(packet).toContain("## Known Heuristics / Known Weaknesses");
    expect(packet).toContain("## Prompt To Paste Into Claude");
    expect(packet).toContain("Branch: codex/test-packet");
    expect(packet).toContain("apps/api/src/lib/runMoltCycle.ts");
  });
});
