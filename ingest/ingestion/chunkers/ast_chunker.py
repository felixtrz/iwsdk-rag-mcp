"""
AST-based semantic chunking following the cAST paper approach.

Creates structure-preserving chunks that maintain semantic coherence.
"""

from typing import List, Optional, Set
from dataclasses import dataclass
from tree_sitter import Node
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from ingestion.parsers.typescript_parser import TypeScriptChunk


@dataclass
class ChunkingConfig:
    """Configuration for chunking strategy."""
    MIN_CHUNK_SIZE: int = 15  # Minimum lines per chunk
    MAX_CHUNK_SIZE: int = 100  # Maximum lines per chunk
    TARGET_CHUNK_SIZE: int = 50  # Ideal chunk size
    CONTEXT_LINES: int = 3  # Context lines to add


class ASTChunker:
    """
    Semantic code chunker using AST structure.

    Implements cAST-style chunking:
    1. Preserve semantic boundaries (complete functions, classes)
    2. Merge small related nodes (getters/setters, lifecycle methods)
    3. Split large nodes recursively
    4. Maintain minimum/maximum chunk sizes
    """

    def __init__(self, config: Optional[ChunkingConfig] = None):
        self.config = config or ChunkingConfig()
        print(f"✅ AST Chunker initialized (min={self.config.MIN_CHUNK_SIZE}, "
              f"max={self.config.MAX_CHUNK_SIZE}, target={self.config.TARGET_CHUNK_SIZE})")

    def optimize_chunks(self, chunks: List[TypeScriptChunk]) -> List[TypeScriptChunk]:
        """
        Optimize chunk sizes following cAST strategy.

        Args:
            chunks: Initial chunks from parser

        Returns:
            Optimized chunks with better size distribution
        """
        if not chunks:
            return chunks

        optimized = []

        # Group chunks by file for better context
        by_file = {}
        for chunk in chunks:
            if chunk.file_path not in by_file:
                by_file[chunk.file_path] = []
            by_file[chunk.file_path].append(chunk)

        # Process each file's chunks
        for file_path, file_chunks in by_file.items():
            # Sort by start line
            file_chunks.sort(key=lambda c: c.start_line)

            # Optimize this file's chunks
            file_optimized = self._optimize_file_chunks(file_chunks)
            optimized.extend(file_optimized)

        return optimized

    def _optimize_file_chunks(self, chunks: List[TypeScriptChunk]) -> List[TypeScriptChunk]:
        """Optimize chunks within a single file."""
        optimized = []
        consumed = set()  # Track which indices have been merged into other chunks
        i = 0

        while i < len(chunks):
            # Skip chunks that were already consumed by a previous merge
            if i in consumed:
                i += 1
                continue

            chunk = chunks[i]
            chunk_size = chunk.end_line - chunk.start_line + 1

            # Case 1: Chunk is too small - try to merge with neighbors
            if chunk_size < self.config.MIN_CHUNK_SIZE:
                merge_result = self._try_merge_small_chunk(chunks, i, consumed)
                if merge_result:
                    merged_chunk, consumed_indices = merge_result
                    optimized.append(merged_chunk)
                    consumed.update(consumed_indices)
                    i += 1
                else:
                    # Can't merge, expand with context
                    expanded = self._expand_with_context(chunk)
                    optimized.append(expanded)
                    i += 1

            # Case 2: Chunk is too large - mark for potential splitting
            elif chunk_size > self.config.MAX_CHUNK_SIZE:
                # For now, keep it but mark as large
                # TODO: Implement recursive splitting
                chunk.semantic_labels.add('large_chunk')
                optimized.append(chunk)
                consumed.add(i)  # Mark as consumed
                i += 1

            # Case 3: Chunk is perfect size
            else:
                optimized.append(chunk)
                consumed.add(i)  # Mark as consumed
                i += 1

        # Validation: Ensure we didn't skip or duplicate any chunks
        if len(consumed) != len(chunks):
            unconsumed = set(range(len(chunks))) - consumed
            print(f"⚠️  WARNING: Chunker processed {len(consumed)}/{len(chunks)} chunks")
            print(f"    Unconsumed indices: {sorted(unconsumed)}")
            for idx in sorted(unconsumed):
                print(f"    - Index {idx}: {chunks[idx].name} ({chunks[idx].chunk_type})")

        return optimized

    def _try_merge_small_chunk(self, chunks: List[TypeScriptChunk],
                               index: int, consumed: set) -> Optional[tuple]:
        """
        Try to merge a small chunk with related neighbors.

        Merging rules:
        - Same chunk type (function + function, interface + interface)
        - Related names (getters/setters, lifecycle methods)
        - Adjacent or close together (< 5 lines apart)
        - Combined size < MAX_CHUNK_SIZE

        Returns:
            Tuple of (merged_chunk, consumed_indices_set) or None
        """
        current = chunks[index]

        # Check next chunk first (prefer forward merging)
        if index < len(chunks) - 1 and (index + 1) not in consumed:
            next_chunk = chunks[index + 1]
            if self._should_merge(current, next_chunk):
                merged = self._merge_chunks(current, next_chunk)
                # Mark both current and next as consumed
                return (merged, {index, index + 1})

        # Only check previous if not already consumed
        if index > 0 and (index - 1) not in consumed:
            prev = chunks[index - 1]
            if self._should_merge(prev, current):
                merged = self._merge_chunks(prev, current)
                # Mark both prev and current as consumed
                return (merged, {index - 1, index})

        return None

    def _should_merge(self, chunk1: TypeScriptChunk, chunk2: TypeScriptChunk) -> bool:
        """Determine if two chunks should be merged."""
        # Must be same file
        if chunk1.file_path != chunk2.file_path:
            return False

        # Check if adjacent or close
        gap = chunk2.start_line - chunk1.end_line
        if gap > 5:
            return False

        # Check combined size
        combined_size = (chunk2.end_line - chunk1.start_line + 1)
        if combined_size > self.config.MAX_CHUNK_SIZE:
            return False

        # Same chunk type is preferred
        if chunk1.chunk_type == chunk2.chunk_type:
            # Check for related patterns
            if self._are_related(chunk1.name, chunk2.name):
                return True

            # Functions in same class
            if chunk1.chunk_type == 'function' and chunk1.class_name == chunk2.class_name:
                return True

        # Interfaces and types can merge
        if chunk1.chunk_type in ['interface', 'type'] and chunk2.chunk_type in ['interface', 'type']:
            return True

        return False

    def _are_related(self, name1: str, name2: str) -> bool:
        """Check if two names indicate related functionality."""
        name1_lower = name1.lower()
        name2_lower = name2.lower()

        # Getter/setter pairs
        if name1_lower.startswith('get') and name2_lower.startswith('set'):
            return name1_lower[3:] == name2_lower[3:]
        if name1_lower.startswith('set') and name2_lower.startswith('get'):
            return name1_lower[3:] == name2_lower[3:]

        # Lifecycle methods
        lifecycle_prefixes = ['on', 'handle', 'init', 'update', 'cleanup', 'destroy']
        for prefix in lifecycle_prefixes:
            if name1_lower.startswith(prefix) and name2_lower.startswith(prefix):
                return True

        # Same base name with different suffixes
        for name in [name1_lower, name2_lower]:
            base = name.rstrip('0123456789')
            if base in name1_lower and base in name2_lower:
                return True

        return False

    def _merge_chunks(self, chunk1: TypeScriptChunk, chunk2: TypeScriptChunk) -> TypeScriptChunk:
        """Merge two chunks into one."""
        # Combine content (assume chunks are ordered)
        if chunk1.start_line < chunk2.start_line:
            first, second = chunk1, chunk2
        else:
            first, second = chunk2, chunk1

        # Read the full range from file
        try:
            with open(first.file_path, 'r') as f:
                lines = f.readlines()
                start_idx = first.start_line - 1
                end_idx = second.end_line
                merged_content = ''.join(lines[start_idx:end_idx])
        except:
            # Fallback: concatenate existing content
            merged_content = first.content + '\n' + second.content

        # Create merged chunk
        merged = TypeScriptChunk(
            content=merged_content,
            chunk_type=f"{first.chunk_type}_group",
            name=f"{first.name}_and_{second.name}",
            start_line=first.start_line,
            end_line=second.end_line,
            file_path=first.file_path,
            language=first.language,
            imports=list(set(first.imports + second.imports)),
        )

        # Merge metadata
        merged.calls = first.calls | second.calls
        merged.extends = first.extends | second.extends
        merged.implements = first.implements | second.implements
        merged.uses_types = first.uses_types | second.uses_types
        merged.semantic_labels = first.semantic_labels | second.semantic_labels
        merged.semantic_labels.add('merged_chunk')

        # Preserve boolean ECS flags (OR operation - true if either is true)
        merged.ecs_component = first.ecs_component or second.ecs_component
        merged.ecs_system = first.ecs_system or second.ecs_system

        # Merge API usage sets
        merged.webxr_api_usage = first.webxr_api_usage | second.webxr_api_usage
        merged.three_js_usage = first.three_js_usage | second.three_js_usage

        # Track merge metadata
        if not hasattr(merged, 'metadata'):
            merged.metadata = {}
        merged.metadata['merged_count'] = 2
        merged.metadata['original_chunks'] = [first.name, second.name]

        return merged

    def _expand_with_context(self, chunk: TypeScriptChunk) -> TypeScriptChunk:
        """Expand a chunk with surrounding context to meet minimum size."""
        try:
            with open(chunk.file_path, 'r') as f:
                lines = f.readlines()
                total_lines = len(lines)

                current_size = chunk.end_line - chunk.start_line + 1
                needed = self.config.MIN_CHUNK_SIZE - current_size

                # Add context lines before and after
                expand_before = needed // 2
                expand_after = needed - expand_before

                new_start = max(1, chunk.start_line - expand_before)
                new_end = min(total_lines, chunk.end_line + expand_after)

                # Get expanded content
                expanded_content = ''.join(lines[new_start - 1:new_end])

                # Create expanded chunk
                expanded = TypeScriptChunk(
                    content=expanded_content,
                    chunk_type=chunk.chunk_type,
                    name=chunk.name,
                    start_line=new_start,
                    end_line=new_end,
                    file_path=chunk.file_path,
                    language=chunk.language,
                    imports=chunk.imports,
                )

                # Copy metadata
                expanded.calls = chunk.calls
                expanded.extends = chunk.extends
                expanded.implements = chunk.implements
                expanded.uses_types = chunk.uses_types
                expanded.semantic_labels = chunk.semantic_labels | {'expanded_context'}

                # Preserve boolean ECS flags
                expanded.ecs_component = chunk.ecs_component
                expanded.ecs_system = chunk.ecs_system

                # Preserve API usage sets
                expanded.webxr_api_usage = chunk.webxr_api_usage
                expanded.three_js_usage = chunk.three_js_usage

                return expanded

        except Exception as e:
            print(f"Warning: Could not expand chunk {chunk.name}: {e}")
            return chunk

    def analyze_chunks(self, chunks: List[TypeScriptChunk]) -> dict:
        """Analyze chunk distribution and quality."""
        if not chunks:
            return {}

        sizes = [c.end_line - c.start_line + 1 for c in chunks]

        return {
            'total_chunks': len(chunks),
            'min_size': min(sizes),
            'max_size': max(sizes),
            'avg_size': sum(sizes) / len(sizes),
            'under_min': sum(1 for s in sizes if s < self.config.MIN_CHUNK_SIZE),
            'over_max': sum(1 for s in sizes if s > self.config.MAX_CHUNK_SIZE),
            'optimal': sum(1 for s in sizes if self.config.MIN_CHUNK_SIZE <= s <= self.config.MAX_CHUNK_SIZE),
            'by_type': self._count_by_type(chunks),
        }

    def _count_by_type(self, chunks: List[TypeScriptChunk]) -> dict:
        """Count chunks by type."""
        counts = {}
        for chunk in chunks:
            counts[chunk.chunk_type] = counts.get(chunk.chunk_type, 0) + 1
        return counts


