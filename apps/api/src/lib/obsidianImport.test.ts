import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { MockMarketDataProvider } from "./MockMarketDataProvider.js";
import { importObsidianHumanInbox } from "./obsidianImport.js";
import type { AppServices } from "./services.js";

async function buildTestServices(): Promise<AppServices> {
  return {
    repository: new InMemoryRepository(),
    marketDataProvider: new MockMarketDataProvider(),
    embeddingProvider: new LocalEmbeddingProvider(),
  };
}

async function createVaultWithInbox() {
  const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-import-"));
  const inboxPath = join(vaultPath, "Finance Superbrain", "Human Inbox");
  await mkdir(inboxPath, { recursive: true });

  return { vaultPath, inboxPath };
}

describe("obsidian selective import", () => {
  it("dry-runs an explicit human inbox note without mutating repository memory", async () => {
    const services = await buildTestServices();
    const { vaultPath, inboxPath } = await createVaultWithInbox();
    await writeFile(
      join(inboxPath, "rates-note.md"),
      `\uFEFF---
fs_import: true
title: Rates breadth reminder
lesson_type: reinforcement
themes: [rates, breadth]
assets: [TLT, DXY]
tags:
  - demo
  - human-memory
---
# Rates breadth reminder

When yields reprice higher after inflation, do not upgrade cyclicals until breadth confirms that tighter conditions are not spreading.
`,
      "utf8",
    );

    const summary = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: true,
      max_notes: 50,
      app_url: "http://localhost:3000",
    });

    expect(summary.dry_run).toBe(true);
    expect(summary.counts.scanned).toBe(1);
    expect(summary.counts.importable).toBe(1);
    expect(summary.candidates[0]?.title).toBe("Rates breadth reminder");
    expect(summary.candidates[0]?.themes).toEqual(["rates", "breadth"]);
    expect(await services.repository.listLessons()).toHaveLength(0);
  });

  it("applies eligible notes as retrieval-only lessons and deduplicates by content hash", async () => {
    const services = await buildTestServices();
    const { vaultPath, inboxPath } = await createVaultWithInbox();
    await writeFile(
      join(inboxPath, "portfolio-follow-through.md"),
      `---
fs_import: true
title: Trimmed posture follow-through
lesson_type: mistake
themes:
  - portfolio
  - follow-through
assets: [XLI]
investigation_id: demo-investigation-cpi-discipline
linked_decision_brief_id: demo-decision-cpi-discipline
linked_portfolio_candidate_id: demo-portfolio-cpi-discipline
---
# Trimmed posture follow-through

If a candidate is trimmed but still open, require a new checkpoint within the next review window or close it.
`,
      "utf8",
    );

    const applied = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: false,
      max_notes: 50,
      app_url: "http://localhost:3000",
    });

    expect(applied.counts.imported).toBe(1);
    expect(applied.candidates[0]?.status).toBe("imported");
    expect(applied.candidates[0]?.imported_lesson_id).toBeTruthy();
    expect(applied.candidates[0]?.imported_prediction_id).toBeTruthy();
    expect(applied.candidates[0]?.linked_investigation_id).toBe("demo-investigation-cpi-discipline");
    expect(applied.candidates[0]?.linked_decision_brief_id).toBe("demo-decision-cpi-discipline");
    expect(applied.candidates[0]?.linked_portfolio_candidate_id).toBe("demo-portfolio-cpi-discipline");

    const lessons = await services.repository.listLessons();
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.metadata.imported_from).toBe("obsidian");
    expect(lessons[0]?.metadata.investigation_id).toBe("demo-investigation-cpi-discipline");
    expect(lessons[0]?.metadata.decision_brief_id).toBe("demo-decision-cpi-discipline");
    expect(lessons[0]?.metadata.portfolio_candidate_id).toBe("demo-portfolio-cpi-discipline");

    const rerun = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: false,
      max_notes: 50,
      app_url: "http://localhost:3000",
    });

    expect(rerun.counts.imported).toBe(0);
    expect(rerun.counts.duplicate).toBe(1);
  });

  it("applies only the selected review queue notes when content hashes are provided", async () => {
    const services = await buildTestServices();
    const { vaultPath, inboxPath } = await createVaultWithInbox();
    await writeFile(
      join(inboxPath, "selected-note.md"),
      `---
fs_import: true
title: Selected note
lesson_type: reinforcement
themes: [selection]
assets: [SPY]
---
# Selected note

Keep this note.
`,
      "utf8",
    );
    await writeFile(
      join(inboxPath, "rejected-note.md"),
      `---
fs_import: true
title: Rejected note
lesson_type: reinforcement
themes: [selection]
assets: [QQQ]
---
# Rejected note

Do not import this note yet.
`,
      "utf8",
    );

    const dryRun = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: true,
      max_notes: 50,
      app_url: "http://localhost:3000",
    });

    const selectedHash = dryRun.candidates.find((candidate) => candidate.title === "Selected note")?.content_hash;
    expect(selectedHash).toBeTruthy();

    const applied = await importObsidianHumanInbox(
      services,
      {
        vault_path: vaultPath,
        inbox_path: "Finance Superbrain/Human Inbox",
        dry_run: false,
        max_notes: 50,
        app_url: "http://localhost:3000",
      },
      {
        selected_content_hashes: [selectedHash!],
      },
    );

    expect(applied.counts.imported).toBe(1);
    expect(applied.counts.skipped).toBe(1);
    expect(applied.candidates.find((candidate) => candidate.title === "Selected note")?.status).toBe("imported");
    expect(applied.candidates.find((candidate) => candidate.title === "Rejected note")?.status).toBe("skipped");

    const lessons = await services.repository.listLessons();
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.metadata.obsidian_title).toBe("Selected note");
  });

  it("skips generated export notes and notes without explicit import frontmatter", async () => {
    const services = await buildTestServices();
    const { vaultPath, inboxPath } = await createVaultWithInbox();
    await writeFile(
      join(inboxPath, "generated.md"),
      `---
managed_by: "finance_superbrain"
type: "lesson"
---
# Generated note
`,
      "utf8",
    );
    await writeFile(
      join(inboxPath, "ordinary.md"),
      `# Ordinary note

This note is intentionally not marked for import.
`,
      "utf8",
    );

    const summary = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: true,
      max_notes: 50,
      app_url: null,
    });

    expect(summary.counts.scanned).toBe(2);
    expect(summary.counts.importable).toBe(0);
    expect(summary.counts.skipped).toBe(2);
    expect(summary.candidates.map((candidate: { reason: string | null }) => candidate.reason)).toEqual([
      "Generated Finance Superbrain notes are export output and are never imported back.",
      "Note is missing fs_import: true frontmatter.",
    ]);
  });

  it("returns a safe empty summary when the configured inbox does not exist", async () => {
    const services = await buildTestServices();
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-import-"));
    const summary = await importObsidianHumanInbox(services, {
      vault_path: vaultPath,
      inbox_path: "Finance Superbrain/Human Inbox",
      dry_run: true,
      max_notes: 50,
      app_url: null,
    });

    expect(summary.counts.scanned).toBe(0);
    expect(summary.warnings[0]).toContain("Obsidian import inbox does not exist yet");
  });

  it("rejects inbox paths that escape the vault", async () => {
    const services = await buildTestServices();
    const vaultPath = await mkdtemp(join(tmpdir(), "finance-superbrain-obsidian-import-"));

    await expect(
      importObsidianHumanInbox(services, {
        vault_path: vaultPath,
        inbox_path: "../outside",
        dry_run: true,
        max_notes: 50,
        app_url: null,
      }),
    ).rejects.toThrow("OBSIDIAN_IMPORT_INBOX");
  });
});
