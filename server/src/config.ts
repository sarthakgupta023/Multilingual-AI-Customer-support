import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Determine LLM provider: HuggingFace, Groq, OpenAI, or Mock
const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';
const openaiKey = process.env.OPENAI_API_KEY || '';

let providerBaseUrl = 'https://api.openai.com/v1';
let providerApiKey = openaiKey;
let defaultModel = 'gpt-4o-mini';
let defaultEmbedding = 'text-embedding-3-small';

if (hfToken) {
  providerBaseUrl = process.env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference/v1';
  providerApiKey = hfToken;
  defaultModel = process.env.LLM_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
  defaultEmbedding = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
} else if (groqKey) {
  providerBaseUrl = 'https://api.groq.com/openai/v1';
  providerApiKey = groqKey;
  defaultModel = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
  defaultEmbedding = 'local';
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  gnani: {
    apiKey: process.env.GNANI_API_KEY || 'vach_1ytE2CY5X2PJobx8lbgDIWNmYqKRNBLsyPBpprJuCfvqdiYU91zFuKRONknaz6PjGUoyFeSmjvf0xS2O36A3tT5HVYyd4APi_c4f54fd8132894568360b878e4420e68',
    sttWsUrl: process.env.GNANI_STT_WS_URL || 'wss://api.vachana.ai/stt/v3/stream',
    ttsWsUrl: process.env.GNANI_TTS_WS_URL || 'wss://api.vachana.ai/api/v1/tts',
    ttsFileUrl: process.env.GNANI_TTS_FILE_URL || 'https://api.vachana.ai/api/v1/tts/inference',
    isMock: process.env.MOCK_GNANI === 'true',
    defaultVoice: process.env.GNANI_VOICE || 'Shivani',
    defaultModel: process.env.GNANI_TTS_MODEL || 'timbre-v3.0',
  },
  
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    useLocalStore: process.env.USE_LOCAL_VECTOR_STORE === 'true' || !process.env.SUPABASE_URL,
  },
  
  llm: {
    apiKey: providerApiKey,
    baseUrl: process.env.LLM_BASE_URL || providerBaseUrl,
    model: process.env.LLM_MODEL || defaultModel,
    embeddingModel: process.env.EMBEDDING_MODEL || defaultEmbedding,
    isMock: process.env.MOCK_LLM === 'true' || !providerApiKey,
    provider: hfToken ? 'huggingface' : groqKey ? 'groq' : openaiKey ? 'openai' : 'mock-local',
  },
  
  paths: {
    policiesDir: path.resolve(process.cwd(), '../data/policies'),
  }
};
