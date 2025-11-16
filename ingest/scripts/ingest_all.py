#!/usr/bin/env python
"""
Complete IWSDK RAG ingestion pipeline - one command to rule them all.

This script:
1. Clones immersive-web-sdk from GitHub to temp folder
2. Installs dependencies (pnpm install)
3. Builds the SDK (npm run build:tgz)
4. Ingests IWSDK runtime code
5. Ingests dependencies (Three.js, WebXR types)
6. Exports to JSON for MCP server
7. Validates data integrity
8. Cleans up temp folder

Usage:
    python scripts/ingest_all.py
    python scripts/ingest_all.py --keep-repo  # Don't delete cloned repo
    python scripts/ingest_all.py --skip-build  # Skip pnpm install/build (repo must exist)
"""

import sys
import subprocess
import shutil
from pathlib import Path
from typing import Optional, List
from tqdm import tqdm
import argparse

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ingestion.parsers.typescript_parser import TypeScriptParser
from ingestion.chunkers.ast_chunker import ASTChunker
from ingestion.embedders.simple_embedder import SimpleEmbedder
from storage.vector_store import VectorStore


# Configuration
IWSDK_REPO = "https://github.com/facebook/immersive-web-sdk.git"
IWSDK_RUNTIME_PACKAGES = {'core', 'xr-input', 'locomotor', 'glxf'}
IWSDK_EXCLUDE_PACKAGES = {
    'vite-plugin-iwsdk',
    'vite-plugin-legacy-worker',
    'create',
    'starter-assets'
}


def run_command(cmd: List[str], cwd: Optional[Path] = None, description: str = "") -> bool:
    """Run a shell command and return success status."""
    try:
        if description:
            print(f"  {description}...")
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ❌ Command failed: {' '.join(cmd)}")
        print(f"  Error: {e.stderr}")
        return False


def clone_and_build_iwsdk(temp_dir: Path, skip_build: bool = False) -> Optional[Path]:
    """Clone IWSDK repo and build it."""
    print("=" * 80)
    print("📥 CLONING AND BUILDING IWSDK")
    print("=" * 80)
    print()

    iwsdk_dir = temp_dir / "immersive-web-sdk"

    if not iwsdk_dir.exists():
        print(f"📦 Cloning {IWSDK_REPO}...")
        if not run_command(
            ["git", "clone", IWSDK_REPO, str(iwsdk_dir)],
            description="Cloning repository"
        ):
            return None
        print("✅ Repository cloned")
        print()

    if skip_build:
        print("⏭️  Skipping build (--skip-build)")
        print()
        return iwsdk_dir

    print("📦 Installing dependencies (pnpm install)...")
    if not run_command(
        ["pnpm", "install"],
        cwd=iwsdk_dir,
        description="Running pnpm install"
    ):
        print("  ⚠️  pnpm not found, trying npm...")
        if not run_command(
            ["npm", "install"],
            cwd=iwsdk_dir,
            description="Running npm install"
        ):
            return None
    print("✅ Dependencies installed")
    print()

    print("🔨 Building SDK (npm run build:tgz)...")
    if not run_command(
        ["npm", "run", "build:tgz"],
        cwd=iwsdk_dir,
        description="Building SDK"
    ):
        return None
    print("✅ SDK built successfully")
    print()

    return iwsdk_dir


def should_include_file(file_path: Path, root: Path) -> bool:
    """Determine if a file should be included in ingestion."""
    try:
        rel_path = file_path.relative_to(root)
    except ValueError:
        return False

    parts = rel_path.parts

    # Skip test files and type definitions
    if '.test.' in file_path.name or '.spec.' in file_path.name:
        return False
    if file_path.name.endswith('.d.ts'):
        return False

    # Skip build output and config
    if any(p in parts for p in ['dist', 'build', 'node_modules', '.git']):
        return False

    # Include examples
    if 'examples' in parts and 'src' in parts:
        return True

    # Include runtime packages
    if 'packages' in parts:
        pkg_idx = parts.index('packages') + 1
        if pkg_idx < len(parts):
            pkg_name = parts[pkg_idx]
            if pkg_name in IWSDK_EXCLUDE_PACKAGES:
                return False
            if pkg_name in IWSDK_RUNTIME_PACKAGES and 'src' in parts:
                return True
        return False

    return False


