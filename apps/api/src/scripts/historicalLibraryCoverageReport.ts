import { buildHistoricalLibraryCoverageReport } from "../lib/historicalLibraryCoverageReport.js";
import { buildServices } from "../lib/services.js";

const parseTop = () => {
  const raw = Number(process.env.HISTORICAL_LIBRARY_COVERAGE_TOP ?? 8);

  return Number.isFinite(raw) ? Math.max(3, Math.min(20, raw)) : 8;
};

const main = async () => {
  const services = buildServices();

  try {
    const report = await buildHistoricalLibraryCoverageReport(services.repository, {
      top: parseTop(),
    });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await services.repository.close?.();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
