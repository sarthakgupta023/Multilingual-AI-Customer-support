import crypto from 'crypto';
import { Pool } from 'pg';

export const ADMIN_EMAIL = 'solongnososhort057@gmail.com';
export type PublicUser = { id: string; email: string; name: string; isAdmin: boolean };
interface Message { sources?: any[]; suggestTicket?: boolean }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', err => console.error('Database connection error:', err.message));
export async function databaseReady() { await pool.query('SELECT 1'); }
export async function initDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in server/.env');
  await pool.query(`CREATE SCHEMA IF NOT EXISTS nova_private;
    REVOKE ALL ON SCHEMA nova_private FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS nova_private.nova_users (id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, salt text NOT NULL, hash text NOT NULL);
    CREATE TABLE IF NOT EXISTS nova_private.nova_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, email text NOT NULL, name text NOT NULL, is_admin boolean NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS nova_private.nova_messages (id text PRIMARY KEY, user_id text NOT NULL REFERENCES nova_private.nova_users(id), sender text NOT NULL CHECK(sender IN ('user','assistant')), text text NOT NULL, sources jsonb, suggest_ticket boolean, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS nova_messages_user_created ON nova_private.nova_messages(user_id, created_at);
    CREATE TABLE IF NOT EXISTS nova_private.nova_tickets (id text PRIMARY KEY, ticket_number text UNIQUE NOT NULL, user_id text NOT NULL REFERENCES nova_private.nova_users(id), customer_email text NOT NULL, customer_language text NOT NULL, user_query text NOT NULL, conversation_summary text NOT NULL, status text NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')), agent_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS nova_tickets_user_created ON nova_private.nova_tickets(user_id, created_at DESC);
    REVOKE ALL ON ALL TABLES IN SCHEMA nova_private FROM PUBLIC;
    ALTER TABLE nova_private.nova_users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nova_private.nova_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nova_private.nova_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nova_private.nova_tickets ENABLE ROW LEVEL SECURITY;`);
}
function hash(password: string, salt: string) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function tokenHash(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
function cookieToken(cookie = '') { return cookie.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8); }
export async function signup(email: string, password: string, name: string): Promise<PublicUser> {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (password.length < 8 || password.length > 128) || !name.trim()) throw new Error('Enter your name, a valid email, and a password of at least 8 characters.');
  if (email === ADMIN_EMAIL) throw new Error('This address is reserved for the administrator.');
  const user = { id: crypto.randomUUID(), email, name: name.trim().slice(0, 80), isAdmin: false }; const salt = crypto.randomBytes(16).toString('hex');
  try { await pool.query('INSERT INTO nova_private.nova_users (id,email,name,salt,hash) VALUES ($1,$2,$3,$4,$5)', [user.id, email, user.name, salt, hash(password,salt)]); } catch (e: any) { if (e.code === '23505') throw new Error('An account already exists for this email.'); throw e; }
  return user;
}
export async function login(email: string, password: string): Promise<PublicUser> {
  email = email.trim().toLowerCase();
  if (password.length > 128) throw new Error('Invalid email or password.');
  if (email === ADMIN_EMAIL) { const adminPassword = process.env.ADMIN_PASSWORD; if (adminPassword && Buffer.byteLength(password) === Buffer.byteLength(adminPassword) && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))) return { id: 'admin', email, name: 'Admin', isAdmin: true }; throw new Error('Invalid email or password.'); }
  const result = await pool.query('SELECT * FROM nova_private.nova_users WHERE email=$1', [email]); const user = result.rows[0];
  if (!user || !crypto.timingSafeEqual(Buffer.from(hash(password, user.salt), 'hex'), Buffer.from(user.hash, 'hex'))) throw new Error('Invalid email or password.');
  return { id: user.id, email: user.email, name: user.name, isAdmin: false };
}
export async function createSession(user: PublicUser) { const token = crypto.randomBytes(32).toString('hex'); await pool.query("INSERT INTO nova_private.nova_sessions VALUES ($1,$2,$3,$4,$5,now() + interval '1 day')", [tokenHash(token),user.id,user.email,user.name,user.isAdmin]); return token; }
export async function sessionFromCookie(cookie = '') { const token = cookieToken(cookie); if (!token) return null; const r = await pool.query('SELECT user_id AS id,email,name,is_admin AS "isAdmin" FROM nova_private.nova_sessions WHERE token_hash=$1 AND expires_at > now()', [tokenHash(token)]); return (r.rows[0] as PublicUser | undefined) || null; }
export async function endSession(cookie = '') { const token = cookieToken(cookie); if (token) await pool.query('DELETE FROM nova_private.nova_sessions WHERE token_hash=$1',[tokenHash(token)]); }
export async function addMessage(userId: string, sender: 'user' | 'assistant', text: string, extra: Message = {}) { await pool.query('INSERT INTO nova_private.nova_messages (id,user_id,sender,text,sources,suggest_ticket) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(),userId,sender,text,extra.sources ? JSON.stringify(extra.sources) : null,extra.suggestTicket ?? null]); }
export async function getMessages(userId: string) { const r = await pool.query('SELECT * FROM (SELECT id,sender,text,sources,suggest_ticket AS "suggestTicket",created_at AS "createdAt" FROM nova_private.nova_messages WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY "createdAt",id', [userId]); return r.rows; }
const ticketFields = 'id,ticket_number AS "ticketNumber",user_id AS "userId",customer_email AS "customerEmail",customer_language AS "customerLanguage",user_query AS "userQuery",conversation_summary AS "conversationSummary",status,agent_notes AS "agentNotes",created_at AS "createdAt",updated_at AS "updatedAt"';
export async function createTicket(user: PublicUser, language: string, query: string, summary: string) { if (user.isAdmin) throw new Error('Admin accounts cannot create customer tickets.'); const id = crypto.randomUUID(); const r = await pool.query(`INSERT INTO nova_private.nova_tickets (id,ticket_number,user_id,customer_email,customer_language,user_query,conversation_summary,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN') RETURNING ${ticketFields}`, [id,`TN-${id.slice(0,8).toUpperCase()}`,user.id,user.email,language,query,summary]); return r.rows[0]; }
export async function getTickets(user: PublicUser) { const r = user.isAdmin ? await pool.query(`SELECT ${ticketFields} FROM nova_private.nova_tickets ORDER BY created_at DESC`) : await pool.query(`SELECT ${ticketFields} FROM nova_private.nova_tickets WHERE user_id=$1 ORDER BY created_at DESC`,[user.id]); return r.rows; }
export async function updateTicket(id: string, updates: { status?: string; agentNotes?: string }) { const status = updates.status && ['OPEN','IN_PROGRESS','RESOLVED'].includes(updates.status) ? updates.status : null; const notes = typeof updates.agentNotes === 'string' ? updates.agentNotes.slice(0,4000) : null; const r = await pool.query(`UPDATE nova_private.nova_tickets SET status=COALESCE($2,status),agent_notes=COALESCE($3,agent_notes),updated_at=now() WHERE id=$1 RETURNING ${ticketFields}`, [id,status,notes]); return r.rows[0] || null; }
