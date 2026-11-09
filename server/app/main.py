import asyncio
import base64
import binascii
import json
import logging
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import websockets
from . import config, database
from .agent import answer_question
from .policies import parse_policy

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.PRODUCTION and len(config.ADMIN_PASSWORD) < 12:
        raise RuntimeError('Set ADMIN_PASSWORD to at least 12 characters in production')
    await database.start()
    yield
    await database.close()

app = FastAPI(lifespan=lifespan)
attempts = {}

@app.middleware('http')
async def security(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method in ('POST','PUT','PATCH','DELETE') and origin:
        try:
            if urlparse(origin).netloc.lower() != request.headers.get('host','').lower(): return JSONResponse({'error':'Origin not allowed'}, 403)
        except ValueError: return JSONResponse({'error':'Origin not allowed'}, 403)
    if request.url.path in ('/api/auth/login','/api/auth/signup') and request.method == 'POST':
        now = time.monotonic(); key = request.client.host if request.client else 'unknown'
        if len(attempts) > 10000:
            for old in list(attempts):
                if attempts[old][1] <= now: attempts.pop(old, None)
        count, until = attempts.get(key, (0, now + 900))
        if until <= now: count, until = 0, now + 900
        attempts[key] = (count + 1, until)
        if count >= 20: return JSONResponse({'error':'Too many attempts. Please try again later.'}, 429)
    return await call_next(request)

class Auth(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)
    name: str = Field(default='', max_length=100)
class TicketCreate(BaseModel):
    query: str = Field(max_length=4000)
    language: str = Field(default='en', max_length=10)
    summary: str = Field(default='', max_length=4000)
class PolicyUpload(BaseModel):
    docId: str = Field(max_length=64)
    title: str = Field(max_length=200)
    filename: str = Field(max_length=255)
    contentBase64: str = Field(max_length=7_000_000)
class TicketUpdate(BaseModel):
    status: str | None = None
    agentNotes: str | None = Field(default=None, max_length=4000)

def set_cookie(response, token):
    response.set_cookie('session',token,httponly=True,samesite='strict',secure=config.PRODUCTION,max_age=86400,path='/')

async def current_user(request: Request):
    user = await database.session(request.cookies.get('session'))
    if not user: raise HTTPException(401, 'Sign in required')
    return user

@app.exception_handler(HTTPException)
async def handle_http(_request, exc): return JSONResponse({'error':exc.detail}, status_code=exc.status_code)

@app.post('/api/auth/signup', status_code=201)
async def signup(body: Auth, response: Response):
    try: user = await database.signup(body.email,body.password,body.name)
    except ValueError as e: raise HTTPException(400,str(e)) from e
    set_cookie(response,await database.create_session(user)); return user

@app.post('/api/auth/login')
async def login(body: Auth, response: Response):
    try: user = await database.login(body.email,body.password)
    except ValueError as e: raise HTTPException(401,str(e)) from e
    set_cookie(response,await database.create_session(user)); return user

@app.post('/api/auth/logout')
async def logout(request: Request, response: Response):
    await database.logout(request.cookies.get('session')); response.delete_cookie('session',path='/',samesite='strict',secure=config.PRODUCTION,httponly=True); return {'ok':True}

@app.get('/api/auth/me')
async def me(request: Request): return await current_user(request)

@app.get('/api/health')
async def health():
    try: await database.execute('SELECT 1', fetch='one')
    except Exception: return JSONResponse({'status':'unavailable','database':'disconnected'},503)
    return {'status':'ok','database':'connected','backend':'python','gnaniMock':config.GNANI_MOCK,'llmMock':config.LLM_MOCK}

@app.get('/api/history')
async def history(request: Request):
    user = await current_user(request); return await database.history(user['id'])

@app.get('/api/tickets')
async def tickets(request: Request): return await database.tickets(await current_user(request))

@app.post('/api/tickets',status_code=201)
async def new_ticket(body: TicketCreate,request: Request):
    user = await current_user(request)
    if user['isAdmin']: raise HTTPException(403,'Admin accounts cannot create customer tickets.')
    if not body.query.strip(): raise HTTPException(400,'A question is required')
    return await database.create_ticket(user,body.language,body.query.strip(),body.summary)

@app.patch('/api/tickets/{ticket_id}')
async def update_ticket(ticket_id: str,body: TicketUpdate,request: Request):
    user = await current_user(request)
    if not user['isAdmin']: raise HTTPException(403,'Admin access required')
    ticket = await database.update_ticket(ticket_id,body.status,body.agentNotes)
    if not ticket: raise HTTPException(404,'Ticket not found')
    return ticket

@app.get('/api/admin/policies')
async def list_policy_documents(request: Request):
    user = await current_user(request)
    if not user['isAdmin']: raise HTTPException(403, 'Admin access required')
    return await database.list_policies()

@app.post('/api/admin/policies', status_code=201)
async def upload_policy(body: PolicyUpload, request: Request):
    user = await current_user(request)
    if not user['isAdmin']: raise HTTPException(403, 'Admin access required')
    filename = Path(body.filename.replace('\\','/')).name
    try:
        raw = base64.b64decode(body.contentBase64, validate=True)
        chunks, digest = await asyncio.to_thread(parse_policy, raw, filename, body.docId.strip(), body.title)
    except (ValueError, binascii.Error) as e:
        raise HTTPException(400, str(e)) from e
    result = await database.save_policy(body.docId.strip(), body.title.strip(), filename, digest, chunks)
    return {**result, 'passages': len(chunks)}

@app.websocket('/ws/voice')
async def voice(ws: WebSocket):
    origin = ws.headers.get('origin')
    try: allowed = not origin or urlparse(origin).netloc.lower() == ws.headers.get('host','').lower()
    except ValueError: allowed = False
    user = await database.session(ws.cookies.get('session')) if allowed else None
    if not user: await ws.close(code=1008); return
    await ws.accept()
    language='en'; rate=16000; upstream=None; reader=None; turn_task=None; lock=asyncio.Lock()
    recent = [] if user['isAdmin'] else await database.history(user['id'])
    history = [{'role': 'assistant' if m['sender']=='assistant' else 'user', 'content':m['text']} for m in recent[-6:]]
    async def send(data):
        async with lock: await ws.send_json(data)
    async def turn(text):
        try:
            if not user['isAdmin']: await database.add_message(user['id'],'user',text)
            answer = await answer_question(text,language,history)
            history.extend([{'role':'user','content':text},{'role':'assistant','content':answer['fullAnswer']}])
            if not user['isAdmin']: await database.add_message(user['id'],'assistant',answer['fullAnswer'],answer['sources'],answer['suggestTicket'])
            await send({'type':'answer',**answer})
        except Exception:
            log.exception('Turn failed'); await send({'type':'error','message':'Could not answer right now. Please try again.'})
    def start_turn(text):
        nonlocal turn_task
        if turn_task and not turn_task.done(): return False
        turn_task=asyncio.create_task(turn(text[:4000])); return True
    async def read_stt(connection):
        try:
            async for message in connection:
                if not isinstance(message,str): continue
                try: obj=json.loads(message)
                except (ValueError,TypeError): continue
                if obj.get('type') == 'error': await send({'type':'error','message':'Speech recognition is unavailable. Please type your question.'}); continue
                text = obj.get('transcript') or obj.get('text')
                if isinstance(text,str) and text.strip():
                    final = obj.get('is_final',True)
                    await send({'type':'transcript','text':text,'isFinal':final})
                    if final and len(text.strip()) > 1 and not start_turn(text.strip()): await send({'type':'error','message':'Please wait for the current answer.'})
        except (websockets.ConnectionClosed, WebSocketDisconnect): pass
        except Exception: log.exception('Speech recognition failed'); await send({'type':'error','message':'Speech recognition disconnected. Please type your question.'})
    async def close_stt():
        nonlocal upstream, reader
        if reader:
            reader.cancel()
            with suppress(asyncio.CancelledError, Exception): await reader
            reader=None
        if upstream:
            with suppress(Exception): await upstream.close()
            upstream=None
    try:
        while True:
            msg=await ws.receive()
            if msg['type']=='websocket.disconnect': break
            if msg.get('bytes') is not None:
                if upstream: await upstream.send(msg['bytes'])
                continue
            try: data=json.loads(msg.get('text') or '{}')
            except (ValueError, TypeError): await send({'type':'error','message':'Invalid message.'}); continue
            kind=data.get('type')
            if kind in ('init','set_language','set_sample_rate'):
                language=str(data.get('language') or language)[:10]; rate=8000 if data.get('sampleRate') == 8000 else 16000
                await close_stt()
                if not config.GNANI_MOCK:
                    try:
                        code = 'indic-auto' if language == 'auto' else language + '-IN'
                        upstream=await websockets.connect(config.GNANI_URL,additional_headers={'x-api-key-id':config.GNANI_KEY,'lang_code':code,'x-sample-rate':str(rate)},open_timeout=10,max_size=1048576)
                        reader=asyncio.create_task(read_stt(upstream))
                    except Exception: log.warning('Speech recognition connection failed'); await send({'type':'error','message':'Speech recognition is unavailable. Please type your question.'})
                await send({'type':'ready'})
            elif kind=='text_input' and isinstance(data.get('text'),str) and data['text'].strip():
                if not start_turn(data['text'].strip()): await send({'type':'error','message':'Please wait for the current answer.'})
    except WebSocketDisconnect: pass
    finally:
        await close_stt()
        if turn_task and not turn_task.done():
            turn_task.cancel()
            with suppress(asyncio.CancelledError, Exception): await turn_task

client_dir = config.ROOT / 'client' / 'dist'
if client_dir.exists():
    app.mount('/assets',StaticFiles(directory=client_dir / 'assets'),name='assets')
    @app.get('/{path:path}', include_in_schema=False)
    async def frontend(path: str):
        if path.startswith('api/'): raise HTTPException(404,'Not found')
        candidate = (client_dir / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(client_dir.resolve()): return FileResponse(candidate)
        return FileResponse(client_dir / 'index.html')
