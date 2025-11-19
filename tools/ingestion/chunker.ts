/**
 * Semantic code chunker
 *
 * ts-morph already gives us clean semantic chunks, so we just sort them.
 * No merging needed - granular chunks provide better search precision.
 */

import { TypeScriptChunk } from './types.js';

export interface ChunkingConfig {
  minChunkSize: number;  // Minimum lines per chunk
  maxChunkSize: number;  // Maximum lines per chunk
  targetChunkSize: number;  // Ideal chunk size
}

export class ASTChunker {
  private config: ChunkingConfig;

  constructor(config?: Partial<ChunkingConfig>) {
    this.config = {
      minChunkSize: config?.minChunkSize ?? 15,
      maxChunkSize: config?.maxChunkSize ?? 100,
      targetChunkSize: config?.targetChunkSize ?? 50,
    };

    console.error(
      `✅ AST Chunker initialized (min=${this.config.minChunkSize}, ` +
      `max=${this.config.maxChunkSize}, target=${this.config.targetChunkSize})`
    );
  }

  /**
   * Optimize chunks - just sort them by file and line number
   *
   * ts-morph already gives us perfect semantic boundaries.
   * Granular chunks = better search precision!
   */
  optimizeChunks(chunks: TypeScriptChunk[]): TypeScriptChunk[] {
    if (!chunks || chunks.length === 0) {
      return chunks;
    }

    // Group by file for better context
    const byFile = new Map<string, TypeScriptChunk[]>();
    for (const chunk of chunks) {
      if (!byFile.has(chunk.file_path)) {
        byFile.set(chunk.file_path, []);
      }
      byFile.get(chunk.file_path)!.push(chunk);
    }

    // Sort and return
    const optimized: TypeScriptChunk[] = [];
    for (const [, fileChunks] of byFile) {
      fileChunks.sort((a, b) => a.start_line - b.start_line);
      optimized.push(...fileChunks);
    }

    return optimized;
  }
}
