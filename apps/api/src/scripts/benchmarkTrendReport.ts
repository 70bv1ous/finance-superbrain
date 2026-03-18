import { buildBenchmarkTrendReport } from "../lib/benchmarkTrendReport.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

try {
  const report = await buildBenchmarkTrendReport(services.repository, {
    benchmark_pack_id: process.env.REPLAY_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1",
  });

  console.log(JSON.stringify(report, null, 2));
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
