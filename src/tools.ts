/**
 * MCP Tools for IWSDK RAG
 *
 * Provides 3 focused tools:
 * 1. search_code - Semantic search across all code
 * 2. find_by_relationship - Structural queries (extends, implements, imports, calls, WebXR API usage)
 * 3. get_api_reference - Quick API lookups by name
 */

import { FileService } from './files.js';
import type { SearchService } from './search.js';
import type { Chunk } from './types.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Helper to safely convert a field to an array
 * IMPORTANT: Handles both arrays and single strings (not splitting strings into chars!)
 */
function toArray(value: any): string[] {
  if (!value) {return [];}
  if (Array.isArray(value)) {return value;}
  if (typeof value === 'string') {return [value];}  // Return as single-element array
  return [];
}

/**
 * Deduplicate chunks by file_path and overlapping line ranges
 * Keeps the first occurrence when there's overlap
 */
function deduplicateChunks<T extends { chunk: Chunk }>(results: T[]): T[] {
  const seen = new Map<string, Array<[number, number]>>();
  const deduplicated: T[] = [];

  for (const result of results) {
    const chunk = result.chunk;
    const key = chunk.metadata.file_path;
    const start = chunk.metadata.start_line;
    const end = chunk.metadata.end_line;

    // Check for overlap with existing entries for this file
    const existingRanges = seen.get(key) || [];
    const hasOverlap = existingRanges.some(([existStart, existEnd]) =>
      !(end < existStart || start > existEnd) // NOT (completely before OR completely after)
    );

    if (!hasOverlap) {
      deduplicated.push(result);
      existingRanges.push([start, end]);
      seen.set(key, existingRanges);
    }
  }

  return deduplicated;
}

/**
 * Generate source filtering hints based on search results
 */
function getSourceHints(results: Chunk[], query: string): string {
  if (results.length === 0) {
    return '\n**Tip**: Try searching without source filters to see all available results.';
  }

  const sourceCounts = new Map<string, number>();
  for (const chunk of results) {
    const source = chunk.metadata.source;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }

  // Detect patterns in the query
  const queryLower = query.toLowerCase();
  const hints: string[] = [];

  // Three.js related queries (types are in deps via @types/three)
  if (queryLower.includes('material') || queryLower.includes('mesh') ||
      queryLower.includes('geometry') || queryLower.includes('vector') ||
      queryLower.includes('scene') || queryLower.includes('renderer')) {
    if (!sourceCounts.has('deps') || sourceCounts.get('deps')! < 3) {
      hints.push('For Three.js types, try: `source: ["deps"]`');
    }
  }

  // ECS related queries
  if (queryLower.includes('component') || queryLower.includes('system') ||
      queryLower.includes('entity') || queryLower.includes('query')) {
    if (!sourceCounts.has('iwsdk') || sourceCounts.get('iwsdk')! < 3) {
      hints.push('For ECS patterns, try: `source: ["iwsdk"]`');
    }
  }

  // WebXR related queries
  if (queryLower.includes('xr') || queryLower.includes('controller') ||
      queryLower.includes('vr') || queryLower.includes('ar')) {
    hints.push('For WebXR types, try: `source: ["deps"]`');
  }

  if (hints.length > 0) {
    return '\n\n**Source filtering hints**:\n' + hints.map(h => `- ${h}`).join('\n');
  }

  return '';
}

/**
 * Summarize chunk content based on verbosity level
 * 0 = metadata only, 1 = first 10 lines, 2 = first 30 lines, 3 = full content
 */
