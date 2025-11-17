/**
 * Vector search service for IWSDK code chunks
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EmbeddingService, cosineSimilarity } from './embeddings.js';
import type { Chunk, ChunksData, SearchResult, RelationshipQuery } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Helper to safely convert a field to an array
 */
function toArray(value: any): string[] {
  if (!value) {return [];}
  if (Array.isArray(value)) {return value;}
  if (typeof value === 'string') {return [value];}
  return [];
}

export class SearchService {
  private chunks: Chunk[] = [];
  private embeddingService: EmbeddingService;
  private initialized = false;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.error('Initializing search service...');

    // Load chunks data
    const dataPath = join(__dirname, '..', 'data', 'chunks.json');
    console.error(`Loading chunks from ${dataPath}...`);

    const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as ChunksData;
    this.chunks = data.chunks;

    console.error(`Loaded ${this.chunks.length} chunks from ${Object.keys(data.sources).length} sources`);
    for (const [source, count] of Object.entries(data.sources)) {
      console.error(`  - ${source}: ${count} chunks`);
    }

    // Initialize embedding service
    await this.embeddingService.initialize();

    this.initialized = true;
    console.error('Search service initialized successfully');
  }

  /**
   * Semantic search across all code chunks
   */
  async search(query: string, options: {
    limit?: number;
    source_filter?: string[];
    min_score?: number;
  } = {}): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error('Search service not initialized. Call initialize() first.');
    }

    const limit = options.limit ?? 10;
    const minScore = options.min_score ?? 0.0;

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embed(query);

    // Filter chunks by source if specified
    let searchableChunks = this.chunks;
    if (options.source_filter && options.source_filter.length > 0) {
      searchableChunks = this.chunks.filter(chunk =>
        options.source_filter!.includes(chunk.metadata.source)
      );
    }

    // Calculate similarity scores
    const results: SearchResult[] = searchableChunks.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    // Filter by minimum score and sort by score descending
    return results
      .filter(result => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Find chunks by relationship (extends, implements, imports, calls, uses WebXR API)
   */
  findByRelationship(query: RelationshipQuery): Chunk[] {
    if (!this.initialized) {
      throw new Error('Search service not initialized. Call initialize() first.');
    }

    const limit = query.limit ?? 20;
    const results: Chunk[] = [];

    for (const chunk of this.chunks) {
      let matches = false;

      switch (query.type) {
        case 'extends':
          matches = toArray(chunk.metadata.extends).some(e =>
            e.toLowerCase().includes(query.target.toLowerCase())
          );
          break;

        case 'implements':
          matches = toArray(chunk.metadata.implements).some(i =>
            i.toLowerCase().includes(query.target.toLowerCase())
          );
          break;

        case 'imports':
          matches = toArray(chunk.metadata.imports).some(imp =>
            imp.toLowerCase().includes(query.target.toLowerCase())
          );
          break;

        case 'calls':
          matches = toArray(chunk.metadata.calls).some(call =>
            call.toLowerCase().includes(query.target.toLowerCase())
          );
          break;

        case 'uses_webxr_api':
          matches = toArray(chunk.metadata.webxr_api_usage).some(api =>
            api.toLowerCase().includes(query.target.toLowerCase())
          );
          break;
      }

      if (matches) {
        results.push(chunk);
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Get a specific chunk by name (for API reference lookups)
   */
  getByName(name: string, options: {
    chunk_type?: string;
    source_filter?: string[];
  } = {}): Chunk[] {
    if (!this.initialized) {
      throw new Error('Search service not initialized. Call initialize() first.');
    }

    let results = this.chunks.filter(chunk =>
      chunk.metadata.name.toLowerCase().includes(name.toLowerCase())
    );

    if (options.chunk_type) {
      results = results.filter(chunk => chunk.metadata.chunk_type === options.chunk_type);
    }

    if (options.source_filter && options.source_filter.length > 0) {
      results = results.filter(chunk =>
        options.source_filter!.includes(chunk.metadata.source)
      );
    }

    return results;
  }

  /**
   * Get statistics about the indexed data
   */
  getStats(): {
    total_chunks: number;
    by_source: Record<string, number>;
    by_type: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const chunk of this.chunks) {
      // Count by source
      bySource[chunk.metadata.source] = (bySource[chunk.metadata.source] ?? 0) + 1;

      // Count by type
      byType[chunk.metadata.chunk_type] = (byType[chunk.metadata.chunk_type] ?? 0) + 1;
    }

    return {
      total_chunks: this.chunks.length,
      by_source: bySource,
      by_type: byType
    };
  }

  /**
   * Get all chunks (for advanced filtering in tools)
   */
  getAllChunks(): Chunk[] {
    return this.chunks;
  }
}
