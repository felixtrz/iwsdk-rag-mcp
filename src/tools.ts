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
import type { TelemetryLogger, EventType, LogLevel, LogEntry } from './telemetry.js';

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
 * Format a chunk for display
 */
function formatChunk(chunk: Chunk, score?: number): string {
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

  // Code content
  lines.push('```typescript');
  lines.push(chunk.content);
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

  try {
    const results = await searchService.search(args.query, {
      limit: args.limit ?? 10,
      source_filter: args.source,
      min_score: args.min_score ?? 0.0
    });

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No results found for query: "${args.query}"`
        }]
      };
    }

    const output: string[] = [];
    output.push(`# Search Results for: "${args.query}"`);
    output.push('');
    output.push(`Found ${results.length} relevant code chunks:`);
    output.push('');

    for (const result of results) {
      output.push(formatChunk(result.chunk, result.score));
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

/**
 * Tool 9: get_telemetry
 *
 * Query telemetry data and session statistics.
 * Provides insights into how LLMs are using the MCP server.
 */
export async function getTelemetry(
  telemetry: TelemetryLogger,
  args: {
    query_type: 'current_session' | 'recent_logs' | 'aggregated_stats' | 'list_files';
    event_type?: EventType | EventType[];
    tool_name?: string;
    session_id?: string;
    since?: string;
    until?: string;
    level?: LogLevel | LogLevel[];
    limit?: number;
    current_session_only?: boolean;
  }
): Promise<ToolResult> {
  try {
    const output: string[] = [];

    switch (args.query_type) {
      case 'current_session': {
        const info = telemetry.getCurrentSessionInfo();
        output.push('# Current Session Information');
        output.push('');
        output.push(`**Session ID**: ${info.session_id}`);
        output.push(`**Started**: ${info.start_time}`);
        output.push(`**Uptime**: ${formatDuration(info.uptime_ms)}`);
        output.push(`**Log File**: ${info.log_file}`);
        output.push('');
        output.push('## Statistics');
        output.push('');
        output.push(`- **Total Tool Calls**: ${info.tool_calls}`);
        output.push(`- **Total Errors**: ${info.errors}`);
        output.push(`- **Total Processing Time**: ${formatDuration(info.total_processing_time_ms)}`);
        output.push('');

        if (Object.keys(info.tool_calls_by_name).length > 0) {
          output.push('## Tool Usage Breakdown');
          output.push('');
          output.push('| Tool | Calls |');
          output.push('|------|-------|');
          for (const [tool, count] of Object.entries(info.tool_calls_by_name)) {
            output.push(`| ${tool} | ${count} |`);
          }
        }
        break;
      }

      case 'recent_logs': {
        const entries = await telemetry.queryLogs({
          event_type: args.event_type,
          tool_name: args.tool_name,
          session_id: args.session_id,
          since: args.since,
          until: args.until,
          level: args.level,
          limit: args.limit ?? 50,
          include_current_session_only: args.current_session_only,
        });

        output.push('# Recent Log Entries');
        output.push('');
        output.push(`Found ${entries.length} entries matching filters.`);
        output.push('');

        for (const entry of entries) {
          output.push(formatLogEntry(entry));
          output.push('');
        }
        break;
      }

      case 'aggregated_stats': {
        const stats = await telemetry.getAggregatedStats({
          since: args.since,
          until: args.until,
          session_id: args.session_id,
        });

        output.push('# Aggregated Telemetry Statistics');
        output.push('');
        output.push('## Overview');
        output.push('');
        output.push(`- **Total Sessions**: ${stats.total_sessions}`);
        output.push(`- **Total Tool Calls**: ${stats.total_tool_calls}`);
        output.push(`- **Total Errors**: ${stats.total_errors}`);
        output.push('');

        if (Object.keys(stats.tool_usage).length > 0) {
          output.push('## Tool Performance');
          output.push('');
          output.push('| Tool | Calls | Avg Duration | Errors |');
          output.push('|------|-------|--------------|--------|');
          for (const [tool, data] of Object.entries(stats.tool_usage)) {
            output.push(`| ${tool} | ${data.count} | ${data.avg_duration_ms}ms | ${data.error_count} |`);
          }
          output.push('');
        }

        if (stats.sessions.length > 0) {
          output.push('## Recent Sessions');
          output.push('');
          output.push('| Session ID | Started | Tool Calls | Errors |');
          output.push('|------------|---------|------------|--------|');
          for (const session of stats.sessions) {
            const shortId = session.session_id.substring(0, 12) + '...';
            output.push(`| ${shortId} | ${session.start_time.split('T')[0]} | ${session.tool_calls} | ${session.errors} |`);
          }
        }
        break;
      }

      case 'list_files': {
        const files = await telemetry.listLogFiles();

        output.push('# Telemetry Log Files');
        output.push('');
        output.push(`**Log Directory**: ${telemetry.getLogDirectory()}`);
        output.push('');

        if (files.length === 0) {
          output.push('No log files found.');
        } else {
          output.push('| Filename | Size | Last Modified |');
          output.push('|----------|------|---------------|');
          for (const file of files) {
            const sizeKb = (file.size_bytes / 1024).toFixed(1);
            output.push(`| ${file.filename} | ${sizeKb} KB | ${file.modified.split('T')[0]} |`);
          }
        }
        break;
      }

      default:
        return {
          content: [{
            type: 'text',
            text: `Unknown query type: ${args.query_type}. Valid types: current_session, recent_logs, aggregated_stats, list_files`
          }],
          isError: true
        };
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
        text: `Error querying telemetry: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format a log entry for display
 */
function formatLogEntry(entry: LogEntry): string {
  const lines: string[] = [];
  const { timestamp, event_type: eventType, level, session_id } = entry;

  lines.push(`### [${level.toUpperCase()}] ${eventType} @ ${timestamp}`);

  // Use type narrowing via event_type discriminant
  if (entry.event_type === 'tool_request') {
    lines.push(`- **Tool**: ${entry.tool_name}`);
    lines.push(`- **Request ID**: ${entry.request_id}`);
    lines.push(`- **Args**: ${entry.argument_summary}`);
  } else if (entry.event_type === 'tool_response') {
    lines.push(`- **Tool**: ${entry.tool_name}`);
    lines.push(`- **Duration**: ${entry.duration_ms}ms`);
    lines.push(`- **Success**: ${entry.success}`);
    lines.push(`- **Result Size**: ${entry.result_size_bytes} bytes`);
  } else if (entry.event_type === 'tool_error') {
    lines.push(`- **Tool**: ${entry.tool_name}`);
    lines.push(`- **Duration**: ${entry.duration_ms}ms`);
    lines.push(`- **Error**: ${entry.error_message}`);
  } else if (entry.event_type === 'session_start') {
    lines.push(`- **Session**: ${session_id}`);
    lines.push(`- **Server Version**: ${entry.server_version}`);
    lines.push(`- **Platform**: ${entry.platform}`);
  } else if (entry.event_type === 'session_end') {
    lines.push(`- **Duration**: ${formatDuration(entry.duration_ms)}`);
    lines.push(`- **Tool Calls**: ${entry.total_tool_calls}`);
    lines.push(`- **Errors**: ${entry.total_errors}`);
  } else if (entry.event_type === 'service_init') {
    lines.push(`- **Service**: ${entry.service_name}`);
    lines.push(`- **Duration**: ${entry.duration_ms}ms`);
    lines.push(`- **Success**: ${entry.success}`);
  } else if (entry.event_type === 'system_error') {
    lines.push(`- **Error**: ${entry.error_message}`);
    if (entry.context) {
      lines.push(`- **Context**: ${JSON.stringify(entry.context)}`);
    }
  } else {
    // Generic formatting for other event types
    for (const [key, value] of Object.entries(entry)) {
      if (!['timestamp', 'event_type', 'level', 'session_id'].includes(key)) {
        lines.push(`- **${key}**: ${JSON.stringify(value)}`);
      }
    }
  }

  return lines.join('\n');
}