def ingest_iwsdk_source(iwsdk_dir: Path) -> int:
    """Ingest IWSDK TypeScript source files."""
    print("=" * 80)
    print("📝 INGESTING IWSDK SOURCE CODE")
    print("=" * 80)
    print()

    # Find TypeScript files
    print("🔍 Finding TypeScript files...")
    ts_files = []
    for pattern in ['**/*.ts', '**/*.tsx']:
        for file_path in iwsdk_dir.glob(pattern):
            if should_include_file(file_path, iwsdk_dir):
                ts_files.append(file_path)

    print(f"✅ Found {len(ts_files)} TypeScript files")
    print()

    # Initialize components
    print("🔧 Initializing components...")
    parser = TypeScriptParser()
    chunker = ASTChunker()
    embedder = SimpleEmbedder()
    store = VectorStore()

    print("⚠️  Clearing existing data from vector store...")
    store.clear()
    print()

    # Process files
    print(f"📝 Processing {len(ts_files)} files...")
    print()

    all_chunks = []
    successful = 0
    failed = 0

    for file_path in tqdm(ts_files, desc="Processing files"):
        try:
            # Parse file
            chunks = parser.parse_file(str(file_path))
            if not chunks:
                continue

            # Optimize chunks
            optimized = chunker.optimize_chunks(chunks)

            # Add source metadata
            for chunk in optimized:
                chunk.source = 'iwsdk'

            all_chunks.extend(optimized)
            successful += 1

        except Exception as e:
            failed += 1
            if failed <= 5:  # Show first 5 errors
                print(f"  ⚠️  Error processing {file_path.name}: {e}")

    print()
    print(f"✅ Processed {successful} files successfully")
    if failed > 0:
        print(f"⚠️  Failed to process {failed} files")
    print(f"📊 Generated {len(all_chunks)} code chunks")
    print()

    # Generate embeddings
    print("🧠 Generating embeddings...")
    all_embeddings = embedder.embed_chunks(all_chunks)
    print(f"✅ Generated {len(all_embeddings)} embeddings")
    print()

    # Store in vector database
    print("💾 Storing in vector database...")
    store.add_chunks(all_chunks, all_embeddings, source='iwsdk')
    print()

    # Validate
    print("🔍 Validating IWSDK ingestion...")
    components = sum(1 for c in all_chunks if c.ecs_component)
    systems = sum(1 for c in all_chunks if c.ecs_system)

    EXPECTED_COMPONENTS = 27
    EXPECTED_SYSTEMS = 17

    print(f"  ECS Components: {components} (expected: {EXPECTED_COMPONENTS})")
    print(f"  ECS Systems: {systems} (expected: {EXPECTED_SYSTEMS})")

    if components == EXPECTED_COMPONENTS:
        print(f"  ✅ All {EXPECTED_COMPONENTS} components found")
    else:
        print(f"  ⚠️  WARNING: Expected {EXPECTED_COMPONENTS}, found {components}")

    if systems == EXPECTED_SYSTEMS:
        print(f"  ✅ All {EXPECTED_SYSTEMS} systems found")
    else:
        print(f"  ⚠️  WARNING: Expected {EXPECTED_SYSTEMS}, found {systems}")
    print()

    return len(all_chunks)


def should_include_dep_file(file_path: Path, root: Path) -> bool:
    """Determine if a dependency file should be included (from old ingest_deps.py)."""
    # Must be a .d.ts file
    if not file_path.name.endswith('.d.ts'):
        return False

    # Skip test/example files
    if '.test.' in file_path.name or '.spec.' in file_path.name or 'example' in file_path.name.lower():
        return False

    try:
        rel_path = file_path.relative_to(root)
    except ValueError:
        return False

    parts = rel_path.parts

    # Check if it's in node_modules
    if 'node_modules' not in parts:
        return False

    # Find the LAST node_modules occurrence (handles pnpm's nested structure)
    nm_indices = [i for i, part in enumerate(parts) if part == 'node_modules']
    if not nm_indices:
        return False

    nm_idx = nm_indices[-1]

    # Get the package name (handles @scope/package format)
    if nm_idx + 1 < len(parts):
        pkg_part1 = parts[nm_idx + 1]

        # Handle scoped packages like @types/three
        if pkg_part1.startswith('@'):
            if nm_idx + 2 < len(parts):
                pkg_name = f"{pkg_part1}/{parts[nm_idx + 2]}"
            else:
                pkg_name = pkg_part1
        else:
            pkg_name = pkg_part1

        # Include three, webxr, and @types variants
        included_deps = ['@types/three', '@types/webxr', '@pmndrs/pointer-events', '@pmndrs/uikit', '@pmndrs/uikitml', '@preact/signals-core', 'elics', '@babylonjs/havok']
        return pkg_name in included_deps

    return False


