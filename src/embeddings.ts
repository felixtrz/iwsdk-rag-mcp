/**
 * Embedding service using transformers.js
 *
 * Uses the same model as Python: sentence-transformers/all-mpnet-base-v2
 */

import { pipeline, env } from '@xenova/transformers';

// Disable local model caching in production
env.allowLocalModels = false;

export class EmbeddingService {
  private extractor: any = null;
  private modelName = 'Xenova/all-mpnet-base-v2';

  async initialize(): Promise<void> {
    if (this.extractor) {
      return;
    }

    console.error('Loading embedding model...');
    this.extractor = await pipeline('feature-extraction', this.modelName);
    console.error('Embedding model loaded successfully');
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

    // Generate embedding
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });

    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array);

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

    // Process all texts
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }
}

// Cosine similarity calculation
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
