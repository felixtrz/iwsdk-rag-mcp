# IWSDK RAG Data

This directory contains pre-processed code chunks and embeddings for the IWSDK RAG MCP server.

## Contents

- `chunks.json` (41.8 MB) - All code chunks with embeddings and metadata
- `metadata.json` - Summary statistics

## Data Statistics

- **Total chunks:** 3337
- **Embedding model:** sentence-transformers/all-MiniLM-L6-v2
- **Embedding dimensions:** 384
- **Generated:** 2025-11-16T18:19:11.479932Z

### Sources

- **deps:** 3164 chunks
- **iwsdk:** 173 chunks

### Chunk Types

- class: 28
- function: 25
- interface: 13
- interface_group: 10
- component: 8
- function_group: 7
- type_group: 5
- type: 4

## Usage

This data is loaded by the TypeScript MCP server at startup:

```typescript
import chunksData from './data/chunks.json';

// Search using transformers.js for query embedding
// and cosine similarity against pre-computed embeddings
```

## Regenerating

To regenerate this data (after ingesting new IWSDK versions):

```bash
cd /path/to/iwsdk-rag

# Re-ingest
python scripts/ingest_multi.py /path/to/iwsdk --source iwsdk --clear
python scripts/ingest_multi.py /path/to/elics --source elics
python scripts/ingest_deps.py /path/to/iwsdk

# Re-export
python scripts/export_for_npm.py --output /path/to/iwsdk-rag-mcp/data/
```
