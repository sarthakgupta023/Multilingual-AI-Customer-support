import asyncio
import os
import uuid

from fastapi.testclient import TestClient
from server.app.agent import answer_question
from server.app.database import password_hash


def test_node_scrypt_compatibility():
    assert password_hash('password123', 'abcd1234') == '2c7525001365b2c695a1f2c99253f018ee9725fb2bc21b94d68613f983619b792376b250363510b8600ebdf92b0d121fa8e3e3a081b604e89d1b0231790d4d60'


def test_agent_routes_in_and_out_of_scope(monkeypatch):
    from server.app import config
    monkeypatch.setattr(config, 'LLM_MOCK', True)
    answer = asyncio.run(answer_question('What is the price and validity of the Super599 plan?'))
    assert not answer['found'] and answer['sources'] and answer['suggestTicket']
    answer = asyncio.run(answer_question('Who won the cricket world cup today?'))
    assert not answer['found'] and answer['suggestTicket'] and not answer['sources']


def test_accounts_tickets_and_history():
    if not os.getenv('TEST_DATABASE_URL'):
        import pytest
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database')
    from server.app import config
    config.DATABASE_URL = os.environ['TEST_DATABASE_URL']
    config.ADMIN_PASSWORD = 'test-admin-password'
    config.LLM_MOCK = True
    config.GNANI_MOCK = True
    from server.app.main import app
    suffix = uuid.uuid4().hex
    with TestClient(app) as a:
        b = TestClient(app)
        assert a.post('/api/auth/signup',json={'name':'Alice','email':f'alice-{suffix}@example.test','password':'password123'}).status_code == 201
        assert b.post('/api/auth/signup',json={'name':'Bob','email':f'bob-{suffix}@example.test','password':'password123'}).status_code == 201
        t = a.post('/api/tickets',json={'query':'Lost SIM'}).json()
        assert not b.get('/api/tickets').json()
        assert b.patch('/api/tickets/'+t['id'],json={'status':'RESOLVED'}).status_code == 403
        with a.websocket_connect('/ws/voice') as ws:
            ws.send_json({'type':'text_input','text':'What is the Super599 plan?'})
            answer = ws.receive_json()
            assert answer['type'] == 'answer' and answer['fullAnswer']
        assert len(a.get('/api/history').json()) == 2
        assert a.post('/api/auth/login',json={'email':config.ADMIN_EMAIL,'password':'test-admin-password'}).status_code == 200
        assert any(item['id']==t['id'] for item in a.get('/api/tickets').json())
        assert a.patch('/api/tickets/'+t['id'],json={'status':'RESOLVED'}).json()['status'] == 'RESOLVED'

    # A new app lifespan must be able to read records created by the previous one.
    with TestClient(app) as restarted:
        login = restarted.post('/api/auth/login', json={'email': f'alice-{suffix}@example.test', 'password':'password123'})
        assert login.status_code == 200
        assert len(restarted.get('/api/history').json()) == 2
        assert restarted.get('/api/tickets').json()[0]['status'] == 'RESOLVED'


def test_history_retention_is_per_user_and_safe_for_concurrent_writes():
    if not os.getenv('TEST_DATABASE_URL'):
        import pytest
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database')
    from server.app import config, database
    config.DATABASE_URL = os.environ['TEST_DATABASE_URL']

    async def check():
        await database.start()
        try:
            suffix = uuid.uuid4().hex
            first = await database.signup(f'first-{suffix}@example.test', 'password123', 'First')
            second = await database.signup(f'second-{suffix}@example.test', 'password123', 'Second')
            async with database.pool.connection() as conn:
                await conn.execute("""INSERT INTO nova_private.nova_messages (id,user_id,sender,text,created_at)
                    SELECT %s || n::text, %s, 'user', 'old-' || n::text, now() - (201-n) * interval '1 second'
                    FROM generate_series(1,200) AS n""", (suffix, first['id']))
            await database.add_message(second['id'], 'user', 'other account')
            await asyncio.gather(*(database.add_message(first['id'], 'user', f'new-{n}') for n in range(5)))
            first_rows = await database.execute('SELECT text FROM nova_private.nova_messages WHERE user_id=%s', (first['id'],), 'all')
            second_rows = await database.history(second['id'])
            assert len(first_rows) == 200
            texts = {row['text'] for row in first_rows}
            assert all(f'new-{n}' in texts for n in range(5))
            assert 'old-1' not in texts and 'old-5' not in texts and 'old-6' in texts
            assert [row['text'] for row in second_rows] == ['other account']
        finally:
            await database.close()

    asyncio.run(check())


