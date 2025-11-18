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
} from "./tools/index.js";

// Create services
const searchService = new SearchService();
const fileService = new FileService();

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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_code":
        return (await searchCode(searchService, args as any)) as CallToolResult;

      case "find_by_relationship":
        return (await findByRelationship(
          searchService,
          args as any
        )) as CallToolResult;

      case "get_api_reference":
        return (await getApiReference(
          searchService,
          args as any
        )) as CallToolResult;

      case "get_file_content":
        return (await getFileContent(
          fileService,
          args as any
        )) as CallToolResult;

      case "list_ecs_components":
        return (await listEcsComponents(
          searchService,
          args as any
        )) as CallToolResult;

      case "list_ecs_systems":
        return (await listEcsSystems(
          searchService,
          args as any
        )) as CallToolResult;

      case "find_dependents":
        return (await findDependents(
          searchService,
          args as any
        )) as CallToolResult;

      case "find_usage_examples":
        return (await findUsageExamples(
          searchService,
          args as any
        )) as CallToolResult;

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        } as CallToolResult;
    }
  } catch (error) {
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

  // Initialize search service
  await searchService.initialize();

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("IWSDK RAG MCP Server is ready");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
