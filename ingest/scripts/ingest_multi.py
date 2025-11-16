#!/usr/bin/env python
"""
Ingest code from multiple sources (IWSDK, elics, etc.) into a unified vector store.

This script allows ingesting code from different repositories into the same collection,
with metadata tagging to distinguish the source. This enables cross-codebase semantic search.

Sources:
- iwsdk: Immersive Web SDK (filtered to runtime code)
- elics: Entity Component System library

Usage:
    # Ingest IWSDK (first time - clears DB)
    python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear

    # Ingest elics (appends to existing data)
    python scripts/ingest_multi.py /path/to/elics --source elics

    # Search across both sources
    python scripts/search.py "ECS component system"

    # Search specific source
    python scripts/search.py "physics" --filter source=iwsdk
"""

import sys
from pathlib import Path
import argparse
from typing import Optional, List
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent.parent))

from ingestion.parsers.typescript_parser import TypeScriptParser
from ingestion.chunkers.ast_chunker import ASTChunker
from ingestion.embedders.simple_embedder import SimpleEmbedder
from storage.vector_store import VectorStore


# IWSDK runtime packages to include
IWSDK_RUNTIME_PACKAGES = [
    'core',           # Main SDK runtime
    'xr-input',       # Input handling
    'locomotor',      # Movement systems
    'glxf',           # Scene loader
]

# IWSDK build/dev packages to exclude
IWSDK_EXCLUDE_PACKAGES = [
    'vite-plugin-metaspatial',
    'vite-plugin-iwer',
    'vite-plugin-gltf-optimizer',
    'vite-plugin-uikitml',
    'create',         # CLI scaffolding
    'starter-assets', # Templates
]


def should_include_iwsdk_file(file_path: Path, sdk_root: Path) -> bool:
    """
    Determine if an IWSDK file should be included in ingestion.

    Include:
    - packages/core/src/**/*.ts
    - packages/xr-input/src/**/*.ts
    - packages/locomotor/src/**/*.ts
    - packages/glxf/src/**/*.ts
    - examples/**/src/**/*.ts

    Exclude:
    - vite-plugin-* packages
    - CLI/build tools
    - Test files
    - Type definitions (.d.ts)
    """
    try:
        rel_path = file_path.relative_to(sdk_root)
    except ValueError:
        return False

    parts = rel_path.parts

    # Skip test files and type definitions
    if '.test.' in file_path.name or '.spec.' in file_path.name:
        return False
    if file_path.name.endswith('.d.ts'):
        return False

    # Include examples/**/src/**
    if 'examples' in parts:
        if 'src' in parts:
            return True
        return False

    # Include specific runtime packages
    if 'packages' in parts:
        pkg_idx = parts.index('packages') + 1
        if pkg_idx < len(parts):
            pkg_name = parts[pkg_idx]

            # Exclude build/dev packages
            if pkg_name in IWSDK_EXCLUDE_PACKAGES:
                return False

            # Include runtime packages
            if pkg_name in IWSDK_RUNTIME_PACKAGES:
                # Only src directory
                if 'src' in parts:
                    return True

            return False

    return False


def should_include_elics_file(file_path: Path, root: Path) -> bool:
    """
    Determine if an elics file should be included.

    Include:
    - src/**/*.ts

    Exclude:
    - Test files
    - Type definitions (.d.ts)
    - Build output
    """
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

    # Only include src directory
    if 'src' in parts:
        return True

    return False


def find_files(root_path: Path, source: str) -> List[Path]:
    """
    Find TypeScript files based on source type.

    Args:
        root_path: Root directory to search
        source: Source type ('iwsdk', 'elics')

    Returns:
        List of file paths to process
    """
    all_ts_files = list(root_path.glob("**/*.ts"))

    # Filter out node_modules and dist for all sources
    ts_files = [
        f for f in all_ts_files
        if 'node_modules' not in str(f)
        and 'dist' not in str(f)
        and 'build' not in str(f)
        and 'lib' not in str(f)  # elics build output
        and '__tests__' not in str(f)  # elics tests
    ]

    # Apply source-specific filtering
    if source == 'iwsdk':
        ts_files = [f for f in ts_files if should_include_iwsdk_file(f, root_path)]
    elif source == 'elics':
        ts_files = [f for f in ts_files if should_include_elics_file(f, root_path)]
    else:
        # Unknown source - include all non-excluded files
        pass

    return ts_files


