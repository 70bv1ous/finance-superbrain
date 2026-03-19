import type { EmbeddingProvider } from "./embeddingProvider.types.js";
import type { Repository } from "./repository.types.js";
import type { MarketDataProvider } from "./marketDataProvider.types.js";

import { InMemoryRepository } from "./InMemoryRepository.js";
import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";
import { VoyageEmbeddingProvider } from "./VoyageEmbeddingProvider.js";
import { MockMarketDataProvider } from "./MockMarketDataProvider.js";
import { createPGliteRepository } from "./PGliteRepository.js";
import { createPostgresRepository } from "./PostgresRepository.js";
import { resolvePGliteDataDir } from "./schema.js";
import { YahooMarketDataProvider } from "./YahooMarketDataProvider.js";

export type AppServices = {
  repository: Repository;
  marketDataProvider: MarketDataProvider;
  embeddingProvider: EmbeddingProvider;
};

export type BuildServicesOptions = Partial<AppServices>;

export const buildRepositoryFromEnv = (): Repository => {
  const backend =
    process.env.REPOSITORY_BACKEND ??
    (process.env.DATABASE_URL ? "postgres" : process.env.PGLITE_DATA_DIR ? "pglite" : "memory");

  if (backend === "postgres") {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when REPOSITORY_BACKEND=postgres.");
    }

    return createPostgresRepository(databaseUrl);
  }

  if (backend === "pglite") {
    return createPGliteRepository(resolvePGliteDataDir());
  }

  if (backend !== "memory") {
    throw new Error(`Unsupported repository backend: ${backend}`);
  }

  return new InMemoryRepository();
};

const createMarketDataProviderFromEnv = (): MarketDataProvider => {
  const backend = process.env.MARKET_DATA_BACKEND ?? "mock";

  if (backend === "yahoo") {
    return new YahooMarketDataProvider();
  }

  return new MockMarketDataProvider();
};

/**
 * Returns a VoyageEmbeddingProvider (voyage-finance-2) when VOYAGE_API_KEY is
 * set; falls back to the in-process hash-vector LocalEmbeddingProvider so the
 * app works without any API key configured.
 */
const createEmbeddingProviderFromEnv = (): EmbeddingProvider => {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (voyageKey) {
    console.log("[embedding] Using VoyageEmbeddingProvider (voyage-finance-2)");
    return new VoyageEmbeddingProvider(voyageKey);
  }
  console.log("[embedding] VOYAGE_API_KEY not set — using LocalEmbeddingProvider (hash vectors)");
  return new LocalEmbeddingProvider();
};

export const buildServices = (options: BuildServicesOptions = {}): AppServices => ({
  repository:          options.repository          ?? buildRepositoryFromEnv(),
  marketDataProvider:  options.marketDataProvider  ?? createMarketDataProviderFromEnv(),
  embeddingProvider:   options.embeddingProvider   ?? createEmbeddingProviderFromEnv(),
});
