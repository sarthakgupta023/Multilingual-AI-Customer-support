export interface PolicyChunk {
  id: string;
  docId: string;
  docTitle: string;
  sectionTitle: string;
  content: string;
  embedding?: number[];
}

export interface SearchResult {
  chunk: PolicyChunk;
  similarity: number;
}

export interface GroundedAnswer {
  found: boolean;
  fullAnswer: string;
  spokenAnswer: string;
  sources: Array<{
    docId: string;
    docTitle: string;
    sectionTitle: string;
  }>;
  suggestTicket: boolean;
  similarityScore: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}