def test_pdf_extraction_and_page_references():
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    from server.app.policies import parse_policy
    writer = PdfWriter()
    for number in (1, 2):
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 30 200 Td (Page {number} policy eligibility conditions.) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_metadata({'/Description': 'a' * 100_000})
    output = io.BytesIO(); writer.write(output)
    assert len(output.getvalue()) > 100_000
    chunks, _ = parse_policy(output.getvalue(), 'policy.pdf', '1', 'Demo policy')
    assert [chunk['pageNumber'] for chunk in chunks] == [1, 2]
    assert 'eligibility conditions' in chunks[1]['content']


def test_llm_requires_evidence_and_uses_history(monkeypatch):
    from server.app import agent, config
    monkeypatch.setattr(config, 'LLM_MOCK', False)
    seen = []
    async def fake_llm(messages, **kwargs):
        seen.extend(messages)
        return '{"found":true,"fullAnswer":"An answer","spokenAnswer":"An answer","sources":[{"docId":"D1","docTitle":"Policy","sectionTitle":"Section"}],"evidence":"this phrase is invented"}'
    monkeypatch.setattr(agent, 'llm', fake_llm)
    state = {'query':'Am I eligible?', 'language':'en', 'history':[{'role':'user','content':'I have a prepaid plan'}], 'matches':[{'docId':'D1','docTitle':'Policy','sectionTitle':'Section','content':'Actual policy terms are written here.', 'score':0.9}]}
    result = asyncio.run(agent.answer(state))['answer']
    assert not result['found'] and result['suggestTicket']
    assert 'I have a prepaid plan' in seen[-1]['content']


def test_admin_upload_refreshes_retrieval():
    if not os.getenv('TEST_DATABASE_URL'):
        import pytest
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database')
    import base64
    from server.app import config
    config.DATABASE_URL = os.environ['TEST_DATABASE_URL']
    config.ADMIN_PASSWORD = 'test-admin-password'
    config.LLM_MOCK = True
    config.GNANI_MOCK = True
    from server.app.main import app
    suffix = uuid.uuid4().hex[:12]
    payload = {'docId':f'TEST-{suffix}', 'title':f'{suffix} zephyr constellation', 'filename':'terms.txt', 'contentBase64':base64.b64encode(f'{suffix} zephyr constellation is available within seven days.'.encode()).decode()}
    with TestClient(app) as admin:
        customer = TestClient(app)
        assert customer.post('/api/auth/signup',json={'name':'Customer','email':f'{suffix}@example.test','password':'password123'}).status_code == 201
        assert customer.post('/api/admin/policies', json=payload).status_code == 403
        assert admin.post('/api/auth/login',json={'email':config.ADMIN_EMAIL,'password':'test-admin-password'}).status_code == 200
        created = admin.post('/api/admin/policies',json=payload)
        assert created.status_code == 201 and created.json()['version'] == 1
        with customer.websocket_connect('/ws/voice') as ws:
            ws.send_json({'type':'text_input','text':f'What is {suffix} zephyr constellation?'})
            result = ws.receive_json()
            assert result['sources'][0]['docId'] == payload['docId']
        payload['contentBase64'] = base64.b64encode(f'{suffix} zephyr constellation is available within fourteen days.'.encode()).decode()
        updated = admin.post('/api/admin/policies',json=payload)
        assert updated.status_code == 201 and updated.json()['version'] == 2
        with customer.websocket_connect('/ws/voice') as ws:
            ws.send_json({'type':'text_input','text':f'What is {suffix} zephyr constellation?'})
            assert 'fourteen days' in ws.receive_json()['fullAnswer']
        assert any(doc['docId'] == payload['docId'] for doc in customer.get('/api/knowledge').json()['documents'])
        assert customer.delete('/api/admin/policies/' + payload['docId']).status_code == 403
        assert admin.delete('/api/admin/policies/' + payload['docId']).status_code == 200
        assert all(doc['docId'] != payload['docId'] for doc in customer.get('/api/knowledge').json()['documents'])
        assert admin.delete('/api/admin/policies/' + payload['docId']).status_code == 404


