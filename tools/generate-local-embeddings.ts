/**
 * Generate embeddings locally using TF-IDF approach
 *
 * This script creates embeddings without requiring network access,
 * using a simple TF-IDF based approach for code similarity.
 */

import { readFileSync, writeFileSync } from 'fs';

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

// Simple tokenizer for code
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// Create enhanced text for embedding
function createChunkText(chunk: Chunk): string {
  const parts: string[] = [];

  parts.push(`${chunk.chunk_type} ${chunk.name}`);

  if (chunk.file_path) {
    const pathParts = chunk.file_path.split('/');
    parts.push(pathParts.join(' '));
  }

  if (chunk.class_name) {
    parts.push(chunk.class_name);
  }

  if (chunk.extends && chunk.extends.length > 0) {
    parts.push(...chunk.extends);
  }

  if (chunk.implements && chunk.implements.length > 0) {
    parts.push(...chunk.implements);
  }

  if (chunk.calls && chunk.calls.length > 0) {
    parts.push(...chunk.calls.slice(0, 10));
  }

  if (chunk.webxr_api_usage && chunk.webxr_api_usage.length > 0) {
    parts.push(...chunk.webxr_api_usage);
  }

  if (chunk.semantic_labels && chunk.semantic_labels.length > 0) {
    parts.push(...chunk.semantic_labels);
  }

  if (chunk.ecs_component) {
    parts.push('ecs component');
  }
  if (chunk.ecs_system) {
    parts.push('ecs system');
  }

  parts.push(chunk.content);

  return parts.join(' ');
}

// Build vocabulary from all chunks
function buildVocabulary(chunks: Chunk[]): Map<string, number> {
  const vocab = new Map<string, number>();
  let index = 0;

  for (const chunk of chunks) {
    const text = createChunkText(chunk);
    const tokens = tokenize(text);
    for (const token of tokens) {
      if (!vocab.has(token)) {
        vocab.set(token, index++);
      }
    }
  }

  return vocab;
}

// Calculate IDF values
function calculateIDF(chunks: Chunk[], vocab: Map<string, number>): Float32Array {
  const docFreq = new Float32Array(vocab.size);
  const n = chunks.length;

  for (const chunk of chunks) {
    const text = createChunkText(chunk);
    const tokens = new Set(tokenize(text));
    for (const token of tokens) {
      const idx = vocab.get(token);
      if (idx !== undefined) {
        docFreq[idx]++;
      }
    }
  }

  const idf = new Float32Array(vocab.size);
  for (let i = 0; i < vocab.size; i++) {
    idf[i] = Math.log((n + 1) / (docFreq[i] + 1)) + 1;
  }

  return idf;
}

// Generate TF-IDF embedding for a single chunk
function generateEmbedding(
  chunk: Chunk,
  vocab: Map<string, number>,
  idf: Float32Array,
  dimensions: number = 768
): number[] {
  const text = createChunkText(chunk);
  const tokens = tokenize(text);

  // Calculate TF
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  // Create sparse TF-IDF vector
  const tfidf = new Float32Array(vocab.size);
  for (const [token, freq] of tf) {
    const idx = vocab.get(token);
    if (idx !== undefined) {
      tfidf[idx] = freq * idf[idx];
    }
  }

  // Reduce dimensionality using a simple hash-based projection
  // This creates a dense embedding from the sparse TF-IDF vector
  const embedding = new Float32Array(dimensions);

  for (let i = 0; i < tfidf.length; i++) {
    if (tfidf[i] !== 0) {
      // Use multiple hash functions to project into dense space
      for (let j = 0; j < 4; j++) {
        const hash = simpleHash(`${i}_${j}`) % dimensions;
        const sign = ((simpleHash(`${i}_${j}_sign`) % 2) * 2 - 1);
        embedding[hash] += tfidf[i] * sign;
      }
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] /= norm;
    }
  }

  return Array.from(embedding);
}

// Simple hash function
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

async function generateEmbeddings(chunks: Chunk[]): Promise<ChunkWithEmbedding[]> {
  console.error('🔧 Building vocabulary...');
  const vocab = buildVocabulary(chunks);
  console.error(`✅ Vocabulary size: ${vocab.size} tokens`);

  console.error('📊 Calculating IDF values...');
  const idf = calculateIDF(chunks, vocab);
  console.error('✅ IDF calculated');

  console.error(`\n🧠 Generating embeddings for ${chunks.length} chunks...`);

  const results: ChunkWithEmbedding[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = generateEmbedding(chunk, vocab, idf);

    results.push({
      ...chunk,
      embedding
    });

    if ((i + 1) % 100 === 0 || i === chunks.length - 1) {
      const progress = Math.round(((i + 1) / chunks.length) * 100);
      console.error(`   Progress: ${i + 1}/${chunks.length} (${progress}%)`);
    }
  }

  console.error('\n✅ All embeddings generated!');
  return results;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node generate-local-embeddings.js <chunks-file> <output-file>');
    process.exit(1);
  }

  const [chunksFile, outputFile] = args;

  console.error('='.repeat(70));
  console.error('🚀 GENERATING LOCAL EMBEDDINGS (TF-IDF)');
  console.error('='.repeat(70));
  console.error('');
  console.error(`📂 Input:  ${chunksFile}`);
  console.error(`📂 Output: ${outputFile}`);
  console.error('');

  try {
    console.error('📖 Reading chunks...');
    const chunksData = readFileSync(chunksFile, 'utf-8');
    const chunks: Chunk[] = JSON.parse(chunksData);
    console.error(`✅ Loaded ${chunks.length} chunks\n`);

    const chunksWithEmbeddings = await generateEmbeddings(chunks);

    console.error('\n💾 Writing embeddings to file...');
    writeFileSync(outputFile, JSON.stringify(chunksWithEmbeddings, null, 2));
    console.error(`✅ Written to ${outputFile}\n`);

    console.error('='.repeat(70));
    console.error('✅ LOCAL EMBEDDING GENERATION COMPLETE');
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
