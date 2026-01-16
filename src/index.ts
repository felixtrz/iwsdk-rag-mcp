#!/usr/bin/env node

/**
 * IWSDK RAG MCP Server
 *
 * A Model Context Protocol server for IWSDK code search and API reference.
 * Provides semantic search, relationship queries, and API lookups for IWSDK,
 * elics ECS library, and related dependencies (Three.js, WebXR).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FileService } from "./files.js";
import { SearchService } from "./search.js";
import {
  searchCode,
  findByRelationship,
  getApiReference,
  getFileContent,
  listEcsComponents,
  listEcsSystems,
  findDependents,
  findUsageExamples,
  getTelemetry,
} from "./tools.js";
import {
  TelemetryLogger,
  initializeTelemetry,
  shutdownTelemetry,
} from "./telemetry.js";

// Create services
const searchService = new SearchService();
const fileService = new FileService();

// Initialize telemetry logger
const telemetry: TelemetryLogger = initializeTelemetry({
  enabled: process.env.MCP_TELEMETRY_ENABLED !== "false",
  log_level: (process.env.MCP_TELEMETRY_LEVEL as "debug" | "info" | "warn" | "error") || "info",
});

// Create MCP server
const server = new Server(
  {
    name: "iwsdk-rag-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_code",
        description:
          "Semantic search across IWSDK, elics, and dependency code. Best for finding relevant code by description, use case, or functionality. Returns code chunks ranked by relevance.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                'Natural language search query (e.g., "how to create a VR session", "XR controller input handling")',
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return (default: 10)",
              default: 10,
            },
            source: {
              type: "array",
              items: { type: "string" },
              description:
                'Filter by source: ["iwsdk", "elics", "deps"]. Omit to search all sources.',
            },
            min_score: {
              type: "number",
              description: "Minimum similarity score (0.0-1.0, default: 0.0)",
              default: 0.0,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "find_by_relationship",
        description:
          "Find code by structural relationships. Use this to find all classes that extend/implement something, code that imports/calls specific functions, or uses WebXR APIs.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "extends",
                "implements",
                "imports",
                "calls",
                "uses_webxr_api",
              ],
              description: "Relationship type to search for",
            },
            target: {
              type: "string",
              description:
                'The target to search for (e.g., "Component" for extends, "XRSession" for uses_webxr_api)',
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return (default: 20)",
              default: 20,
            },
          },
          required: ["type", "target"],
        },
      },
      {
        name: "get_api_reference",
        description:
          "Quick lookup of API by name. Use this when you know the class/function/interface name and want to see its implementation and documentation.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Name of the class, function, interface, or type to look up",
            },
            type: {
              type: "string",
              enum: ["class", "function", "interface", "type"],
              description: "Filter by chunk type (optional)",
            },
            source: {
              type: "array",
              items: { type: "string" },
              description:
                'Filter by source: ["iwsdk", "elics", "deps"]. Omit to search all sources.',
            },
          },
          required: ["name"],
        },
      },
      {
        name: "get_file_content",
        description:
          "Read the full content of a source file. Useful for seeing complete file context beyond code snippets.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                'Relative path to the file (e.g., "src/core/engine.ts")',
            },
            source: {
              type: "string",
              enum: ["iwsdk", "elics", "deps"],
              description: "Source of the file",
            },
            start_line: {
              type: "number",
              description: "Optional starting line number (1-indexed)",
            },
            end_line: {
              type: "number",
              description: "Optional ending line number",
            },
          },
          required: ["file_path", "source"],
        },
      },
      {
        name: "list_ecs_components",
        description:
          "List all ECS (Entity Component System) components in the codebase.",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "array",
              items: { type: "string" },
              description:
                'Filter by source: ["iwsdk", "elics"]. Omit to list all.',
            },
            limit: {
              type: "number",
              description:
                "Maximum number of components to return (default: 100)",
              default: 100,
            },
          },
        },
      },
      {
        name: "list_ecs_systems",
        description:
          "List all ECS (Entity Component System) systems in the codebase.",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "array",
              items: { type: "string" },
              description:
                'Filter by source: ["iwsdk", "elics"]. Omit to list all.',
            },
            limit: {
              type: "number",
              description: "Maximum number of systems to return (default: 100)",
              default: 100,
            },
          },
        },
      },
      {
        name: "find_dependents",
        description:
          'Find code that depends on a given API (reverse dependency lookup). Answers "what uses this API?"',
        inputSchema: {
          type: "object",
          properties: {
            api_name: {
              type: "string",
              description: "Name of the API to find dependents for",
            },
            dependency_type: {
              type: "string",
              enum: ["imports", "calls", "extends", "implements", "any"],
              description: 'Type of dependency to search for (default: "any")',
              default: "any",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of dependents to return (default: 20)",
              default: 20,
            },
          },
          required: ["api_name"],
        },
      },
      {
        name: "find_usage_examples",
        description:
          "Find real-world usage examples of an API. Prioritizes code that actually imports and uses the API, not just type definitions. Perfect for understanding how to use a specific API.",
        inputSchema: {
          type: "object",
          properties: {
            api_name: {
              type: "string",
              description:
                'Name of the API to find usage examples for (e.g., "Component", "createComponent", "XRSession")',
            },
            limit: {
              type: "number",
              description: "Maximum number of examples to return (default: 10)",
              default: 10,
            },
          },
          required: ["api_name"],
        },
      },
      {
        name: "get_telemetry",
        description:
          "Query telemetry data and session statistics. Provides insights into MCP server usage, tool performance, and session history.",
        inputSchema: {
          type: "object",
          properties: {
            query_type: {
              type: "string",
              enum: ["current_session", "recent_logs", "aggregated_stats", "list_files"],
              description:
                "Type of telemetry query: 'current_session' for live stats, 'recent_logs' for log entries, 'aggregated_stats' for historical analysis, 'list_files' to see available log files",
            },
            event_type: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "session_start",
                  "session_end",
                  "tool_request",
                  "tool_response",
                  "tool_error",
                  "service_init",
                  "system_error",
                ],
              },
              description: "Filter by event type(s) - only for recent_logs query",
            },
            tool_name: {
              type: "string",
              description: "Filter by specific tool name - only for recent_logs query",
            },
            level: {
              type: "array",
              items: {
                type: "string",
                enum: ["debug", "info", "warn", "error"],
              },
              description: "Filter by log level(s) - only for recent_logs query",
            },
            since: {
              type: "string",
              description: "Filter entries after this ISO timestamp",
            },
            until: {
              type: "string",
              description: "Filter entries before this ISO timestamp",
            },
            limit: {
              type: "number",
              description: "Maximum number of log entries to return (default: 50)",
              default: 50,
            },
            current_session_only: {
              type: "boolean",
              description: "Only include entries from the current session (default: false)",
              default: false,
            },
          },
          required: ["query_type"],
        },
      },
    ],
  };
});

// Handle tool calls with telemetry
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const requestId = telemetry.generateRequestId();
  const startTime = Date.now();

  // Log the incoming request
  await telemetry.logToolRequest(
    requestId,
    name,
    (args as Record<string, unknown>) || {}
  );

  try {
    let result: CallToolResult;

    switch (name) {
      case "search_code":
        result = (await searchCode(searchService, args as any)) as CallToolResult;
        break;

      case "find_by_relationship":
        result = (await findByRelationship(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "get_api_reference":
        result = (await getApiReference(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "get_file_content":
        result = (await getFileContent(
          fileService,
          args as any
        )) as CallToolResult;
        break;

      case "list_ecs_components":
        result = (await listEcsComponents(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "list_ecs_systems":
        result = (await listEcsSystems(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "find_dependents":
        result = (await findDependents(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "find_usage_examples":
        result = (await findUsageExamples(
          searchService,
          args as any
        )) as CallToolResult;
        break;

      case "get_telemetry":
        result = (await getTelemetry(
          telemetry,
          args as any
        )) as CallToolResult;
        break;

      default:
        result = {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        } as CallToolResult;
    }

    // Log the successful response
    const durationMs = Date.now() - startTime;
    await telemetry.logToolResponse(
      requestId,
      name,
      durationMs,
      result as { content: Array<{ type: string; text?: string }>; isError?: boolean }
    );

    return result;
  } catch (error) {
    // Log the error
    const durationMs = Date.now() - startTime;
    await telemetry.logToolError(requestId, name, error, durationMs);

    return {
      content: [
        {
          type: "text",
          text: `Error executing tool ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    } as CallToolResult;
  }
});

// Main function
async function main() {
  console.error("Starting IWSDK RAG MCP Server...");

  // Initialize telemetry
  let telemetryInitStart = Date.now();
  try {
    await telemetry.initialize();
    await telemetry.logServiceInit(
      "TelemetryLogger",
      Date.now() - telemetryInitStart,
      true,
      { log_file: telemetry.getLogFilePath() }
    );
    console.error(`Telemetry logging to: ${telemetry.getLogFilePath()}`);
  } catch (error) {
    console.error("Failed to initialize telemetry:", error);
    // Continue without telemetry
  }

  // Initialize search service
  const searchInitStart = Date.now();
  try {
    await searchService.initialize();
    await telemetry.logServiceInit(
      "SearchService",
      Date.now() - searchInitStart,
      true,
      { chunks_loaded: searchService.getChunkCount() }
    );
  } catch (error) {
    await telemetry.logServiceInit(
      "SearchService",
      Date.now() - searchInitStart,
      false,
      { error: error instanceof Error ? error.message : String(error) }
    );
    throw error;
  }

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("IWSDK RAG MCP Server is ready");
  console.error(`Session ID: ${telemetry.getSessionId()}`);

  // Handle graceful shutdown
  const handleShutdown = async () => {
    console.error("Shutting down...");
    const stats = telemetry.getStats();
    console.error(
      `Session stats: ${stats.toolCalls} tool calls, ${stats.errors} errors`
    );
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await telemetry.logSystemError(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
    { context: "main" }
  );
  await shutdownTelemetry();
  process.exit(1);
});
