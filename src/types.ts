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
  // Pre-lowercased relationship arrays for fast case-insensitive comparison
  _extendsLower: string[];
  _implementsLower: string[];
  _importsLower: string[];
  _callsLower: string[];
  _webxrApiUsageLower: string[];
}

export interface Chunk {
  id: string;
  content: string;
  contentLower: string;
  metadata: ChunkMetadata;
  embedding: Float32Array;
}

// Raw chunk format from embeddings.json (flattened structure)
export interface RawChunk {
  content: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: string;
  module_path?: string;
  class_name?: string;
  imports?: string[];
  exports?: string[];
  type_parameters?: string[];
  decorators?: string[];
  calls?: string[];
  extends?: string[];
  implements?: string[];
  uses_types?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
  webxr_api_usage?: string[];
  three_js_usage?: string[];
  semantic_labels?: string[];
  source: string;
  embedding: number[];
}

// Embeddings.json format (new hybrid approach)
export interface EmbeddingsData {
  version: string;
  model: string;
  dimensions: number;
  iwsdk: RawChunk[];
  deps: RawChunk[];
}

// Legacy chunks.json format (for backward compatibility)
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

// Tool argument types

export interface SearchCodeArgs {
  query: string;
  limit?: number;
  source?: string[];
  min_score?: number;
  verbosity?: number;
}

export interface FindByRelationshipArgs {
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  limit?: number;
}

export interface GetApiReferenceArgs {
  name: string;
  type?: 'class' | 'function' | 'interface' | 'type';
  source?: string[];
}

export interface GetFileContentArgs {
  file_path: string;
  source: 'iwsdk' | 'elics' | 'deps';
  start_line?: number;
  end_line?: number;
}

export interface ListEcsArgs {
  source?: string[];
  limit?: number;
}

export interface FindDependentsArgs {
  api_name: string;
  dependency_type?: 'imports' | 'calls' | 'extends' | 'implements' | 'any';
  limit?: number;
}

export interface FindUsageExamplesArgs {
  api_name: string;
  limit?: number;
}
