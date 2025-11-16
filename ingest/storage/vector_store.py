"""
Vector storage using ChromaDB.

Clean interface that's easy to extend with:
- Hybrid search (BM25 + semantic) later
- Metadata filtering
- Different distance metrics
"""

import chromadb
from chromadb.config import Settings
from typing import List, Dict, Any, Optional
import numpy as np
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from ingestion.parsers.typescript_parser import TypeScriptChunk


class VectorStore:
    """
    Vector storage using ChromaDB.

    Features:
    - Persistent storage
    - Metadata filtering
    - Semantic search
    - Easy to add: hybrid search, reranking later
    """

    def __init__(self, db_path: str = "./chroma_db", collection_name: str = "iwsdk_code"):
        """
        Initialize vector store.

        Args:
            db_path: Path to ChromaDB storage
            collection_name: Name of the collection
        """
        self.db_path = Path(db_path)
        self.db_path.mkdir(exist_ok=True)
        self.collection_name = collection_name

        print(f"🔄 Initializing ChromaDB at {db_path}")

        # Initialize ChromaDB client
        self.client = chromadb.PersistentClient(
            path=str(self.db_path),
            settings=Settings(anonymized_telemetry=False)
        )

        # Get or create collection
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"description": "Immersive Web SDK code chunks"}
        )

        print(f"✅ Vector store ready (collection: {collection_name})")

    def add_chunks(self, chunks: List[TypeScriptChunk], embeddings: List[np.ndarray], source: Optional[str] = None):
        """
        Add chunks with their embeddings to the store.

        Args:
            chunks: List of TypeScriptChunk objects
            embeddings: List of embedding vectors (same order as chunks)
            source: Optional source identifier (e.g., 'iwsdk', 'elics')
        """
        if len(chunks) != len(embeddings):
            raise ValueError(f"Chunks ({len(chunks)}) and embeddings ({len(embeddings)}) must have same length")

        if not chunks:
            return

        # Prepare data for ChromaDB
        ids = []
        vectors = []
        metadatas = []
        documents = []

        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            # Generate unique ID
            chunk_id = self._generate_id(chunk, i, source)
            ids.append(chunk_id)

            # Embedding vector
            vectors.append(embedding.tolist())

            # Metadata (for filtering)
            metadata = self._create_metadata(chunk, source)
            metadatas.append(metadata)

            # Document text (the actual code)
            documents.append(chunk.content)

        # Add to collection
        self.collection.add(
            ids=ids,
            embeddings=vectors,
            metadatas=metadatas,
            documents=documents
        )

        print(f"✅ Added {len(chunks)} chunks to vector store")

    def search(self,
               query_embedding: np.ndarray,
               n_results: int = 10,
               filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Search for similar code chunks.

        Args:
            query_embedding: Query vector
            n_results: Number of results to return
            filters: Optional metadata filters (e.g., {"chunk_type": "function"})

        Returns:
            List of results with content, metadata, and scores
        """
        # Build where clause for filtering
        where_clause = filters if filters else None

        # Query ChromaDB
        results = self.collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=n_results,
            where=where_clause,
            include=["documents", "metadatas", "distances"]
        )

        # Format results
        formatted_results = []
        for i in range(len(results["ids"][0])):
            # Convert distance to similarity score (0-1 range)
            distance = results["distances"][0][i]
            similarity = 1 / (1 + distance)  # Convert L2 distance to similarity

            result = {
                "id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "distance": distance,
                "similarity": similarity,
            }

            formatted_results.append(result)

        return formatted_results

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the vector store."""
        count = self.collection.count()

        # Get sample to analyze
        sample_size = min(100, count)
        if sample_size > 0:
            sample = self.collection.get(limit=sample_size, include=["metadatas"])

            # Aggregate stats
            chunk_types = {}
            languages = {}
            files = set()

            for metadata in sample["metadatas"]:
                # Count chunk types
                chunk_type = metadata.get("chunk_type", "unknown")
                chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1

                # Count languages
                language = metadata.get("language", "unknown")
                languages[language] = languages.get(language, 0) + 1

                # Track files
                file_path = metadata.get("file_path")
                if file_path:
                    files.add(file_path)

            return {
                "total_chunks": count,
                "chunk_types": chunk_types,
                "languages": languages,
                "unique_files": len(files),
                "sample_size": sample_size
            }
        else:
            return {
                "total_chunks": 0,
                "chunk_types": {},
                "languages": {},
                "unique_files": 0
            }

    def clear(self):
        """Clear all data from the collection."""
        self.client.delete_collection(self.collection_name)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "Immersive Web SDK code chunks"}
        )
        print(f"✅ Collection '{self.collection_name}' cleared")

    def _generate_id(self, chunk: TypeScriptChunk, index: int, source: Optional[str] = None) -> str:
        """Generate unique ID for a chunk."""
        # Use file path + chunk name + line number
        file_parts = Path(chunk.file_path).parts
        if 'src' in file_parts:
            src_idx = file_parts.index('src')
            rel_path = '/'.join(file_parts[src_idx:])
        else:
            rel_path = Path(chunk.file_path).name

        # Include source in ID if provided
        source_prefix = f"{source}:" if source else ""

        # Create unique ID
        chunk_id = f"{source_prefix}{rel_path}:{chunk.chunk_type}:{chunk.name}:L{chunk.start_line}"

        # Add index to ensure uniqueness
        return f"{chunk_id}:{index}"

    def _create_metadata(self, chunk: TypeScriptChunk, source: Optional[str] = None) -> Dict[str, Any]:
        """Create metadata dictionary for a chunk."""
        # Get relative file path
        file_parts = Path(chunk.file_path).parts
        if 'src' in file_parts:
            src_idx = file_parts.index('src')
            rel_path = '/'.join(file_parts[src_idx:])
        else:
            rel_path = str(chunk.file_path)

        metadata = {
            "chunk_type": chunk.chunk_type,
            "name": chunk.name,
            "file_path": rel_path,
            "start_line": chunk.start_line,
            "end_line": chunk.end_line,
            "language": chunk.language,
            "size": chunk.end_line - chunk.start_line + 1,
        }

        # Add source if provided
        if source:
            metadata["source"] = source

        # Add optional fields
        if chunk.class_name:
            metadata["class_name"] = chunk.class_name

        if chunk.module_path:
            metadata["module_path"] = chunk.module_path

        # Add semantic labels as string (ChromaDB doesn't support lists in where clauses)
        if chunk.semantic_labels:
            metadata["labels"] = ",".join(sorted(chunk.semantic_labels))

        # Add relationship info
        if chunk.extends:
            metadata["extends"] = ",".join(chunk.extends)

        if chunk.implements:
            metadata["implements"] = ",".join(chunk.implements)

        # Add dependency relationships
        if chunk.imports:
            # Store first 5 imports (metadata has size limits)
            imports_str = ",".join(chunk.imports[:5])
            if len(imports_str) < 1000:  # Metadata field size limit
                metadata["imports"] = imports_str

        if chunk.calls:
            # Store up to 10 function calls
            calls_list = list(chunk.calls)[:10]
            calls_str = ",".join(calls_list)
            if len(calls_str) < 1000:
                metadata["calls"] = calls_str

        # Add API usage patterns
        if chunk.webxr_api_usage:
            webxr_list = list(chunk.webxr_api_usage)[:5]
            metadata["webxr_api"] = ",".join(webxr_list)

        # Add boolean flags
        metadata["ecs_component"] = chunk.ecs_component
        metadata["ecs_system"] = chunk.ecs_system

        return metadata


