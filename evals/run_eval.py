"""Measure vector retrieval on bundled synthetic policies, without an LLM call."""
import asyncio
import json
import time
from pathlib import Path
from psycopg import AsyncConnection, sql
from psycopg.rows import dict_row
from server.app import config, embeddings
from server.app.database import validate_database_url


async def main():
    validate_database_url(config.DATABASE_URL, config.PRODUCTION)
    cases = json.loads((Path(__file__).parent / 'test_dataset.json').read_text(encoding='utf-8'))
    async with await AsyncConnection.connect(config.DATABASE_URL, row_factory=dict_row) as conn:
        extension = await (await conn.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'")).fetchone()
        if not extension: raise RuntimeError('pgvector is not enabled; start the app to initialize the database')
        schema = sql.Identifier(extension['nspname'])
        query = sql.SQL("""SELECT chunk->>'docId' AS doc_id,
            1 - (embedding OPERATOR({}.<=>) %s::{}.vector) AS similarity
            FROM nova_private.nova_builtin_vectors WHERE model_name=%s
            ORDER BY embedding OPERATOR({}.<=>) %s::{}.vector LIMIT 8""").format(schema, schema, schema, schema)
        for lang in ('en', 'hi', 'ta'):
            top_hits = recall_hits = total = ood = ood_with_match = 0
            started = time.monotonic()
            for case in cases:
                vector = json.dumps(await embeddings.embed_query(case[lang]), allow_nan=False)
                rows = await (await conn.execute(query, (vector, embeddings.MODEL_NAME, vector))).fetchall()
                if not rows: raise RuntimeError('Bundled policy vectors are missing; start the app to index them')
                expected = case['expected_doc_id']
                if expected is None:
                    ood += 1
                    ood_with_match += int(rows[0]['similarity'] >= 0.20)
                else:
                    total += 1
                    top_hits += int(rows[0]['doc_id'] == expected)
                    recall_hits += int(any(row['doc_id'] == expected for row in rows))
            print(f'{lang}: top-1 {top_hits}/{total}; top-8 {recall_hits}/{total}; out-of-domain above retrieval threshold {ood_with_match}/{ood}; {time.monotonic()-started:.1f}s')
    print('Retrieval-only evaluation on bundled synthetic policies; this does not measure factual answers, voice quality, or real-user accuracy.')

if __name__ == '__main__': asyncio.run(main())
