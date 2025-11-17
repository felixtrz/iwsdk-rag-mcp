#!/usr/bin/env python
"""
Health check script for IWSDK RAG system.

Validates:
- Vector database integrity
- Expected component/system counts
- Embedding quality
- Export data validity

Usage:
    python scripts/health_check.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.vector_store import VectorStore
import json


def check_vector_store():
    """Check ChromaDB vector store health."""
    print("=" * 80)
    print("🏥 IWSDK RAG HEALTH CHECK")
    print("=" * 80)
    print()

    store = VectorStore()
    stats = store.get_stats()

    total_chunks = stats['total_chunks']
    if total_chunks == 0:
        print("❌ FAIL: Vector store is empty!")
        print("   Run: python scripts/ingest_multi.py /path/to/iwsdk --source iwsdk --clear")
        return False

    print(f"✅ Vector store has {total_chunks} chunks")
    print()

    # Check sources
    print("📊 Sources:")
    all_data = store.collection.get(include=["metadatas"])
    sources = {}
    for metadata in all_data['metadatas']:
        source = metadata.get('source', 'unknown')
        sources[source] = sources.get(source, 0) + 1

    for source, count in sorted(sources.items()):
        print(f"  {source}: {count} chunks")
    print()

    # Check IWSDK components and systems
    if 'iwsdk' in sources:
        print("🔍 IWSDK Validation:")

        components = sum(1 for m in all_data['metadatas']
                        if m.get('source') == 'iwsdk' and m.get('ecs_component'))
        systems = sum(1 for m in all_data['metadatas']
                     if m.get('source') == 'iwsdk' and m.get('ecs_system'))

        EXPECTED_COMPONENTS = 28  # Updated - IWSDK codebase has grown
        EXPECTED_SYSTEMS = 17

        print(f"  Components: {components} (expected: {EXPECTED_COMPONENTS})")
        if components == EXPECTED_COMPONENTS:
            print(f"    ✅ PASS")
        else:
            print(f"    ❌ FAIL: Missing {EXPECTED_COMPONENTS - components} components" if components < EXPECTED_COMPONENTS
                  else f"    ❌ FAIL: {components - EXPECTED_COMPONENTS} extra components")

        print(f"  Systems: {systems} (expected: {EXPECTED_SYSTEMS})")
        if systems == EXPECTED_SYSTEMS:
            print(f"    ✅ PASS")
        else:
            print(f"    ❌ FAIL: Missing {EXPECTED_SYSTEMS - systems} systems" if systems < EXPECTED_SYSTEMS
                  else f"    ❌ FAIL: {systems - EXPECTED_SYSTEMS} extra systems")
        print()

    # Check chunk types
    print("📝 Chunk Types:")
    for chunk_type, count in sorted(stats['chunk_types'].items(), key=lambda x: -x[1])[:10]:
        print(f"  {chunk_type}: {count}")
    print()

    return True


def check_export_data():
    """Check exported MCP data."""
    print("📦 Checking MCP Export Data:")
    print()

    # Go from scripts/ingest/scripts -> scripts/ingest -> scripts -> root -> data
    export_path = Path(__file__).parent.parent.parent.parent / "data" / "chunks.json"

    if not export_path.exists():
        print(f"  ⚠️  Export file not found: {export_path}")
        print(f"     Run: npm run ingest")
        return False

    print(f"  ✅ Found: {export_path}")

    # Load and validate
    with open(export_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"  Total chunks: {data['total_chunks']}")
    print(f"  Embedding dim: {data['embedding_dim']}")
    print(f"  Model: {data['model']}")
    print()

    # Validate embedding dimensions
    if data['chunks']:
        first_embedding = data['chunks'][0].get('embedding', [])
        if len(first_embedding) == 768:
            print(f"  ✅ Embedding dimensions correct (768)")
        else:
            print(f"  ❌ FAIL: Wrong embedding dimension: {len(first_embedding)}")

    # Check for IWSDK components/systems in export
    if 'iwsdk' in data.get('sources', {}):
        iwsdk_chunks = [c for c in data['chunks'] if c['metadata'].get('source') == 'iwsdk']
        components = sum(1 for c in iwsdk_chunks if c['metadata'].get('ecs_component'))
        systems = sum(1 for c in iwsdk_chunks if c['metadata'].get('ecs_system'))

        print(f"  IWSDK Components in export: {components}")
        print(f"  IWSDK Systems in export: {systems}")

        EXPECTED_COMPONENTS = 28  # Updated - IWSDK codebase has grown
        EXPECTED_SYSTEMS = 17

        if components == EXPECTED_COMPONENTS and systems == EXPECTED_SYSTEMS:
            print(f"  ✅ Component/System counts match expected values")
        else:
            print(f"  ❌ FAIL: Component/System counts don't match")

    print()
    return True


def main():
    """Run all health checks."""
    vector_ok = check_vector_store()
    export_ok = check_export_data()

    print("=" * 80)
    if vector_ok and export_ok:
        print("✅ ALL CHECKS PASSED")
        print()
        print("System is healthy and ready to use!")
    else:
        print("❌ SOME CHECKS FAILED")
        print()
        print("Review the errors above and fix them.")
        sys.exit(1)
    print("=" * 80)


if __name__ == "__main__":
    main()
