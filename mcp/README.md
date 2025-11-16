# IWSDK RAG MCP Server

TypeScript-based Model Context Protocol (MCP) server that provides semantic code search across the Immersive Web SDK.

## Overview

This MCP server exposes 8 tools for AI assistants to search and understand IWSDK code:
1. `search_code` - Semantic search across all code
2. `find_by_relationship` - Find code by relationships (extends, implements, imports, calls)
3. `get_api_reference` - Look up specific APIs by name
4. `get_file_content` - Retrieve complete file contents
5. `list_ecs_components` - List all ECS components
6. `list_ecs_systems` - List all ECS systems
7. `find_dependents` - Find code that depends on a given API
8. `find_usage_examples` - Find real-world usage examples

## Quick Start

### 1. Build

```bash
npm install
npm run build
```

### 2. Configure Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "iwsdk-rag": {
      "command": "node",
      "args": ["/absolute/path/to/iwsdk-rag/mcp/dist/index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

The IWSDK RAG tools will appear in Claude's available tools.

## Directory Structure

```
mcp/
├── README.md              # This file
├── package.json           # Node dependencies and scripts
├── tsconfig.json          # TypeScript configuration
│
├── src/                   # TypeScript source code
│   ├── index.ts          # MCP server entry point
│   ├── search.ts         # Vector search service
│   ├── embeddings.ts     # Query embedding & similarity
│   └── tools/            # MCP tool implementations
│       └── index.ts      # All 8 tools
│
├── dist/                  # Compiled JavaScript
│   └── index.js          # Built server (run this)
│
└── data/                  # Vector database (JSON format)
    ├── chunks.json       # All code chunks with embeddings (33MB)
    └── metadata.json     # Database metadata
```

## Available Tools

### 1. search_code
Semantic search across all indexed code.

```typescript
search_code({
  query: "hand tracking controller input",
  limit: 10,                      // optional
  min_score: 0.5,                 // optional
  source_filter: ["iwsdk"]        // optional: filter by source
})
```

Returns code chunks ranked by semantic similarity to the query.

### 2. find_by_relationship
Find code by relationships (extends, implements, imports, calls, uses WebXR API).

```typescript
find_by_relationship({
  type: "extends",
  target: "Component",
  limit: 20
})
```

Relationship types:
- `extends` - Classes extending a base class
- `implements` - Classes implementing an interface
- `imports` - Code importing a module
- `calls` - Code calling a function
- `uses_webxr_api` - Code using WebXR APIs

### 3. get_api_reference
Look up specific API definitions.

```typescript
get_api_reference({
  name: "AudioSource",
  type: "component"              // optional: component, class, function, interface, type
})
```

### 4. get_file_content
Retrieve complete file contents (useful when search returns partial results).

```typescript
get_file_content({
  file_path: "src/audio/audio.ts",
  source: "iwsdk"                // optional
})
```

### 5. list_ecs_components
List all ECS components, optionally filtered by source.

```typescript
list_ecs_components({
  source: ["iwsdk"],             // optional
  limit: 30                      // optional
})
```

Returns all 27 IWSDK components: AudioSource, Transform, Handle, etc.

### 6. list_ecs_systems
List all ECS systems.

```typescript
list_ecs_systems({
  source: ["iwsdk"],
  limit: 20
})
```

Returns all 17 IWSDK systems: AudioSystem, TransformSystem, GrabSystem, etc.

### 7. find_dependents
Find code that depends on a given API (imports or calls it).

```typescript
find_dependents({
  api_name: "Transform",
  limit: 10
})
```

### 8. find_usage_examples
Find real-world usage examples of an API, ranked by relevance.

```typescript
find_usage_examples({
  api_name: "AudioSource",
  limit: 10
})
```

Prioritizes actual usage (imports + calls) over type definitions.

## Data Format

The `data/chunks.json` file contains:

```json
{
  "version": "1.0.0",
  "model": "sentence-transformers/all-MiniLM-L6-v2",
  "embedding_dim": 384,
  "total_chunks": 2720,
  "sources": {
    "iwsdk": 172,
    "deps": 2548
  },
  "chunks": [
    {
      "id": "uuid",
      "content": "export const AudioSource = createComponent(...)",
      "metadata": {
        "name": "AudioSource",
        "chunk_type": "component",
        "file_path": "src/audio/audio.ts",
        "source": "iwsdk",
        "ecs_component": true,
        "extends": "Component"
      },
      "embedding": [0.123, -0.456, ...]  // 384-dim vector
    }
  ]
}
```

## Updating Data

When the IWSDK codebase changes, regenerate `chunks.json`:

```bash
# In the ingest/ directory
cd ../ingest
source venv/bin/activate

# Re-ingest IWSDK
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear
python scripts/ingest_deps.py /path/to/immersive-web-sdk

# Export to MCP data folder
python scripts/export_for_npm.py --output ../mcp/data/

# Rebuild MCP server
cd ../mcp
npm run build
```

Then restart Claude Desktop to pick up the new data.

## Development

### Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in `dist/`.

### Watch Mode

```bash
npm run watch
```

Automatically recompiles on file changes.

### Testing

```bash
# Test the MCP server
node dist/index.js
```

The server will start and wait for MCP protocol messages on stdin.

## How It Works

### Vector Search

1. **Query Embedding**: User query is embedded using transformers.js with the same model used for ingestion (all-MiniLM-L6-v2)
2. **Similarity**: Cosine similarity computed between query embedding and all code chunk embeddings
3. **Ranking**: Results sorted by similarity score
4. **Filtering**: Optional filters by source, min score, etc.

### Pattern Detection

ECS components and systems are detected using pattern matching:
- **Components**: Classes with `ecs_component: true` OR `extends` contains "Component"
- **Systems**: Classes with `ecs_system: true` OR `extends` contains "System"

### Metadata-Based Search

Relationship queries use metadata fields:
- `extends` - Parent classes
- `implements` - Interfaces
- `imports` - Import statements
- `calls` - Function calls
- `webxr_api_usage` - WebXR APIs used

## Dependencies

Key packages:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@xenova/transformers` - On-device ML inference for embeddings
- `zod` - Schema validation

See `package.json` for complete list.

## Configuration

The server uses:
- **Embedding model**: `Xenova/all-MiniLM-L6-v2` (matches ingestion)
- **Embedding dimensions**: 384
- **Similarity metric**: Cosine similarity
- **Default result limit**: 10 chunks

## Notes

- The MCP server loads all data into memory at startup (~34MB)
- Embedding model is downloaded on first run and cached locally
- All search is performed in-process (no external API calls)
- The server is stateless - each request is independent
