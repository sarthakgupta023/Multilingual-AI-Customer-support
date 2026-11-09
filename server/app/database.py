import asyncio
import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from psycopg.rows import dict_row
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import AsyncConnectionPool
from . import config

pool: AsyncConnectionPool | None = None
vector_schema: str | None = None
SCHEMA = '''
CREATE SCHEMA IF NOT EXISTS nova_private;
REVOKE ALL ON SCHEMA nova_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS nova_private.nova_users (id text PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,salt text NOT NULL,hash text NOT NULL);
CREATE TABLE IF NOT EXISTS nova_private.nova_sessions (token_hash text PRIMARY KEY,user_id text NOT NULL,email text NOT NULL,name text NOT NULL,is_admin boolean NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS nova_private.nova_messages (id text PRIMARY KEY,user_id text NOT NULL REFERENCES nova_private.nova_users(id),sender text NOT NULL CHECK(sender IN ('user','assistant')),text text NOT NULL,sources jsonb,suggest_ticket boolean,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS nova_messages_user_created ON nova_private.nova_messages(user_id,created_at);
CREATE TABLE IF NOT EXISTS nova_private.nova_tickets (id text PRIMARY KEY,ticket_number text UNIQUE NOT NULL,user_id text NOT NULL REFERENCES nova_private.nova_users(id),customer_email text NOT NULL,customer_language text NOT NULL,user_query text NOT NULL,conversation_summary text NOT NULL,status text NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')),agent_notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS nova_tickets_user_created ON nova_private.nova_tickets(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS nova_private.nova_policies (
    doc_id text PRIMARY KEY, title text NOT NULL, filename text NOT NULL, sha256 text NOT NULL,
    version integer NOT NULL DEFAULT 1, chunks jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA nova_private FROM PUBLIC;
ALTER TABLE nova_private.nova_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_private.nova_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_private.nova_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_private.nova_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_private.nova_policies ENABLE ROW LEVEL SECURITY;
'''
TICKET_COLUMNS = '''id,ticket_number AS "ticketNumber",user_id AS "userId",customer_email AS "customerEmail",customer_language AS "customerLanguage",user_query AS "userQuery",conversation_summary AS "conversationSummary",status,agent_notes AS "agentNotes",created_at AS "createdAt",updated_at AS "updatedAt"'''

def validate_database_url(url: str, production: bool):
    if not url:
        raise RuntimeError('DATABASE_URL must be set in server/.env or the environment')
    try:
        options = conninfo_to_dict(url)
    except Exception:
        raise RuntimeError('DATABASE_URL is not a valid PostgreSQL connection string') from None
    if production:
        hosts = options.get('host', os.getenv('PGHOST', '')).split(',')
        remote = any(host and host not in ('localhost', '127.0.0.1', '::1') and not host.startswith('/') for host in hosts)
        sslmode = options.get('sslmode', os.getenv('PGSSLMODE', ''))
        if remote and sslmode not in ('require', 'verify-ca', 'verify-full'):
            raise RuntimeError('Remote production DATABASE_URL must require TLS (prefer sslmode=verify-full with a trusted CA)')


async def start():
    global pool, vector_schema
    validate_database_url(config.DATABASE_URL, config.PRODUCTION)
    pool = AsyncConnectionPool(config.DATABASE_URL, open=False, min_size=1, max_size=5,
                               timeout=10, check=AsyncConnectionPool.check_connection,
                               kwargs={'row_factory': dict_row})
    try:
        await pool.open(wait=True, timeout=15)
        await initialize_schema()
    except BaseException:
        await pool.close()
        pool = None
        vector_schema = None
        raise


