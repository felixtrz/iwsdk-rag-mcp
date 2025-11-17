# IWSDK RAG Data

This directory contains pre-processed code chunks and embeddings for the IWSDK RAG MCP server.

## Contents

- `chunks.json` (78.8 MB) - All code chunks with embeddings and metadata
- `metadata.json` - Summary statistics

## Data Statistics

- **Total chunks:** 3337
- **Embedding model:** sentence-transformers/all-mpnet-base-v2
- **Embedding dimensions:** 768
- **Generated:** 2025-11-17T16:35:00.735627Z

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

# Re-run ingestion
npm run ingest
```
