"""Local multilingual embeddings for document passages and search queries."""
import asyncio
import hashlib
import json
import os
import threading
from pathlib import Path
from . import config

MODEL_NAME = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
DIMENSIONS = 384
CACHE_DIR = Path(os.getenv('EMBEDDING_CACHE_DIR', config.ROOT / 'server' / '.model-cache'))
_model = None
_lock = threading.Lock()


def _embed(texts: list[str], query: bool = False) -> list[list[float]]:
    global _model
    # ONNX inference and lazy initialization are kept off the event loop and serialized.
    with _lock:
        if _model is None:
            from fastembed import TextEmbedding
            try:
                _model = TextEmbedding(MODEL_NAME, cache_dir=str(CACHE_DIR), threads=2, local_files_only=True)
            except Exception as error:
                raise RuntimeError('Embedding model unavailable. Run python -m server.app.download_embedding_model.') from error
        vectors = _model.query_embed(texts) if query else _model.passage_embed(texts)
        result = [[float(value) for value in vector] for vector in vectors]
        if len(result) != len(texts) or any(len(vector) != DIMENSIONS for vector in result):
            raise RuntimeError('Embedding model produced an unexpected number or size of vectors')
        return result


async def embed_documents(texts: list[str]) -> list[list[float]]:
    if not texts: return []
    return await asyncio.to_thread(_embed, texts)


async def embed_query(text: str) -> list[float]:
    return (await asyncio.to_thread(_embed, [text], True))[0]


async def prepare_index():
    """Load the local model and index documents uploaded by older versions."""
    from . import agent, database
    await embed_query('embedding model readiness check')
    chunks = agent.POLICIES
    fingerprint = hashlib.sha256(json.dumps(chunks, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    if not await database.builtin_index_current(MODEL_NAME, fingerprint, len(chunks)):
        vectors = await embed_documents([chunk['content'] for chunk in chunks])
        await database.replace_builtin_index(chunks, vectors, MODEL_NAME, fingerprint)
    pending = await database.policies_to_index(MODEL_NAME)
    for policy in pending:
        chunks = policy['chunks']
        vectors = await embed_documents([chunk['content'] for chunk in chunks])
        await database.index_existing_policy(policy['doc_id'], policy['sha256'], policy['version'], chunks, vectors, MODEL_NAME)
