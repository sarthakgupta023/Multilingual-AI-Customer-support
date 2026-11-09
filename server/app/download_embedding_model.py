"""Download public model files only; no customer data is sent."""
from fastembed import TextEmbedding
from .embeddings import CACHE_DIR, MODEL_NAME

if __name__ == '__main__':
    model = TextEmbedding(MODEL_NAME, cache_dir=str(CACHE_DIR), threads=2)
    next(model.query_embed('model readiness test'))
    print(f'Embedding model ready: {MODEL_NAME}')