async def initialize_schema():
    global vector_schema
    if pool is None: raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        await conn.execute(SCHEMA)
        await conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
        schema_row = await (await conn.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'")).fetchone()
        vector_schema = schema_row['nspname']
        await conn.execute(sql.SQL("""CREATE TABLE IF NOT EXISTS nova_private.nova_policy_vectors (
            doc_id text NOT NULL REFERENCES nova_private.nova_policies(doc_id) ON DELETE CASCADE,
            passage_index integer NOT NULL, model_name text NOT NULL, policy_sha256 text NOT NULL,
            chunk jsonb NOT NULL, embedding {}.vector(384) NOT NULL,
            PRIMARY KEY (doc_id, passage_index))""").format(sql.Identifier(vector_schema)))
        await conn.execute(sql.SQL('''CREATE TABLE IF NOT EXISTS nova_private.nova_builtin_vectors (
            passage_index integer PRIMARY KEY, model_name text NOT NULL, corpus_hash text NOT NULL,
            chunk jsonb NOT NULL, embedding {}.vector(384) NOT NULL)''').format(sql.Identifier(vector_schema)))
        await conn.execute('ALTER TABLE nova_private.nova_builtin_vectors ENABLE ROW LEVEL SECURITY')
        await conn.execute('REVOKE ALL ON nova_private.nova_builtin_vectors FROM PUBLIC')
        await conn.execute('ALTER TABLE nova_private.nova_policy_vectors ENABLE ROW LEVEL SECURITY')
        await conn.execute('REVOKE ALL ON nova_private.nova_policy_vectors FROM PUBLIC')
        # Apply the retention limit to histories that predate this change.
        await conn.execute("""DELETE FROM nova_private.nova_messages WHERE id IN (
            SELECT id FROM (SELECT id, row_number() OVER
                (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
                FROM nova_private.nova_messages) ranked WHERE position > 200)""")

async def close():
    global pool, vector_schema
    if pool:
        await pool.close()
        pool = None
    vector_schema = None

async def execute(query, params=(), fetch=None):
    if pool is None:
        raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        cursor = await conn.execute(query, params)
        if fetch == 'one': return await cursor.fetchone()
        if fetch == 'all': return await cursor.fetchall()

# Node's scryptSync uses the literal hexadecimal salt string as UTF-8 bytes.
def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()

def token_hash(token): return hashlib.sha256(token.encode()).hexdigest()

async def signup(email, password, name):
    import re
    email = email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or not 8 <= len(password) <= 128 or not name.strip():
        raise ValueError('Enter your name, a valid email, and a password of 8 to 128 characters.')
    if email == config.ADMIN_EMAIL: raise ValueError('This address is reserved for the administrator.')
    user = {'id': str(uuid.uuid4()), 'email': email, 'name': name.strip()[:80], 'isAdmin': False}
    salt = secrets.token_hex(16)
    from psycopg.errors import UniqueViolation
    hashed = await asyncio.to_thread(password_hash, password, salt)
    try:
        await execute('INSERT INTO nova_private.nova_users (id,email,name,salt,hash) VALUES (%s,%s,%s,%s,%s)', (user['id'], email, user['name'], salt, hashed))
    except UniqueViolation:
        raise ValueError('An account already exists for this email.')
    return user

async def login(email, password):
    email = email.strip().lower()
    if len(password) > 128: raise ValueError('Invalid email or password.')
    if email == config.ADMIN_EMAIL:
        if config.ADMIN_PASSWORD and hmac.compare_digest(password.encode(), config.ADMIN_PASSWORD.encode()): return {'id':'admin','email':email,'name':'Admin','isAdmin':True}
        raise ValueError('Invalid email or password.')
    user = await execute('SELECT * FROM nova_private.nova_users WHERE email=%s', (email,), 'one')
    # Perform the same expensive derivation for unknown emails as for existing accounts.
    hashed = await asyncio.to_thread(password_hash, password, user['salt'] if user else '0' * 32)
    if not user or not hmac.compare_digest(hashed, user['hash']): raise ValueError('Invalid email or password.')
    return {'id':user['id'],'email':user['email'],'name':user['name'],'isAdmin':False}

async def create_session(user):
    token = secrets.token_hex(32)
    await execute("INSERT INTO nova_private.nova_sessions VALUES (%s,%s,%s,%s,%s,now() + interval '1 day')", (token_hash(token), user['id'], user['email'], user['name'], user['isAdmin']))
    return token

async def session(token):
    if not token: return None
    return await execute('SELECT user_id AS id,email,name,is_admin AS "isAdmin" FROM nova_private.nova_sessions WHERE token_hash=%s AND expires_at > now()', (token_hash(token),), 'one')

async def logout(token):
    if token: await execute('DELETE FROM nova_private.nova_sessions WHERE token_hash=%s', (token_hash(token),))

async def lock_message_history(conn, user_id):
    # Serialize a user's writes across requests and application instances.
    await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (user_id,))

async def prune_messages(conn, user_id):
    await conn.execute("""DELETE FROM nova_private.nova_messages WHERE user_id=%s AND id IN (
        SELECT id FROM nova_private.nova_messages WHERE user_id=%s
        ORDER BY created_at DESC, id DESC OFFSET 200)""", (user_id, user_id))

