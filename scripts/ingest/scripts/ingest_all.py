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
import json
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


def get_iwsdk_version(iwsdk_dir: Path) -> Optional[str]:
    """Extract IWSDK version from packages/core/package.json."""
    try:
        core_pkg_json = iwsdk_dir / "packages" / "core" / "package.json"
        if core_pkg_json.exists():
            with open(core_pkg_json) as f:
                data = json.load(f)
                return data.get("version")
    except Exception as e:
        print(f"  ⚠️  Failed to read core package version: {e}")

    return None


def update_parent_package_version(iwsdk_version: str):
    """Update the parent project's package.json with IWSDK version."""
    # Go from scripts/ingest/scripts -> scripts/ingest -> scripts -> root
    repo_root = Path(__file__).parent.parent.parent.parent
    package_json_path = repo_root / "package.json"

    if not package_json_path.exists():
        print("  ⚠️  Parent package.json not found")
        return

    try:
        with open(package_json_path, 'r') as f:
            package_data = json.load(f)

        old_version = package_data.get('version', 'unknown')
        package_data['version'] = iwsdk_version

        with open(package_json_path, 'w') as f:
            json.dump(package_data, f, indent=2)
            f.write('\n')  # Add trailing newline

        print(f"  ✅ Updated package.json version: {old_version} → {iwsdk_version}")
    except Exception as e:
        print(f"  ⚠️  Failed to update package.json: {e}")


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

    EXPECTED_COMPONENTS = 28  # Updated - IWSDK codebase has grown
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


def export_to_json(iwsdk_version: str = None):
    """Export vector store to JSON for MCP server."""
    print("=" * 80)
    print("📤 EXPORTING TO JSON")
    print("=" * 80)
    print()

    # Import and run export
    from export_for_npm import export_to_json as export_fn

    # Go from scripts/ingest/scripts -> scripts/ingest -> scripts -> root -> data
    output_path = Path(__file__).parent.parent.parent.parent / "data"
    export_fn(str(output_path), iwsdk_version=iwsdk_version)


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


