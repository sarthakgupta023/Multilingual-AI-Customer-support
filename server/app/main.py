import asyncio
import base64
import binascii
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import websockets
from . import config, database, embeddings
from .agent import answer_question, POLICIES
from .policies import parse_policy
from .tts import stream_speech

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.PRODUCTION and len(config.ADMIN_PASSWORD) < 12:
        raise RuntimeError('Set ADMIN_PASSWORD to at least 12 characters in production')
    await database.start()
    try:
        await embeddings.prepare_index()
        yield
    finally:
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

@app.get('/api/knowledge')
async def knowledge_status(request: Request):
    await current_user(request)
    uploads = await database.list_policies()
    if uploads:
        return {'source':'uploaded', 'documents':[{'docId':p['docId'],'title':p['title']} for p in uploads]}
    examples = {p['docId']:p['docTitle'] for p in POLICIES}
    return {'source':'sample', 'documents':[{'docId':key,'title':value} for key,value in examples.items()]}

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
    try:
        vectors = await embeddings.embed_documents([chunk['content'] for chunk in chunks])
    except Exception as error:
        log.exception('Policy indexing failed')
        raise HTTPException(503, 'The embedding model is unavailable. The policy was not saved.') from error
    result = await database.save_policy(body.docId.strip(), body.title.strip(), filename, digest, chunks, vectors, embeddings.MODEL_NAME)
    return {**result, 'passages': len(chunks)}

@app.delete('/api/admin/policies/{doc_id}')
async def remove_policy(doc_id: str, request: Request):
    user = await current_user(request)
    if not user['isAdmin']: raise HTTPException(403, 'Admin access required')
    if not await database.delete_policy(doc_id): raise HTTPException(404, 'Policy not found')
    return {'ok':True}

