/**
 * Voyage AI embedding provider — uses voyage-finance-2, a model specifically
 * tuned for financial text.
 *
 * Free tier: 200M tokens. Cost: $0.12/M tokens after that.
 * 1024-dimensional vectors. Supports batch embedding (up to 128 inputs).
 *
 * Falls back gracefully: if the API call fails, throws so the caller can
 * fall back to LocalEmbeddingProvider.
 */

import type { EmbeddingProvider } from "./embeddingProvider.types.js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL  = "voyage-finance-2";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async embedText(input: string): Promise<number[]> {
    const results = await this.embedBatch([input]);
    const first   = results[0];
    if (!first) throw new Error("Voyage API returned no embeddings.");
    return first;
  }

  /** Embed up to 128 strings in a single API call. */
  async embedBatch(inputs: string[]): Promise<number[][]> {
    const response = await fetch(VOYAGE_API_URL, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ input: inputs, model: this.model }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Voyage API ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to guarantee order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
