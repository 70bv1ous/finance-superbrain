import type { EmbeddingProvider } from "./embeddingProvider.types.js";
import { buildSemanticVector } from "./semanticRetrieval.js";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  async embedText(input: string): Promise<number[]> {
    return buildSemanticVector(input);
  }
}

export const normalizeEmbedding = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const embedding = value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .map((item) => Number(item));

  return embedding.length ? embedding : null;
};