def test_valid_evidence_keeps_actual_page_number(monkeypatch):
    from server.app import agent, config
    monkeypatch.setattr(config, 'LLM_MOCK', False)
    async def fake_llm(messages, **kwargs):
        return '{"found":true,"fullAnswer":"Seven days.","spokenAnswer":"Seven days.","sources":[{"docId":"D1","docTitle":"Policy","sectionTitle":"Page 2, passage 1"}],"evidence":"Refunds take seven days"}'
    monkeypatch.setattr(agent, 'llm', fake_llm)
    state = {'query':'How long?', 'language':'en', 'matches':[{'docId':'D1','docTitle':'Policy','sectionTitle':'Page 2, passage 1','pageNumber':2,'content':'Refunds take seven days from approval.', 'score':0.9}]}
    answer = asyncio.run(agent.answer(state))['answer']
    assert answer['found'] and answer['sources'][0]['pageNumber'] == 2
    assert answer['sources'][0]['quote'] == 'Refunds take seven days'


def test_same_origin_login_allowed_and_cross_origin_rejected(monkeypatch):
    from server.app import database
    from server.app.main import app
    async def invalid_login(email, password):
        raise ValueError('Invalid email or password.')
    monkeypatch.setattr(database, 'login', invalid_login)
    client = TestClient(app)
    body = {'email': 'test@example.invalid', 'password': 'incorrect'}
    same = client.post('/api/auth/login', json=body, headers={'origin': 'http://testserver'})
    cross = client.post('/api/auth/login', json=body, headers={'origin': 'https://example.invalid'})
    assert same.status_code == 401 and same.json()['error'] == 'Invalid email or password.'
    assert cross.status_code == 403 and cross.json()['error'] == 'Origin not allowed'


def test_large_pdf_upload_through_python_backend():
    if not os.getenv('TEST_DATABASE_URL'):
        import pytest
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database')
    import base64
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    from server.app import config
    config.DATABASE_URL = os.environ['TEST_DATABASE_URL']
    config.ADMIN_PASSWORD = 'test-admin-password'
    from server.app.main import app
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 30 200 Td (Policy: support is available to all customers.) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_metadata({'/Description': 'a' * 100_000})
    file = io.BytesIO(); writer.write(file)
    assert len(file.getvalue()) > 100_000
    with TestClient(app) as client:
        assert client.get('/api/health').json()['backend'] == 'python'
        assert client.post('/api/auth/login', json={'email':config.ADMIN_EMAIL, 'password':'test-admin-password'}).status_code == 200
        response = client.post('/api/admin/policies', json={'docId':f'PDF-{uuid.uuid4().hex}', 'title':'PDF upload test', 'filename':'policy.pdf', 'contentBase64':base64.b64encode(file.getvalue()).decode()})
        assert response.status_code == 201 and response.json()['passages'] == 1


def test_speech_connection_failure_reports_not_ready(monkeypatch):
    from server.app import config, database
    from server.app.main import app
    import websockets
    async def session(_token):
        return {'id':'admin','email':'admin@example.test','name':'Admin','isAdmin':True}
    async def connection_failure(*args, **kwargs):
        raise OSError('unreachable')
    monkeypatch.setattr(database, 'session', session)
    monkeypatch.setattr(config, 'GNANI_MOCK', False)
    monkeypatch.setattr(websockets, 'connect', connection_failure)
    client = TestClient(app)
    with client.websocket_connect('/ws/voice') as ws:
        ws.send_json({'type':'init','language':'en'})
        assert ws.receive_json() == {'type':'ready', 'speechReady':False}
        ws.send_json({'type':'start_listening', 'requestId':'attempt-1'})
        ready = ws.receive_json()
        assert ready['type'] == 'speech_ready' and ready['requestId'] == 'attempt-1'
        assert not ready['speechReady'] and 'internet connection' in ready['message']


