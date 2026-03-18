import { buildServices } from "../lib/services.js";
import { buildPromotionAnalyticsReport } from "../lib/promotionAnalyticsReport.js";

const services = buildServices();

try {
  const result = await buildPromotionAnalyticsReport(services.repository);

  console.log(
    JSON.stringify(
      {
        sample_count: result.sample_count,
        leaders: result.leaders,
        families: result.families,
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
