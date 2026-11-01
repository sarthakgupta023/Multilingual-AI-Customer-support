import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  gnani: {
    apiKey: process.env.GNANI_API_KEY || '',
    sttWsUrl: process.env.GNANI_STT_WS_URL || 'wss://api.vachana.ai/stt/v3/stream',
    ttsWsUrl: process.env.GNANI_TTS_WS_URL || 'wss://api.vachana.ai/api/v1/tts',
    ttsFileUrl: process.env.GNANI_TTS_FILE_URL || 'https://api.vachana.ai/api/v1/tts/inference',
    isMock: process.env.MOCK_GNANI === 'true' || !process.env.GNANI_API_KEY,
  },
  
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    useLocalStore: process.env.USE_LOCAL_VECTOR_STORE === 'true' || !process.env.SUPABASE_URL,
  },
  
  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    isMock: process.env.MOCK_LLM === 'true' || !process.env.OPENAI_API_KEY,
  },
  
  paths: {
    policiesDir: path.resolve(process.cwd(), '../data/policies'),
  }
};