def main():
    """Test the vector store."""
    from ingestion.parsers.typescript_parser import TypeScriptParser
    from ingestion.chunkers.ast_chunker import ASTChunker
    from ingestion.embedders.simple_embedder import SimpleEmbedder

    print("🧪 Testing Vector Store\n")

    # Parse and chunk a test file
    test_file = "/Users/felixz/Projects/llm-knowledge/immersive-web-sdk/packages/core/src/ecs/system.ts"

    parser = TypeScriptParser()
    chunker = ASTChunker()
    embedder = SimpleEmbedder()

    print("Parsing and chunking...")
    chunks = parser.parse_file(test_file)
    chunks = chunker.optimize_chunks(chunks)
    print(f"✅ Got {len(chunks)} chunks\n")

    print("Generating embeddings...")
    embeddings = embedder.embed_chunks(chunks)
    print(f"✅ Generated {len(embeddings)} embeddings\n")

    # Initialize vector store
    store = VectorStore(db_path="./test_chroma_db")

    # Clear any existing data
    store.clear()

    # Add chunks
    print("Adding to vector store...")
    store.add_chunks(chunks, embeddings)
    print()

    # Get stats
    stats = store.get_stats()
    print("📊 Store statistics:")
    print(f"  Total chunks: {stats['total_chunks']}")
    print(f"  Chunk types: {stats['chunk_types']}")
    print(f"  Languages: {stats['languages']}")
    print()

    # Test search
    print("Testing search...")
    query = "How to create an ECS system"
    query_embedding = embedder.embed_query(query)

    results = store.search(query_embedding, n_results=3)

    print(f"Query: '{query}'")
    print(f"Found {len(results)} results:\n")

    for i, result in enumerate(results, 1):
        print(f"{i}. {result['metadata']['chunk_type']}: {result['metadata']['name']}")
        print(f"   File: {result['metadata']['file_path']}")
        print(f"   Lines: {result['metadata']['start_line']}-{result['metadata']['end_line']}")
        print(f"   Similarity: {result['similarity']:.4f}")
        print(f"   Content preview: {result['content'][:100]}...")
        print()

    print("✅ Vector store test complete!")


if __name__ == "__main__":
    main()