def ingest_dependencies(iwsdk_dir: Path) -> int:
    """Ingest dependency type definitions (Three.js, WebXR)."""
    print("=" * 80)
    print("📦 INGESTING DEPENDENCIES")
    print("=" * 80)
    print()

    node_modules = iwsdk_dir / "node_modules"
    if not node_modules.exists():
        print("❌ node_modules not found - dependencies not installed?")
        return 0

    # Find ALL .d.ts files in node_modules, then filter (old method)
    print("🔍 Finding dependency type definitions...")
    all_dts_files = list(iwsdk_dir.glob("**/node_modules/**/*.d.ts"))
    print(f"  Found {len(all_dts_files)} total .d.ts files in node_modules")

    # Filter to included dependencies
    ts_files = [f for f in all_dts_files if should_include_dep_file(f, iwsdk_dir)]
    print(f"✅ Found {len(ts_files)} type definition files from dependencies")
    print()

    if not ts_files:
        print("⚠️  No dependency files to ingest")
        return 0

    # Initialize components
    parser = TypeScriptParser()
    chunker = ASTChunker()
    embedder = SimpleEmbedder()
    store = VectorStore()

    # Process files
    print(f"📝 Processing {len(ts_files)} dependency files...")
    print()

    all_chunks = []
    for file_path in tqdm(ts_files, desc="Processing dependencies"):
        try:
            chunks = parser.parse_file(str(file_path))
            if not chunks:
                continue

            optimized = chunker.optimize_chunks(chunks)

            for chunk in optimized:
                chunk.source = 'deps'

            all_chunks.extend(optimized)

        except Exception:
            pass  # Silently skip errors for dependencies

    print()
    print(f"📊 Generated {len(all_chunks)} dependency chunks")
    print()

    # Generate embeddings
    print("🧠 Generating embeddings...")
    all_embeddings = embedder.embed_chunks(all_chunks)
    print(f"✅ Generated {len(all_embeddings)} embeddings")
    print()

    # Store in vector database
    print("💾 Storing in vector database...")
    store.add_chunks(all_chunks, all_embeddings, source='deps')
    print()

    return len(all_chunks)


def export_to_json():
    """Export vector store to JSON for MCP server."""
    print("=" * 80)
    print("📤 EXPORTING TO JSON")
    print("=" * 80)
    print()

    # Import and run export
    from export_for_npm import export_to_json as export_fn

    output_path = Path(__file__).parent.parent.parent / "mcp" / "data"
    export_fn(str(output_path))


def run_health_check() -> bool:
    """Run health check."""
    print("=" * 80)
    print("🏥 RUNNING HEALTH CHECK")
    print("=" * 80)
    print()

    from health_check import check_vector_store, check_export_data

    vector_ok = check_vector_store()
    export_ok = check_export_data()

    return vector_ok and export_ok


def main():
    """Main ingestion pipeline."""
    parser = argparse.ArgumentParser(
        description="Complete IWSDK RAG ingestion pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--keep-repo", action="store_true",
                       help="Keep cloned repository (don't delete)")
    parser.add_argument("--skip-build", action="store_true",
                       help="Skip pnpm install and build (repo must already exist)")
    parser.add_argument("--repo-path", type=str,
                       help="Use existing repo at this path instead of cloning")

    args = parser.parse_args()

    print()
    print("=" * 80)
    print("🚀 IWSDK RAG COMPLETE INGESTION PIPELINE")
    print("=" * 80)
    print()

    # Setup temp directory
    iwsdk_dir = None  # Initialize for cleanup in finally block

    if args.repo_path:
        temp_dir = Path(args.repo_path).parent
        iwsdk_dir = Path(args.repo_path)
        print(f"📁 Using existing repo: {iwsdk_dir}")
        print()
    else:
        # Use local .temp directory instead of system temp
        repo_root = Path(__file__).parent.parent.parent
        temp_dir = repo_root / ".temp"
        temp_dir.mkdir(exist_ok=True)
        print(f"📁 Temp directory: {temp_dir}")
        print()

        # Clone and build
        iwsdk_dir = clone_and_build_iwsdk(temp_dir, args.skip_build)
        if not iwsdk_dir:
            print("❌ Failed to clone/build IWSDK")
            sys.exit(1)

    try:
        # Ingest source code
        iwsdk_chunks = ingest_iwsdk_source(iwsdk_dir)

        # Ingest dependencies
        deps_chunks = ingest_dependencies(iwsdk_dir)

        # Export to JSON
        export_to_json()

        # Health check
        health_ok = run_health_check()

        # Final summary
        print()
        print("=" * 80)
        print("✅ INGESTION COMPLETE")
        print("=" * 80)
        print()
        print(f"Total chunks ingested: {iwsdk_chunks + deps_chunks}")
        print(f"  - IWSDK: {iwsdk_chunks}")
        print(f"  - Dependencies: {deps_chunks}")
        print()

        if health_ok:
            print("✅ All health checks passed!")
            print()
            print("Next steps:")
            print("  1. cd ../mcp")
            print("  2. npm run build")
            print("  3. Restart Claude Desktop")
        else:
            print("⚠️  Some health checks failed - review output above")
            sys.exit(1)

    finally:
        # Cleanup
        if not args.keep_repo and not args.repo_path and iwsdk_dir and iwsdk_dir.exists():
            print()
            print("🧹 Cleaning up cloned repository...")
            shutil.rmtree(iwsdk_dir)
            print("✅ Cleanup complete")
            print(f"   (Tip: Use --keep-repo to inspect the cloned repo at {iwsdk_dir})")

    print()


if __name__ == "__main__":
    main()
