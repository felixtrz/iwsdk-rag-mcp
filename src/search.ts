/**
 * Vector search service for IWSDK code chunks
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EmbeddingService, cosineSimilarity } from './embeddings.js';
import type { Chunk, ChunksData, EmbeddingsData, RawChunk, SearchResult, RelationshipQuery } from './types.js';
import { toArray } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SearchService {
  private chunks: Chunk[] = [];
  private chunksBySource = new Map<string, Chunk[]>();
  private embeddingService: EmbeddingService;
  private initialized = false;
  private searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
  private readonly CACHE_MAX_SIZE = 100;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.error('Initializing search service...');

    // Try new embeddings.json format first, fall back to legacy chunks.json
    const embeddingsPath = join(__dirname, '..', 'data', 'embeddings.json');
    const chunksPath = join(__dirname, '..', 'data', 'chunks.json');

    try {
      console.error(`Loading embeddings from ${embeddingsPath}...`);
      const data = JSON.parse(readFileSync(embeddingsPath, 'utf-8')) as EmbeddingsData;

      // Transform raw chunks into Chunk objects
      this.chunks = [
        ...data.iwsdk.map((raw, idx) => this.rawChunkToChunk(raw, `iwsdk_${idx}`)),
        ...data.deps.map((raw, idx) => this.rawChunkToChunk(raw, `deps_${idx}`))
      ];

      console.error(`Loaded ${this.chunks.length} chunks using ${data.model}`);
      console.error(`  - iwsdk: ${data.iwsdk.length} chunks`);
      console.error(`  - deps: ${data.deps.length} chunks`);
      console.error(`  - embedding dimensions: ${data.dimensions}`);
    } catch {
      // Fall back to legacy format
      console.error(`Could not load embeddings.json, trying chunks.json...`);
      const data = JSON.parse(readFileSync(chunksPath, 'utf-8')) as ChunksData;
      this.chunks = data.chunks;

      console.error(`Loaded ${this.chunks.length} chunks from ${Object.keys(data.sources).length} sources`);
      for (const [source, count] of Object.entries(data.sources)) {
        console.error(`  - ${source}: ${count} chunks`);
      }
    }

    // Build source index for fast filtered searches
    for (const chunk of this.chunks) {
      const source = chunk.metadata.source;
      let arr = this.chunksBySource.get(source);
      if (!arr) {
        arr = [];
        this.chunksBySource.set(source, arr);
      }
      arr.push(chunk);
    }

    // Initialize embedding service
    await this.embeddingService.initialize();

    this.initialized = true;
    console.error('Search service initialized successfully');
  }

  /**
   * Transform a RawChunk from embeddings.json into a Chunk object
   */
  private rawChunkToChunk(raw: RawChunk, id: string): Chunk {
    return {
      id,
      content: raw.content,
      contentLower: raw.content.toLowerCase(),
      embedding: new Float32Array(raw.embedding),
      metadata: {
        source: raw.source,
        file_path: raw.file_path,
        chunk_type: raw.chunk_type,
        name: raw.name,
        start_line: raw.start_line,
        end_line: raw.end_line,
        class_context: raw.class_name,
        semantic_labels: raw.semantic_labels,
        extends: raw.extends,
        implements: raw.implements,
        imports: raw.imports,
        calls: raw.calls,
        webxr_api_usage: raw.webxr_api_usage,
        ecs_component: raw.ecs_component,
        ecs_system: raw.ecs_system,
        _extendsLower: toArray(raw.extends).map(s => s.toLowerCase()),
        _implementsLower: toArray(raw.implements).map(s => s.toLowerCase()),
        _importsLower: toArray(raw.imports).map(s => s.toLowerCase()),
        _callsLower: toArray(raw.calls).map(s => s.toLowerCase()),
        _webxrApiUsageLower: toArray(raw.webxr_api_usage).map(s => s.toLowerCase()),
      }
    };
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

    // Check cache (delete+reinsert for LRU ordering)
    const cacheKey = `${query}|${JSON.stringify(options)}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      this.searchCache.delete(cacheKey);
      this.searchCache.set(cacheKey, cached);
      return cached.results;
    }

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embed(query);

    // Use source index for filtered searches to avoid scanning all chunks
    let searchableChunks: Chunk[];
    if (options.source_filter && options.source_filter.length > 0) {
      searchableChunks = options.source_filter.flatMap(
        source => this.chunksBySource.get(source) ?? []
      );
    } else {
      searchableChunks = this.chunks;
    }

    // Calculate similarity scores
    const results: SearchResult[] = searchableChunks.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }));

    // Filter by minimum score and sort by score descending
    const finalResults = results
      .filter(result => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Cache results (evict LRU entry if at capacity)
    if (this.searchCache.size >= this.CACHE_MAX_SIZE) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest !== undefined) {
        this.searchCache.delete(oldest);
      }
    }
    this.searchCache.set(cacheKey, { results: finalResults, timestamp: Date.now() });

    return finalResults;
  }

  /**
   * Find chunks by relationship (extends, implements, imports, calls, uses WebXR API)
   */
  findByRelationship(query: RelationshipQuery): Chunk[] {
    if (!this.initialized) {
      throw new Error('Search service not initialized. Call initialize() first.');
    }

    const limit = query.limit ?? 20;
    const targetLower = query.target.toLowerCase();
    const results: Chunk[] = [];

    for (const chunk of this.chunks) {
      let matches = false;

      switch (query.type) {
        case 'extends':
          matches = chunk.metadata._extendsLower.some(e => e.includes(targetLower));
          break;

        case 'implements':
          matches = chunk.metadata._implementsLower.some(i => i.includes(targetLower));
          break;

        case 'imports':
          matches = chunk.metadata._importsLower.some(imp => imp.includes(targetLower));
          break;

        case 'calls':
          matches = chunk.metadata._callsLower.some(call => call.includes(targetLower));
          break;

        case 'uses_webxr_api':
          matches = chunk.metadata._webxrApiUsageLower.some(api => api.includes(targetLower));
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

    const nameLower = name.toLowerCase();
    return this.chunks.filter(chunk => {
      if (!chunk.metadata.name.toLowerCase().includes(nameLower)) { return false; }
      if (options.chunk_type && chunk.metadata.chunk_type !== options.chunk_type) { return false; }
      if (options.source_filter && options.source_filter.length > 0 &&
          !options.source_filter.includes(chunk.metadata.source)) { return false; }
      return true;
    });
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
