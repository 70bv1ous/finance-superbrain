export interface EmbeddingProvider {
  embedText(input: string): Promise<number[]>;
  close?(): Promise<void>;
}
