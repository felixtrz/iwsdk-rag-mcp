"""
Base embedder interface - allows easy swapping of embedding models.
"""

from abc import ABC, abstractmethod
import numpy as np
from typing import List
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from ingestion.parsers.typescript_parser import TypeScriptChunk


class CodeEmbedder(ABC):
    """
    Abstract base class for code embedders.

    This interface allows easy swapping between different embedding models:
    - SimpleEmbedder (MVP): Fast sentence-transformers
    - CodeT5Embedder (Enhanced): Code-specific embeddings
    - HybridEmbedder (Advanced): Multiple embedding strategies
    """

    @abstractmethod
    def embed_chunk(self, chunk: TypeScriptChunk) -> np.ndarray:
        """
        Generate embedding for a code chunk.

        Args:
            chunk: TypeScriptChunk to embed

        Returns:
            numpy array of embedding vector
        """
        pass

    @abstractmethod
    def embed_query(self, query: str) -> np.ndarray:
        """
        Generate embedding for a search query.

        Args:
            query: Natural language search query

        Returns:
            numpy array of embedding vector
        """
        pass

    def embed_chunks(self, chunks: List[TypeScriptChunk]) -> List[np.ndarray]:
        """
        Batch embed multiple chunks (can be optimized in subclasses).

        Args:
            chunks: List of TypeScriptChunk objects

        Returns:
            List of embedding vectors
        """
        return [self.embed_chunk(chunk) for chunk in chunks]

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        """Return the dimensionality of embeddings."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Return the name/identifier of the embedding model."""
        pass