def test_tamil_voice_stream_can_be_stopped(monkeypatch):
    import threading
    import server.app.main as main
    cancelled = threading.Event()
    seen_language = []
    async def session(_token):
        return {'id':'admin','email':'admin@example.test','name':'Admin','isAdmin':True}
    async def answer(_text, language, _history):
        return {'fullAnswer':'வணக்கம்', 'spokenAnswer':'வணக்கம்', 'found':True, 'sources':[], 'suggestTicket':False}
    async def speech(_text, language):
        seen_language.append(language)
        try:
            yield 'AAA='
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    monkeypatch.setattr(main.database, 'session', session)
    monkeypatch.setattr(main.config, 'GNANI_MOCK', True)
    monkeypatch.setattr(main, 'answer_question', answer)
    monkeypatch.setattr(main, 'stream_speech', speech)
    client = TestClient(main.app)
    with client.websocket_connect('/ws/voice') as ws:
        ws.send_json({'type':'set_language','language':'ta'})
        # Mock mode avoids connecting to the speech recognition provider.
        ready = ws.receive_json()
        assert ready['type'] == 'ready'
        ws.send_json({'type':'text_input','text':'வணக்கம்'})
        answer_event = ws.receive_json()
        start = ws.receive_json()
        chunk = ws.receive_json()
        assert answer_event['language'] == 'ta'
        assert start['turnId'] == chunk['turnId'] == answer_event['turnId']
        assert start['sampleRate'] == 24000
        assert chunk['type'] == 'audio_chunk'
        ws.send_json({'type':'stop_audio'})
        assert cancelled.wait(3)
    assert seen_language == ['ta']


def test_tamil_excerpt_fallback_uses_tamil_spoken_message(monkeypatch):
    from server.app import agent, config
    monkeypatch.setattr(config, 'LLM_MOCK', True)
    state = {'query':'திட்டம் என்ன?', 'language':'ta', 'matches':[{'docId':'D1','docTitle':'Plan','sectionTitle':'Details','content':'The plan costs 100 rupees.', 'score':0.9}]}
    answer = asyncio.run(agent.answer(state))['answer']
    assert not answer['found'] and answer['suggestTicket']
    assert any('\u0b80' <= char <= '\u0bff' for char in answer['spokenAnswer'])


def test_tts_requests_raw_pcm_at_the_playback_rate(monkeypatch):
    import json
    import server.app.tts as tts
    from server.app import config
    sent = []
    class FakeSocket:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def send(self, payload): sent.append(json.loads(payload))
        def __aiter__(self): return self
        async def __anext__(self):
            if getattr(self, 'done', False): raise StopAsyncIteration
            self.done = True
            return json.dumps({'type':'audio','data':{'audio':'AAA=', 'is_final':True}})
    monkeypatch.setattr(config, 'GNANI_MOCK', False)
    monkeypatch.setattr(tts.websockets, 'connect', lambda *args, **kwargs: FakeSocket())
    async def collect(): return [chunk async for chunk in tts.stream_speech('வணக்கம்', 'ta')]
    assert asyncio.run(collect()) == ['AAA=']
    assert sent[0]['language'] == 'ta'
    assert sent[0]['audio_config'] == {'sample_rate':24000, 'encoding':'linear_pcm', 'container':'raw'}


def test_uploaded_policy_used_for_semantic_question_and_old_examples_excluded(monkeypatch):
    import json
    from server.app import agent, config, database
    monkeypatch.setattr(config, 'LLM_MOCK', False)
    monkeypatch.setattr(database, 'pool', object())
    async def has_uploads(): return True
    async def embed_query(_text): return [1.0] + [0.0] * 383
    async def search(_vector, _model, limit=8):
        return [{'docId':'HR-1','docTitle':'Employee handbook','sectionTitle':'Page 3, passage 1','pageNumber':3,'content':'Employees receive 18 paid leave days each year.', 'score':0.7}]
    async def fake_llm(messages, max_tokens=850, json_mode=False):
        if not json_mode: return 'How much time can staff take off?'
        return json.dumps({'found':True,'fullAnswer':'Employees receive 18 paid leave days each year.','spokenAnswer':'Employees receive eighteen paid leave days each year.','sources':[{'docId':'HR-1','docTitle':'Employee handbook','sectionTitle':'Page 3, passage 1'}],'evidence':'Employees receive 18 paid leave days each year.'})
    monkeypatch.setattr(database, 'has_uploaded_policies', has_uploads)
    monkeypatch.setattr(agent.embeddings, 'embed_query', embed_query)
    monkeypatch.setattr(database, 'search_policy_vectors', search)
    monkeypatch.setattr(agent, 'llm', fake_llm)
    result = asyncio.run(agent.answer_question('How much time can staff take off?', 'en'))
    assert result['found'] and result['sources'][0]['docId'] == 'HR-1'
    assert result['sources'][0]['pageNumber'] == 3


