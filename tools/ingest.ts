/**
 * Complete TypeScript ingestion pipeline
 *
 * Replaces the Python ingestion pipeline with a pure TypeScript implementation.
 * Uses ts-morph for parsing and @huggingface/transformers for embeddings.
 */

import { TypeScriptParser } from './ingestion/parser.js';
import { ASTChunker } from './ingestion/chunker.js';
import { TypeScriptChunk } from './ingestion/types.js';
import { EmbeddingService } from '../src/embeddings.js';
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'fs';
import { resolve, relative, join } from 'path';
import { glob } from 'glob';

const IWSDK_REPO = 'https://github.com/facebook/immersive-web-sdk.git';

interface IngestOptions {
  skipClone?: boolean;
  skipBuild?: boolean;
  repoPath?: string;
  keepRepo?: boolean;
  skipEmbeddings?: boolean;  // Stop before embedding generation for testing
}

// Chunk size limits to filter out overly large data blobs
const MAX_CHUNK_LINES = 500;      // Skip chunks with more than 500 lines
const MAX_CHUNK_BYTES = 20000;    // Skip chunks larger than 20KB

/**
 * Filter out chunks that are too large to be useful for semantic search
 * These are typically data blobs, large constants, or generated code
 * Returns { filtered, skipped } so callers can log a summary
 */
function filterLargeChunks(chunks: TypeScriptChunk[]): { filtered: TypeScriptChunk[]; skipped: number } {
  const filtered: TypeScriptChunk[] = [];
  let skipped = 0;

  for (const chunk of chunks) {
    const lineCount = chunk.end_line - chunk.start_line + 1;
    const byteSize = Buffer.byteLength(chunk.content, 'utf-8');

    if (lineCount > MAX_CHUNK_LINES || byteSize > MAX_CHUNK_BYTES) {
      skipped++;
      continue;
    }

    filtered.push(chunk);
  }

  return { filtered, skipped };
}

class IngestionPipeline {
  private repoRoot: string;
  private tempDir: string;
  private dataDir: string;

  constructor() {
    this.repoRoot = resolve(process.cwd());
    this.tempDir = resolve(this.repoRoot, 'tools', '.temp');
    this.dataDir = resolve(this.repoRoot, 'data');
  }

  async run(options: IngestOptions = {}) {
    console.error('='.repeat(80));
    console.error('🚀 IWSDK RAG INGESTION PIPELINE (TypeScript)');
    console.error('='.repeat(80));
    console.error('');

    try {
      // Step 1: Clone and build IWSDK
      const iwsdkDir = await this.cloneAndBuildIWSK(options);

      // Step 2: Ingest IWSDK source code
      const iwsdkChunks = await this.ingestIWSK(iwsdkDir);

      // Step 3: Ingest dependencies
      const depsChunks = await this.ingestDependencies(iwsdkDir);

      // Step 4: Export chunks to JSON
      const iwsdkFile = await this.exportChunks(iwsdkChunks, 'iwsdk_chunks.json', iwsdkDir);
      const depsFile = await this.exportChunks(depsChunks, 'deps_chunks.json', resolve(iwsdkDir, 'node_modules'));

      if (options.skipEmbeddings) {
        console.error('');
        console.error('='.repeat(80));
        console.error('⏹️  STOPPED BEFORE EMBEDDINGS (--skip-embeddings)');
        console.error('='.repeat(80));
        console.error('');
        console.error('Chunks exported to:');
        console.error(`  - ${iwsdkFile}`);
        console.error(`  - ${depsFile}`);
        console.error('');
        return;
      }

      // Step 5: Generate embeddings
      const [iwsdkEmbeddings, depsEmbeddings] = await this.generateEmbeddings(iwsdkFile, depsFile);

      // Step 6: Combine and export final embeddings.json
      await this.exportFinalEmbeddings(iwsdkEmbeddings, depsEmbeddings);

      // Step 7: Copy source files for MCP file access
      this.copySourceFiles(iwsdkDir);

      // Step 8: Cleanup
      if (!options.keepRepo) {
        this.cleanup();
      }

      console.error('');
      console.error('='.repeat(80));
      console.error('✅ INGESTION PIPELINE COMPLETED SUCCESSFULLY!');
      console.error('='.repeat(80));
      console.error('');
      console.error('Next steps:');
      console.error('  1. npm run build');
      console.error('  2. Restart Claude Desktop/Code');
      console.error('');

    } catch (error) {
      console.error('');
      console.error('❌ INGESTION PIPELINE FAILED');
      console.error(error);
      process.exit(1);
    }
  }

