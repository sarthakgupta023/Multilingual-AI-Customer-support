import { config } from '../config';
import { loadAndChunkPolicies } from './parser';
import { PolicyChunk, SearchResult } from './types';

// Multilingual synonyms and concepts mapped to English policy documents
const SYNONYM_MAP: Record<string, string[]> = {
  lost_sim: ['खो गया', 'lost', 'damaged', 'stolen', 'replacement', 'ரிப்ளேஸ்மென்ட்', 'தொலைந்து', 'పోయின', 'replace sim'],
  esim: ['esim', 'e-sim', 'ई-सिम', 'ஈசிம்', 'ఈசிమ్', 'convert sim', 'qr code'],
  sim: ['sim', 'सिम', 'சீம்', 'నెంబர்', 'சிம்', 'sim card'],
  recharge: ['recharge', 'रिचार्ज', 'ரீசார்ஜ்', 'రీఛార్జ్', 'pack', 'plan', 'validity', 'पैक', 'वैधता', 'offer', 'rate', 'price'],
  port: ['port', 'mnp', 'पोर्ट', 'போர்ட்', 'போர்ட்டிங்', 'போர்ட் செய்வதற்கு', 'పోర్टिंग', 'upc', 'change operator', 'switch', 'badalna'],
  roaming: ['roaming', 'रोमिंग', 'ரோமிங்', 'ரோமிங்', 'international', 'abroad', 'foreign', 'travel', 'globalpass', 'विदेश', 'சர்வதேச'],
  postpaid: ['postpaid', 'पोस्टपेड', 'போஸ்ட்பெய்டு', 'போஸ்ట్‌பெயிட்', 'bill', 'billing', 'invoice', 'due date', 'बिल', 'bill dispute'],
  prepaid: ['prepaid', 'प्रीपेड', 'ப்ரீபெய்ட்', 'பரீபெய்ட்', 'super199', 'super299', 'super599', 'super849', 'daily data'],
  fup: ['fup', 'speed', 'slow', 'quota', 'limit', '64kbps', 'throttled', 'exhausted', 'data khatam', 'कोटा समाप्त', 'முடிந்தவுடன்', 'दैनिक डेटा', 'தினசரி டேட்டா'],
  data_booster: ['booster', 'बूस्टर', 'பூஸ்டர்', '₹29', '1gb', '2gb booster', 'डेटा बूस्टर', 'டேட்டா பூஸ்டர்'],
  '5g': ['5g', '5जी', 'ultra', 'unlimited 5g', 'welcome offer', 'true unlimited', 'ट्रू अनलिमिटेड', 'அலைவரிசை', 'frequency bands', 'फ्रीक्वेंसी', 'n28', 'n78'],
  broadband: ['broadband', 'fiber', 'wifi', 'wi-fi', 'router', 'इंटरनेट', 'ब्रॉडबैंड', 'airfiber', 'home fiber', 'fiber stream', 'फाइबर', 'ஃபைபர்', 'இன்ஸ்டாலேஷன்', 'इंस्टॉलेशन'],
  dnd: ['dnd', 'spam', 'unwanted', 'telemarketing', '1909', 'start 0', 'फालतू कॉल', 'ब्लॉक', 'block', 'स्पैम कॉल', 'விளம்பர', '3 days', '72 hours'],
  refund: ['refund', 'double deduction', 'paisa kat gaya', 'पैसे कट गए', 'वापसी', 'failed transaction', 'complaint', '198', 'tat', 'टोल-फ्री', 'புகார்', 'शिकायत', 'இருமுறை பணம்', 'தோல்வி'],
  kyc: ['kyc', 'aadhaar', 'आधार', 'documents', 'address proof', 'verification', 'reverification', 'sim limit', 'ई-केवाईसी', 'இ-கேஒய்சி', '9 mobile', 'ceiling', 'अधिकतम', 'அதிகபட்சமாக'],
  call_drop: ['call drop', 'कॉल ड्रॉप', 'கால் டிராப்', 'compensation', 'हर्जाना', 'இழப்பீடு', '₹1 per call drop'],
  autopay: ['auto-pay', 'autopay', 'ऑटो-पे', 'ஆட்டோ-பே', 'cashback', 'कैशबैक', 'கேஷ்பேக்', '5%'],
  deactivation: ['90 consecutive', '90 days', 'deactivated', 'हमेशा के लिए बंद', 'நிரந்தரமாக', 'grace period'],
  sms_barring: ['24 hours', 'sms barred', 'एसएमएस सेवा 24 घंटे', 'எஸ்எம்எஸ் சேவை ஏன் 24', 'otp fraud'],
  whatsapp_concierge: ['whatsapp', 'व्हाट्सएप', 'வாட்ஸ்அப்', 'concierge', '+91-99880-12345']
};

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'by',
  'with', 'from', 'about', 'how', 'do', 'does', 'can', 'you', 'i', 'my', 'me', 'we', 'our',
  'this', 'that', 'these', 'those', 'there', 'where', 'when', 'who', 'which', 'why', 'are',
  'was', 'were', 'been', 'being', 'have', 'has', 'had', 'tell', 'give', 'please', 'today', 'between'
]);

