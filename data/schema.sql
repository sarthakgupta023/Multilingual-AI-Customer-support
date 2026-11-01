-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table to store TeleNova policy passages
CREATE TABLE IF NOT EXISTS telenova_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id TEXT NOT NULL,
    doc_title TEXT NOT NULL,
    section_title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536), -- compatible with text-embedding-3-small or multilingual embeddings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS telenova_documents_embedding_idx 
ON telenova_documents 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Table for customer support tickets created by VoiceDesk
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL,
    customer_language TEXT NOT NULL,
    user_query TEXT NOT NULL,
    conversation_summary TEXT,
    status TEXT DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Table for turn-by-turn evaluation logging
CREATE TABLE IF NOT EXISTS turn_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    language_code TEXT NOT NULL,
    user_speech_transcript TEXT NOT NULL,
    retrieved_sources JSONB,
    similarity_score FLOAT,
    llm_written_answer TEXT,
    llm_spoken_answer TEXT,
    time_to_first_audio_ms INTEGER,
    total_turn_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Match function for vector similarity retrieval
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id UUID,
  doc_id TEXT,
  doc_title TEXT,
  section_title TEXT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    telenova_documents.id,
    telenova_documents.doc_id,
    telenova_documents.doc_title,
    telenova_documents.section_title,
    telenova_documents.content,
    1 - (telenova_documents.embedding <=> query_embedding) AS similarity
  FROM telenova_documents
  WHERE 1 - (telenova_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
