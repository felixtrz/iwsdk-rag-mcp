/**
 * Type definitions for IWSDK RAG MCP Server
 */

export interface ChunkMetadata {
  source: string;
  file_path: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  class_context?: string;
  semantic_labels?: string[];
  extends?: string[];
  implements?: string[];
  imports?: string[];
  calls?: string[];
  webxr_api_usage?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
}

export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
  embedding: number[];
}

export interface ChunksData {
  version: string;
  model: string;
  embedding_dim: number;
  total_chunks: number;
  sources: {
    iwsdk: number;
    elics: number;
    deps: number;
  };
  chunks: Chunk[];
  generated_at: string;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export interface RelationshipQuery {
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  limit?: number;
}