  private async cloneAndBuildIWSK(options: IngestOptions): Promise<string> {
    console.error('='.repeat(80));
    console.error('📦 CLONING AND BUILDING IWSDK');
    console.error('='.repeat(80));
    console.error('');

    if (options.repoPath) {
      console.error(`📂 Using existing repo: ${options.repoPath}`);
      return resolve(options.repoPath);
    }

    const iwsdkDir = resolve(this.tempDir, 'immersive-web-sdk');

    if (options.skipClone && existsSync(iwsdkDir)) {
      console.error('⏭️  Skipping clone (repo exists)');
      return iwsdkDir;
    }

    // Create temp directory
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }

    // Clean existing repo
    if (existsSync(iwsdkDir)) {
      console.error('🗑️  Removing existing repo...');
      rmSync(iwsdkDir, { recursive: true, force: true });
    }

    // Clone repository
    console.error(`🔽 Cloning ${IWSDK_REPO}...`);
    execSync(`git clone --depth 1 ${IWSDK_REPO} ${iwsdkDir}`, {
      stdio: 'inherit'
    });
    console.error('✅ Repository cloned');
    console.error('');

    if (!options.skipBuild) {
      // Install dependencies (needed for node_modules type definitions)
      console.error('📥 Installing dependencies...');
      execSync('pnpm install', {
        cwd: iwsdkDir,
        stdio: 'inherit'
      });
      console.error('✅ Dependencies installed');
      console.error('');
    }

