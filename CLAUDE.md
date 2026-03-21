# CLAUDE.md

## Setup

This repo uses Git LFS for the bundled ONNX model (~162 MB). After cloning:

```sh
git lfs pull
pnpm install
pnpm build
```

Without `git lfs pull`, the model file will be a LFS pointer and the server will fail with "Protobuf parsing failed".

## Commands

```sh
pnpm build            # Compile MCP server → dist/
pnpm build:tools      # Compile ingestion pipeline → dist-tools/
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix lint issues
pnpm start            # Run the MCP server (stdio transport)
pnpm ingest           # Re-run ingestion (requires IWSDK repo cloned alongside)
```

## Testing

```sh
pnpm build                    # Must build first
node test/test_server.mjs     # 28 functional assertions across all 8 MCP tools
node test/test_relevance.mjs  # 10 semantic search quality tests
```

Both test suites spawn the MCP server as a subprocess, communicate via JSON-RPC over stdio, and require the ONNX model to be downloaded via `git lfs pull`.

## Project Structure

```
src/                          # MCP server (compiles to dist/)
  index.ts                    # Entry point — registers 8 MCP tools, handles JSON-RPC
  search.ts                   # SearchService — vector similarity search, relationship queries
  tools.ts                    # Tool implementations — formatting, deduplication, validation
  embeddings.ts               # EmbeddingService — loads ONNX model, generates embeddings
  files.ts                    # FileService — serves source files from data/sources/
  types.ts                    # Core types: Chunk, RawChunk, SearchResult, EmbeddingsData
  utils.ts                    # Shared utilities (toArray)

tools/                        # Ingestion pipeline (compiles to dist-tools/)
  ingest.ts                   # Pipeline orchestration — clone, parse, chunk, embed, export
  ingestion/parser.ts         # TypeScript AST parser using ts-morph
  ingestion/chunker.ts        # Semantic chunk optimizer (sorts by file + line)
  ingestion/types.ts          # TypeScriptChunk type definition

data/                         # Generated data (gitignored, included in npm package)
  embeddings.json             # Pre-computed 768-dim embeddings (~94 MB)
  sources/iwsdk/              # Mirrored IWSDK source files
  sources/deps/               # Mirrored dependency type definitions

model/                        # Bundled ONNX model (Git LFS)
  onnx/model_quantized.onnx   # jinaai/jina-embeddings-v2-base-code (q8, ~162 MB)
  config.json                 # Model config
  tokenizer.json              # Tokenizer

test/
  test_server.mjs             # Functional tests for all 8 tools
  test_relevance.mjs          # Semantic search quality/relevance tests
```

## Architecture & Data Flow

**Ingestion** (offline, run manually): `pnpm ingest`
1. Clones IWSDK repo into `tools/.temp/`
2. Parses TypeScript files with ts-morph — extracts classes, functions, interfaces, types, enums
3. Detects ECS patterns (both `extends Component` and `createComponent()` factory)
4. Detects relationships: extends, implements, imports, calls, WebXR API usage
5. Filters out chunks > 500 lines or > 20 KB
6. Generates 768-dim embeddings using jinaai/jina-embeddings-v2-base-code
7. Writes `data/embeddings.json` with flattened `RawChunk[]` arrays for iwsdk and deps

**Server** (runtime): `pnpm start`
1. Loads `data/embeddings.json` → transforms `RawChunk` to `Chunk` (unflattens metadata)
2. Loads ONNX model for query embedding
3. On search: embeds query → cosine similarity against all chunks → filter/sort/deduplicate
4. Returns formatted markdown via MCP tool responses

**Key type transformation**: `RawChunk` (flat, from JSON) → `Chunk` (nested `metadata` object) via `SearchService.rawChunkToChunk()`. Note `class_name` becomes `class_context` in metadata.

## Coding Conventions

**Imports**: Ordered by group — builtin → external → sibling. Alphabetized within groups. No blank lines between groups. Enforced by `import/order` ESLint rule.

**Braces**: Required on ALL control statements, even single-line (`curly: ['error', 'all']`). Write `if (x) { return y; }` not `if (x) return y;`.

**Unused variables**: Prefix with `_` to suppress lint errors (`argsIgnorePattern: '^_'`).

**TypeScript**: Strict mode. ES2022 target. ES modules throughout (`"type": "module"` in package.json). Two tsconfigs: `tsconfig.json` (src/ → dist/) and `tsconfig.tools.json` (tools/ + src/ → dist-tools/).

**Relationship fields** (extends, imports, calls, etc.) may be `undefined`, a single string, or an array. Always use `toArray()` from `src/utils.ts` before iterating.

**Tool return format**: All tools return `ToolResult` with `content: [{ type: 'text', text: string }]` and optional `isError: boolean`.

## Key Patterns

**Deduplication**: Two strategies in `src/tools.ts`:
- `deduplicateByLineRange()` — removes overlapping chunks from the same file
- `deduplicateByName()` — prefers `packages/` paths over `examples/`

**Search over-fetch**: `searchCode()` requests 2x the limit, deduplicates, then slices to the requested limit.

**Usage scoring** in `findUsageExamples()`: imports+calls=10, imports+extends=8, just imports=3, mentioned=+2, classes/functions=+3, pure type defs=-2.

**Verbosity levels** for `search_code`: 0=metadata only, 1=first 10 lines, 2=first 30 lines, 3=full content (default).

**Path resolution** in `FileService`: handles IWSDK paths (`packages/{pkg}/src/...`), elics paths, and deps paths (both npm and pnpm `node_modules` layouts). Validates resolved paths stay within `data/sources/` to prevent traversal.

## Indexed Data

- 1,140 IWSDK chunks (27 ECS components, 17 systems)
- 4,529 dependency chunks (Three.js types, WebXR types, pmndrs/*, elics, babylonjs/havok)
- 5,669 total chunks with 768-dimensional embeddings
- Embedding model: jinaai/jina-embeddings-v2-base-code (q8)
- Dependency inclusion list is hardcoded in `tools/ingest.ts` (`includedDeps` array)