def test_non_english_query_is_translated_for_retrieval(monkeypatch):
    from server.app import agent, config
    monkeypatch.setattr(config, 'LLM_MOCK', False)
    async def fake_llm(messages, max_tokens=850, json_mode=False):
        assert 'English search query' in messages[0]['content']
        return 'employee leave eligibility'
    monkeypatch.setattr(agent, 'llm', fake_llm)
    result = asyncio.run(agent.rewrite({'query':'விடுப்பு தகுதி என்ன?', 'language':'ta', 'history':[]}))
    assert result['standalone_query'] == 'employee leave eligibility'


def test_pgvector_similarity_and_atomic_replacement():
    if not os.getenv('TEST_DATABASE_URL'):
        import pytest
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database with pgvector')
    from server.app import config, database, embeddings
    config.DATABASE_URL = os.environ['TEST_DATABASE_URL']
    async def check():
        await database.start()
        try:
            doc_id = f'VECTOR-{uuid.uuid4().hex}'
            model_name = f'test-model-{uuid.uuid4().hex}'
            one = [1.0] + [0.0]*383
            two = [0.0, 1.0] + [0.0]*382
            chunks = [{'docId':doc_id,'docTitle':'Test','sectionTitle':'first','content':'First passage'}, {'docId':doc_id,'docTitle':'Test','sectionTitle':'second','content':'Second passage'}]
            await database.save_policy(doc_id,'Test','test.txt','hash1',chunks,[one,two],model_name)
            rows = await database.search_policy_vectors(one,model_name,limit=1)
            assert rows[0]['docId'] == doc_id and rows[0]['sectionTitle'] == 'first' and rows[0]['score'] > 0.99
            await database.save_policy(doc_id,'Test','test.txt','hash2',chunks,[two,one],model_name)
            rows = await database.search_policy_vectors(one,model_name,limit=1)
            assert rows[0]['docId'] == doc_id and rows[0]['sectionTitle'] == 'second'
            assert all(row['doc_id'] != doc_id for row in await database.policies_to_index(model_name))
            try:
                await database.save_policy(doc_id,'Test','test.txt','hash3',chunks,[one],model_name)
                assert False, 'Expected mismatched vectors to fail'
            except ValueError:
                pass
            rows = await database.search_policy_vectors(one,model_name,limit=1)
            assert rows[0]['sectionTitle'] == 'second'  # failed replacement rolled back
            assert await database.delete_policy(doc_id)
            assert not await database.search_policy_vectors(one,model_name,limit=1)
        finally: await database.close()
    asyncio.run(check())


def test_local_multilingual_embeddings_rank_paraphrases():
    from server.app import embeddings
    async def check():
        # Synthetic data only. This test uses the locally cached model, never a provider.
        vectors = await embeddings.embed_documents([
            'Employees receive eighteen days of annual paid leave.',
            'Install the router and connect the network cable.'
        ])
        query = await embeddings.embed_query('How much paid time off can workers take each year?')
        def cosine(a,b):
            import math
            return sum(x*y for x,y in zip(a,b)) / (math.sqrt(sum(x*x for x in a))*math.sqrt(sum(y*y for y in b)))
        assert cosine(query,vectors[0]) > cosine(query,vectors[1])
    asyncio.run(check())


