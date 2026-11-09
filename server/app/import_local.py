"""Import the previous JSON store without modifying the source file."""
import asyncio
import json
import os
from pathlib import Path
from . import config, database

async def main():
    file = Path(os.getenv('DATA_FILE', config.ROOT / 'server' / 'runtime-data.json'))
    data = json.loads(file.read_text(encoding='utf-8'))
    await database.start()
    try:
        async with database.pool.connection() as conn:
            for u in data.get('users', []):
                await conn.execute('INSERT INTO nova_private.nova_users (id,email,name,salt,hash) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING', (u['id'],u['email'],u['name'],u['salt'],u['hash']))
            message_users = sorted({m['userId'] for m in data.get('messages', [])})
            for user_id in message_users:
                await database.lock_message_history(conn, user_id)
            for m in data.get('messages', []):
                await conn.execute('INSERT INTO nova_private.nova_messages (id,user_id,sender,text,sources,suggest_ticket,created_at) VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s) ON CONFLICT (id) DO NOTHING', (m['id'],m['userId'],m['sender'],m['text'],json.dumps(m['sources']) if m.get('sources') is not None else None,m.get('suggestTicket'),m['createdAt']))
            for user_id in message_users:
                await database.prune_messages(conn, user_id)
            for t in data.get('tickets', []):
                await conn.execute('INSERT INTO nova_private.nova_tickets (id,ticket_number,user_id,customer_email,customer_language,user_query,conversation_summary,status,agent_notes,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING', (t['id'],t['ticketNumber'],t['userId'],t['customerEmail'],t['customerLanguage'],t['userQuery'],t.get('conversationSummary') or '',t['status'],t.get('agentNotes'),t['createdAt'],t.get('updatedAt') or t['createdAt']))
        print('Imported local accounts, conversations and tickets. The original file remains unchanged.')
    finally:
        await database.close()

if __name__ == '__main__': asyncio.run(main())