@app.websocket('/ws/voice')
async def voice(ws: WebSocket):
    origin = ws.headers.get('origin')
    try: allowed = not origin or urlparse(origin).netloc.lower() == ws.headers.get('host','').lower()
    except ValueError: allowed = False
    session_token = ws.cookies.get('session')
    user = await database.session(session_token) if allowed else None
    if not user: await ws.close(code=1008); return
    await ws.accept()
    language='en'; rate=16000; upstream=None; reader=None; turn_task=None; tts_task=None; flush_task=None; lock=asyncio.Lock()
    recent = [] if user['isAdmin'] else await database.history(user['id'])
    history = [{'role': 'assistant' if m['sender']=='assistant' else 'user', 'content':m['text']} for m in recent[-6:]]
    async def send(data):
        async with lock: await ws.send_json(data)
    async def stop_tts():
        nonlocal tts_task
        if tts_task and not tts_task.done():
            tts_task.cancel()
            with suppress(asyncio.CancelledError, Exception): await tts_task
        tts_task = None

    async def synthesize(turn_id, spoken_text, lang):
        sent_audio = False
        try:
            await send({'type':'tts_start', 'turnId':turn_id, 'sampleRate':config.GNANI_TTS_SAMPLE_RATE})
            async for audio in stream_speech(spoken_text, lang):
                sent_audio = True
                await send({'type':'audio_chunk', 'turnId':turn_id, 'audio':audio})
            await send({'type':'audio_complete', 'turnId':turn_id})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.warning('Voice synthesis failed: %s', type(error).__name__)
            await send({'type':'tts_error', 'turnId':turn_id, 'partial':sent_audio})

    async def turn(text, turn_language):
        nonlocal tts_task
        try:
            if not await database.session(session_token):
                await ws.close(code=1008)
                return
            if not user['isAdmin']: await database.add_message(user['id'],'user',text)
            answer = await answer_question(text,turn_language,history)
            history.extend([{'role':'user','content':text},{'role':'assistant','content':answer['fullAnswer']}])
            if not user['isAdmin']: await database.add_message(user['id'],'assistant',answer['fullAnswer'],answer['sources'],answer['suggestTicket'])
            await stop_tts()
            turn_id = str(uuid.uuid4())
            await send({'type':'answer','turnId':turn_id,'language':turn_language,**answer})
            if answer.get('spokenAnswer'):
                tts_task = asyncio.create_task(synthesize(turn_id, answer['spokenAnswer'], turn_language))
        except Exception:
            log.exception('Turn failed'); await send({'type':'error','message':'Could not answer right now. Please try again.'})
    def start_turn(text):
        nonlocal turn_task
        if turn_task and not turn_task.done(): return False
        turn_task=asyncio.create_task(turn(text[:4000], language)); return True
    def speech_connection_error(error):
        status = getattr(getattr(error, 'response', None), 'status_code', None)
        if status in (401, 403): return 'Speech provider rejected the API key. Check GNANI_API_KEY in server/.env.'
        if status == 429: return 'Speech provider rate limit or quota reached. Please try again later.'
        if isinstance(error, (OSError, TimeoutError)): return 'Cannot reach the speech provider. Check your internet connection and try again.'
        return 'Speech recognition could not connect. Please try again or type your question.'

    async def read_stt(connection):
        nonlocal upstream
        try:
            async for message in connection:
                if not isinstance(message,str): continue
                try: obj=json.loads(message)
                except (ValueError,TypeError): continue
                if obj.get('type') == 'error':
                    log.warning('Speech provider reported an error')
                    break
                text = obj.get('transcript') or obj.get('text')
                if isinstance(text,str) and text.strip():
                    final = obj.get('is_final',True)
                    await send({'type':'transcript','text':text,'isFinal':final})
                    if final and len(text.strip()) > 1 and not start_turn(text.strip()): await send({'type':'error','message':'Please wait for the current answer.'})
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed as error:
            log.info('Speech recognition connection closed: code=%s', error.code)
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception('Speech recognition connection failed')
        finally:
            # A normal idle close and an unexpected close both invalidate readiness.
            # Intentional closes clear upstream before cancelling this task.
            if upstream is connection:
                upstream = None
                with suppress(Exception): await send({'type':'speech_status','speechReady':False})

    async def stop_flush():
        nonlocal flush_task
        if flush_task and not flush_task.done():
            flush_task.cancel()
            with suppress(asyncio.CancelledError, Exception): await flush_task
        flush_task = None

    async def close_stt():
        nonlocal upstream, reader
        await stop_flush()
        connection, upstream = upstream, None
        task, reader = reader, None
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception): await task
        if connection:
            with suppress(Exception): await connection.close()

    async def finish_listening(connection, sample_rate):
        # Trailing silence lets the provider's end-of-speech detector finish
        # the last utterance after the browser stops the microphone.
        try:
            for _ in range(24):
                if upstream is not connection: break
                await connection.send(bytes(1024))
                await asyncio.sleep(512 / sample_rate)
        except websockets.ConnectionClosed:
            log.info('Speech provider closed while finishing an utterance')

    async def start_listening(request_id):
        nonlocal upstream, reader
        # Always establish a fresh upstream connection: a previously open socket
        # may have been closed by the provider while the customer was idle.
        await close_stt()
        if config.GNANI_MOCK:
            await send({'type':'speech_ready','requestId':request_id,'speechReady':False,
                        'message':'Speech recognition is not configured. Please type your question.'})
            return
        try:
            code = 'indic-auto' if language == 'auto' else language + '-IN'
            upstream = await websockets.connect(config.GNANI_URL, additional_headers={
                'x-api-key-id':config.GNANI_KEY, 'lang_code':code, 'x-sample-rate':str(rate)
            }, open_timeout=6, max_size=1048576)
            initial = await asyncio.wait_for(upstream.recv(), timeout=6)
            if not isinstance(initial, str) or json.loads(initial).get('type') != 'connected':
                raise RuntimeError('Speech provider did not confirm readiness')
            reader = asyncio.create_task(read_stt(upstream))
            await send({'type':'speech_ready','requestId':request_id,'speechReady':True})
        except Exception as error:
            await close_stt()
            status = getattr(getattr(error, 'response', None), 'status_code', None)
            log.warning('Speech recognition connection failed: %s (HTTP status: %s)', type(error).__name__, status)
            await send({'type':'speech_ready','requestId':request_id,'speechReady':False,
                        'message':speech_connection_error(error)})
    try:
        while True:
            msg=await ws.receive()
            if msg['type']=='websocket.disconnect': break
            if msg.get('bytes') is not None:
                if upstream:
                    try: await upstream.send(msg['bytes'])
                    except websockets.ConnectionClosed:
                        await close_stt()
                        await send({'type':'speech_status','speechReady':False})
                        await send({'type':'error','message':'Speech recognition disconnected. Please try again or type your question.'})
                continue
            try: data=json.loads(msg.get('text') or '{}')
            except (ValueError, TypeError): await send({'type':'error','message':'Invalid message.'}); continue
            kind=data.get('type')
            # Login state can change while a WebSocket remains open in another tab.
            if kind in ('init','set_language','set_sample_rate','start_listening','finish_listening','text_input'):
                if not await database.session(session_token):
                    await ws.close(code=1008)
                    break
            if kind == 'stop_audio':
                await stop_tts()
            elif kind == 'finish_listening':
                await stop_flush()
                if upstream:
                    flush_task = asyncio.create_task(finish_listening(upstream, rate))
            elif kind in ('init','set_language','set_sample_rate'):
                language=str(data.get('language') or language)[:10]; rate=8000 if data.get('sampleRate') == 8000 else 16000
                await close_stt()
                await send({'type':'ready','speechReady':False})
            elif kind == 'start_listening':
                request_id = data.get('requestId')
                if not isinstance(request_id, str) or len(request_id) > 100:
                    await send({'type':'error','message':'Invalid speech connection request.'})
                else:
                    await start_listening(request_id)
            elif kind=='text_input' and isinstance(data.get('text'),str) and data['text'].strip():
                if not start_turn(data['text'].strip()): await send({'type':'error','message':'Please wait for the current answer.'})
    except WebSocketDisconnect: pass
    finally:
        if turn_task and not turn_task.done():
            turn_task.cancel()
            with suppress(asyncio.CancelledError, Exception): await turn_task
        await stop_tts()
        await close_stt()

client_dir = config.ROOT / 'client' / 'dist'
if client_dir.exists():
    app.mount('/assets',StaticFiles(directory=client_dir / 'assets'),name='assets')
    @app.get('/{path:path}', include_in_schema=False)
    async def frontend(path: str):
        if path.startswith('api/'): raise HTTPException(404,'Not found')
        candidate = (client_dir / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(client_dir.resolve()): return FileResponse(candidate)
        return FileResponse(client_dir / 'index.html')