    return iwsdkDir;
  }

  private async ingestIWSK(iwsdkDir: string): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('📝 INGESTING IWSDK SOURCE CODE');
    console.error('='.repeat(80));
    console.error('');

    // Find TypeScript files
    console.error('🔍 Finding TypeScript files...');
    const tsFiles = await glob('**/*.{ts,tsx}', {
      cwd: iwsdkDir,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
      ],
      absolute: true,
    });

    console.error(`✅ Found ${tsFiles.length} TypeScript files`);
    console.error('');

    // Initialize components
    console.error('🔧 Initializing components...');
    const parser = new TypeScriptParser();
    const chunker = new ASTChunker();
    console.error('');

    // Process files
    console.error(`📝 Processing ${tsFiles.length} files...`);
    console.error('');

    const allChunks: TypeScriptChunk[] = [];
    let successful = 0;
    let failed = 0;
    let totalSkipped = 0;

    for (let i = 0; i < tsFiles.length; i++) {
      const file = tsFiles[i];
      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const { filtered, skipped } = filterLargeChunks(optimized);
          totalSkipped += skipped;

          // Add source metadata
          for (const chunk of filtered) {
            chunk.source = 'iwsdk';
          }

          allChunks.push(...filtered);
          successful++;
        }

        // Progress every 25 files
        if ((i + 1) % 25 === 0 || (i + 1) === tsFiles.length) {
          const progress = Math.round(((i + 1) / tsFiles.length) * 100);
          console.error(`   Progress: ${i + 1}/${tsFiles.length} files (${progress}%) - ${allChunks.length} chunks so far`);
        }
      } catch (error) {
        failed++;
        if (failed <= 5) {
          console.error(`  ⚠️  Error processing ${file}: ${error}`);
        }
      }
    }

    console.error('');
    console.error(`✅ Processed ${successful} files successfully`);
    if (failed > 0) {
      console.error(`⚠️  Failed to process ${failed} files`);
    }
    if (totalSkipped > 0) {
      console.error(`📊 Filtered out ${totalSkipped} oversized chunks`);
    }
    console.error(`📊 Generated ${allChunks.length} code chunks`);
    console.error('');

    return allChunks;
  }

  private async ingestDependencies(iwsdkDir: string): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('📦 INGESTING DEPENDENCIES');
    console.error('='.repeat(80));
    console.error('');

    const nodeModules = resolve(iwsdkDir, 'node_modules');
    if (!existsSync(nodeModules)) {
      console.error('⚠️  node_modules not found - skipping dependencies');
      return [];
    }

    // Find dependency type definitions
    console.error('🔍 Finding dependency type definitions...');
    const dtsFiles = await glob('**/*.d.ts', {
      cwd: nodeModules,
      ignore: ['**/@types/node/**'],  // Skip Node.js types
      absolute: true,
      follow: true,  // Follow symlinks (needed for pnpm)
    });
    console.error(`   Found ${dtsFiles.length} total .d.ts files (before filtering)`);

    // Filter to included dependencies
    const includedDeps = ['@types/three', '@types/webxr', '@pmndrs/pointer-events', '@pmndrs/uikit', '@pmndrs/uikitml', '@preact/signals-core', 'elics', '@babylonjs/havok'];
    const filtered = dtsFiles.filter(file => {
      return includedDeps.some(dep => {
        // Handle both npm (node_modules/pkg/) and pnpm (.pnpm/pkg@version/node_modules/pkg/)
        const npmPattern = `node_modules/${dep}/`;
        const pnpmPattern = `/${dep.replace('@', '').replace('/', '+')}@`; // e.g. /types+three@
        return file.includes(npmPattern) || file.includes(pnpmPattern);
      });
    });

    console.error(`✅ Found ${filtered.length} type definition files from dependencies`);
    console.error('');

    if (filtered.length === 0) {
      return [];
    }

    // Initialize components
    const parser = new TypeScriptParser();
    const chunker = new ASTChunker();

    // Process files
    console.error(`📝 Processing ${filtered.length} dependency files...`);
    console.error('');

    const allChunks: TypeScriptChunk[] = [];
    let totalSkipped = 0;

    for (let i = 0; i < filtered.length; i++) {
      const file = filtered[i];
      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const { filtered: sizeFiltered, skipped } = filterLargeChunks(optimized);
          totalSkipped += skipped;

          // Add source metadata
          for (const chunk of sizeFiltered) {
            chunk.source = 'deps';
          }

          allChunks.push(...sizeFiltered);
        }

        // Progress every 50 files
        if ((i + 1) % 50 === 0 || (i + 1) === filtered.length) {
          const progress = Math.round(((i + 1) / filtered.length) * 100);
          console.error(`   Progress: ${i + 1}/${filtered.length} files (${progress}%) - ${allChunks.length} chunks so far`);
        }
      } catch (error) {
        // Silently skip errors for dependencies
      }
    }

    console.error('');
    if (totalSkipped > 0) {
      console.error(`📊 Filtered out ${totalSkipped} oversized chunks`);
    }
    console.error(`📊 Generated ${allChunks.length} dependency chunks`);
    console.error('');

    return allChunks;
  }

  private async exportChunks(chunks: TypeScriptChunk[], filename: string, basePath: string): Promise<string> {
    console.error(`📤 Exporting chunks to ${filename}...`);

    // Make paths relative to basePath
    const chunksWithRelativePaths = chunks.map(chunk => ({
      ...chunk,
      file_path: relative(basePath, chunk.file_path),
    }));

    const outputPath = resolve(this.tempDir, filename);
    writeFileSync(outputPath, JSON.stringify(chunksWithRelativePaths, null, 2));

    console.error(`✅ Exported ${chunks.length} chunks to ${outputPath}`);
    console.error('');

    return outputPath;
  }

  private async generateEmbeddings(iwsdkFile: string, depsFile: string): Promise<[string, string]> {
    console.error('='.repeat(80));
    console.error('🧠 GENERATING EMBEDDINGS (TypeScript)');
    console.error('='.repeat(80));
    console.error('');

    const embedScript = resolve(this.repoRoot, 'dist-tools', 'tools', 'generate-embeddings.js');

    // Check if script is compiled
    if (!existsSync(embedScript)) {
      console.error('🔨 Building TypeScript embeddings script...');
      execSync('npm run build:tools', { cwd: this.repoRoot, stdio: 'inherit' });
      console.error('');
    }

    const iwsdkOutput = resolve(this.tempDir, 'iwsdk_embeddings.json');
    const depsOutput = resolve(this.tempDir, 'deps_embeddings.json');

    // Generate IWSDK embeddings
    console.error('📊 Generating IWSDK embeddings...');
    execSync(`node ${embedScript} ${iwsdkFile} ${iwsdkOutput}`, {
      cwd: this.repoRoot,
      stdio: 'inherit',
    });
    console.error('');

    // Generate dependency embeddings
    console.error('📊 Generating dependency embeddings...');
    execSync(`node ${embedScript} ${depsFile} ${depsOutput}`, {
      cwd: this.repoRoot,
      stdio: 'inherit',
    });
    console.error('');

    return [iwsdkOutput, depsOutput];
  }

  private async exportFinalEmbeddings(iwsdkFile: string, depsFile: string): Promise<void> {
    console.error('='.repeat(80));
    console.error('📤 EXPORTING TO JSON');
    console.error('='.repeat(80));
    console.error('');

    // Read embeddings
    console.error('📖 Reading embeddings...');
    const iwsdkData = JSON.parse(readFileSync(iwsdkFile, 'utf-8'));
    const depsData = JSON.parse(readFileSync(depsFile, 'utf-8'));

    console.error(`✅ Loaded ${iwsdkData.length} IWSDK chunks with embeddings`);
    console.error(`✅ Loaded ${depsData.length} dependency chunks with embeddings`);
    console.error('');

    // Prepare output
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Combine and export
    console.error('💾 Writing to data/embeddings.json...');

    // Extract IWSDK version from packages/core/package.json
    let iwsdkVersion = 'unknown';
    try {
      const corePkgPath = resolve(this.tempDir, 'immersive-web-sdk', 'packages', 'core', 'package.json');
      if (existsSync(corePkgPath)) {
        const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf-8'));
        iwsdkVersion = corePkg.version || 'unknown';
      }
    } catch (error) {
      console.error(`⚠️  Could not extract IWSDK core version: ${error}`);
    }

    const outputData = {
      version: iwsdkVersion,
      model: 'jinaai/jina-embeddings-v2-base-code',
      dimensions: iwsdkData[0]?.embedding.length || 768,
      iwsdk: iwsdkData,
      deps: depsData,
    };

    const embeddingsFile = resolve(this.dataDir, 'embeddings.json');
    writeFileSync(embeddingsFile, JSON.stringify(outputData));

    console.error(`✅ Exported to ${embeddingsFile}`);
    console.error(`   Total chunks: ${iwsdkData.length + depsData.length}`);
    console.error('');
  }

  private copySourceFiles(iwsdkDir: string): void {
    console.error('='.repeat(80));
    console.error('📋 COPYING SOURCE FILES');
    console.error('='.repeat(80));
    console.error('');

    const sourcesDir = resolve(this.dataDir, 'sources');
    console.error(`📁 Target directory: ${sourcesDir}`);
    console.error('');

    // Clear existing sources
    if (existsSync(sourcesDir)) {
      console.error('🧹 Clearing existing source files...');
      rmSync(sourcesDir, { recursive: true, force: true });
    }

    mkdirSync(sourcesDir, { recursive: true });
    console.error('✅ Source directory ready');
    console.error('');

    // Copy IWSDK source files - preserve packages/ structure
    console.error('📦 Copying IWSDK source files...');
    const iwsdkSource = resolve(iwsdkDir, 'packages');
    const iwsdkTarget = resolve(sourcesDir, 'iwsdk', 'packages');

    const runtimePackages = ['core', 'xr-input', 'locomotor', 'glxf'];

    for (const pkgName of runtimePackages) {
      const pkgSrc = join(iwsdkSource, pkgName, 'src');
      if (existsSync(pkgSrc)) {
        const pkgTarget = join(iwsdkTarget, pkgName, 'src');
        console.error(`  - Copying ${pkgName}...`);
        cpSync(pkgSrc, pkgTarget, { recursive: true });
      } else {
        console.error(`  ⚠️  Package ${pkgName}/src not found`);
      }
    }

    console.error(`✅ Copied ${runtimePackages.length} IWSDK packages`);
    console.error('');

    // Copy dependency type definitions
    console.error('📦 Copying dependency type definitions...');
    const nodeModules = resolve(iwsdkDir, 'node_modules');
    const depsTarget = resolve(sourcesDir, 'deps');

    if (existsSync(nodeModules)) {
      // Copy @types/three
      const threeSrc = join(nodeModules, '@types', 'three');
      if (existsSync(threeSrc)) {
        const threeTarget = join(depsTarget, '@types', 'three');
        console.error('  - Copying @types/three...');
        cpSync(threeSrc, threeTarget, { recursive: true });
      }

      // Copy @types/webxr (handle pnpm structure)
      let webxrFound = false;
      const pnpmDir = join(nodeModules, '.pnpm');
      if (existsSync(pnpmDir)) {
        const pnpmEntries = glob.sync('@types+webxr@*', { cwd: pnpmDir });
        if (pnpmEntries.length > 0) {
          const webxrSrc = join(pnpmDir, pnpmEntries[0], 'node_modules', '@types', 'webxr');
          if (existsSync(webxrSrc)) {
            const webxrTarget = join(depsTarget, '@types', 'webxr');
            console.error(`  - Copying @types/webxr from ${pnpmEntries[0]}...`);
            cpSync(webxrSrc, webxrTarget, { recursive: true });
            webxrFound = true;
          }
        }
      }

      if (!webxrFound) {
        const webxrSrc = join(nodeModules, '@types', 'webxr');
        if (existsSync(webxrSrc)) {
          const webxrTarget = join(depsTarget, '@types', 'webxr');
          console.error('  - Copying @types/webxr...');
          cpSync(webxrSrc, webxrTarget, { recursive: true });
        }
      }
    }

    console.error('✅ Source files copied');
    console.error('');
  }

  private cleanup(): void {
    console.error('🗑️  Cleaning up temporary files...');
    if (existsSync(this.tempDir)) {
      rmSync(this.tempDir, { recursive: true, force: true });
    }
    console.error('✅ Cleanup complete');
    console.error('');
  }
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const options: IngestOptions = {};

  // Parse command line arguments
  for (const arg of args) {
    if (arg === '--keep-repo') {
      options.keepRepo = true;
    } else if (arg === '--skip-clone') {
      options.skipClone = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--skip-embeddings') {
      options.skipEmbeddings = true;
      options.keepRepo = true;  // Auto-keep repo for inspection
    } else if (arg.startsWith('--repo-path=')) {
      options.repoPath = arg.split('=')[1];
    }
  }

  const pipeline = new IngestionPipeline();
  await pipeline.run(options);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