def copy_source_files(iwsdk_dir: Path):
    """Copy source files to data/sources/ for reference."""
    print("=" * 80)
    print("📋 COPYING SOURCE FILES")
    print("=" * 80)
    print()

    # Get repo root and sources directory
    # Go from scripts/ingest/scripts -> scripts/ingest -> scripts -> root
    repo_root = Path(__file__).parent.parent.parent.parent
    sources_dir = repo_root / "data" / "sources"

    print(f"📁 Source directory: {sources_dir}")
    print()

    # Clear existing sources
    if sources_dir.exists():
        print("🧹 Clearing existing source files...")
        shutil.rmtree(sources_dir)

    sources_dir.mkdir(parents=True, exist_ok=True)
    print("✅ Source directory ready")
    print()

    # 1. Copy IWSDK runtime packages
    print("📦 Copying IWSDK runtime packages...")
    iwsdk_target = sources_dir / "iwsdk"
    iwsdk_target.mkdir(exist_ok=True)

    packages_dir = iwsdk_dir / "packages"
    for package_name in IWSDK_RUNTIME_PACKAGES:
        package_src = packages_dir / package_name / "src"
        if package_src.exists():
            package_target = iwsdk_target / package_name
            print(f"  - Copying {package_name}...")
            shutil.copytree(package_src, package_target, dirs_exist_ok=True)
        else:
            print(f"  ⚠️  Package {package_name}/src not found")

    print(f"✅ Copied {len(IWSDK_RUNTIME_PACKAGES)} IWSDK packages")
    print()

    # 2. Copy dependency type definitions
    print("📦 Copying dependency type definitions...")
    deps_target = sources_dir / "deps"
    deps_target.mkdir(exist_ok=True)

    # Find dependency paths (handle pnpm's nested structure)
    node_modules = iwsdk_dir / "node_modules"

    # Copy Three.js types
    three_sources = [
        node_modules / "@types" / "three",  # Direct path
        node_modules / ".pnpm" / "node_modules" / "@types" / "three",  # pnpm structure
    ]
    for three_src in three_sources:
        if three_src.exists():
            three_target = deps_target / "three"
            print(f"  - Copying three.js types from {three_src.name}...")
            shutil.copytree(three_src, three_target, dirs_exist_ok=True)
            break
    else:
        print("  ⚠️  Three.js types not found")

    # Copy WebXR types (handle pnpm's versioned structure)
    webxr_found = False
    pnpm_dir = node_modules / ".pnpm"
    if pnpm_dir.exists():
        # Look for @types+webxr@* directories
        for item in pnpm_dir.iterdir():
            if item.is_dir() and item.name.startswith("@types+webxr@"):
                webxr_src = item / "node_modules" / "@types" / "webxr"
                if webxr_src.exists():
                    webxr_target = deps_target / "webxr"
                    print(f"  - Copying WebXR types from {item.name}...")
                    shutil.copytree(webxr_src, webxr_target, dirs_exist_ok=True)
                    webxr_found = True
                    break

    if not webxr_found:
        # Fallback to direct path
        webxr_src = node_modules / "@types" / "webxr"
        if webxr_src.exists():
            webxr_target = deps_target / "webxr"
            print(f"  - Copying WebXR types from @types/webxr...")
            shutil.copytree(webxr_src, webxr_target, dirs_exist_ok=True)
            webxr_found = True

    if not webxr_found:
        print("  ⚠️  WebXR types not found")

    print("✅ Copied dependency type definitions")
    print()

    # 3. Copy elics (ECS library) - handle pnpm's versioned structure
    # Note: elics has .d.ts files in lib/ directory, not src/
    print("📦 Copying elics (ECS library)...")
    elics_found = False
    if pnpm_dir.exists():
        # Look for elics@* directories
        for item in pnpm_dir.iterdir():
            if item.is_dir() and item.name.startswith("elics@"):
                elics_lib_dir = item / "node_modules" / "elics" / "lib"
                if elics_lib_dir.exists():
                    elics_target = sources_dir / "elics" / "src"  # Keep as /src for consistency
                    print(f"  - Copying elics from {item.name}...")
                    shutil.copytree(elics_lib_dir, elics_target, dirs_exist_ok=True)
                    elics_found = True
                    break

    if not elics_found:
        # Fallback to direct path (lib directory)
        elics_lib_dir = node_modules / "elics" / "lib"
        if elics_lib_dir.exists():
            elics_target = sources_dir / "elics" / "src"
            print(f"  - Copying elics from elics/lib...")
            shutil.copytree(elics_lib_dir, elics_target, dirs_exist_ok=True)
            elics_found = True

    if not elics_found:
        print("  ⚠️  elics not found")

    print("✅ Copied elics library")
    print()

    print("=" * 80)
    print("✅ SOURCE FILES COPIED")
    print("=" * 80)
    print()
    print(f"Source files available at: {sources_dir}")
    print()


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
        # Go from scripts/ingest/scripts -> scripts/ingest -> scripts -> root
        repo_root = Path(__file__).parent.parent.parent.parent
        temp_dir = repo_root / "scripts" / ".temp"
        temp_dir.mkdir(exist_ok=True)
        print(f"📁 Temp directory: {temp_dir}")
        print()

        # Clone and build
        iwsdk_dir = clone_and_build_iwsdk(temp_dir, args.skip_build)
        if not iwsdk_dir:
            print("❌ Failed to clone/build IWSDK")
            sys.exit(1)

    try:
        # Extract and sync IWSDK version
        print("=" * 80)
        print("🔖 SYNCING IWSDK VERSION")
        print("=" * 80)
        print()

        iwsdk_version = get_iwsdk_version(iwsdk_dir)
        if iwsdk_version:
            print(f"📦 IWSDK version: {iwsdk_version}")
            update_parent_package_version(iwsdk_version)
        else:
            print("  ⚠️  Could not determine IWSDK version")
        print()

        # Ingest source code
        iwsdk_chunks = ingest_iwsdk_source(iwsdk_dir)

        # Ingest dependencies
        deps_chunks = ingest_dependencies(iwsdk_dir)

        # Export to JSON
        export_to_json(iwsdk_version=iwsdk_version)

        # Copy source files for reference
        copy_source_files(iwsdk_dir)

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
            print("  1. npm run build")
            print("  2. Restart Claude Desktop/Code")
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