function summarizeContent(content: string, verbosity: number = 3): string {
  if (verbosity >= 3) {
    return content;
  }

  const lines = content.split('\n');

  if (verbosity === 0) {
    return `[${lines.length} lines - use verbosity 1+ to see content]`;
  }

  const maxLines = verbosity === 1 ? 10 : 30;

  if (lines.length <= maxLines) {
    return content;
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  return truncated + `\n\n// ... ${lines.length - maxLines} more lines (increase verbosity to see more)`;
}

/**
 * Format a chunk for display
 */
function formatChunk(chunk: Chunk, score?: number, verbosity: number = 3): string {
  const lines: string[] = [];

  // Header with score if provided
  if (score !== undefined) {
    lines.push(`## ${chunk.metadata.name} (score: ${score.toFixed(3)})`);
  } else {
    lines.push(`## ${chunk.metadata.name}`);
  }

  lines.push('');

  // Metadata
  lines.push(`**Type**: ${chunk.metadata.chunk_type}`);
  lines.push(`**Source**: ${chunk.metadata.source}`);
  lines.push(`**File**: ${chunk.metadata.file_path}:${chunk.metadata.start_line}-${chunk.metadata.end_line}`);

  if (chunk.metadata.class_context) {
    lines.push(`**Class**: ${chunk.metadata.class_context}`);
  }

  // Relationships
  const extendsArr = toArray(chunk.metadata.extends);
  if (extendsArr.length > 0) {
    lines.push(`**Extends**: ${extendsArr.join(', ')}`);
  }

  const implementsArr = toArray(chunk.metadata.implements);
  if (implementsArr.length > 0) {
    lines.push(`**Implements**: ${implementsArr.join(', ')}`);
  }

  // API usage
  const webxrArr = toArray(chunk.metadata.webxr_api_usage);
  if (webxrArr.length > 0) {
    lines.push(`**WebXR APIs**: ${webxrArr.join(', ')}`);
  }

  // ECS patterns
  if (chunk.metadata.ecs_component) {
    lines.push(`**Pattern**: ECS Component`);
  }
  if (chunk.metadata.ecs_system) {
    lines.push(`**Pattern**: ECS System`);
  }

  lines.push('');

  // Code content with summarization
  lines.push('```typescript');
  lines.push(summarizeContent(chunk.content, verbosity));
  lines.push('```');

  return lines.join('\n');
}

/**
 * Tool 1: search_code
 *
 * Semantic search across all code using embeddings.
 * Best for finding relevant code by description or use case.
 */
export async function searchCode(
  searchService: SearchService,
  args: {
    query: string;
    limit?: number;
    source?: string[];
    min_score?: number;
    verbosity?: number;
  }
): Promise<ToolResult> {
  // Input validation
  if (!args.query || args.query.trim().length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Query cannot be empty'
      }],
      isError: true
    };
  }

  if (args.limit !== undefined && (args.limit < 1 || args.limit > 100)) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Limit must be between 1 and 100'
      }],
      isError: true
    };
  }

  if (args.min_score !== undefined && (args.min_score < 0 || args.min_score > 1)) {
    return {
      content: [{
        type: 'text',
        text: 'Error: min_score must be between 0 and 1'
      }],
      isError: true
    };
  }

  const verbosity = args.verbosity ?? 3;

  try {
    // Request more results than needed for deduplication
    const requestLimit = Math.min((args.limit ?? 10) * 2, 100);
    const results = await searchService.search(args.query, {
      limit: requestLimit,
      source_filter: args.source,
      min_score: args.min_score ?? 0.0
    });

    if (results.length === 0) {
      const hint = getSourceHints([], args.query);
      return {
        content: [{
          type: 'text',
          text: `No results found for query: "${args.query}"${hint}`
        }]
      };
    }

    // Deduplicate by file_path + line range
    const deduplicated = deduplicateChunks(results);

    // Apply final limit
    const finalResults = deduplicated.slice(0, args.limit ?? 10);

    const output: string[] = [];
    output.push(`# Search Results for: "${args.query}"`);
    output.push('');
    output.push(`Found ${finalResults.length} relevant code chunks:`);
    output.push('');

    for (const result of finalResults) {
      output.push(formatChunk(result.chunk, result.score, verbosity));
      output.push('');
      output.push('---');
      output.push('');
    }

    // Add source filtering hints
    const hints = getSourceHints(finalResults.map(r => r.chunk), args.query);
    if (hints) {
      output.push(hints);
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error searching code: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 2: find_by_relationship
 *
 * Find code by structural relationships.
 * Use this to find all classes that extend/implement something,
 * or find code that imports/calls specific functions, or uses WebXR APIs.
 */
export async function findByRelationship(
  searchService: SearchService,
  args: {
    type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
    target: string;
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const results = searchService.findByRelationship({
      type: args.type,
      target: args.target,
      limit: args.limit ?? 20
    });

    if (results.length === 0) {
      const typeLabel = args.type.replace('_', ' ');
      return {
        content: [{
          type: 'text',
          text: `No code found that ${typeLabel}: "${args.target}"`
        }]
      };
    }

    const output: string[] = [];
    const typeLabel = args.type.replace('_', ' ');
    output.push(`# Code that ${typeLabel}: "${args.target}"`);
    output.push('');
    output.push(`Found ${results.length} code chunks:`);
    output.push('');

    for (const chunk of results) {
      output.push(formatChunk(chunk));
      output.push('');
      output.push('---');
      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error finding by relationship: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 3: get_api_reference
 *
 * Quick lookup of API by name.
 * Use this when you know the class/function name and want to see its implementation.
 */
export async function getApiReference(
  searchService: SearchService,
  args: {
    name: string;
    type?: 'class' | 'function' | 'interface' | 'type';
    source?: string[];
  }
): Promise<ToolResult> {
  try {
    const results = searchService.getByName(args.name, {
      chunk_type: args.type,
      source_filter: args.source
    });

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No API found with name: "${args.name}"${args.type ? ` (type: ${args.type})` : ''}`
        }]
      };
    }

    const output: string[] = [];
    output.push(`# API Reference: "${args.name}"`);
    output.push('');
    output.push(`Found ${results.length} matching definitions:`);
    output.push('');

    for (const chunk of results) {
      output.push(formatChunk(chunk));
      output.push('');
      output.push('---');
      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error getting API reference: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 4: get_file_content
 *
 * Read the full content of a source file.
 * Useful for seeing complete file context beyond code snippets.
 */
export async function getFileContent(
  fileService: FileService,
  args: {
    file_path: string;
    source: 'iwsdk' | 'elics' | 'deps';
    start_line?: number;
    end_line?: number;
  }
): Promise<ToolResult> {
  try {
    const content = fileService.readFile(args.file_path, args.source, {
      startLine: args.start_line,
      endLine: args.end_line
    });

    if (content === null) {
      return {
        content: [{
          type: 'text',
          text: `File not found: ${args.file_path} (source: ${args.source})`
        }],
        isError: true
      };
    }

    const output: string[] = [];
    output.push(`# File: ${args.file_path}`);
    output.push(`**Source**: ${args.source}`);

    if (args.start_line || args.end_line) {
      output.push(`**Lines**: ${args.start_line || 1}-${args.end_line || 'end'}`);
    }

    output.push('');
    output.push('```typescript');
    output.push(content);
    output.push('```');

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 5: list_ecs_components
 *
 * List all ECS components in the codebase.
 * Uses pattern detection: classes that extend "Component"
 */
export async function listEcsComponents(
  searchService: SearchService,
  args: {
    source?: string[];
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const allChunks = searchService.getAllChunks();

    // Filter for ECS components - trust the parser's metadata flags
    let components = allChunks.filter(chunk => {
      return chunk.metadata.ecs_component === true;
    });

    // Apply source filter
    if (args.source && args.source.length > 0) {
      components = components.filter(chunk => args.source!.includes(chunk.metadata.source));
    }

    // Apply limit
    const limit = args.limit ?? 100;
    components = components.slice(0, limit);

    if (components.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No ECS components found'
        }]
      };
    }

    const output: string[] = [];
    output.push(`# ECS Components`);
    output.push('');
    output.push(`Found ${components.length} ECS components:`);
    output.push('');

    for (const chunk of components) {
      output.push(`## ${chunk.metadata.name}`);
      output.push(`**Source**: ${chunk.metadata.source}`);
      output.push(`**File**: ${chunk.metadata.file_path}:${chunk.metadata.start_line}`);

      const extendsArr = toArray(chunk.metadata.extends);
      if (extendsArr.length > 0) {
        output.push(`**Extends**: ${extendsArr.join(', ')}`);
      }

      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error listing components: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 6: list_ecs_systems
 *
 * List all ECS systems in the codebase.
 * Uses pattern detection: classes that extend "System"
 */
export async function listEcsSystems(
  searchService: SearchService,
  args: {
    source?: string[];
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const allChunks = searchService.getAllChunks();

    // Filter for ECS systems - trust the parser's metadata flags
    let systems = allChunks.filter(chunk => {
      return chunk.metadata.ecs_system === true;
    });

    // Apply source filter
    if (args.source && args.source.length > 0) {
      systems = systems.filter(chunk => args.source!.includes(chunk.metadata.source));
    }

    // Apply limit
    const limit = args.limit ?? 100;
    systems = systems.slice(0, limit);

    if (systems.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No ECS systems found'
        }]
      };
    }

    const output: string[] = [];
    output.push(`# ECS Systems`);
    output.push('');
    output.push(`Found ${systems.length} ECS systems:`);
    output.push('');

    for (const chunk of systems) {
      output.push(`## ${chunk.metadata.name}`);
      output.push(`**Source**: ${chunk.metadata.source}`);
      output.push(`**File**: ${chunk.metadata.file_path}:${chunk.metadata.start_line}`);

      const extendsArr = toArray(chunk.metadata.extends);
      if (extendsArr.length > 0) {
        output.push(`**Extends**: ${extendsArr.join(', ')}`);
      }

      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error listing systems: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 7: find_dependents
 *
 * Find code that depends on a given API (reverse dependency lookup).
 * This answers "what uses this API?"
 */
export async function findDependents(
  searchService: SearchService,
  args: {
    api_name: string;
    dependency_type?: 'imports' | 'calls' | 'extends' | 'implements' | 'any';
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const dependencyType = args.dependency_type ?? 'any';
    const limit = args.limit ?? 20;
    const allChunks = searchService.getAllChunks();

    const dependents: Chunk[] = [];

    for (const chunk of allChunks) {
      let matches = false;
      const apiNameLower = args.api_name.toLowerCase();

      if (dependencyType === 'any' || dependencyType === 'imports') {
        matches = matches || toArray(chunk.metadata.imports).some(imp =>
          imp.toLowerCase().includes(apiNameLower)
        );
      }

      if (dependencyType === 'any' || dependencyType === 'calls') {
        matches = matches || toArray(chunk.metadata.calls).some(call =>
          call.toLowerCase().includes(apiNameLower)
        );
      }

      if (dependencyType === 'any' || dependencyType === 'extends') {
        matches = matches || toArray(chunk.metadata.extends).some(ext =>
          ext.toLowerCase().includes(apiNameLower)
        );
      }

      if (dependencyType === 'any' || dependencyType === 'implements') {
        matches = matches || toArray(chunk.metadata.implements).some(impl =>
          impl.toLowerCase().includes(apiNameLower)
        );
      }

      if (matches) {
        dependents.push(chunk);
        if (dependents.length >= limit) {
          break;
        }
      }
    }

    if (dependents.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No code found that depends on "${args.api_name}"${args.dependency_type ? ` (type: ${args.dependency_type})` : ''}`
        }]
      };
    }

    const output: string[] = [];
    output.push(`# Code that depends on: "${args.api_name}"`);
    output.push('');
    output.push(`Found ${dependents.length} dependents:`);
    output.push('');

    for (const chunk of dependents) {
      output.push(formatChunk(chunk));
      output.push('');
      output.push('---');
      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error finding dependents: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Tool 8: find_usage_examples
 *
 * Find real-world usage examples of an API.
 * Prioritizes code that imports AND uses the API (not just type definitions).
 */
export async function findUsageExamples(
  searchService: SearchService,
  args: {
    api_name: string;
    limit?: number;
  }
): Promise<ToolResult> {
  try {
    const limit = args.limit ?? 10;
    const allChunks = searchService.getAllChunks();
    const apiNameLower = args.api_name.toLowerCase();

    interface ScoredChunk {
      chunk: Chunk;
      score: number;
    }

    const examples: ScoredChunk[] = [];

    for (const chunk of allChunks) {
      let score = 0;

      // Check if imports the API
      const importsApi = toArray(chunk.metadata.imports).some(imp =>
        imp.toLowerCase().includes(apiNameLower)
      );

      // Check if calls the API
      const callsApi = toArray(chunk.metadata.calls).some(call =>
        call.toLowerCase().includes(apiNameLower)
      );

      // Check if extends/implements the API
      const extendsApi = toArray(chunk.metadata.extends).some(ext =>
        ext.toLowerCase().includes(apiNameLower)
      );
      const implementsApi = toArray(chunk.metadata.implements).some(impl =>
        impl.toLowerCase().includes(apiNameLower)
      );

      // Check if mentioned in code content
      const mentionedInCode = chunk.content.toLowerCase().includes(apiNameLower);

      // Scoring:
      // - Imports + calls = 10 (actual usage)
      // - Imports + extends/implements = 8 (inheritance usage)
      // - Just imports = 3 (potential usage)
      // - Mentioned in code = +2
      // - Not a type definition = +3

      if (importsApi && callsApi) {score += 10;}
      else if (importsApi && (extendsApi || implementsApi)) {score += 8;}
      else if (importsApi) {score += 3;}

      if (mentionedInCode) {score += 2;}

      // Prefer actual code over type definitions
      if (chunk.metadata.chunk_type === 'class' || chunk.metadata.chunk_type === 'function') {
        score += 3;
      }

      // Avoid pure type definitions
      if (chunk.metadata.chunk_type === 'type' || chunk.metadata.chunk_type === 'interface') {
        score -= 2;
      }

      if (score > 0) {
        examples.push({ chunk, score });
      }
    }

    // Sort by score (highest first)
    examples.sort((a, b) => b.score - a.score);

    // Take top N
    const topExamples = examples.slice(0, limit);

    if (topExamples.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No usage examples found for "${args.api_name}"`
        }]
      };
    }

    const output: string[] = [];
    output.push(`# Usage Examples: "${args.api_name}"`);
    output.push('');
    output.push(`Found ${topExamples.length} usage examples (ranked by relevance):`);
    output.push('');

    for (const example of topExamples) {
      output.push(formatChunk(example.chunk, example.score / 10)); // Normalize score to 0-1 range
      output.push('');
      output.push('---');
      output.push('');
    }

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error finding usage examples: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}
