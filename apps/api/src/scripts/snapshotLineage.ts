import { captureLineageSnapshot } from "../lib/captureLineageSnapshot.js";
import { buildServices } from "../lib/services.js";

const services = buildServices();

try {
  const snapshot = await captureLineageSnapshot(services.repository, {
    as_of: process.env.LINEAGE_SNAPSHOT_AS_OF,
  });

  console.log(
    JSON.stringify(
      {
        snapshot_id: snapshot.id,
        as_of: snapshot.as_of,
        family_count: snapshot.family_count,
        total_shells: snapshot.total_shells,
        hardened_shells: snapshot.hardened_shells,
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
