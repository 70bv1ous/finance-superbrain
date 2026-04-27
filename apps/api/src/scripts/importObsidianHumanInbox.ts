import { buildObsidianImportConfigFromEnv, importObsidianHumanInbox } from "../lib/obsidianImport.js";
import { buildServices } from "../lib/services.js";

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const apply = hasFlag("--apply");
  const services = buildServices();

  try {
    const config = buildObsidianImportConfigFromEnv(process.env, { apply });
    const summary = await importObsidianHumanInbox(services, config);

    console.log(`Obsidian human inbox import ${summary.dry_run ? "dry-run" : "apply"} complete`);
    console.log(`Workspace: ${summary.workspace_id}`);
    console.log(`Inbox: ${summary.inbox_path}`);
    console.log(
      `Notes: scanned=${summary.counts.scanned}, importable=${summary.counts.importable}, imported=${summary.counts.imported}, duplicate=${summary.counts.duplicate}, skipped=${summary.counts.skipped}, errors=${summary.counts.errors}`,
    );

    if (summary.candidates.length) {
      console.log("Candidates:");
      for (const candidate of summary.candidates) {
        const suffix = candidate.reason ? ` | ${candidate.reason}` : "";
        console.log(`- ${candidate.status}: ${candidate.title} (${candidate.relative_path})${suffix}`);
      }
    }

    if (summary.warnings.length) {
      console.log("Warnings:");
      for (const warning of summary.warnings) {
        console.log(`- ${warning}`);
      }
    }

    if (summary.dry_run && summary.counts.importable > 0) {
      console.log("Run again with -- --apply to import the eligible notes as retrieval memory.");
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
