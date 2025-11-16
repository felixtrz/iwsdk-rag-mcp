#!/usr/bin/env python
"""
Ingest TypeScript type definitions from external dependencies into the vector store.

This script ingests ONLY type definition files (.d.ts) from key dependencies
like Three.js and WebXR. This allows semantic search to understand external APIs
without ingesting entire implementation code.

Why only type definitions?
- Small and focused (API signatures, not implementation)
- Useful for understanding interfaces and contracts
- Avoids bloating the database with implementation details

Dependencies included:
- three: Three.js 3D library
- @webxr/types or webxr: WebXR API type definitions

Usage:
    # Ingest from IWSDK node_modules (appends to existing data)
    python scripts/ingest_deps.py /path/to/immersive-web-sdk

    # Search dependencies
    python scripts/search.py "XRSession" --filter source=deps
"""

import sys
import os
from pathlib import Path
import argparse
from typing import Optional, List
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent.parent))

from ingestion.parsers.typescript_parser import TypeScriptParser
from ingestion.chunkers.ast_chunker import ASTChunker
from ingestion.embedders.simple_embedder import SimpleEmbedder
from storage.vector_store import VectorStore


# Dependencies to include
INCLUDED_DEPS = [
    'three',           # Three.js 3D library
    '@types/three',    # Three.js types (if separate)
    'webxr',           # WebXR types
    '@webxr/types',    # WebXR types (alternative location)
    '@types/webxr',    # WebXR types (alternative location)
]


def should_include_dep_file(file_path: Path, root: Path) -> bool:
    """
    Determine if a dependency file should be included.

    Include:
    - ONLY .d.ts files (type definitions)
    - From three, webxr, @types/three, @types/webxr
    - Exclude test/example files

    Args:
        file_path: Path to file
        root: Root directory

    Returns:
        True if file should be included
    """
    # Must be a .d.ts file
    if not file_path.name.endswith('.d.ts'):
        return False

    # Skip test/example files
    if '.test.' in file_path.name or '.spec.' in file_path.name:
        return False
    if 'example' in file_path.name.lower():
        return False

    try:
        rel_path = file_path.relative_to(root)
    except ValueError:
        return False

    parts = rel_path.parts

    # Check if it's in node_modules
    if 'node_modules' not in parts:
        return False

    # Handle both npm and pnpm structures
    # pnpm: node_modules/.pnpm/@types+three@0.177.0/node_modules/@types/three/...
    # npm:  node_modules/@types/three/...

    # Find the LAST node_modules occurrence (works for both npm and pnpm)
    nm_indices = [i for i, part in enumerate(parts) if part == 'node_modules']
    if not nm_indices:
        return False

    nm_idx = nm_indices[-1]  # Use last occurrence

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

        # Check if it's one of our included dependencies
        return pkg_name in INCLUDED_DEPS

    return False


def find_dep_files(root_path: Path) -> List[Path]:
    """
    Find type definition files for dependencies.

    Args:
        root_path: Root directory to search (usually IWSDK root)

    Returns:
        List of .d.ts file paths from dependencies
    """
    print(f"🔍 Searching for dependency type definitions in {root_path}...")

    # Find all .d.ts files
    all_dts_files = list(root_path.glob("**/node_modules/**/*.d.ts"))

    print(f"  Found {len(all_dts_files)} total .d.ts files in node_modules")

    # Filter to included dependencies
    dep_files = [f for f in all_dts_files if should_include_dep_file(f, root_path)]

    return dep_files


