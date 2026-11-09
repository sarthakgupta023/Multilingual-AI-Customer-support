import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { initDatabase } from '../services/accounts';

async function main() {
  const file = process.env.DATA_FILE || path.resolve(process.cwd(), 'runtime-data.json');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
  if (!fs.existsSync(file)) throw new Error('Local data file not found.');
  const data = JSON.parse(fs.readFileSync(file,'utf8')); await initDatabase();
  const pool = new Pool({connectionString: process.env.DATABASE_URL}); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of data.users || []) await client.query('INSERT INTO nova_private.nova_users (id,email,name,salt,hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',[u.id,u.email,u.name,u.salt,u.hash]);
    for (const m of data.messages || []) await client.query('INSERT INTO nova_private.nova_messages (id,user_id,sender,text,sources,suggest_ticket,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',[m.id,m.userId,m.sender,m.text,m.sources ? JSON.stringify(m.sources) : null,m.suggestTicket ?? null,m.createdAt]);
    for (const t of data.tickets || []) await client.query('INSERT INTO nova_private.nova_tickets (id,ticket_number,user_id,customer_email,customer_language,user_query,conversation_summary,status,agent_notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING',[t.id,t.ticketNumber,t.userId,t.customerEmail,t.customerLanguage,t.userQuery,t.conversationSummary || '',t.status,t.agentNotes || null,t.createdAt,t.updatedAt || t.createdAt]);
    await client.query('COMMIT'); console.log('Local accounts, messages and tickets imported. The original file was retained.');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); await pool.end(); }
}
main().then(() => process.exit(0)).catch(e => { console.error('Import failed:',e.message); process.exit(1); });
