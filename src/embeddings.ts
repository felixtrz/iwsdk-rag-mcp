/**
 * Embedding service with support for both transformers.js and local TF-IDF
 *
 * Supports:
 * - jinaai/jina-embeddings-v2-base-code (when network available)
 * - Local TF-IDF embeddings (offline fallback)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EmbeddingsData {
  model: string;
  dimensions: number;
  iwsdk: Array<{ content: string; embedding: number[] }>;
  deps: Array<{ content: string; embedding: number[] }>;
}

export class EmbeddingService {
  private extractor: any = null;
  private modelName = 'jinaai/jina-embeddings-v2-base-code';
  private useLocalTFIDF = false;
  private vocab: Map<string, number> = new Map();
  private idf: Float32Array = new Float32Array(0);
  private dimensions = 768;

  async initialize(): Promise<void> {
    if (this.extractor || this.useLocalTFIDF) {
      return;
    }

    // Check if we should use local TF-IDF (based on model in embeddings.json)
    try {
      const embeddingsPath = join(__dirname, '..', 'data', 'embeddings.json');
      const data = JSON.parse(readFileSync(embeddingsPath, 'utf-8')) as EmbeddingsData;

      if (data.model.includes('local') || data.model.includes('tfidf')) {
        console.error('Using local TF-IDF embeddings...');
        this.useLocalTFIDF = true;
        this.dimensions = data.dimensions;

        // Build vocabulary from all chunks
        const allTexts = [...data.iwsdk, ...data.deps].map(c => c.content);
        this.buildVocabulary(allTexts);
        this.calculateIDF(allTexts);

        console.error(`Local TF-IDF initialized (vocab: ${this.vocab.size}, dims: ${this.dimensions})`);
        return;
      }
    } catch {
      // Fall through to try HuggingFace model
    }

    // Try to load HuggingFace model
    try {
      console.error('Loading embedding model...');
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      this.extractor = await pipeline('feature-extraction', this.modelName);
      console.error('Embedding model loaded successfully');
    } catch (error) {
      // Fall back to local TF-IDF
      console.error('Could not load HuggingFace model, falling back to local TF-IDF...');
      this.useLocalTFIDF = true;

      try {
        const embeddingsPath = join(__dirname, '..', 'data', 'embeddings.json');
        const data = JSON.parse(readFileSync(embeddingsPath, 'utf-8')) as EmbeddingsData;
        this.dimensions = data.dimensions;

        const allTexts = [...data.iwsdk, ...data.deps].map(c => c.content);
        this.buildVocabulary(allTexts);
        this.calculateIDF(allTexts);

        console.error(`Local TF-IDF initialized (vocab: ${this.vocab.size}, dims: ${this.dimensions})`);
      } catch {
        throw new Error('Could not initialize embedding service: no model available');
      }
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  private buildVocabulary(texts: string[]): void {
    let index = 0;
    for (const text of texts) {
      const tokens = this.tokenize(text);
      for (const token of tokens) {
        if (!this.vocab.has(token)) {
          this.vocab.set(token, index++);
        }
      }
    }
  }

  private calculateIDF(texts: string[]): void {
    const docFreq = new Float32Array(this.vocab.size);
    const n = texts.length;

    for (const text of texts) {
      const tokens = new Set(this.tokenize(text));
      for (const token of tokens) {
        const idx = this.vocab.get(token);
        if (idx !== undefined) {
          docFreq[idx]++;
        }
      }
    }

    this.idf = new Float32Array(this.vocab.size);
    for (let i = 0; i < this.vocab.size; i++) {
      this.idf[i] = Math.log((n + 1) / (docFreq[i] + 1)) + 1;
    }
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private embedLocal(text: string): number[] {
    const tokens = this.tokenize(text);

    // Calculate TF
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Create sparse TF-IDF vector
    const tfidf = new Float32Array(this.vocab.size);
    for (const [token, freq] of tf) {
      const idx = this.vocab.get(token);
      if (idx !== undefined) {
        tfidf[idx] = freq * this.idf[idx];
      }
    }

    // Project to dense space using hash-based projection
    const embedding = new Float32Array(this.dimensions);

    for (let i = 0; i < tfidf.length; i++) {
      if (tfidf[i] !== 0) {
        for (let j = 0; j < 4; j++) {
          const hash = this.simpleHash(`${i}_${j}`) % this.dimensions;
          const sign = ((this.simpleHash(`${i}_${j}_sign`) % 2) * 2 - 1);
          embedding[hash] += tfidf[i] * sign;
        }
      }
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return Array.from(embedding);
  }

  async embed(text: string): Promise<number[]> {
    if (this.useLocalTFIDF) {
      return this.embedLocal(text);
    }

    if (!this.extractor) {
      throw new Error('Embedding service not initialized. Call initialize() first.');
    }

    // Generate embedding using HuggingFace model
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });

    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array);

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
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