def ingest_deps(
    source_path: str,
    limit: Optional[int] = None
):
    """
    Ingest dependency type definitions into the vector store.

    Args:
        source_path: Path to project root (with node_modules)
        limit: Maximum number of files to process (for testing)
    """
    source_dir = Path(source_path)

    if not source_dir.exists():
        print(f"❌ Source path not found: {source_path}")
        return

    node_modules = source_dir / "node_modules"
    if not node_modules.exists():
        print(f"❌ node_modules not found in {source_path}")
        print()
        print("📋 Setup instructions:")
        print(f"   cd {source_path}")
        print(f"   npm install  # or pnpm install, or yarn install")
        print()
        print("This will download Three.js and WebXR type definitions to node_modules/")
        return

    print("=" * 80)
    print(f"🚀 Dependency Type Definitions Ingestion")
    print("=" * 80)
    print()
    print(f"📦 Source: deps")
    print(f"📁 Path: {source_path}")
    print(f"📚 Dependencies: {', '.join(INCLUDED_DEPS)}")
    print()

    # Find type definition files
    print("🔍 Finding type definition files...")
    dep_files = find_dep_files(source_dir)

    if limit:
        dep_files = dep_files[:limit]

    print(f"✅ Found {len(dep_files)} type definition files")
    print()

    if not dep_files:
        print("⚠️  No dependency type files found!")
        print()
        print("Checked for:")
        for dep in INCLUDED_DEPS:
            dep_path = node_modules / dep.replace('/', os.sep)
            exists = "✅" if dep_path.exists() else "❌"
            print(f"  {exists} {dep}")
        return

    # Show file breakdown by package
    by_package = {}
    for f in dep_files:
        try:
            rel = f.relative_to(node_modules)
            parts = rel.parts

            # Get package name
            if parts[0].startswith('@'):
                pkg_name = f"{parts[0]}/{parts[1]}" if len(parts) > 1 else parts[0]
            else:
                pkg_name = parts[0]

            by_package[pkg_name] = by_package.get(pkg_name, 0) + 1
        except:
            pass

    print("📊 Type definitions by package:")
    for package, count in sorted(by_package.items()):
        print(f"  {package}: {count} files")
    print()

    # Initialize pipeline components
    print("🔧 Initializing components...")
    parser = TypeScriptParser()
    chunker = ASTChunker()
    embedder = SimpleEmbedder()
    store = VectorStore()
    print()

    # Process files
    print(f"📝 Processing type definition files...")
    print()

    all_chunks = []
    successful = 0
    failed = 0
    skipped = 0

    for file_path in tqdm(dep_files, desc="Processing", unit="file"):
        try:
            # Parse
            chunks = parser.parse_file(str(file_path))

            if not chunks:
                skipped += 1
                continue

            # Optimize chunks
            chunks = chunker.optimize_chunks(chunks)

            # Add to batch
            all_chunks.extend(chunks)

            successful += 1

        except Exception as e:
            tqdm.write(f"❌ Error processing {file_path.name}: {e}")
            failed += 1

    print()
    print(f"📊 Parsing complete:")
    print(f"  ✅ Successful: {successful}")
    print(f"  ⏭️  Skipped (no chunks): {skipped}")
    print(f"  ❌ Failed: {failed}")
    print(f"  📦 Total chunks: {len(all_chunks)}")
    print()

    if not all_chunks:
        print("⚠️  No chunks to process!")
        return

    # Generate embeddings
    print("🔮 Generating embeddings...")
    all_embeddings = embedder.embed_chunks(all_chunks)
    print(f"✅ Generated {len(all_embeddings)} embeddings")
    print()

    # Store in vector database with source metadata
    print(f"💾 Storing in vector database (source: deps)...")
    store.add_chunks(all_chunks, all_embeddings, source="deps")
    print()

    # Show statistics
    print("=" * 80)
    print(f"📊 INGESTION COMPLETE: deps")
    print("=" * 80)
    print()

    stats = store.get_stats()
    print(f"Total chunks in database (all sources): {stats['total_chunks']}")
    print()
    print("Chunk types:")
    for chunk_type, count in sorted(stats['chunk_types'].items(), key=lambda x: -x[1]):
        print(f"  {chunk_type}: {count}")
    print()
    print("Languages:")
    for language, count in stats['languages'].items():
        print(f"  {language}: {count}")
    print()
    print(f"Unique files: {stats['unique_files']}")
    print()
    print("✅ Ready for search!")
    print()
    print("Search examples:")
    print(f'  python scripts/search.py "XRSession"')
    print(f'  python scripts/search.py "Three.js Group" --filter source=deps')
    print(f'  python scripts/search_relationships.py --extends Group --source deps')
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Ingest dependency type definitions into vector store",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Ingest Three.js and WebXR types from IWSDK node_modules
  python scripts/ingest_deps.py /path/to/immersive-web-sdk

  # Test with limited files
  python scripts/ingest_deps.py /path/to/immersive-web-sdk --limit 10

  # Search dependencies
  python scripts/search.py "XRSession" --filter source=deps

  # Find what extends Three.js classes
  python scripts/search_relationships.py --extends Group
        """
    )

    parser.add_argument("source_path",
                       help="Path to project root (with node_modules)")
    parser.add_argument("--limit", type=int,
                       help="Limit number of files to process (for testing)")

    args = parser.parse_args()

    ingest_deps(args.source_path, limit=args.limit)


if __name__ == "__main__":
    main()
