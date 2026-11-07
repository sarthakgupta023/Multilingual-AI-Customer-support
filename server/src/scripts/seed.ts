import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { loadAndChunkPolicies } from '../rag/parser';

async function seed() {
  console.log('--- Starting TeleNova Policy Seed ---');
  if (!config.supabase.url || !config.supabase.serviceKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be provided in .env to seed Supabase.');
    process.exit(1);
  }
  if (!config.llm.apiKey) {
    console.error('ERROR: OPENAI_API_KEY (or compatible embedding key) is required to compute vector embeddings.');
    process.exit(1);
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  const chunks = loadAndChunkPolicies();
  console.log(`Loaded ${chunks.length} chunks. Generating embeddings...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[${i + 1}/${chunks.length}] Embedding: ${chunk.docTitle} - ${chunk.sectionTitle}`);

    const res = await fetch(`${config.llm.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.embeddingModel,
        input: chunk.content,
      }),
    });

    if (!res.ok) {
      console.error(`Failed to generate embedding for chunk ${chunk.id}: ${res.statusText}`);
      continue;
    }

    const json = await res.json() as any;
    const embedding = json.data[0].embedding;

    const { error } = await supabase.from('telenova_documents').upsert({
      doc_id: chunk.docId,
      doc_title: chunk.docTitle,
      section_title: chunk.sectionTitle,
      content: chunk.content,
      embedding,
    });

    if (error) {
      console.error(`Supabase error for chunk ${chunk.id}:`, error.message);
    }
  }

  console.log('✅ Seeding complete!');
}

seed().catch(console.error);