def test_speech_reconnects_after_normal_idle_close(monkeypatch):
    import server.app.main as main
    attempts = []
    class FakeProvider:
        def __init__(self, close_soon): self.close_soon = close_soon
        def __aiter__(self): return self
        async def __anext__(self):
            if self.close_soon:
                await asyncio.sleep(0.05)
                raise StopAsyncIteration
            await asyncio.Event().wait()
        async def recv(self): return '{"type":"connected"}'
        async def close(self): pass
        async def send(self, data): pass
    async def session(_token): return {'id':'admin','email':'admin@example.test','name':'Admin','isAdmin':True}
    async def connect(_url, **kwargs):
        attempts.append(kwargs['additional_headers']['lang_code'])
        return FakeProvider(close_soon=len(attempts) == 1)
    monkeypatch.setattr(main.database, 'session', session)
    monkeypatch.setattr(main.config, 'GNANI_MOCK', False)
    monkeypatch.setattr(main.websockets, 'connect', connect)
    client = TestClient(main.app)
    with client.websocket_connect('/ws/voice') as ws:
        ws.send_json({'type':'init','language':'ta'})
        assert not ws.receive_json()['speechReady']
        ws.send_json({'type':'start_listening','requestId':'first'})
        assert ws.receive_json() == {'type':'speech_ready','requestId':'first','speechReady':True}
        assert ws.receive_json() == {'type':'speech_status','speechReady':False}
        ws.send_json({'type':'start_listening','requestId':'second'})
        assert ws.receive_json() == {'type':'speech_ready','requestId':'second','speechReady':True}
    assert attempts == ['ta-IN','ta-IN']


def test_policy_passages_overlap_at_word_boundaries():
    from server.app.policies import split_text
    text = ' '.join(f'word{i:04d}' for i in range(400))
    chunks = split_text(text, size=400, overlap=80)
    assert len(chunks) > 2 and all(0 < len(c) <= 400 for c in chunks)
    assert chunks[0].startswith('word0000') and chunks[-1].endswith('word0399')
    for left, right in zip(chunks, chunks[1:]):
        assert set(left.split()) & set(right.split())
        assert left.split()[-1].startswith('word') and right.split()[0].startswith('word')


def test_end_of_recording_sends_paced_silence(monkeypatch):
    import threading
    import server.app.main as main
    sent = []
    received = threading.Event()
    class Provider:
        async def recv(self): return '{"type":"connected"}'
        def __aiter__(self): return self
        async def __anext__(self): await asyncio.Event().wait()
        async def close(self): pass
        async def send(self, data):
            sent.append(data)
            if len(sent) >= 2: received.set()
    async def session(_token): return {'id':'admin','email':'admin@example.test','name':'Admin','isAdmin':True}
    async def connect(_url, **_kwargs): return Provider()
    monkeypatch.setattr(main.database, 'session', session)
    monkeypatch.setattr(main.config, 'GNANI_MOCK', False)
    monkeypatch.setattr(main.websockets, 'connect', connect)
    client = TestClient(main.app)
    with client.websocket_connect('/ws/voice') as ws:
        ws.send_json({'type':'init','language':'en'}); ws.receive_json()
        ws.send_json({'type':'start_listening','requestId':'one'}); assert ws.receive_json()['speechReady']
        ws.send_json({'type':'finish_listening'})
        assert received.wait(3)
    assert all(len(frame) == 1024 and not any(frame) for frame in sent)


def test_revoked_session_cannot_start_new_websocket_turn(monkeypatch):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    import server.app.main as main
    calls = []
    async def session(_token):
        calls.append(True)
        return {'id':'admin','email':'admin@example.test','name':'Admin','isAdmin':True} if len(calls) == 1 else None
    monkeypatch.setattr(main.database, 'session', session)
    client = TestClient(main.app)
    with client.websocket_connect('/ws/voice') as ws:
        ws.send_json({'type':'text_input','text':'Hello'})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1008


def test_production_database_requires_tls_for_remote_hosts(monkeypatch):
    import pytest
    from server.app.database import validate_database_url
    monkeypatch.delenv('PGSSLMODE', raising=False)
    validate_database_url('postgresql://user:secret@127.0.0.1:55432/nova', True)
    validate_database_url('postgresql://user:secret@db.example.test/nova?sslmode=verify-full', True)
    with pytest.raises(RuntimeError, match='must require TLS'):
        validate_database_url('postgresql://user:secret@db.example.test/nova', True)
    with pytest.raises(RuntimeError, match='not a valid PostgreSQL') as exc:
        validate_database_url('not a valid URL with password=secret', False)
    assert 'secret' not in str(exc.value)
