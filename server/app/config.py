import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / 'server' / '.env')
DATABASE_URL = os.getenv('DATABASE_URL', '')
ADMIN_EMAIL = 'solongnososhort057@gmail.com'
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', '')
PRODUCTION = os.getenv('NODE_ENV', '').lower() == 'production'
GNANI_KEY = os.getenv('GNANI_API_KEY', '')
GNANI_MOCK = os.getenv('MOCK_GNANI', '').lower() == 'true' or not GNANI_KEY
GNANI_URL = os.getenv('GNANI_STT_WS_URL', 'wss://api.vachana.ai/stt/v3/stream')
GNANI_TTS_URL = os.getenv('GNANI_TTS_WS_URL', 'wss://api.vachana.ai/api/v1/tts')
GNANI_TTS_SAMPLE_RATE = 24000
GNANI_TTS_MODEL = os.getenv('GNANI_TTS_MODEL', 'timbre-v3.0')
GNANI_VOICE = os.getenv('GNANI_VOICE', 'Shivani')
HF_KEY = os.getenv('HF_TOKEN') or os.getenv('HUGGINGFACE_API_KEY') or ''
GROQ_KEY = os.getenv('GROQ_API_KEY', '')
OPENAI_KEY = os.getenv('OPENAI_API_KEY', '')
LLM_PROVIDER = os.getenv('LLM_PROVIDER', '').strip().lower() or ('huggingface' if HF_KEY else 'groq' if GROQ_KEY else 'openai' if OPENAI_KEY else 'mock')
if LLM_PROVIDER not in ('huggingface', 'groq', 'openai', 'mock'):
    raise RuntimeError('LLM_PROVIDER must be huggingface, groq, openai, or mock')
LLM_KEY = {'huggingface': HF_KEY, 'groq': GROQ_KEY, 'openai': OPENAI_KEY, 'mock': ''}[LLM_PROVIDER]
LLM_MOCK = os.getenv('MOCK_LLM', '').lower() == 'true' or not LLM_KEY
_base = {'huggingface': os.getenv('HF_BASE_URL', 'https://router.huggingface.co/v1'), 'groq': 'https://api.groq.com/openai/v1', 'openai': 'https://api.openai.com/v1', 'mock': ''}[LLM_PROVIDER]
LLM_BASE = os.getenv('LLM_BASE_URL') or _base
_defaults = {'huggingface': 'meta-llama/Llama-3.1-8B-Instruct', 'groq': 'qwen/qwen3.8-27b', 'openai': 'gpt-4o-mini', 'mock': ''}
LLM_MODEL = (os.getenv('GROQ_MODEL') if LLM_PROVIDER == 'groq' else None) or os.getenv('LLM_MODEL') or _defaults[LLM_PROVIDER]
