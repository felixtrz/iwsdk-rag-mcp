#!/usr/bin/env python
"""
Export ChromaDB vector store to JSON format for TypeScript MCP server.

This script exports the ingested code chunks, embeddings, and metadata
into a JSON file that can be included in an npm package.

The TypeScript MCP server will load this JSON and perform vector search
using the same all-MiniLM-L6-v2 model via transformers.js.

Usage:
    python scripts/export_for_npm.py --output ../iwsdk-rag-mcp/data/
    python scripts/export_for_npm.py --output ./export/ --limit 100  # For testing
"""

import sys
import json
from pathlib import Path
import argparse
import numpy as np
from typing import Dict, Any, List

sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.vector_store import VectorStore


def export_to_json(output_dir: str, limit: int = None):
    """
    Export ChromaDB data to JSON format for npm distribution.

    Args:
        output_dir: Directory to write JSON files
        limit: Optional limit on number of chunks (for testing)
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("📦 Exporting ChromaDB to JSON for npm Package")
    print("=" * 80)
    print()
    print(f"Output directory: {output_path}")
    print()

    # Initialize vector store
    print("🔄 Loading ChromaDB...")
    store = VectorStore()

    # Get statistics
    stats = store.get_stats()
    total_chunks = stats['total_chunks']

    if total_chunks == 0:
        print("❌ No data in vector store!")
        print("   Run ingestion scripts first:")
        print("   python scripts/ingest_multi.py /path/to/iwsdk --source iwsdk --clear")
        return

    print(f"✅ Found {total_chunks} chunks")
    print()

    # Get all data from ChromaDB
    print("📥 Fetching all data from ChromaDB...")
    all_data = store.collection.get(
        include=["documents", "metadatas", "embeddings"]
    )

    print(f"✅ Retrieved {len(all_data['ids'])} chunks")
    print()

    # Apply limit if specified (for testing)
    if limit:
        print(f"⚠️  Limiting to {limit} chunks for testing")
        all_data['ids'] = all_data['ids'][:limit]
        all_data['documents'] = all_data['documents'][:limit]
        all_data['metadatas'] = all_data['metadatas'][:limit]
        all_data['embeddings'] = all_data['embeddings'][:limit]
        print()

    # Count by source
    sources = {}
    for metadata in all_data['metadatas']:
        source = metadata.get('source', 'unknown')
        sources[source] = sources.get(source, 0) + 1

    print("📊 Data breakdown:")
    for source, count in sorted(sources.items()):
        print(f"  {source}: {count} chunks")
    print()

    # Prepare export data
    print("🔧 Preparing export data...")

    export_data = {
        "version": "1.0.0",
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "embedding_dim": 384,
        "total_chunks": len(all_data['ids']),
        "sources": sources,
        "generated_at": None,  # Will be set when exporting
        "chunks": []
    }

    # Process each chunk
    for idx, (chunk_id, document, metadata, embedding) in enumerate(
        zip(
            all_data['ids'],
            all_data['documents'],
            all_data['metadatas'],
            all_data['embeddings']
        )
    ):
        # Convert numpy array to list for JSON serialization
        if isinstance(embedding, np.ndarray):
            embedding = embedding.tolist()
        elif not isinstance(embedding, list):
            embedding = list(embedding)

        chunk_data = {
            "id": chunk_id,
            "content": document,
            "metadata": metadata,
            "embedding": embedding  # 384-dim vector as array
        }
        export_data["chunks"].append(chunk_data)

        # Progress indicator
        if (idx + 1) % 500 == 0:
            print(f"  Processed {idx + 1}/{len(all_data['ids'])} chunks...")

    print(f"✅ Prepared {len(export_data['chunks'])} chunks")
    print()

    # Add generation timestamp
    from datetime import datetime, timezone
    export_data["generated_at"] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    # Write to JSON file
    output_file = output_path / "chunks.json"
    print(f"💾 Writing to {output_file}...")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False)

    # Get file size
    file_size_mb = output_file.stat().st_size / (1024 * 1024)

    print(f"✅ Exported to {output_file}")
    print(f"   File size: {file_size_mb:.1f} MB")
    print()

    # Also create a metadata-only file (smaller, for quick loading)
    print("📋 Creating metadata summary...")

    metadata_summary = {
        "version": export_data["version"],
        "model": export_data["model"],
        "embedding_dim": export_data["embedding_dim"],
        "total_chunks": export_data["total_chunks"],
        "sources": export_data["sources"],
        "generated_at": export_data["generated_at"],
        "chunk_types": stats.get("chunk_types", {}),
        "languages": stats.get("languages", {}),
        "unique_files": stats.get("unique_files", 0)
    }

    metadata_file = output_path / "metadata.json"
    with open(metadata_file, 'w', encoding='utf-8') as f:
        json.dump(metadata_summary, f, indent=2, ensure_ascii=False)

    print(f"✅ Metadata summary: {metadata_file}")
    print()

    # Create a README for the data directory
    readme_content = f"""# IWSDK RAG Data

This directory contains pre-processed code chunks and embeddings for the IWSDK RAG MCP server.

## Contents

- `chunks.json` ({file_size_mb:.1f} MB) - All code chunks with embeddings and metadata
- `metadata.json` - Summary statistics

## Data Statistics

- **Total chunks:** {export_data['total_chunks']}
- **Embedding model:** {export_data['model']}
- **Embedding dimensions:** {export_data['embedding_dim']}
- **Generated:** {export_data['generated_at']}

### Sources

{chr(10).join(f"- **{source}:** {count} chunks" for source, count in sorted(sources.items()))}

### Chunk Types

{chr(10).join(f"- {chunk_type}: {count}" for chunk_type, count in sorted(stats.get('chunk_types', {}).items(), key=lambda x: -x[1]))}

## Usage

This data is loaded by the TypeScript MCP server at startup:

```typescript
import chunksData from './data/chunks.json';

// Search using transformers.js for query embedding
// and cosine similarity against pre-computed embeddings
```

## Regenerating

To regenerate this data (after ingesting new IWSDK versions):

```bash
cd /path/to/iwsdk-rag

# Re-ingest
python scripts/ingest_multi.py /path/to/iwsdk --source iwsdk --clear
python scripts/ingest_multi.py /path/to/elics --source elics
python scripts/ingest_deps.py /path/to/iwsdk

# Re-export
python scripts/export_for_npm.py --output /path/to/iwsdk-rag-mcp/data/
```
"""

    readme_file = output_path / "README.md"
    with open(readme_file, 'w', encoding='utf-8') as f:
        f.write(readme_content)

    print(f"✅ Created README: {readme_file}")
    print()

    # Summary
    print("=" * 80)
    print("📊 EXPORT COMPLETE")
    print("=" * 80)
    print()
    print(f"Output directory: {output_path}")
    print(f"Files created:")
    print(f"  - chunks.json ({file_size_mb:.1f} MB)")
    print(f"  - metadata.json")
    print(f"  - README.md")
    print()
    print("Next steps:")
    print("  1. Copy this directory to your TypeScript MCP server project")
    print("  2. Load chunks.json in your TypeScript server")
    print("  3. Use transformers.js to embed queries")
    print("  4. Compute cosine similarity for search")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Export ChromaDB to JSON for npm package",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Export to TypeScript project
  python scripts/export_for_npm.py --output ../iwsdk-rag-mcp/data/

  # Test with limited chunks
  python scripts/export_for_npm.py --output ./test_export/ --limit 100
        """
    )

    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output directory for JSON files"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of chunks (for testing)"
    )

    args = parser.parse_args()

    export_to_json(args.output, limit=args.limit)


if __name__ == "__main__":
    main()
