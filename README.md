# IWSDK RAG - Retrieval-Augmented Generation for Immersive Web SDK

Semantic code search system for the Immersive Web SDK, powered by vector embeddings and accessible via Model Context Protocol (MCP).

## Overview

This project provides AI assistants (like Claude) with deep understanding of the Immersive Web SDK codebase through:
- **Semantic code search** - Find code by meaning, not just keywords
- **Relationship queries** - Discover inheritance, imports, and usage patterns
- **ECS-aware tools** - List components and systems with smart pattern detection
- **Real-world examples** - Find actual usage of APIs in the codebase

## Architecture

```
iwsdk-rag/
├── ingest/          # Python pipeline: parse → chunk → embed → store
├── mcp/             # TypeScript MCP server: search tools for AI
└── chroma_db/       # Vector database (ChromaDB)
```

### Ingest Pipeline (Python)

Processes TypeScript code into searchable embeddings:
1. **Parse** - Extract semantic chunks using tree-sitter (classes, functions, components, etc.)
2. **Chunk** - Intelligently split code using AST-aware strategies
3. **Embed** - Generate 384-dim vectors using sentence-transformers
4. **Store** - Save to ChromaDB with rich metadata
5. **Export** - Create JSON for MCP server

**Technology**: Python, tree-sitter, sentence-transformers, ChromaDB

See [`ingest/README.md`](ingest/README.md) for details.

### MCP Server (TypeScript)

Provides 8 search tools for AI assistants:
- `search_code` - Semantic search
- `list_ecs_components` - Find all ECS components (27 detected)
- `list_ecs_systems` - Find all ECS systems (17 detected)
- `get_api_reference` - Look up API definitions
- `find_by_relationship` - Query by extends/implements/imports/calls
- `find_usage_examples` - Find real-world usage
- `find_dependents` - Find code that depends on an API
- `get_file_content` - Retrieve full files

**Technology**: TypeScript, Model Context Protocol, transformers.js

See [`mcp/README.md`](mcp/README.md) for details.

## Quick Start

### 1. Ingest IWSDK Code

```bash
cd ingest
./setup.sh
source venv/bin/activate

# Ingest IWSDK + dependencies
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear
python scripts/ingest_deps.py /path/to/immersive-web-sdk

# Export for MCP server
python scripts/export_for_npm.py --output ../mcp/data/
```

### 2. Build MCP Server

```bash
cd ../mcp
npm install
npm run build
```

### 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### 4. Use in Claude

Restart Claude Desktop, then ask questions like:
- "Show me all ECS components in IWSDK"
- "Find examples of using AudioSource"
- "What classes extend Component?"
- "How does hand tracking work?"

## What Gets Indexed

### IWSDK (172 chunks)
- **27 ECS Components**: AudioSource, Transform, Handle, LocomotionEnvironment, etc.
- **17 ECS Systems**: AudioSystem, TransformSystem, GrabSystem, VisibilitySystem, etc.
- **Classes, Functions, Interfaces**: All semantic code structures
- **Metadata**: Relationships, imports, calls, API usage

### Dependencies (2548 chunks)
- **Three.js types**: Complete type definitions
- **WebXR types**: Full WebXR API types

**Total**: 2720 searchable code chunks with embeddings

## Features

### Smart Pattern Detection

- **ECS Components**: Detects `createComponent()` factory pattern
- **ECS Systems**: Detects `extends createSystem()` pattern
- **Relationships**: Tracks extends, implements, imports, calls
- **API Usage**: WebXR and Three.js API detection

### AST-Aware Chunking

- Preserves semantic boundaries (complete functions, classes)
- Merges related small chunks (getters/setters)
- Prevents duplicates and skipped chunks
- Maintains ECS metadata through merging

### High-Quality Embeddings

- **Model**: sentence-transformers/all-MiniLM-L6-v2
- **Dimensions**: 384
- **Fast**: CPU inference, no external APIs
- **Accurate**: Semantic code understanding

## Repository Structure

```
iwsdk-rag/
│
├── ingest/                      # Python ingestion pipeline
│   ├── README.md               # Ingestion documentation
│   ├── requirements.txt        # Python dependencies
│   ├── setup.sh               # Environment setup
│   ├── venv/                  # Python virtual environment
│   ├── ingestion/             # Core ingestion code
│   │   ├── parsers/          # Tree-sitter parsers
│   │   ├── chunkers/         # AST-aware chunking
│   │   └── embedders/        # Embedding models
│   ├── storage/              # ChromaDB wrapper
│   └── scripts/              # Ingestion scripts
│       ├── ingest_multi.py      # Ingest IWSDK
│       ├── ingest_deps.py       # Ingest dependencies
│       └── export_for_npm.py    # Export to JSON
│
├── mcp/                         # TypeScript MCP server
│   ├── README.md               # MCP server documentation
│   ├── package.json            # Node dependencies
│   ├── tsconfig.json           # TypeScript config
│   ├── src/                   # TypeScript source
│   │   ├── index.ts          # MCP server entry
│   │   ├── search.ts         # Vector search
│   │   ├── embeddings.ts     # Query embeddings
│   │   └── tools/            # 8 MCP tools
│   ├── dist/                 # Compiled JavaScript
│   └── data/                 # Vector database (JSON)
│       └── chunks.json       # All embeddings (33MB)
│
├── chroma_db/                   # ChromaDB vector database
├── .gitignore                   # Git ignore rules
└── README.md                    # This file
```

## Bug Fixes

This codebase includes fixes for 3 critical bugs found during development:

1. **Parser Bug**: Added detection for `createComponent()` factory pattern
2. **Chunker Metadata Bug**: Preserve ECS flags during chunk merging/expansion
3. **Chunker Skip Bug**: Track consumed indices to prevent skipped/duplicated chunks

See commit history for details.

## Development Workflow

### Update IWSDK Index

When the IWSDK codebase changes:

```bash
# 1. Re-ingest
cd ingest
source venv/bin/activate
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear
python scripts/ingest_deps.py /path/to/immersive-web-sdk
python scripts/export_for_npm.py --output ../mcp/data/

# 2. Rebuild MCP server
cd ../mcp
npm run build

# 3. Restart Claude Desktop
```

### Modify Tools

```bash
cd mcp
# Edit src/tools/index.ts
npm run build
# Restart Claude Desktop
```

### Debug Ingestion

```bash
cd ingest
source venv/bin/activate

# Test parser on a single file
python -c "
from ingestion.parsers.typescript_parser import TypeScriptParser
parser = TypeScriptParser()
chunks = parser.parse_file('/path/to/file.ts')
for c in chunks:
    print(f'{c.chunk_type}: {c.name}')
"
```

## Requirements

### Python (Ingestion)
- Python 3.8+
- pip packages in `ingest/requirements.txt`

### Node.js (MCP Server)
- Node.js 18+
- npm packages in `mcp/package.json`

### Claude Desktop
- Latest version with MCP support

## License

MIT

## Contributing

This is a research/development project. Contributions welcome!

Key areas for improvement:
- Add more code sources (examples, tests)
- Improve chunking strategies
- Add more relationship types
- Optimize search performance
