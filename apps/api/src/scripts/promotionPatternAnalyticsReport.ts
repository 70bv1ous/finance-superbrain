import { buildServices } from "../lib/services.js";
import { buildPromotionPatternAnalyticsReport } from "../lib/promotionPatternAnalyticsReport.js";

const services = buildServices();

try {
  const result = await buildPromotionPatternAnalyticsReport(services.repository);

  console.log(
    JSON.stringify(
      {
        sample_count: result.sample_count,
        leaders: result.leaders,
        patterns: result.patterns,
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
