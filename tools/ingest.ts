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
const THREEJS_REPO = 'https://github.com/mrdoob/three.js.git';

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
 */
function filterLargeChunks(chunks: TypeScriptChunk[]): TypeScriptChunk[] {
  const filtered: TypeScriptChunk[] = [];
  let skipped = 0;

  for (const chunk of chunks) {
    const lineCount = chunk.end_line - chunk.start_line + 1;
    const byteSize = Buffer.byteLength(chunk.content, 'utf-8');

    if (lineCount > MAX_CHUNK_LINES || byteSize > MAX_CHUNK_BYTES) {
      skipped++;
      // Log first few skipped chunks for visibility
      if (skipped <= 3) {
        console.error(`   ⚠️  Skipping large chunk: ${chunk.name} (${lineCount} lines, ${Math.round(byteSize/1024)}KB)`);
      }
      continue;
    }

    filtered.push(chunk);
  }

  if (skipped > 0) {
    console.error(`   📊 Filtered out ${skipped} oversized chunks (>${MAX_CHUNK_LINES} lines or >${Math.round(MAX_CHUNK_BYTES/1024)}KB)`);
  }

  return filtered;
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

      // Step 3: Ingest IWSDK examples
      const exampleChunks = await this.ingestExamples(iwsdkDir);

      // Step 4: Clone and ingest Three.js
      const threeDir = await this.cloneThreeJS(iwsdkDir);
      let threeChunks: TypeScriptChunk[] = [];
      if (threeDir) {
        threeChunks = await this.ingestThreeJS(threeDir);
      }

      // Step 5: Ingest dependencies
      const depsChunks = await this.ingestDependencies(iwsdkDir);

      // Combine IWSDK and example chunks
      const allIwsdkChunks = [...iwsdkChunks, ...exampleChunks];

      // Step 6: Export chunks to JSON
      const iwsdkFile = await this.exportChunks(allIwsdkChunks, 'iwsdk_chunks.json', iwsdkDir);
      const depsFile = await this.exportChunks(depsChunks, 'deps_chunks.json', resolve(iwsdkDir, 'node_modules'));
      let threeFile: string | null = null;
      if (threeChunks.length > 0 && threeDir) {
        threeFile = await this.exportChunks(threeChunks, 'threejs_chunks.json', threeDir);
      }

      if (options.skipEmbeddings) {
        console.error('');
        console.error('='.repeat(80));
        console.error('⏹️  STOPPED BEFORE EMBEDDINGS (--skip-embeddings)');
        console.error('='.repeat(80));
        console.error('');
        console.error('Chunks exported to:');
        console.error(`  - ${iwsdkFile}`);
        console.error(`  - ${depsFile}`);
        if (threeFile) {
          console.error(`  - ${threeFile}`);
        }
        console.error('');
        return;
      }

      // Step 7: Generate embeddings
      const [iwsdkEmbeddings, depsEmbeddings, threeEmbeddings] = await this.generateEmbeddings(iwsdkFile, depsFile, threeFile);

      // Step 8: Combine and export final embeddings.json
      await this.exportFinalEmbeddings(iwsdkEmbeddings, depsEmbeddings, threeEmbeddings);

      // Step 9: Copy source files for MCP file access
      this.copySourceFiles(iwsdkDir, threeDir);

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
      // Install dependencies
      console.error('📥 Installing dependencies...');
      execSync('pnpm install', {
        cwd: iwsdkDir,
        stdio: 'inherit'
      });
      console.error('✅ Dependencies installed');
      console.error('');

      // Build
      console.error('🔨 Building SDK...');
      execSync('npm run build:tgz', {
        cwd: iwsdkDir,
        stdio: 'inherit'
      });
      console.error('✅ SDK built');
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

    for (let i = 0; i < tsFiles.length; i++) {
      const file = tsFiles[i];
      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const filtered = filterLargeChunks(optimized);

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
    console.error(`📊 Generated ${allChunks.length} code chunks`);
    console.error('');

    return allChunks;
  }

  private async ingestExamples(iwsdkDir: string): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('📚 INGESTING IWSDK EXAMPLES');
    console.error('='.repeat(80));
    console.error('');

    const examplesDir = resolve(iwsdkDir, 'examples');
    if (!existsSync(examplesDir)) {
      console.error('⚠️  examples folder not found - skipping');
      return [];
    }

    // Find JavaScript/TypeScript files in examples
    console.error('🔍 Finding example source files...');
    const jsFiles = await glob('*/src/**/*.{js,ts,tsx}', {
      cwd: examplesDir,
      ignore: ['**/node_modules/**', '**/dist/**'],
      absolute: true,
    });
    console.error(`   Found ${jsFiles.length} JS/TS files`);

    // Find uikitml files
    const uikitmlFiles = await glob('*/ui/**/*.uikitml', {
      cwd: examplesDir,
      absolute: true,
    });
    console.error(`   Found ${uikitmlFiles.length} uikitml files`);
    console.error('');

    const allChunks: TypeScriptChunk[] = [];

    // Process JS/TS files
    if (jsFiles.length > 0) {
      console.error('📝 Processing example JS/TS files...');
      const parser = new TypeScriptParser();
      const chunker = new ASTChunker();

      for (const file of jsFiles) {
        try {
          const chunks = parser.parseFile(file);
          if (chunks.length > 0) {
            const optimized = chunker.optimizeChunks(chunks);
            const filtered = filterLargeChunks(optimized);
            for (const chunk of filtered) {
              chunk.source = 'iwsdk';
              // Add semantic label for examples
              if (!chunk.semantic_labels.includes('example')) {
                chunk.semantic_labels.push('example');
              }
            }
            allChunks.push(...filtered);
          }
        } catch (error) {
          // Silently skip errors
        }
      }
      console.error(`   Generated ${allChunks.length} chunks from JS/TS`);
    }

    // Process uikitml files - create simple text chunks
    if (uikitmlFiles.length > 0) {
      console.error('📝 Processing uikitml files...');
      let uikitmlCount = 0;

      for (const file of uikitmlFiles) {
        try {
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');

          // Extract example name from path (e.g., "grab" from examples/grab/ui/file.uikitml)
          const pathParts = file.split('/');
          const exampleIdx = pathParts.indexOf('examples');
          const exampleName = exampleIdx >= 0 ? pathParts[exampleIdx + 1] : 'unknown';

          // Get filename without extension
          const fileName = pathParts[pathParts.length - 1].replace('.uikitml', '');

          const chunk: TypeScriptChunk = {
            content,
            chunk_type: 'uikitml',
            name: `${exampleName}/${fileName}`,
            start_line: 1,
            end_line: lines.length,
            file_path: file,
            language: 'uikitml',
            imports: [],
            exports: [],
            type_parameters: [],
            decorators: [],
            calls: [],
            extends: [],
            implements: [],
            uses_types: [],
            ecs_component: false,
            ecs_system: false,
            webxr_api_usage: [],
            three_js_usage: [],
            semantic_labels: ['uikitml', 'ui', 'example', exampleName],
            source: 'iwsdk',
          };

          allChunks.push(chunk);
          uikitmlCount++;
        } catch (error) {
          // Silently skip errors
        }
      }
      console.error(`   Generated ${uikitmlCount} uikitml chunks`);
    }

    console.error('');
    console.error(`📊 Generated ${allChunks.length} total example chunks`);
    console.error('');

    return allChunks;
  }

  private getThreeJSVersion(iwsdkDir: string): string | null {
    try {
      const corePkgPath = resolve(iwsdkDir, 'packages', 'core', 'package.json');
      if (!existsSync(corePkgPath)) return null;

      const pkg = JSON.parse(readFileSync(corePkgPath, 'utf-8'));
      const threeDep = pkg.dependencies?.three;
      if (!threeDep) return null;

      // Handle formats like "npm:super-three@0.177.0" or "^0.177.0"
      const match = threeDep.match(/(\d+)\.(\d+)/);
      if (match) {
        return match[2]; // Return minor version (e.g., "177")
      }
      return null;
    } catch {
      return null;
    }
  }

  private async cloneThreeJS(iwsdkDir: string): Promise<string | null> {
    console.error('='.repeat(80));
    console.error('📦 CLONING THREE.JS');
    console.error('='.repeat(80));
    console.error('');

    const version = this.getThreeJSVersion(iwsdkDir);
    if (!version) {
      console.error('⚠️  Could not determine Three.js version from IWSDK - skipping');
      return null;
    }

    const tag = `r${version}`;
    console.error(`📌 Detected Three.js version: r${version}`);
    console.error('');

    const threeDir = resolve(this.tempDir, 'three.js');

    // Check if already cloned with correct tag
    if (existsSync(threeDir)) {
      try {
        const currentTag = execSync('git describe --tags --exact-match 2>/dev/null || echo ""', {
          cwd: threeDir,
          encoding: 'utf-8',
        }).trim();
        if (currentTag === tag) {
          console.error(`⏭️  Three.js ${tag} already cloned`);
          return threeDir;
        }
      } catch {
        // Continue with fresh clone
      }
      console.error('🗑️  Removing existing Three.js repo...');
      rmSync(threeDir, { recursive: true, force: true });
    }

    // Clone with specific tag
    console.error(`🔽 Cloning Three.js at tag ${tag}...`);
    try {
      execSync(`git clone --depth 1 --branch ${tag} ${THREEJS_REPO} ${threeDir}`, {
        stdio: 'inherit'
      });
      console.error('✅ Three.js cloned');
      console.error('');
      return threeDir;
    } catch (error) {
      console.error(`❌ Failed to clone Three.js at tag ${tag}: ${error}`);
      return null;
    }
  }

  private async ingestThreeJS(threeDir: string): Promise<TypeScriptChunk[]> {
    console.error('='.repeat(80));
    console.error('🎨 INGESTING THREE.JS');
    console.error('='.repeat(80));
    console.error('');

    const allChunks: TypeScriptChunk[] = [];

    // Ingest Three.js source code
    console.error('🔍 Finding Three.js source files...');
    const srcFiles = await glob('src/**/*.js', {
      cwd: threeDir,
      absolute: true,
    });
    console.error(`   Found ${srcFiles.length} source files`);

    // Ingest examples
    console.error('🔍 Finding Three.js examples...');
    const exampleFiles = await glob('examples/*.html', {
      cwd: threeDir,
      absolute: true,
    });
    console.error(`   Found ${exampleFiles.length} example files`);
    console.error('');

    // Process source files with parser
    if (srcFiles.length > 0) {
      console.error('📝 Processing Three.js source files...');
      const parser = new TypeScriptParser();
      const chunker = new ASTChunker();
      let srcChunks = 0;

      for (let i = 0; i < srcFiles.length; i++) {
        const file = srcFiles[i];
        try {
          const chunks = parser.parseFile(file);
          if (chunks.length > 0) {
            const optimized = chunker.optimizeChunks(chunks);
            const filtered = filterLargeChunks(optimized);
            for (const chunk of filtered) {
              chunk.source = 'threejs';
              if (!chunk.semantic_labels.includes('threejs')) {
                chunk.semantic_labels.push('threejs');
              }
            }
            allChunks.push(...filtered);
            srcChunks += filtered.length;
          }
        } catch {
          // Silently skip errors
        }

        // Progress every 100 files
        if ((i + 1) % 100 === 0 || (i + 1) === srcFiles.length) {
          const progress = Math.round(((i + 1) / srcFiles.length) * 100);
          console.error(`   Progress: ${i + 1}/${srcFiles.length} files (${progress}%)`);
        }
      }
      console.error(`   Generated ${srcChunks} source chunks`);
    }

    // Process example files as raw HTML chunks
    if (exampleFiles.length > 0) {
      console.error('📝 Processing Three.js examples...');
      let exampleCount = 0;

      for (const file of exampleFiles) {
        try {
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          const fileName = file.split('/').pop()?.replace('.html', '') || 'unknown';

          // Extract category from filename (e.g., webgl_animation_keyframes -> webgl, animation)
          const parts = fileName.split('_');
          const category = parts[0] || 'misc';
          const subcategory = parts[1] || '';

          const chunk: TypeScriptChunk = {
            content,
            chunk_type: 'example',
            name: fileName,
            start_line: 1,
            end_line: lines.length,
            file_path: file,
            language: 'javascript', // HTML with JS
            imports: [],
            exports: [],
            type_parameters: [],
            decorators: [],
            calls: [],
            extends: [],
            implements: [],
            uses_types: [],
            ecs_component: false,
            ecs_system: false,
            webxr_api_usage: fileName.includes('webxr') || fileName.includes('vr') || fileName.includes('ar')
              ? [fileName] : [],
            three_js_usage: [],
            semantic_labels: ['threejs', 'example', category, subcategory].filter(Boolean),
            source: 'threejs',
          };

          allChunks.push(chunk);
          exampleCount++;
        } catch {
          // Silently skip errors
        }
      }
      console.error(`   Generated ${exampleCount} example chunks`);
    }

    console.error('');
    console.error(`📊 Generated ${allChunks.length} total Three.js chunks`);
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

    // Filter to included dependencies (excluding @types/three since we ingest three.js source)
    const includedDeps = ['@types/webxr', '@pmndrs/pointer-events', '@pmndrs/uikit', '@pmndrs/uikitml', '@preact/signals-core', 'elics', '@babylonjs/havok'];
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

    for (let i = 0; i < filtered.length; i++) {
      const file = filtered[i];
      try {
        const chunks = parser.parseFile(file);
        if (chunks.length > 0) {
          const optimized = chunker.optimizeChunks(chunks);
          const sizeFiltered = filterLargeChunks(optimized);

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

  private async generateEmbeddings(iwsdkFile: string, depsFile: string, threeFile: string | null): Promise<[string, string, string | null]> {
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

    // Generate Three.js embeddings
    let threeOutput: string | null = null;
    if (threeFile) {
      threeOutput = resolve(this.tempDir, 'threejs_embeddings.json');
      console.error('📊 Generating Three.js embeddings...');
      execSync(`node ${embedScript} ${threeFile} ${threeOutput}`, {
        cwd: this.repoRoot,
        stdio: 'inherit',
      });
      console.error('');
    }

    return [iwsdkOutput, depsOutput, threeOutput];
  }

  private async exportFinalEmbeddings(iwsdkFile: string, depsFile: string, threeFile: string | null): Promise<void> {
    console.error('='.repeat(80));
    console.error('📤 EXPORTING TO JSON');
    console.error('='.repeat(80));
    console.error('');

    // Read embeddings
    console.error('📖 Reading embeddings...');
    const iwsdkData = JSON.parse(readFileSync(iwsdkFile, 'utf-8'));
    const depsData = JSON.parse(readFileSync(depsFile, 'utf-8'));
    const threeData = threeFile ? JSON.parse(readFileSync(threeFile, 'utf-8')) : [];

    console.error(`✅ Loaded ${iwsdkData.length} IWSDK chunks with embeddings`);
    console.error(`✅ Loaded ${depsData.length} dependency chunks with embeddings`);
    if (threeData.length > 0) {
      console.error(`✅ Loaded ${threeData.length} Three.js chunks with embeddings`);
    }
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

    const outputData: Record<string, unknown> = {
      version: iwsdkVersion,
      model: 'jinaai/jina-embeddings-v2-base-code',
      dimensions: iwsdkData[0]?.embedding.length || 768,
      iwsdk: iwsdkData,
      deps: depsData,
    };

    // Add Three.js if available
    if (threeData.length > 0) {
      outputData.threejs = threeData;
    }

    const embeddingsFile = resolve(this.dataDir, 'embeddings.json');
    writeFileSync(embeddingsFile, JSON.stringify(outputData));

    const totalChunks = iwsdkData.length + depsData.length + threeData.length;
    console.error(`✅ Exported to ${embeddingsFile}`);
    console.error(`   Total chunks: ${totalChunks}`);
    console.error('');
  }

  private copySourceFiles(iwsdkDir: string, threeDir: string | null): void {
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

    // Copy examples
    console.error('📦 Copying IWSDK examples...');
    const examplesSrc = resolve(iwsdkDir, 'examples');
    const examplesTarget = resolve(sourcesDir, 'iwsdk', 'examples');

    if (existsSync(examplesSrc)) {
      const exampleNames = ['audio', 'grab', 'locomotion', 'physics', 'scene-understanding'];
      for (const exName of exampleNames) {
        const exSrc = join(examplesSrc, exName);
        if (existsSync(exSrc)) {
          const exTarget = join(examplesTarget, exName);
          console.error(`  - Copying ${exName}...`);
          // Copy src and ui folders only
          const srcDir = join(exSrc, 'src');
          const uiDir = join(exSrc, 'ui');
          if (existsSync(srcDir)) {
            cpSync(srcDir, join(exTarget, 'src'), { recursive: true });
          }
          if (existsSync(uiDir)) {
            cpSync(uiDir, join(exTarget, 'ui'), { recursive: true });
          }
        }
      }
      console.error(`✅ Copied ${exampleNames.length} examples`);
    } else {
      console.error('  ⚠️  examples folder not found');
    }
    console.error('');

    // Copy Three.js source and examples (code only, skip assets)
    if (threeDir && existsSync(threeDir)) {
      console.error('📦 Copying Three.js source and examples...');
      const threeTarget = resolve(sourcesDir, 'threejs');

      // Copy src folder
      const threeSrc = join(threeDir, 'src');
      if (existsSync(threeSrc)) {
        console.error('  - Copying src/...');
        cpSync(threeSrc, join(threeTarget, 'src'), { recursive: true });
      }

      // Copy only code from examples (skip models, textures, sounds, screenshots)
      const threeExamples = join(threeDir, 'examples');
      if (existsSync(threeExamples)) {
        const examplesTarget = join(threeTarget, 'examples');
        mkdirSync(examplesTarget, { recursive: true });

        // Copy jsm/ folder (JavaScript modules - actual code)
        const jsmSrc = join(threeExamples, 'jsm');
        if (existsSync(jsmSrc)) {
          console.error('  - Copying examples/jsm/...');
          cpSync(jsmSrc, join(examplesTarget, 'jsm'), { recursive: true });
        }

        // Copy HTML example files (root level only)
        console.error('  - Copying examples/*.html...');
        const htmlFiles = glob.sync('*.html', { cwd: threeExamples, absolute: true });
        for (const htmlFile of htmlFiles) {
          const fileName = htmlFile.split('/').pop()!;
          cpSync(htmlFile, join(examplesTarget, fileName));
        }
        console.error(`    Copied ${htmlFiles.length} HTML examples`);
      }

      console.error('✅ Copied Three.js source and examples (code only)');
    }
    console.error('');

    // Copy dependency type definitions (excluding @types/three since we have three.js source)
    console.error('📦 Copying dependency type definitions...');
    const nodeModules = resolve(iwsdkDir, 'node_modules');
    const depsTarget = resolve(sourcesDir, 'deps');

    if (existsSync(nodeModules)) {
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
