/**
 * Generate embeddings from parsed chunks using Node.js
 *
 * This script reads chunks exported from Python parsing and generates embeddings
 * using our TypeScript EmbeddingService with jinaai/jina-embeddings-v2-base-code.
 *
 * Usage:
 *   tsx scripts/generate-embeddings.ts <chunks-file> <output-file>
 */

import { readFileSync, writeFileSync } from 'fs';
import { EmbeddingService } from '../embeddings.js';

interface Chunk {
  content: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: string;
  module_path?: string;
  class_name?: string;
  imports?: string[];
  exports?: string[];
  type_parameters?: string[];
  decorators?: string[];
  calls?: string[];
  extends?: string[];
  implements?: string[];
  uses_types?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
  webxr_api_usage?: string[];
  three_js_usage?: string[];
  semantic_labels?: string[];
  source?: string;
}

interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
}

function createChunkText(chunk: Chunk): string {
  /**
   * Create enhanced text representation for embedding.
   * Mirrors the Python implementation in simple_embedder.py
   */
  const parts: string[] = [];

  // Header with metadata
  parts.push(`# ${chunk.chunk_type}: ${chunk.name}`);

  // File path (get relative path from 'src' onwards)
  if (chunk.file_path) {
    const pathParts = chunk.file_path.split('/');
    const srcIdx = pathParts.indexOf('src');
    if (srcIdx !== -1) {
      const relPath = pathParts.slice(srcIdx).join('/');
      parts.push(`File: ${relPath}`);
    }
  }

  // Class context
  if (chunk.class_name) {
    parts.push(`Class: ${chunk.class_name}`);
  }

  // Module path
  if (chunk.module_path) {
    parts.push(`Module: ${chunk.module_path}`);
  }

  // Semantic labels
  if (chunk.semantic_labels && chunk.semantic_labels.length > 0) {
    const labels = chunk.semantic_labels.sort().join(', ');
    parts.push(`Labels: ${labels}`);
  }

  // Language
  parts.push(`Language: ${chunk.language}`);

  // Inheritance relationships
  if (chunk.extends && chunk.extends.length > 0) {
    const extendsList = chunk.extends.sort().join(', ');
    parts.push(`Extends: ${extendsList}`);
  }

  if (chunk.implements && chunk.implements.length > 0) {
    const implementsList = chunk.implements.sort().join(', ');
    parts.push(`Implements: ${implementsList}`);
  }

  // Dependency relationships
  if (chunk.imports && chunk.imports.length > 0) {
    const moduleNames: string[] = [];
    for (const imp of chunk.imports.slice(0, 5)) {
      if (imp.includes('from')) {
        const parts = imp.split('from');
        if (parts.length > 1) {
          const module = parts[1].trim().replace(/[';\"]/g, '');
          moduleNames.push(module);
        }
      } else if (imp.includes('import')) {
        const module = imp.replace('import', '').trim().replace(/[';\"]/g, '');
        moduleNames.push(module);
      }
    }
    if (moduleNames.length > 0) {
      const importsStr = moduleNames.slice(0, 5).join(', ');
      parts.push(`Imports from: ${importsStr}`);
    }
  }

  // Function call relationships
  if (chunk.calls && chunk.calls.length > 0) {
    const callsList = Array.from(chunk.calls).sort().slice(0, 10).join(', ');
    parts.push(`Calls: ${callsList}`);
  }

  // WebXR API usage
  if (chunk.webxr_api_usage && chunk.webxr_api_usage.length > 0) {
    const webxrList = chunk.webxr_api_usage.sort().join(', ');
    parts.push(`Uses WebXR APIs: ${webxrList}`);
  }

  // ECS patterns
  if (chunk.ecs_component) {
    parts.push('Pattern: ECS Component');
  }
  if (chunk.ecs_system) {
    parts.push('Pattern: ECS System');
  }

  // Add blank line before code
  parts.push('');

  // The actual code
  parts.push(chunk.content);

  return parts.join('\n');
}

async function generateEmbeddings(
  chunks: Chunk[],
  batchSize: number = 50
): Promise<ChunkWithEmbedding[]> {
  const embedder = new EmbeddingService();

  console.error('🔄 Initializing embedding model...');
  await embedder.initialize();
  console.error('✅ Model initialized\n');

  const results: ChunkWithEmbedding[] = [];
  const total = chunks.length;

  console.error(`🧠 Generating embeddings for ${total} chunks...`);
  console.error(`   Batch size: ${batchSize}\n`);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);

    console.error(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);

    for (const chunk of batch) {
      const text = createChunkText(chunk);
      const embedding = await embedder.embed(text);

      results.push({
        ...chunk,
        embedding
      });
    }

    const progress = Math.round((results.length / total) * 100);
    console.error(`   Progress: ${results.length}/${total} (${progress}%)\n`);
  }

  console.error('✅ All embeddings generated!\n');
  return results;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: tsx scripts/generate-embeddings.ts <chunks-file> <output-file>');
    console.error('');
    console.error('Example:');
    console.error('  tsx scripts/generate-embeddings.ts chunks.json embeddings.json');
    process.exit(1);
  }

  const [chunksFile, outputFile] = args;

  console.error('=' .repeat(70));
  console.error('🚀 GENERATING EMBEDDINGS (Node.js)');
  console.error('='.repeat(70));
  console.error('');
  console.error(`📂 Input:  ${chunksFile}`);
  console.error(`📂 Output: ${outputFile}`);
  console.error('');

  try {
    // Read chunks
    console.error('📖 Reading chunks...');
    const chunksData = readFileSync(chunksFile, 'utf-8');
    const chunks: Chunk[] = JSON.parse(chunksData);
    console.error(`✅ Loaded ${chunks.length} chunks\n`);

    // Generate embeddings
    const chunksWithEmbeddings = await generateEmbeddings(chunks);

    // Write output
    console.error('💾 Writing embeddings to file...');
    writeFileSync(outputFile, JSON.stringify(chunksWithEmbeddings, null, 2));
    console.error(`✅ Written to ${outputFile}\n`);

    console.error('='.repeat(70));
    console.error('✅ EMBEDDING GENERATION COMPLETE');
    console.error('='.repeat(70));
    console.error('');
    console.error(`Total chunks processed: ${chunksWithEmbeddings.length}`);
    console.error(`Embedding dimensions: ${chunksWithEmbeddings[0]?.embedding.length || 'N/A'}`);
    console.error('');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
