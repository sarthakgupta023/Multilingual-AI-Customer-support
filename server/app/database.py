import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timezone
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from . import config

pool: AsyncConnectionPool | None = None
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

async def start():
    global pool
    if not config.DATABASE_URL:
        raise RuntimeError('DATABASE_URL must be set in server/.env')
    pool = AsyncConnectionPool(config.DATABASE_URL, open=False, kwargs={'row_factory': dict_row})
    await pool.open(wait=True, timeout=15)
    async with pool.connection() as conn:
        await conn.execute(SCHEMA)
        # Apply the retention limit to histories that predate this change.
        await conn.execute("""DELETE FROM nova_private.nova_messages WHERE id IN (
            SELECT id FROM (SELECT id, row_number() OVER
                (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
                FROM nova_private.nova_messages) ranked WHERE position > 200)""")

async def close():
    global pool
    if pool:
        await pool.close()
        pool = None

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
    try:
        await execute('INSERT INTO nova_private.nova_users (id,email,name,salt,hash) VALUES (%s,%s,%s,%s,%s)', (user['id'], email, user['name'], salt, password_hash(password, salt)))
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
    if not user or not hmac.compare_digest(password_hash(password, user['salt']), user['hash']): raise ValueError('Invalid email or password.')
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

async def save_policy(doc_id, title, filename, sha256, chunks):
    return await execute("""INSERT INTO nova_private.nova_policies (doc_id,title,filename,sha256,chunks)
        VALUES (%s,%s,%s,%s,%s::jsonb)
        ON CONFLICT (doc_id) DO UPDATE SET title=EXCLUDED.title,filename=EXCLUDED.filename,
        sha256=EXCLUDED.sha256,chunks=EXCLUDED.chunks,version=nova_private.nova_policies.version+1,updated_at=now()
        RETURNING doc_id AS "docId",title,filename,version,updated_at AS "updatedAt"
        """,
        (doc_id,title,filename,sha256,json.dumps(chunks)), 'one')

async def list_policies():
    return await execute('SELECT doc_id AS "docId",title,filename,version,updated_at AS "updatedAt",jsonb_array_length(chunks) AS passages FROM nova_private.nova_policies ORDER BY updated_at DESC', fetch='all')

async def policy_chunks():
    rows = await execute('SELECT doc_id,chunks FROM nova_private.nova_policies', fetch='all')
    return {row['doc_id']: row['chunks'] for row in rows}
