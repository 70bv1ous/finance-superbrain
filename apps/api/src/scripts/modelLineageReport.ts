import { buildServices } from "../lib/services.js";
import { buildModelLineageReport } from "../lib/modelLineageReport.js";

const services = buildServices();

try {
  const report = await buildModelLineageReport(services.repository);

  console.log(
    JSON.stringify(
      {
        generated_at: report.generated_at,
        families: report.families.map((family) => ({
          family: family.family,
          root_model_version: family.root_model_version,
          active_model_version: family.active_model_version,
          latest_model_version: family.latest_model_version,
          generation_depth: family.generation_depth,
          total_shells: family.total_shells,
          lineage: family.lineage.map((node) => ({
            model_version: node.model_version,
            parent_model_version: node.parent_model_version,
            generation: node.generation,
            origin_type: node.origin_type,
            shell_state: node.shell_state,
          })),
        })),
        recent_molts: report.recent_molts.map((node) => ({
          family: node.family,
          model_version: node.model_version,
          parent_model_version: node.parent_model_version,
          generation: node.generation,
          shell_state: node.shell_state,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