async def add_message(user_id, sender, text, sources=None, suggest=None):
    if pool is None: raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        await lock_message_history(conn, user_id)
        await conn.execute('INSERT INTO nova_private.nova_messages (id,user_id,sender,text,sources,suggest_ticket,created_at) VALUES (%s,%s,%s,%s,%s::jsonb,%s,clock_timestamp())', (str(uuid.uuid4()),user_id,sender,text,json.dumps(sources) if sources is not None else None,suggest))
        await prune_messages(conn, user_id)

async def history(user_id):
    return await execute('SELECT * FROM (SELECT id,sender,text,sources,suggest_ticket AS "suggestTicket",created_at AS "createdAt" FROM nova_private.nova_messages WHERE user_id=%s ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY "createdAt",id', (user_id,), 'all')

async def tickets(user):
    if user['isAdmin']: return await execute(f'SELECT {TICKET_COLUMNS} FROM nova_private.nova_tickets ORDER BY created_at DESC', fetch='all')
    return await execute(f'SELECT {TICKET_COLUMNS} FROM nova_private.nova_tickets WHERE user_id=%s ORDER BY created_at DESC', (user['id'],), 'all')

async def create_ticket(user, language, query, summary):
    ticket_id = str(uuid.uuid4())
    return await execute(f"INSERT INTO nova_private.nova_tickets (id,ticket_number,user_id,customer_email,customer_language,user_query,conversation_summary,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'OPEN') RETURNING {TICKET_COLUMNS}", (ticket_id, f'TN-{ticket_id[:8].upper()}', user['id'], user['email'], language, query, summary), 'one')

async def update_ticket(ticket_id, status, notes):
    if status not in ('OPEN','IN_PROGRESS','RESOLVED'): status = None
    if notes is not None: notes = notes[:4000]
    return await execute(f'UPDATE nova_private.nova_tickets SET status=COALESCE(%s,status),agent_notes=COALESCE(%s,agent_notes),updated_at=now() WHERE id=%s RETURNING {TICKET_COLUMNS}', (status, notes, ticket_id), 'one')

async def insert_policy_vectors(conn, doc_id, sha256, chunks, vectors, model_name):
    if len(chunks) != len(vectors): raise ValueError('Each passage must have an embedding')
    if vector_schema is None: raise RuntimeError('Vector storage is not initialized')
    await conn.execute('DELETE FROM nova_private.nova_policy_vectors WHERE doc_id=%s', (doc_id,))
    query = sql.SQL("""INSERT INTO nova_private.nova_policy_vectors
        (doc_id,passage_index,model_name,policy_sha256,chunk,embedding)
        VALUES (%s,%s,%s,%s,%s::jsonb,%s::{}.vector)""").format(sql.Identifier(vector_schema))
    values = [(doc_id, i, model_name, sha256, json.dumps(chunk), json.dumps(vector, allow_nan=False))
              for i, (chunk, vector) in enumerate(zip(chunks, vectors))]
    async with conn.cursor() as cursor:
        await cursor.executemany(query, values)


async def save_policy(doc_id, title, filename, sha256, chunks, vectors, model_name):
    if pool is None: raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        # Coordinate replacement and background reindexing for the same document.
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 1))', (doc_id,))
        result = await (await conn.execute("""INSERT INTO nova_private.nova_policies (doc_id,title,filename,sha256,chunks)
            VALUES (%s,%s,%s,%s,%s::jsonb)
            ON CONFLICT (doc_id) DO UPDATE SET title=EXCLUDED.title,filename=EXCLUDED.filename,
            sha256=EXCLUDED.sha256,chunks=EXCLUDED.chunks,version=nova_private.nova_policies.version+1,updated_at=now()
            RETURNING doc_id AS "docId",title,filename,version,updated_at AS "updatedAt""" + '"',
            (doc_id,title,filename,sha256,json.dumps(chunks)))).fetchone()
        await insert_policy_vectors(conn, doc_id, sha256, chunks, vectors, model_name)
        return result


async def policies_to_index(model_name):
    return await execute("""SELECT p.doc_id,p.sha256,p.chunks,p.version FROM nova_private.nova_policies p
        LEFT JOIN nova_private.nova_policy_vectors v ON v.doc_id=p.doc_id
        GROUP BY p.doc_id,p.sha256,p.chunks,p.version
        HAVING COUNT(v.passage_index) <> jsonb_array_length(p.chunks)
           OR COUNT(v.passage_index) FILTER (WHERE v.model_name=%s AND v.policy_sha256=p.sha256) <> jsonb_array_length(p.chunks)""", (model_name,), 'all')


