"""Stream Gnani raw mono 24 kHz linear PCM without logging customer text."""
import asyncio
import json
import websockets
from . import config

async def stream_speech(text: str, language: str):
    if config.GNANI_MOCK:
        raise RuntimeError('Voice synthesis is not configured')
    async with asyncio.timeout(45):
        async with websockets.connect(config.GNANI_TTS_URL, additional_headers={'X-API-Key-ID':config.GNANI_KEY}, open_timeout=10, max_size=4 * 1024 * 1024) as ws:
            await ws.send(json.dumps({'text':text[:2000], 'model':config.GNANI_TTS_MODEL, 'voice':config.GNANI_VOICE, 'language':language.split('-')[0], 'audio_config':{'sample_rate':config.GNANI_TTS_SAMPLE_RATE,'encoding':'linear_pcm','container':'raw'}}, ensure_ascii=False))
            received = False
            async for message in ws:
                if not isinstance(message, str):
                    import base64
                    received = True
                    yield base64.b64encode(message).decode('ascii')
                    continue
                data = json.loads(message)
                if data.get('type') == 'error': raise RuntimeError('Voice provider returned an error')
                payload = data.get('data') if isinstance(data.get('data'), dict) else {}
                audio = payload.get('audio') or data.get('audio')
                if isinstance(audio, str) and audio:
                    received = True
                    yield audio
                if payload.get('is_final') or data.get('type') in ('complete','end'):
                    break
            if not received: raise RuntimeError('Voice provider returned no audio')
