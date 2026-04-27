import { buildObsidianExportConfigFromEnv, exportWorkspaceToObsidian } from "../lib/obsidianExport.js";
import { buildServices } from "../lib/services.js";

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const services = buildServices();

  try {
    const config = buildObsidianExportConfigFromEnv(process.env, { dry_run: dryRun });
    const summary = await exportWorkspaceToObsidian(services.repository, config);

    console.log(`Obsidian export ${summary.dry_run ? "dry-run" : "complete"}`);
    console.log(`Workspace: ${summary.workspace_id}`);
    console.log(`Output: ${summary.output_path}`);
    console.log(
      `Notes: investigations=${summary.note_counts.investigations}, decisions=${summary.note_counts.decision_briefs}, portfolio=${summary.note_counts.portfolio_candidates}, lessons=${summary.note_counts.lessons}, activity=${summary.note_counts.activity}, indexes=${summary.note_counts.indexes}, total=${summary.note_counts.total}`,
    );

    if (summary.warnings.length) {
      console.log("Warnings:");
      for (const warning of summary.warnings) {
        console.log(`- ${warning}`);
      }
    }
  } finally {
    try {
      await services.repository.close?.();
    } catch {}
    try {
      await services.marketDataProvider.close?.();
    } catch {}
    try {
      await services.embeddingProvider.close?.();
    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