export class LocalVectorStore {
  private chunks: PolicyChunk[] = [];
  private isInitialized = false;

  public init() {
    if (!this.isInitialized) {
      this.chunks = loadAndChunkPolicies();
      this.isInitialized = true;
    }
  }

  public async search(query: string, limit: number = 3): Promise<SearchResult[]> {
    this.init();
    const normalizedQuery = query.toLowerCase();

    // Check if real embedding can be computed in-memory
    if (config.llm.apiKey && !config.llm.isMock) {
      try {
        return await this.searchWithEmbeddings(query, limit);
      } catch (err) {
        console.warn('[LocalStore] Embedding API error, falling back to semantic keyword search:', err);
      }
    }

    // Keyword & Multilingual Concept Scoring
    const scored = this.chunks.map(chunk => {
      let score = 0;
      const lowerContent = chunk.content.toLowerCase();
      const lowerDoc = chunk.docTitle.toLowerCase();
      const lowerSec = chunk.sectionTitle.toLowerCase();

      // Direct term hits (ignoring stop words)
      const queryTokens = normalizedQuery
        .split(/[^\p{L}\p{N}]+/u)
        .map(t => t.trim())
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));

      for (const token of queryTokens) {
        if (lowerContent.includes(token)) score += 1.5;
        if (lowerDoc.includes(token)) score += 2.0;
        if (lowerSec.includes(token)) score += 3.0;
      }

      // Check Multilingual Concepts
      for (const [concept, aliases] of Object.entries(SYNONYM_MAP)) {
        let matchingAliasesInQuery = 0;
        for (const alias of aliases) {
          if (normalizedQuery.includes(alias.toLowerCase())) {
            matchingAliasesInQuery++;
          }
        }

        if (matchingAliasesInQuery > 0) {
          const docHasConcept = aliases.some(alias =>
            lowerContent.includes(alias.toLowerCase()) ||
            lowerDoc.includes(alias.toLowerCase()) ||
            lowerSec.includes(alias.toLowerCase())
          );
          if (docHasConcept) {
            score += 6.0 + Math.min(matchingAliasesInQuery * 2.0, 4.0);
          }
        }
      }

      // Normalize to 0.0 - 0.98 range
      const normalizedScore = Math.min(score / 12.0, 0.98);

      return {
        chunk,
        similarity: normalizedScore
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  private async searchWithEmbeddings(query: string, limit: number): Promise<SearchResult[]> {
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
      throw new Error(`Embedding API failed with status ${res.status}`);
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    const queryVector = data.data[0].embedding;

    for (const chunk of this.chunks) {
      if (!chunk.embedding) {
        const chunkRes = await fetch(`${config.llm.baseUrl}/embeddings`, {
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
        if (chunkRes.ok) {
          const chunkData = await chunkRes.json() as { data: Array<{ embedding: number[] }> };
          chunk.embedding = chunkData.data[0].embedding;
        }
      }
    }

    const scored = this.chunks
      .filter(c => !!c.embedding)
      .map(chunk => ({
        chunk,
        similarity: cosineSimilarity(queryVector, chunk.embedding!),
      }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const localVectorStore = new LocalVectorStore();
