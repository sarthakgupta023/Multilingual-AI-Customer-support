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
            assert answer['type'] == 'answer' and answer['sources']
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
