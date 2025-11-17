# IWSDK RAG MCP Server

TypeScript-based Model Context Protocol (MCP) server that provides semantic code search across the Immersive Web SDK using RAG (Retrieval-Augmented Generation) with vector embeddings.

[![npm version](https://badge.fury.io/js/@felixtz%2Fiwsdk-rag-mcp.svg)](https://www.npmjs.com/package/@felixtz/iwsdk-rag-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This MCP server exposes 8 specialized tools for AI assistants to search and understand IWSDK code:

1. **`search_code`** - Semantic search across all code
2. **`find_by_relationship`** - Find code by relationships (extends, implements, imports, calls)
3. **`get_api_reference`** - Look up specific APIs by name
4. **`get_file_content`** - Retrieve complete file contents
5. **`list_ecs_components`** - List all ECS components (27 components)
6. **`list_ecs_systems`** - List all ECS systems (17 systems)
7. **`find_dependents`** - Find code that depends on an API
8. **`find_usage_examples`** - Find real-world usage examples

### What's Indexed

- **173 IWSDK chunks** (27 ECS components, 17 systems)
- **3,164 dependency chunks** (Three.js, WebXR types)
- **3,337 total searchable chunks** with 768-dimensional embeddings
- **Embedding model**: sentence-transformers/all-mpnet-base-v2

## Installation

### Method 1: Install from npm/pnpm (Recommended)

```bash
# Using pnpm (recommended, matches IWSDK)
pnpm add -g @felixtz/iwsdk-rag-mcp

# Or using npm
npm install -g @felixtz/iwsdk-rag-mcp
```

Then add to Claude Code using the CLI (recommended):

```bash
# For user-level (available across all projects)
claude mcp add --transport stdio iwsdk-rag --scope user -- iwsdk-rag-mcp

# For project-level only
claude mcp add --transport stdio iwsdk-rag --scope local -- iwsdk-rag-mcp
```

Restart Claude Code, and the tools will be available!

### Method 2: Use with npx (No Installation)

```bash
# For user-level (available across all projects)
claude mcp add --transport stdio iwsdk-rag --scope user -- npx -y @felixtz/iwsdk-rag-mcp
```

### Method 3: Run from Source

```bash
# Clone and build
git clone https://github.com/felixtrz/iwsdk-rag-mcp.git
cd iwsdk-rag-mcp
pnpm install
pnpm run build

# Add to Claude Code
claude mcp add --transport stdio iwsdk-rag --scope user -- node /absolute/path/to/iwsdk-rag-mcp/dist/index.js
```

### For Claude Desktop

**Configuration file**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "iwsdk-rag": {
      "command": "iwsdk-rag-mcp"
    }
  }
}
```

Or with npx:

```json
{
  "mcpServers": {
    "iwsdk-rag": {
      "command": "npx",
      "args": ["-y", "@felixtz/iwsdk-rag-mcp"]
    }
  }
}
```

### Verify Installation

```bash
# List configured MCP servers
claude mcp list

# Should show:
# iwsdk-rag: iwsdk-rag-mcp - ✓ Connected
```

## Usage Examples

Once installed, try asking Claude:

- "List all ECS components in IWSDK"
- "Show me how to use AudioSource"
- "Find examples of hand tracking in the codebase"
- "What classes extend Component?"
- "Show me the TransformSystem implementation"

## Features

### Semantic Search
- **768-dimensional embeddings** using all-mpnet-base-v2
- **Offline search** - no external API calls required
- **Fast results** - all data loaded in memory

### Smart Pattern Detection
- **ECS Components**: Automatically detected via `createComponent()` pattern (27 found)
- **ECS Systems**: Detected via `extends createSystem()` pattern (17 found)
- **WebXR API Usage**: Tracks XRSession, XRFrame, XRInputSource usage (63 chunks)
- **Relationship Tracking**: extends, implements, imports, calls

### Complete Coverage
- IWSDK core packages (core, xr-input, locomotor, glxf)
- Three.js type definitions
- WebXR API types
- Full file content retrieval

## Repository Structure

```
iwsdk-rag/
├── src/                   # TypeScript source code
│   ├── index.ts          # MCP server entry point
│   ├── search.ts         # Vector search service
│   ├── embeddings.ts     # Query embedding & similarity
│   ├── files.ts          # File content retrieval
│   └── tools/            # 8 MCP tool implementations
├── dist/                  # Compiled JavaScript
├── data/                  # Vector database
│   ├── chunks.json       # Pre-computed embeddings (83MB)
│   ├── metadata.json     # Database metadata
│   └── sources/          # Source files for get_file_content
├── scripts/               # Development tools
│   └── ingest/           # Python ingestion pipeline
├── package.json           # Package configuration
├── pnpm-lock.yaml         # pnpm lockfile
├── tsconfig.json          # TypeScript configuration
└── README.md              # This file
```

## Development

### Building from Source

```bash
git clone https://github.com/felixtrz/iwsdk-rag-mcp.git
cd iwsdk-rag-mcp
pnpm install
pnpm run build
```

### Regenerating the Index

If you need to re-ingest the IWSDK codebase (e.g., after SDK updates):

```bash
cd scripts
./ingest.sh
```

This will run the Python ingestion pipeline to regenerate the vector database.

## How It Works

### Architecture

1. **Ingestion (Python)**: Parses TypeScript code using tree-sitter, chunks semantically, generates embeddings
2. **Storage**: Pre-computed embeddings stored in JSON (~83MB)
3. **MCP Server (TypeScript)**: Loads embeddings at startup, performs semantic search using transformers.js
4. **AI Assistant**: Uses MCP tools to search and understand the codebase

### Vector Search Flow

1. User query → Embedded using all-mpnet-base-v2
2. Cosine similarity computed against all code chunk embeddings
3. Results ranked by similarity score
4. Optional filtering by source, type, relationships

## Troubleshooting

### Tools not showing up

1. Check config file location and syntax
2. Verify package is installed: `pnpm list -g @felixtz/iwsdk-rag-mcp` or `npm list -g @felixtz/iwsdk-rag-mcp`
3. Restart Claude Desktop/Code completely

### Slow first load

- The embedding model (~420MB) downloads on first run
- Subsequent runs are faster (model is cached)

### High memory usage

- Normal - the server loads 83MB of embeddings into memory for fast search
- Minimum recommended RAM: 2GB available

## License

MIT License - Copyright (c) 2022 - present EliXR Games

## Links

- **npm Package**: https://www.npmjs.com/package/@felixtz/iwsdk-rag-mcp
- **GitHub**: https://github.com/felixtrz/iwsdk-rag-mcp
- **Issues**: https://github.com/felixtrz/iwsdk-rag-mcp/issues
- **Author**: Felix Zhang (https://github.com/felixtrz)
- **Sponsor**: https://github.com/sponsors/felixtrz

## Credits

- **Immersive Web SDK**: https://github.com/facebook/immersive-web-sdk
- **Model Context Protocol**: https://modelcontextprotocol.io
- **Embeddings**: sentence-transformers/all-mpnet-base-v2
