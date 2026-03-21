# CLAUDE.md

## Setup

This repo uses Git LFS for the bundled ONNX model (~162 MB). After cloning, run:

```sh
git lfs pull
pnpm install
pnpm build
```

Without `git lfs pull`, the model file will be a pointer and the server will fail with "Protobuf parsing failed".

## Build

- `pnpm build` — compile the MCP server to `dist/`
- `pnpm build:tools` — compile the ingestion pipeline to `dist-tools/`
- `pnpm lint` — run ESLint
- `pnpm lint:fix` — auto-fix lint issues

## Testing

- `node test/test_server.mjs` — functional tests for all 8 MCP tools (28 assertions)
- `node test/test_relevance.mjs` — semantic search quality tests (10 cases)

Both test suites start the MCP server as a subprocess and communicate via JSON-RPC over stdio. They require the model to be downloaded (via `git lfs pull`) and a fresh build.

## Ingestion

`pnpm ingest` runs the full ingestion pipeline. It requires the IWSDK repo to be cloned alongside this repo and will regenerate `data/embeddings.json`.

## Architecture

- `src/` — MCP server: `index.ts` (entry), `search.ts` (vector search), `tools.ts` (8 tool implementations), `files.ts` (source file reader), `embeddings.ts` (ONNX model), `utils.ts` (shared helpers)
- `tools/` — ingestion pipeline: `ingest.ts` (orchestration), `ingestion/parser.ts` (ts-morph AST), `ingestion/chunker.ts` (semantic chunking)
- `data/embeddings.json` — pre-computed embeddings (~94 MB)
- `model/` — bundled jinaai/jina-embeddings-v2-base-code (q8) ONNX model