def main():
    """Test the AST chunker."""
    from ingestion.parsers.typescript_parser import TypeScriptParser

    # Test file
    test_file = "/Users/felixz/Projects/llm-knowledge/immersive-web-sdk/packages/core/src/ecs/system.ts"

    print("🧪 Testing AST Chunker\n")
    print(f"📂 Test file: {test_file}\n")

    # Parse file
    parser = TypeScriptParser()
    chunks = parser.parse_file(test_file)

    print(f"📊 Initial parse: {len(chunks)} chunks\n")

    # Analyze before optimization
    chunker = ASTChunker()
    before_stats = chunker.analyze_chunks(chunks)

    print("Before optimization:")
    print(f"  Total: {before_stats['total_chunks']}")
    print(f"  Size range: {before_stats['min_size']}-{before_stats['max_size']} lines")
    print(f"  Average: {before_stats['avg_size']:.1f} lines")
    print(f"  Under min ({chunker.config.MIN_CHUNK_SIZE}): {before_stats['under_min']}")
    print(f"  Over max ({chunker.config.MAX_CHUNK_SIZE}): {before_stats['over_max']}")
    print(f"  Optimal: {before_stats['optimal']}")
    print(f"  By type: {before_stats['by_type']}\n")

    # Optimize chunks
    optimized = chunker.optimize_chunks(chunks)

    # Analyze after optimization
    after_stats = chunker.analyze_chunks(optimized)

    print("After optimization:")
    print(f"  Total: {after_stats['total_chunks']}")
    print(f"  Size range: {after_stats['min_size']}-{after_stats['max_size']} lines")
    print(f"  Average: {after_stats['avg_size']:.1f} lines")
    print(f"  Under min ({chunker.config.MIN_CHUNK_SIZE}): {after_stats['under_min']}")
    print(f"  Over max ({chunker.config.MAX_CHUNK_SIZE}): {after_stats['over_max']}")
    print(f"  Optimal: {after_stats['optimal']}")
    print(f"  By type: {after_stats['by_type']}\n")

    # Show optimized chunks
    print("Optimized chunks:")
    for i, chunk in enumerate(optimized, 1):
        size = chunk.end_line - chunk.start_line + 1
        status = "✅" if chunker.config.MIN_CHUNK_SIZE <= size <= chunker.config.MAX_CHUNK_SIZE else "⚠️"
        print(f"{status} {i}. {chunk.chunk_type}: {chunk.name} ({size} lines, L{chunk.start_line}-{chunk.end_line})")
        if 'merged_chunk' in chunk.semantic_labels:
            print(f"     Merged from: {chunk.metadata.get('original_chunks', [])}")


if __name__ == "__main__":
    main()
