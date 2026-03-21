/**
 * Embedding service using transformers.js
 *
 * Uses code-specialized model: jinaai/jina-embeddings-v2-base-code (q8)
 * - Trained on 30+ programming languages
 * - 768-dimensional embeddings, 8192 token context
 * - Model bundled locally to avoid download issues
 */

import { pipeline, env } from '@huggingface/transformers';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve bundled model path relative to package root
function getModelPath(): string {
  // In dist/, go up one level to reach package root
  return resolve(__dirname, '..', 'model');
}

export class EmbeddingService {
  private extractor: any = null;
  private modelName = 'jinaai/jina-embeddings-v2-base-code';

  getModelName(): string {
    return this.modelName;
  }

  async initialize(): Promise<void> {
    if (this.extractor) {
      return;
    }

    const modelPath = getModelPath();
    env.allowLocalModels = true;

    console.error(`Loading embedding model from ${modelPath}...`);
    this.extractor = await pipeline('feature-extraction', modelPath, {
      dtype: 'q8',
      local_files_only: true,
    });
    console.error('Embedding model loaded successfully');
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

    const output = await this.extractor(text, { pooling: 'mean', normalize: true });

    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

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
