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
HF_KEY = os.getenv('HF_TOKEN') or os.getenv('HUGGINGFACE_API_KEY') or ''
GROQ_KEY = os.getenv('GROQ_API_KEY', '')
OPENAI_KEY = os.getenv('OPENAI_API_KEY', '')
LLM_KEY = HF_KEY or GROQ_KEY or OPENAI_KEY
LLM_MOCK = os.getenv('MOCK_LLM', '').lower() == 'true' or not LLM_KEY
LLM_BASE = os.getenv('LLM_BASE_URL') or (os.getenv('HF_BASE_URL', 'https://router.huggingface.co/hf-inference/v1') if HF_KEY else 'https://api.groq.com/openai/v1' if GROQ_KEY else 'https://api.openai.com/v1')
LLM_MODEL = os.getenv('LLM_MODEL') or ('meta-llama/Llama-3.1-8B-Instruct' if HF_KEY else 'llama-3.3-70b-versatile' if GROQ_KEY else 'gpt-4o-mini')
