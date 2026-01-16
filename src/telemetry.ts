/**
 * Telemetry Logging System for IWSDK RAG MCP Server
 *
 * Provides comprehensive logging of LLM interactions with the MCP server.
 * Logs are saved in JSON Lines format for easy parsing and analysis.
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types & Interfaces
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export type EventType =
  | "session_start"
  | "session_end"
  | "tool_request"
  | "tool_response"
  | "tool_error"
  | "service_init"
  | "embedding_query"
  | "search_query"
  | "system_error";

export interface BaseLogEntry {
  timestamp: string;
  session_id: string;
  event_type: EventType;
  level: LogLevel;
}

export interface SessionStartEntry extends BaseLogEntry {
  event_type: "session_start";
  server_version: string;
  node_version: string;
  platform: string;
}

export interface SessionEndEntry extends BaseLogEntry {
  event_type: "session_end";
  duration_ms: number;
  total_tool_calls: number;
  total_errors: number;
}

export interface ToolRequestEntry extends BaseLogEntry {
  event_type: "tool_request";
  request_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  argument_summary: string;
}

export interface ToolResponseEntry extends BaseLogEntry {
  event_type: "tool_response";
  request_id: string;
  tool_name: string;
  duration_ms: number;
  success: boolean;
  result_size_bytes: number;
  result_preview?: string;
  results_count?: number;
}

export interface ToolErrorEntry extends BaseLogEntry {
  event_type: "tool_error";
  request_id: string;
  tool_name: string;
  error_message: string;
  error_stack?: string;
  duration_ms: number;
}

export interface ServiceInitEntry extends BaseLogEntry {
  event_type: "service_init";
  service_name: string;
  duration_ms: number;
  success: boolean;
  details?: Record<string, unknown>;
}

export interface EmbeddingQueryEntry extends BaseLogEntry {
  event_type: "embedding_query";
  request_id: string;
  query_text: string;
  embedding_duration_ms: number;
}

export interface SearchQueryEntry extends BaseLogEntry {
  event_type: "search_query";
  request_id: string;
  query_type: "semantic" | "relationship" | "name_lookup" | "ecs_query";
  query_params: Record<string, unknown>;
  results_count: number;
  search_duration_ms: number;
}

export interface SystemErrorEntry extends BaseLogEntry {
  event_type: "system_error";
  error_message: string;
  error_stack?: string;
  context?: Record<string, unknown>;
}

export type LogEntry =
  | SessionStartEntry
  | SessionEndEntry
  | ToolRequestEntry
  | ToolResponseEntry
  | ToolErrorEntry
  | ServiceInitEntry
  | EmbeddingQueryEntry
  | SearchQueryEntry
  | SystemErrorEntry;

export interface TelemetryConfig {
  enabled: boolean;
  log_directory: string;
  log_file_prefix: string;
  max_file_size_mb: number;
  max_files: number;
  log_level: LogLevel;
  include_arguments: boolean;
  include_result_preview: boolean;
  result_preview_max_length: number;
}

export interface SessionStats {
  startTime: Date;
  toolCalls: number;
  errors: number;
  toolCallsByName: Map<string, number>;
  totalDuration: number;
}

// ============================================================================
// TelemetryLogger Class
// ============================================================================

export class TelemetryLogger {
  private config: TelemetryConfig;
  private sessionId: string;
  private currentLogFile: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private sessionStats: SessionStats;
  private requestCounter: number = 0;
  private logLevelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config?: Partial<TelemetryConfig>) {
    this.config = {
      enabled: true,
      log_directory: this.getDefaultLogDirectory(),
      log_file_prefix: "mcp-telemetry",
      max_file_size_mb: 10,
      max_files: 10,
      log_level: "info",
      include_arguments: true,
      include_result_preview: true,
      result_preview_max_length: 500,
      ...config,
    };

    this.sessionId = this.generateSessionId();
    this.sessionStats = {
      startTime: new Date(),
      toolCalls: 0,
      errors: 0,
      toolCallsByName: new Map(),
      totalDuration: 0,
    };
  }

  // --------------------------------------------------------------------------
  // Initialization & Lifecycle
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Ensure log directory exists
    await this.ensureLogDirectory();

    // Rotate logs if needed
    await this.rotateLogsIfNeeded();

    // Open log file
    this.currentLogFile = this.getLogFilePath();
    this.writeStream = fs.createWriteStream(this.currentLogFile, {
      flags: "a",
    });

    // Log session start
    await this.logSessionStart();
  }

  async shutdown(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Log session end
    await this.logSessionEnd();

    // Close write stream
    if (this.writeStream) {
      await new Promise<void>((resolve, reject) => {
        this.writeStream!.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.writeStream = null;
    }
  }

  // --------------------------------------------------------------------------
  // Public Logging Methods
  // --------------------------------------------------------------------------

  generateRequestId(): string {
    this.requestCounter++;
    return `${this.sessionId}-${this.requestCounter.toString().padStart(6, "0")}`;
  }

  async logToolRequest(
    requestId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    this.sessionStats.toolCalls++;
    const count = this.sessionStats.toolCallsByName.get(toolName) || 0;
    this.sessionStats.toolCallsByName.set(toolName, count + 1);

    const entry: ToolRequestEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "tool_request",
      level: "info",
      request_id: requestId,
      tool_name: toolName,
      arguments: this.config.include_arguments ? args : {},
      argument_summary: this.summarizeArguments(toolName, args),
    };

    await this.writeEntry(entry);
  }

  async logToolResponse(
    requestId: string,
    toolName: string,
    durationMs: number,
    result: { content: Array<{ type: string; text?: string }>; isError?: boolean },
    resultsCount?: number
  ): Promise<void> {
    this.sessionStats.totalDuration += durationMs;

    const resultText = result.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");

    const entry: ToolResponseEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "tool_response",
      level: result.isError ? "warn" : "info",
      request_id: requestId,
      tool_name: toolName,
      duration_ms: durationMs,
      success: !result.isError,
      result_size_bytes: Buffer.byteLength(resultText, "utf8"),
      result_preview: this.config.include_result_preview
        ? this.truncateText(resultText, this.config.result_preview_max_length)
        : undefined,
      results_count: resultsCount,
    };

    await this.writeEntry(entry);
  }

  async logToolError(
    requestId: string,
    toolName: string,
    error: Error | unknown,
    durationMs: number
  ): Promise<void> {
    this.sessionStats.errors++;

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    const entry: ToolErrorEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "tool_error",
      level: "error",
      request_id: requestId,
      tool_name: toolName,
      error_message: errorMessage,
      error_stack: errorStack,
      duration_ms: durationMs,
    };

    await this.writeEntry(entry);
  }

  async logServiceInit(
    serviceName: string,
    durationMs: number,
    success: boolean,
    details?: Record<string, unknown>
  ): Promise<void> {
    const entry: ServiceInitEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "service_init",
      level: success ? "info" : "error",
      service_name: serviceName,
      duration_ms: durationMs,
      success,
      details,
    };

    await this.writeEntry(entry);
  }

  async logEmbeddingQuery(
    requestId: string,
    queryText: string,
    durationMs: number
  ): Promise<void> {
    const entry: EmbeddingQueryEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "embedding_query",
      level: "debug",
      request_id: requestId,
      query_text: this.truncateText(queryText, 200),
      embedding_duration_ms: durationMs,
    };

    await this.writeEntry(entry);
  }

  async logSearchQuery(
    requestId: string,
    queryType: "semantic" | "relationship" | "name_lookup" | "ecs_query",
    queryParams: Record<string, unknown>,
    resultsCount: number,
    durationMs: number
  ): Promise<void> {
    const entry: SearchQueryEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "search_query",
      level: "debug",
      request_id: requestId,
      query_type: queryType,
      query_params: queryParams,
      results_count: resultsCount,
      search_duration_ms: durationMs,
    };

    await this.writeEntry(entry);
  }

  async logSystemError(
    errorMessage: string,
    errorStack?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    this.sessionStats.errors++;

    const entry: SystemErrorEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "system_error",
      level: "error",
      error_message: errorMessage,
      error_stack: errorStack,
      context,
    };

    await this.writeEntry(entry);
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  getSessionId(): string {
    return this.sessionId;
  }

  getStats(): SessionStats {
    return { ...this.sessionStats };
  }

  getLogFilePath(): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(
      this.config.log_directory,
      `${this.config.log_file_prefix}-${date}.jsonl`
    );
  }

  getLogDirectory(): string {
    return this.config.log_directory;
  }

  // --------------------------------------------------------------------------
  // Query Methods (for MCP tool access)
  // --------------------------------------------------------------------------

  /**
   * Get current session information and statistics
   */
  getCurrentSessionInfo(): {
    session_id: string;
    start_time: string;
    uptime_ms: number;
    tool_calls: number;
    errors: number;
    tool_calls_by_name: Record<string, number>;
    total_processing_time_ms: number;
    log_file: string;
  } {
    const uptimeMs = Date.now() - this.sessionStats.startTime.getTime();
    const toolCallsByName: Record<string, number> = {};
    this.sessionStats.toolCallsByName.forEach((count, name) => {
      toolCallsByName[name] = count;
    });

    return {
      session_id: this.sessionId,
      start_time: this.sessionStats.startTime.toISOString(),
      uptime_ms: uptimeMs,
      tool_calls: this.sessionStats.toolCalls,
      errors: this.sessionStats.errors,
      tool_calls_by_name: toolCallsByName,
      total_processing_time_ms: this.sessionStats.totalDuration,
      log_file: this.currentLogFile || this.getLogFilePath(),
    };
  }

  /**
   * List available log files
   */
  async listLogFiles(): Promise<Array<{ filename: string; size_bytes: number; modified: string }>> {
    try {
      const files = await fs.promises.readdir(this.config.log_directory);
      const logFiles = files.filter(
        (f) => f.startsWith(this.config.log_file_prefix) && f.endsWith(".jsonl")
      );

      const fileInfos = await Promise.all(
        logFiles.map(async (filename) => {
          const filePath = path.join(this.config.log_directory, filename);
          const stats = await fs.promises.stat(filePath);
          return {
            filename,
            size_bytes: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
      );

      return fileInfos.sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
      return [];
    }
  }

  /**
   * Query log entries with filtering options
   */
  async queryLogs(options: {
    event_type?: EventType | EventType[];
    tool_name?: string;
    session_id?: string;
    since?: string;
    until?: string;
    level?: LogLevel | LogLevel[];
    limit?: number;
    include_current_session_only?: boolean;
  } = {}): Promise<LogEntry[]> {
    const limit = options.limit ?? 100;
    const results: LogEntry[] = [];

    // Determine which log files to read
    const logFiles = await this.listLogFiles();
    if (logFiles.length === 0) {
      return [];
    }

    // Read log files (most recent first)
    for (const fileInfo of logFiles) {
      if (results.length >= limit) break;

      const filePath = path.join(this.config.log_directory, fileInfo.filename);
      try {
        const content = await fs.promises.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        // Parse lines in reverse order (most recent first)
        for (let i = lines.length - 1; i >= 0; i--) {
          if (results.length >= limit) break;

          try {
            const entry = JSON.parse(lines[i]) as LogEntry;

            // Apply filters
            if (!this.matchesFilter(entry, options)) continue;

            results.push(entry);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Get aggregated statistics from logs
   */
  async getAggregatedStats(options: {
    since?: string;
    until?: string;
    session_id?: string;
  } = {}): Promise<{
    total_sessions: number;
    total_tool_calls: number;
    total_errors: number;
    tool_usage: Record<string, { count: number; total_duration_ms: number; avg_duration_ms: number; error_count: number }>;
    sessions: Array<{ session_id: string; start_time: string; tool_calls: number; errors: number }>;
  }> {
    const entries = await this.queryLogs({
      ...options,
      limit: 10000, // Get more entries for aggregation
    });

    const sessions = new Map<string, { start_time: string; tool_calls: number; errors: number }>();
    const toolUsage = new Map<string, { count: number; total_duration_ms: number; error_count: number }>();

    for (const entry of entries) {
      // Track sessions
      if (entry.event_type === "session_start") {
        if (!sessions.has(entry.session_id)) {
          sessions.set(entry.session_id, {
            start_time: entry.timestamp,
            tool_calls: 0,
            errors: 0,
          });
        }
      }

      // Track tool usage
      if (entry.event_type === "tool_response") {
        const toolEntry = entry as ToolResponseEntry;
        const existing = toolUsage.get(toolEntry.tool_name) || {
          count: 0,
          total_duration_ms: 0,
          error_count: 0,
        };
        existing.count++;
        existing.total_duration_ms += toolEntry.duration_ms;
        if (!toolEntry.success) existing.error_count++;
        toolUsage.set(toolEntry.tool_name, existing);

        // Update session stats
        const session = sessions.get(entry.session_id);
        if (session) {
          session.tool_calls++;
          if (!toolEntry.success) session.errors++;
        }
      }

      if (entry.event_type === "tool_error") {
        const toolEntry = entry as ToolErrorEntry;
        const existing = toolUsage.get(toolEntry.tool_name) || {
          count: 0,
          total_duration_ms: 0,
          error_count: 0,
        };
        existing.error_count++;
        toolUsage.set(toolEntry.tool_name, existing);

        const session = sessions.get(entry.session_id);
        if (session) session.errors++;
      }
    }

    // Calculate averages and format output
    const toolUsageOutput: Record<string, { count: number; total_duration_ms: number; avg_duration_ms: number; error_count: number }> = {};
    toolUsage.forEach((stats, name) => {
      toolUsageOutput[name] = {
        ...stats,
        avg_duration_ms: stats.count > 0 ? Math.round(stats.total_duration_ms / stats.count) : 0,
      };
    });

    const sessionsArray = Array.from(sessions.entries()).map(([id, data]) => ({
      session_id: id,
      ...data,
    }));

    return {
      total_sessions: sessions.size,
      total_tool_calls: Array.from(toolUsage.values()).reduce((sum, t) => sum + t.count, 0),
      total_errors: Array.from(toolUsage.values()).reduce((sum, t) => sum + t.error_count, 0),
      tool_usage: toolUsageOutput,
      sessions: sessionsArray.slice(0, 20), // Limit sessions in output
    };
  }

  private matchesFilter(entry: LogEntry, options: {
    event_type?: EventType | EventType[];
    tool_name?: string;
    session_id?: string;
    since?: string;
    until?: string;
    level?: LogLevel | LogLevel[];
    include_current_session_only?: boolean;
  }): boolean {
    // Filter by current session
    if (options.include_current_session_only && entry.session_id !== this.sessionId) {
      return false;
    }

    // Filter by session_id
    if (options.session_id && entry.session_id !== options.session_id) {
      return false;
    }

    // Filter by event type
    if (options.event_type) {
      const types = Array.isArray(options.event_type) ? options.event_type : [options.event_type];
      if (!types.includes(entry.event_type)) return false;
    }

    // Filter by level
    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      if (!levels.includes(entry.level)) return false;
    }

    // Filter by tool name (for tool-related events)
    if (options.tool_name) {
      if ("tool_name" in entry && entry.tool_name !== options.tool_name) {
        return false;
      }
    }

    // Filter by time range
    if (options.since && entry.timestamp < options.since) return false;
    if (options.until && entry.timestamp > options.until) return false;

    return true;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private async logSessionStart(): Promise<void> {
    const entry: SessionStartEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "session_start",
      level: "info",
      server_version: "0.1.0",
      node_version: process.version,
      platform: process.platform,
    };

    await this.writeEntry(entry);
  }

  private async logSessionEnd(): Promise<void> {
    const durationMs = Date.now() - this.sessionStats.startTime.getTime();

    const entry: SessionEndEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      event_type: "session_end",
      level: "info",
      duration_ms: durationMs,
      total_tool_calls: this.sessionStats.toolCalls,
      total_errors: this.sessionStats.errors,
    };

    await this.writeEntry(entry);
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Check log level
    if (
      this.logLevelPriority[entry.level] <
      this.logLevelPriority[this.config.log_level]
    ) {
      return;
    }

    // Check file size and rotate if needed
    await this.rotateLogsIfNeeded();

    const line = JSON.stringify(entry) + "\n";

    if (this.writeStream) {
      await new Promise<void>((resolve, reject) => {
        this.writeStream!.write(line, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  private getDefaultLogDirectory(): string {
    // Use XDG data directory on Linux, or fallback to ~/.local/share
    const xdgData = process.env.XDG_DATA_HOME;
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";

    const baseDir =
      xdgData || path.join(homeDir, ".local", "share");
    return path.join(baseDir, "iwsdk-rag-mcp", "logs");
  }

  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.promises.mkdir(this.config.log_directory, { recursive: true });
    } catch (error) {
      // Directory might already exist
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  private async rotateLogsIfNeeded(): Promise<void> {
    if (!this.currentLogFile) {
      return;
    }

    try {
      const stats = await fs.promises.stat(this.currentLogFile);
      const fileSizeMb = stats.size / (1024 * 1024);

      if (fileSizeMb >= this.config.max_file_size_mb) {
        // Close current stream
        if (this.writeStream) {
          await new Promise<void>((resolve) => {
            this.writeStream!.end(() => resolve());
          });
        }

        // Rename current file with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedPath = this.currentLogFile.replace(
          ".jsonl",
          `-${timestamp}.jsonl`
        );
        await fs.promises.rename(this.currentLogFile, rotatedPath);

        // Clean up old log files
        await this.cleanupOldLogs();

        // Open new stream
        this.writeStream = fs.createWriteStream(this.currentLogFile, {
          flags: "a",
        });
      }
    } catch {
      // File might not exist yet, which is fine
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.config.log_directory);
      const logFiles = files
        .filter((f) => f.startsWith(this.config.log_file_prefix) && f.endsWith(".jsonl"))
        .sort()
        .reverse();

      // Remove files beyond max_files limit
      for (let i = this.config.max_files; i < logFiles.length; i++) {
        const filePath = path.join(this.config.log_directory, logFiles[i]);
        await fs.promises.unlink(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private summarizeArguments(
    toolName: string,
    args: Record<string, unknown>
  ): string {
    switch (toolName) {
      case "search_code":
        return `query="${args.query}", limit=${args.limit || 10}`;
      case "find_by_relationship":
        return `type="${args.type}", target="${args.target}"`;
      case "get_api_reference":
        return `name="${args.name}", type=${args.type || "any"}`;
      case "get_file_content":
        return `file="${args.file_path}", source="${args.source}"`;
      case "list_ecs_components":
      case "list_ecs_systems":
        return `source=${JSON.stringify(args.source)}, limit=${args.limit || 100}`;
      case "find_dependents":
        return `api="${args.api_name}", type="${args.dependency_type || "any"}"`;
      case "find_usage_examples":
        return `api="${args.api_name}", limit=${args.limit || 10}`;
      default:
        return JSON.stringify(args).substring(0, 100);
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }
}

// ============================================================================
// Singleton Instance & Helper Functions
// ============================================================================

let telemetryInstance: TelemetryLogger | null = null;

export function initializeTelemetry(
  config?: Partial<TelemetryConfig>
): TelemetryLogger {
  telemetryInstance = new TelemetryLogger(config);
  return telemetryInstance;
}

export function getTelemetry(): TelemetryLogger | null {
  return telemetryInstance;
}

export async function shutdownTelemetry(): Promise<void> {
  if (telemetryInstance) {
    await telemetryInstance.shutdown();
    telemetryInstance = null;
  }
}