def ingest_multi(
    source_path: str,
    source: str,
    clear: bool = False,
    limit: Optional[int] = None
):
    """
    Ingest code from a source repository into the vector store.

    Args:
        source_path: Path to source code directory
        source: Source identifier (e.g., 'iwsdk', 'elics')
        clear: Whether to clear existing data (use only for first source!)
        limit: Maximum number of files to process (for testing)
    """
    source_dir = Path(source_path)

    if not source_dir.exists():
        print(f"❌ Source path not found: {source_path}")
        return

    print("=" * 80)
    print(f"🚀 Multi-Source Ingestion Pipeline")
    print("=" * 80)
    print()
    print(f"📦 Source: {source}")
    print(f"📁 Path: {source_path}")
    print()

    # Find TypeScript files
    print("🔍 Finding TypeScript files...")
    ts_files = find_files(source_dir, source)

    if limit:
        ts_files = ts_files[:limit]

    print(f"✅ Found {len(ts_files)} TypeScript files for {source}")
    print()

    # Show file breakdown for IWSDK
    if source == 'iwsdk':
        by_category = {
            'core': 0,
            'xr-input': 0,
            'locomotor': 0,
            'glxf': 0,
            'examples': 0,
            'other': 0
        }

        for f in ts_files:
            try:
                rel = f.relative_to(source_dir)
                parts = rel.parts
                if 'examples' in parts:
                    by_category['examples'] += 1
                elif 'core' in parts:
                    by_category['core'] += 1
                elif 'xr-input' in parts:
                    by_category['xr-input'] += 1
                elif 'locomotor' in parts:
                    by_category['locomotor'] += 1
                elif 'glxf' in parts:
                    by_category['glxf'] += 1
                else:
                    by_category['other'] += 1
            except:
                pass

        print("📊 File breakdown:")
        for category, count in sorted(by_category.items()):
            if count > 0:
                print(f"  {category}: {count} files")
        print()

    # Initialize pipeline components
    print("🔧 Initializing components...")
    parser = TypeScriptParser()
    chunker = ASTChunker()
    embedder = SimpleEmbedder()
    store = VectorStore()

    if clear:
        print(f"⚠️  WARNING: Clearing ALL existing data from vector store!")
        print(f"   This will delete data from all sources!")
        print()
        store.clear()

    print()

    # Process files
    print(f"📝 Processing {source} files...")
    print()

    all_chunks = []
    successful = 0
    failed = 0
    skipped = 0

    for file_path in tqdm(ts_files, desc="Processing", unit="file"):
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
    print(f"💾 Storing in vector database (source: {source})...")
    store.add_chunks(all_chunks, all_embeddings, source=source)
    print()

    # Show statistics
    print("=" * 80)
    print(f"📊 INGESTION COMPLETE: {source}")
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
    print("Search across all sources:")
    print(f'  python scripts/search.py "your query here"')
    print()
    print(f"Search only {source}:")
    print(f'  python scripts/search.py "your query here" --filter source={source}')
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Ingest code from multiple sources into unified vector store",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # First source (IWSDK) - clear existing data
  python scripts/ingest_multi.py /path/to/immersive-web-sdk --source iwsdk --clear

  # Second source (elics) - append to existing data
  python scripts/ingest_multi.py /path/to/elics --source elics

  # Search across all sources
  python scripts/search.py "ECS component system"

  # Search specific source
  python scripts/search.py "physics" --filter source=iwsdk
        """
    )

    parser.add_argument("source_path", help="Path to source code directory")
    parser.add_argument("--source", required=True,
                       choices=['iwsdk', 'elics'],
                       help="Source identifier (iwsdk or elics)")
    parser.add_argument("--clear", action="store_true",
                       help="Clear ALL existing data before ingestion (use only for first source!)")
    parser.add_argument("--limit", type=int,
                       help="Limit number of files to process (for testing)")

    args = parser.parse_args()

    ingest_multi(args.source_path, args.source, clear=args.clear, limit=args.limit)


if __name__ == "__main__":
    main()
