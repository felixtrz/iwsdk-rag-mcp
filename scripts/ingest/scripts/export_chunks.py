"""
Export chunks to JSON for Node.js embedding generation.
"""

import json
from pathlib import Path
from typing import List
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from ingestion.parsers.typescript_parser import TypeScriptChunk


def chunk_to_dict(chunk: TypeScriptChunk, base_path: Path = None) -> dict:
    """Convert a TypeScriptChunk to a JSON-serializable dictionary.

    Args:
        chunk: The chunk to convert
        base_path: Optional base path to make file_path relative to
    """
    file_path = chunk.file_path

    # Make path relative to base_path if provided
    if base_path:
        try:
            file_path = str(Path(chunk.file_path).relative_to(base_path))
        except ValueError:
            # If file is not under base_path, keep original
            pass

    return {
        'content': chunk.content,
        'chunk_type': chunk.chunk_type,
        'name': chunk.name,
        'start_line': chunk.start_line,
        'end_line': chunk.end_line,
        'file_path': file_path,
        'language': chunk.language,
        'module_path': chunk.module_path,
        'class_name': chunk.class_name,
        'imports': chunk.imports,
        'exports': chunk.exports,
        'type_parameters': chunk.type_parameters,
        'decorators': chunk.decorators,
        'calls': list(chunk.calls),  # Convert set to list
        'extends': list(chunk.extends),
        'implements': list(chunk.implements),
        'uses_types': list(chunk.uses_types),
        'ecs_component': chunk.ecs_component,
        'ecs_system': chunk.ecs_system,
        'webxr_api_usage': list(chunk.webxr_api_usage),
        'three_js_usage': list(chunk.three_js_usage),
        'semantic_labels': list(chunk.semantic_labels),
        'source': getattr(chunk, 'source', None),  # Add source if it exists
    }


def export_chunks_to_json(chunks: List[TypeScriptChunk], output_path: Path, base_path: Path = None):
    """Export chunks to a JSON file.

    Args:
        chunks: List of chunks to export
        output_path: Path to write JSON file
        base_path: Optional base path to make file paths relative to
    """
    chunks_data = [chunk_to_dict(chunk, base_path) for chunk in chunks]

    with open(output_path, 'w') as f:
        json.dump(chunks_data, f, indent=2)

    print(f"✅ Exported {len(chunks_data)} chunks to {output_path}")
