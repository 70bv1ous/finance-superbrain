import { buildHistoricalLibraryGapReport } from "../lib/historicalLibraryGapReport.js";
import { buildServices } from "../lib/services.js";

const main = async () => {
  const services = buildServices();

  try {
    const report = await buildHistoricalLibraryGapReport(services.repository);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await services.repository.close?.();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