async def index_existing_policy(doc_id, sha256, version, chunks, vectors, model_name):
    if pool is None: raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 1))', (doc_id,))
        row = await (await conn.execute('SELECT sha256,version FROM nova_private.nova_policies WHERE doc_id=%s', (doc_id,))).fetchone()
        if not row or row['sha256'] != sha256 or row['version'] != version: return False
        await insert_policy_vectors(conn, doc_id, sha256, chunks, vectors, model_name)
        return True


async def search_policy_vectors(vector, model_name, limit=8):
    if pool is None or vector_schema is None: raise RuntimeError('Vector storage is not initialized')
    vector_text = json.dumps(vector, allow_nan=False)
    query = sql.SQL("""SELECT chunk, 1 - (embedding OPERATOR({}.<=>) %s::{}.vector) AS score
        FROM nova_private.nova_policy_vectors WHERE model_name=%s
        ORDER BY embedding OPERATOR({}.<=>) %s::{}.vector LIMIT %s""").format(*([sql.Identifier(vector_schema)] * 4))
    async with pool.connection() as conn:
        rows = await (await conn.execute(query, (vector_text, model_name, vector_text, limit))).fetchall()
    return [{**row['chunk'], 'score': float(row['score'])} for row in rows]

async def list_policies():
    return await execute('SELECT doc_id AS "docId",title,filename,version,updated_at AS "updatedAt",jsonb_array_length(chunks) AS passages FROM nova_private.nova_policies ORDER BY updated_at DESC', fetch='all')

async def policy_chunks():
    rows = await execute('SELECT doc_id,chunks FROM nova_private.nova_policies', fetch='all')
    return {row['doc_id']: row['chunks'] for row in rows}


async def has_uploaded_policies():
    row = await execute('SELECT EXISTS (SELECT 1 FROM nova_private.nova_policies) AS present', fetch='one')
    return row['present']


async def builtin_index_current(model_name, corpus_hash, expected_count):
    row = await execute("""SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE model_name=%s AND corpus_hash=%s) AS valid
        FROM nova_private.nova_builtin_vectors""", (model_name, corpus_hash), 'one')
    return row['total'] == expected_count and row['valid'] == expected_count


async def replace_builtin_index(chunks, vectors, model_name, corpus_hash):
    if pool is None or vector_schema is None: raise RuntimeError('Vector storage is not initialized')
    if len(chunks) != len(vectors): raise ValueError('Each passage must have an embedding')
    async with pool.connection() as conn:
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 2))', ('nova_builtin_vectors',))
        current = await (await conn.execute("""SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE model_name=%s AND corpus_hash=%s) AS valid
            FROM nova_private.nova_builtin_vectors""", (model_name, corpus_hash))).fetchone()
        if current['total'] == len(chunks) and current['valid'] == len(chunks): return
        await conn.execute('DELETE FROM nova_private.nova_builtin_vectors')
        query = sql.SQL("""INSERT INTO nova_private.nova_builtin_vectors
            (passage_index,model_name,corpus_hash,chunk,embedding)
            VALUES (%s,%s,%s,%s::jsonb,%s::{}.vector)""").format(sql.Identifier(vector_schema))
        async with conn.cursor() as cursor:
            await cursor.executemany(query, [(i, model_name, corpus_hash, json.dumps(chunk), json.dumps(vector, allow_nan=False))
                for i, (chunk, vector) in enumerate(zip(chunks, vectors))])


async def search_builtin_vectors(vector, model_name, limit=8):
    if pool is None or vector_schema is None: raise RuntimeError('Vector storage is not initialized')
    vector_text = json.dumps(vector, allow_nan=False)
    query = sql.SQL("""SELECT chunk, 1 - (embedding OPERATOR({}.<=>) %s::{}.vector) AS score
        FROM nova_private.nova_builtin_vectors WHERE model_name=%s
        ORDER BY embedding OPERATOR({}.<=>) %s::{}.vector LIMIT %s""").format(*([sql.Identifier(vector_schema)] * 4))
    async with pool.connection() as conn:
        rows = await (await conn.execute(query, (vector_text, model_name, vector_text, limit))).fetchall()
    return [{**row['chunk'], 'score': float(row['score'])} for row in rows]


async def delete_policy(doc_id):
    if pool is None: raise RuntimeError('Database not initialized')
    async with pool.connection() as conn:
        await conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 1))', (doc_id,))
        row = await (await conn.execute('DELETE FROM nova_private.nova_policies WHERE doc_id=%s RETURNING doc_id', (doc_id,))).fetchone()
        return row is not None
