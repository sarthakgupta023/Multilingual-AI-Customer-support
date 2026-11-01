import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { SearchResult } from './types.js';

export class SupabaseVectorStore {
  private client: SupabaseClient | null = null;

  constructor() {
    if (config.supabase.url && config.supabase.serviceKey) {
      this.client = createClient(config.supabase.url, config.supabase.serviceKey);
    }
  }

  public async search(query: string, limit: number = 3): Promise<SearchResult[]> {
    if (!this.client || !config.llm.apiKey) {
      throw new Error('Supabase client or Embedding API key not configured');
    }

    // 1. Get embedding for query
    const res = await fetch(`${config.llm.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.embeddingModel,
        input: query,
      }),
    });

    if (!res.ok) {
      throw new Error(`Embedding generation failed: ${res.statusText}`);
    }

    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    const queryEmbedding = json.data[0].embedding;

    // 2. Call Supabase match_documents RPC
    const { data, error } = await this.client.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.50,
      match_count: limit,
    });

    if (error) {
      throw error;
    }

    return (data || []).map((row: any) => ({
      chunk: {
        id: row.id,
        docId: row.doc_id,
        docTitle: row.doc_title,
        sectionTitle: row.section_title,
        content: row.content,
      },
      similarity: row.similarity,
    }));
  }
}

export const supabaseVectorStore = new SupabaseVectorStore();
