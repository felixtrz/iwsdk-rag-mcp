# IWSDK Ingestion Pipeline

Python-based ingestion pipeline for parsing, chunking, and embedding TypeScript code from the Immersive Web SDK.

## Overview

This pipeline:
1. **Parses** TypeScript files using tree-sitter to extract semantic code chunks (classes, functions, components, systems, etc.)
2. **Chunks** the code intelligently using AST-aware strategies
3. **Embeds** code chunks using sentence-transformers (all-mpnet-base-v2)
4. **Stores** embeddings in ChromaDB vector database
5. **Exports** the database to JSON format for the MCP server

## Quick Start

### 1. Setup (One-time)

```bash
cd ingest
./setup.sh
```

This creates a Python virtual environment and installs dependencies.

### 2. Run Complete Ingestion

From the repository root:

```bash
./ingest.sh
```

This single command:
- ✅ Clones immersive-web-sdk from GitHub to `.temp/` (gitignored)
- ✅ Runs `pnpm install` and `npm run build:tgz`
- ✅ Ingests IWSDK source code (28 components, 17 systems)
- ✅ Ingests dependencies (Three.js, WebXR types, elics)
- ✅ Exports to JSON for MCP server
- ✅ Copies source files to `data/sources/` for reference
- ✅ Runs health check validation (validates 3337 chunks, 63 WebXR API usages)
- ✅ Cleans up cloned repo (use `--keep-repo` to inspect)

**No manual paths needed - everything is automated!**

### Advanced Usage

```bash
# Keep cloned repo for debugging (in .temp/immersive-web-sdk)
./ingest.sh --keep-repo

# Use the kept repo for faster re-ingestion
./ingest.sh --repo-path .temp/immersive-web-sdk

# Skip build step (if repo already built)
./ingest.sh --skip-build --repo-path .temp/immersive-web-sdk

# Run Python script directly
cd ingest
source venv/bin/activate
python scripts/ingest_all.py
```

## Directory Structure

```
ingest/
├── README.md              # This file
├── requirements.txt       # Python dependencies
├── setup.sh              # Setup script
├── venv/                 # Python virtual environment
│
├── ingestion/            # Core ingestion code
│   ├── parsers/         # Tree-sitter parsers
│   │   └── typescript_parser.py   # TypeScript/JavaScript parser
│   ├── chunkers/        # Code chunking strategies
│   │   └── ast_chunker.py         # AST-aware chunker
│   └── embedders/       # Embedding models
│       └── simple_embedder.py     # Sentence transformer embedder
│
├── storage/             # Vector database
│   └── vector_store.py  # ChromaDB wrapper
│
└── scripts/             # Ingestion scripts
    ├── ingest_all.py        # Complete ingestion pipeline (NEW!)
    ├── ingest_multi.py      # Legacy: Manual IWSDK ingestion
    ├── ingest_deps.py       # Legacy: Manual dependency ingestion
    ├── export_for_npm.py    # Export to JSON for MCP server
    └── health_check.py      # Validate system integrity (NEW!)
```

## Supported Sources

### iwsdk
Immersive Web SDK runtime code from these packages:
- `core` - Main SDK runtime
- `xr-input` - Input handling
- `locomotor` - Movement systems
- `glxf` - Scene loader

### deps
External dependency type definitions:
- Three.js types (from `node_modules/three/**/*.d.ts`)
- WebXR types (from `node_modules/@types/webxr/**/*.d.ts`)

## What Gets Extracted

The parser extracts semantic code chunks with rich metadata:

### Chunk Types
- **Classes** - Including inheritance relationships
- **Functions** - Top-level and exported functions
- **Interfaces** - Type definitions
- **Type Aliases** - Type declarations
- **Components** - ECS components created with `createComponent()`
- **Systems** - ECS systems extending `createSystem()`

### Metadata
Each chunk includes:
- Name, file path, line numbers
- Language (TypeScript/JavaScript)
- Imports and exports
- Relationships: `extends`, `implements`, `calls`
- ECS flags: `ecs_component`, `ecs_system`
- API usage: `webxr_api_usage`, `three_js_usage`

## Chunking Strategy

The AST-aware chunker:
1. **Preserves semantic boundaries** - Complete functions, classes, components
2. **Merges small related chunks** - Getters/setters, related functions
3. **Tracks consumed chunks** - Prevents duplicates and skipped chunks
4. **Expands tiny chunks** - Adds surrounding context to meet minimum size
5. **Maintains size limits** - Min 15 lines, max 100 lines, target 50 lines

## Embedding Model

**Model**: `sentence-transformers/all-mpnet-base-v2`
- **Dimensions**: 768
- **High Quality**: Better semantic understanding than MiniLM
- **CPU Inference**: Works on CPU without external APIs

## Vector Database

**ChromaDB** is used for:
- Storing embeddings with metadata
- Fast similarity search during development
- Source of truth for exports

Database location: `../chroma_db/`

## Common Workflows

### Fresh Ingestion

```bash
source venv/bin/activate

# 1. Ingest IWSDK (clears database)
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear

# 2. Add dependencies
python scripts/ingest_deps.py /path/to/immersive-web-sdk

# 3. Export for MCP server
python scripts/export_for_npm.py --output /path/to/iwsdk-rag/data/
```

### Update IWSDK Only

```bash
source venv/bin/activate

# Re-ingest IWSDK (clears database)
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear

# Re-add dependencies
python scripts/ingest_deps.py /path/to/immersive-web-sdk

# Export
python scripts/export_for_npm.py --output /path/to/iwsdk-rag/data/
```

## Troubleshooting

### "Module not found" errors

Make sure you've activated the virtual environment:
```bash
source venv/bin/activate
```

### "node_modules not found" (when ingesting deps)

The dependencies script requires Three.js and WebXR types to be installed:
```bash
cd /path/to/immersive-web-sdk
npm install
```

### ChromaDB errors

If you encounter ChromaDB issues, try deleting and recreating the database:
```bash
rm -rf ../chroma_db
python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear
```

## Dependencies

Key Python packages:
- `tree-sitter` - AST parsing
- `tree-sitter-typescript` - TypeScript parser
- `tree-sitter-javascript` - JavaScript parser
- `sentence-transformers` - Embedding model
- `chromadb` - Vector database
- `torch` - ML framework for embeddings
- `tqdm` - Progress bars

See `requirements.txt` for complete list.

## Output Format

The exported JSON (`chunks.json`) contains:
```json
{
  "version": "1.0.0",
  "model": "sentence-transformers/all-mpnet-base-v2",
  "embedding_dim": 768,
  "total_chunks": 2720,
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
        "extends": "Component",
        ...
      },
      "embedding": [0.123, -0.456, ...]  // 768-dim vector
    }
  ]
}
```

## Notes

- The ingestion process is **source-code aware** and extracts semantic chunks, not arbitrary text blocks
- ECS components and systems are **automatically detected** using pattern matching
- All code chunks include **relationship metadata** for advanced queries
- The exported JSON is **ready to use** in the MCP server without modification
