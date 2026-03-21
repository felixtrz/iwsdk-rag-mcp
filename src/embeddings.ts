/**
 * Embedding service using transformers.js
 *
 * Uses code-specialized model: jinaai/jina-embeddings-v2-base-code (q8)
 * - Trained on 30+ programming languages
 * - 768-dimensional embeddings, 8192 token context
 * - Model bundled locally to avoid download issues
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@huggingface/transformers';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve bundled model path relative to package root
function getModelPath(): string {
  // Walk up from __dirname until we find the model/ directory.
  // Works for both dist/ (one level up) and dist-tools/src/ (two levels up).
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'model');
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = resolve(dir, '..');
  }
  // Fallback to original behaviour
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
    console.error(JSON.stringify({ event: 'model_loaded', model: this.modelName, timestamp: Date.now() }));
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

    const output = await this.extractor(text, { pooling: 'mean', normalize: true });

    return output.data as Float32Array;
  }

}

/**
 * Similarity for unit-normalized vectors (dot product only).
 * All embeddings use normalize: true, so ||a|| = ||b|| = 1
 * and cosine_sim(a,b) = a · b.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
