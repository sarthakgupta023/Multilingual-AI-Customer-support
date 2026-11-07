import { config } from '../config';
import { localVectorStore } from './local_store';
import { supabaseVectorStore } from './supabase_store';
import { ConversationTurn, GroundedAnswer, SearchResult } from './types';

const SIMILARITY_THRESHOLD = 0.52;

export class RAGService {
  /**
   * Rewrites conversational follow-up questions (e.g. "and for prepaid?") into standalone queries
   */
  public async rewriteQuery(query: string, history: ConversationTurn[]): Promise<string> {
    if (history.length === 0 || config.llm.isMock) {
      return query;
    }

    try {
      const recentTurns = history.slice(-4).map(t => `${t.role.toUpperCase()}: ${t.content}`).join('\n');
      const prompt = `Given the conversation history and a follow-up query, rewrite the query into a clear, standalone customer search query regarding TeleNova telecom services.
Preserve the language of the user query. Do NOT answer the question.

Conversation:
${recentTurns}

User Follow-up: ${query}

Standalone Query:`;

      const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 60,
        }),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const rewritten = data.choices[0]?.message?.content?.trim();
        if (rewritten && rewritten.length > 2) {
          return rewritten;
        }
      }
    } catch (err) {
      console.warn('[RAGService] Query rewrite error:', err);
    }

    return query;
  }

  /**
   * Search policy passages across either Supabase or LocalVectorStore
   */
  public async retrieve(query: string): Promise<SearchResult[]> {
    if (!config.supabase.useLocalStore) {
      try {
        const results = await supabaseVectorStore.search(query, 3);
        if (results.length > 0) return results;
      } catch (err) {
        console.warn('[RAGService] Supabase retrieval failed, using local store:', err);
      }
    }
    return localVectorStore.search(query, 3);
  }

  /**
   * Formulates grounded answer from passages or suggests ticket if out-of-domain
   */
  public async answerQuestion(
    query: string,
    languageCode: string = 'en',
    history: ConversationTurn[] = []
  ): Promise<GroundedAnswer> {
    const standaloneQuery = await this.rewriteQuery(query, history);
    const searchResults = await this.retrieve(standaloneQuery);

    const bestMatch = searchResults[0];
    const topScore = bestMatch ? bestMatch.similarity : 0;

    // Check if the best match falls below similarity threshold
    if (!bestMatch || topScore < SIMILARITY_THRESHOLD) {
      return this.generateNotFoundAnswer(query, languageCode, topScore);
    }

    // Passages are found: Generate strict grounded answer
    if (!config.llm.isMock) {
      try {
        return await this.generateLLMAnswer(query, languageCode, searchResults);
      } catch (err) {
        console.error('[RAGService] LLM generation error, falling back to rule-based answer:', err);
      }
    }

    // Deterministic Mock Generator (for local testing without API key)
    return this.generateMockAnswer(query, languageCode, searchResults);
  }

  private async generateLLMAnswer(
    query: string,
    languageCode: string,
    searchResults: SearchResult[]
  ): Promise<GroundedAnswer> {
    const context = searchResults
      .map(r => `Document: ${r.chunk.docTitle} (${r.chunk.docId})\nSection: ${r.chunk.sectionTitle}\nContent:\n${r.chunk.content}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are VoiceDesk, the official AI Voice Assistant for TeleNova, an Indian telecom provider.
Target Language Code: ${languageCode}

CRITICAL RULES:
1. Answer ONLY using the facts provided in the Context below. Never invent prices, validity, limits, or policies.
2. If the context does not explicitly provide the answer, you must state that the policy is not in the records and offer a support ticket.
3. You must reply in the language requested (${languageCode}), matching the user's natural script or Hinglish if the user asked in Hinglish.
4. Provide your response as a strict JSON object with:
   - "found": true / false
   - "fullAnswer": Detailed, polite answer for on-screen reading. Always mention the cited document name.
   - "spokenAnswer": 1 to 2 crisp, conversational sentences for voice playback. Spell out numbers as words (e.g. "five hundred and ninety-nine rupees") so the voice synthesizer pronounces them naturally.
   - "sources": Array of objects [{ "docId": "...", "docTitle": "...", "sectionTitle": "..." }]`;

    const userPrompt = `Context:
${context}

Customer Question:
${query}

JSON Response:`;

    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM API failed: ${res.statusText}`);
    }

    const data = await res.json() as any;
    const parsed = JSON.parse(data.choices[0]?.message?.content || '{}');

    return {
      found: parsed.found ?? true,
      fullAnswer: parsed.fullAnswer || 'Here is the requested information from TeleNova documents.',
      spokenAnswer: parsed.spokenAnswer || 'Here is the requested information.',
      sources: parsed.sources || searchResults.map(r => ({
        docId: r.chunk.docId,
        docTitle: r.chunk.docTitle,
        sectionTitle: r.chunk.sectionTitle,
      })),
      suggestTicket: !(parsed.found ?? true),
      similarityScore: searchResults[0].similarity,
    };
  }

  private generateNotFoundAnswer(query: string, languageCode: string, similarity: number): GroundedAnswer {
    let full = "I'm sorry, but this specific policy or service detail is not covered in the current TeleNova policy documents. Would you like me to create a customer support ticket for our human support team?";
    let spoken = "I couldn't find this policy in our records. Would you like me to raise a support ticket?";

    if (languageCode.startsWith('hi')) {
      full = "माफ़ कीजिये, यह जानकारी टेलीनोवा के वर्तमान दस्तावेज़ों में उपलब्ध नहीं है। क्या आप चाहते हैं कि मैं आपकी सहायता के लिए सपोर्ट टिकट बना दूँ?";
      spoken = "मुझे यह जानकारी नहीं मिली। क्या मैं आपके लिए सपोर्ट टिकट बना दूँ?";
    } else if (languageCode.startsWith('ta')) {
      full = "மன்னிக்கவும், இந்த தகவல் டெலிநோவா ஆவணங்களில் இல்லை. உங்களுக்காக வாடிக்கையாளர் ஆதரவு டிக்கெட்டை உருவாக்கவா?";
      spoken = "இந்த தகவல் கிடைக்கவில்லை. உங்களுக்காக ஆதரவு டிக்கெட் உருவாக்கவா?";
    }

    return {
      found: false,
      fullAnswer: full,
      spokenAnswer: spoken,
      sources: [],
      suggestTicket: true,
      similarityScore: similarity,
    };
  }

  private generateMockAnswer(query: string, languageCode: string, searchResults: SearchResult[]): GroundedAnswer {
    const top = searchResults[0].chunk;
    const sources = [{
      docId: top.docId,
      docTitle: top.docTitle,
      sectionTitle: top.sectionTitle,
    }];

    let full = `According to **${top.docTitle}** (${top.sectionTitle}):\n\n${top.content.split('\n').slice(1, 6).join('\n')}`;
    let spoken = `According to TeleNova's ${top.docTitle}, ${top.sectionTitle} details are available. Please check the screen for complete terms.`;

    if (languageCode.startsWith('hi')) {
      spoken = `टेलीनोवा के ${top.docTitle} के अनुसार पूरी जानकारी स्क्रीन पर उपलब्ध है।`;
    } else if (languageCode.startsWith('ta')) {
      spoken = `டெலிநோவா விதிமுறைகளின்படி முழு விவரங்கள் திரையில் உள்ளன.`;
    }

    return {
      found: true,
      fullAnswer: full,
      spokenAnswer: spoken,
      sources,
      suggestTicket: false,
      similarityScore: searchResults[0].similarity,
    };
  }
}

export const ragService = new RAGService();
